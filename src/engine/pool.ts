import type { PositionEval } from '../lib/types';
import { UciEngine, type LoadProgress } from './engine';

export interface EngineFlavor {
  id: string;
  label: string;
  /** Script file inside /engine (the matching .wasm sits next to it). */
  file: string;
  sizeMB: number;
  /** Upper bound on parallel workers (the full network needs ~100 MB of memory per worker). */
  maxWorkers: number;
  hashMB: number;
}

/** Always shipped; matches what scripts/copy-engine.mjs copies. */
export const LITE_ENGINE: EngineFlavor = {
  id: 'lite',
  label: 'Stockfish 19 Lite',
  file: 'stockfish-19-lite-single.js',
  sizeMB: 1.8,
  maxWorkers: 4,
  hashMB: 32,
};

/** Engine builds bundled with this deployment (engine/manifest.json, written at build time). */
export async function loadEngineFlavors(): Promise<EngineFlavor[]> {
  try {
    const res = await fetch(new URL('engine/manifest.json', document.baseURI));
    if (!res.ok) throw new Error(String(res.status));
    const list = (await res.json()) as EngineFlavor[];
    return list.length ? list : [LITE_ENGINE];
  } catch {
    return [LITE_ENGINE];
  }
}

export function engineUrl(flavor: EngineFlavor): string {
  return new URL(`engine/${flavor.file}`, document.baseURI).href;
}

/** Large builds (the full network) need far longer to download and compile. */
export function startTimeout(flavor: EngineFlavor): number {
  return flavor.sizeMB > 20 ? 300_000 : 60_000;
}

export function defaultPoolSize(flavor: EngineFlavor): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const memory = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  let n = Math.max(1, Math.min(4, cores - 1));
  if (memory !== undefined && memory <= 4) n = Math.min(n, 2);
  return Math.min(n, flavor.maxWorkers);
}

export interface RunHandle {
  done: Promise<void>;
  cancel(): void;
  /** Move these position indices to the front of the queue (e.g. the move the user is looking at). */
  prioritize(indices: number[]): void;
}

/**
 * A pool of single-threaded Stockfish workers. Each worker searches a
 * different position, which uses several cores without SharedArrayBuffer, so
 * it works on any static host (no COOP/COEP headers needed).
 */
export class EnginePool {
  private engines: UciEngine[] = [];
  private starting: Promise<void> | null = null;

  constructor(
    readonly flavor: EngineFlavor,
    readonly size: number = defaultPoolSize(flavor),
  ) {}

  /** Start (or restart dead) workers. `onLoad` reports the WASM download of the first worker. */
  start(onLoad?: (p: LoadProgress) => void): Promise<void> {
    this.engines = this.engines.filter((e) => !e.dead);
    if (this.engines.length >= this.size) return Promise.resolve();
    this.starting ??= (async () => {
      const url = engineUrl(this.flavor);
      const fresh: UciEngine[] = [];
      for (let i = this.engines.length; i < this.size; i++) {
        const e = new UciEngine(url);
        if (i === 0 && onLoad) e.onLoadProgress = onLoad;
        fresh.push(e);
      }
      const results = await Promise.allSettled(
        fresh.map((e) => e.init({ MultiPV: 2, Hash: this.flavor.hashMB }, startTimeout(this.flavor))),
      );
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') this.engines.push(fresh[i]);
        else fresh[i].terminate();
      });
      if (!this.engines.length) {
        const err = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        throw new Error(`Stockfish failed to start: ${err?.reason?.message ?? 'unknown error'}`);
      }
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /**
   * Analyze positions of a game. Position i is the position after the first
   * i moves. Results arrive through `onResult` as each search finishes.
   */
  run(
    game: { startFen: string; uciMoves: string[] },
    indices: number[],
    depth: number,
    onResult: (index: number, result: PositionEval) => void,
  ): RunHandle {
    const queue = [...indices];
    let cancelled = false;
    const engines = this.engines.filter((e) => !e.dead);

    const work = async (engine: UciEngine) => {
      await engine.newGame();
      while (!cancelled && queue.length) {
        const i = queue.shift()!;
        try {
          const result = await engine.analyze({ startFen: game.startFen, moves: game.uciMoves.slice(0, i), depth });
          if (cancelled) return;
          onResult(i, result);
        } catch (err) {
          if (!cancelled) queue.unshift(i); // let a healthy worker pick it up
          if (engine.dead) return;
          throw err;
        }
      }
    };

    const done = Promise.allSettled(engines.map(work)).then((results) => {
      if (cancelled || !queue.length) return;
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      throw new Error(`Analysis stopped: ${failure?.reason?.message ?? 'all engine workers crashed'}`);
    });

    return {
      done,
      cancel: () => {
        cancelled = true;
        queue.length = 0;
        for (const e of engines) e.stop();
      },
      prioritize: (wanted) => {
        const front = wanted.filter((i) => queue.includes(i));
        if (!front.length) return;
        const rest = queue.filter((i) => !front.includes(i));
        queue.splice(0, queue.length, ...front, ...rest);
      },
    };
  }

  get workerCount(): number {
    return this.engines.filter((e) => !e.dead).length;
  }

  terminate(): void {
    for (const e of this.engines) e.terminate();
    this.engines = [];
  }
}
