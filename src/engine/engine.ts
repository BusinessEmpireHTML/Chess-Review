import type { PositionEval } from '../lib/types';
import { LineCollector, parseBestMove, parseInfo, type InfoLine } from './uci';

export interface AnalysisJob {
  /** FEN the game started from. */
  startFen: string;
  /** UCI moves from the start to the position to analyze (gives the engine repetition history). */
  moves: string[];
  depth: number;
  /** Lines to report; defaults to the MultiPV the engine was started with. */
  multiPv?: number;
}

export interface LoadProgress {
  percent: number;
  loaded: number;
  total: number;
}

/**
 * One Stockfish Web Worker speaking UCI. Jobs run one at a time per engine;
 * the pool hands out work.
 */
export class UciEngine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private failures = new Set<(err: Error) => void>();
  private searching = false;
  private multiPv = 1;
  /** Serializes newGame/analyze so a new run never talks over a search that is still stopping. */
  private lock: Promise<unknown> = Promise.resolve();
  dead = false;
  onLoadProgress?: (p: LoadProgress) => void;

  constructor(scriptUrl: string) {
    this.worker = new Worker(scriptUrl);
    this.worker.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        for (const l of [...this.listeners]) l(e.data);
      } else if (e.data && typeof e.data.percent === 'number') {
        this.onLoadProgress?.(e.data as LoadProgress);
      }
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.fail(new Error(e.message || 'The engine worker crashed.'));
    };
  }

  private fail(err: Error) {
    this.dead = true;
    for (const f of [...this.failures]) f(err);
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  /** Resolve with the first line matching `done`, feeding every line to `onLine`. */
  private collect(done: (line: string) => boolean, onLine?: (line: string) => void, timeoutMs = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.listeners.delete(listener);
        this.failures.delete(failure);
        if (timer) clearTimeout(timer);
      };
      const listener = (line: string) => {
        onLine?.(line);
        if (done(line)) {
          cleanup();
          resolve(line);
        }
      };
      const failure = (err: Error) => {
        cleanup();
        reject(err);
      };
      this.listeners.add(listener);
      this.failures.add(failure);
      if (timeoutMs) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error('The engine did not respond in time.'));
        }, timeoutMs);
      }
    });
  }

  async init(options: Record<string, string | number>, timeoutMs = 60_000): Promise<void> {
    const ok = this.collect((l) => l === 'uciok', undefined, timeoutMs);
    this.send('uci');
    await ok;
    for (const [name, value] of Object.entries(options)) this.send(`setoption name ${name} value ${value}`);
    if (options.MultiPV !== undefined) this.multiPv = Number(options.MultiPV);
    await this.ready();
  }

  async ready(): Promise<void> {
    const ok = this.collect((l) => l === 'readyok', undefined, 30_000);
    this.send('isready');
    await ok;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  newGame(): Promise<void> {
    return this.exclusive(async () => {
      this.send('ucinewgame');
      await this.ready();
    });
  }

  /** Search one position to a fixed depth with the configured MultiPV. */
  analyze(job: AnalysisJob, onInfo?: (info: InfoLine) => void): Promise<PositionEval> {
    return this.exclusive(() => this.search(job, onInfo));
  }

  /**
   * Like analyze, but checks `shouldRun` when the job reaches the front of
   * the queue and skips it (resolving null) if it is no longer wanted.
   */
  analyzeIf(job: AnalysisJob, shouldRun: () => boolean, onInfo?: (info: InfoLine) => void): Promise<PositionEval | null> {
    return this.exclusive(() => (shouldRun() ? this.search(job, onInfo) : Promise.resolve(null)));
  }

  private async search(job: AnalysisJob, onInfo?: (info: InfoLine) => void): Promise<PositionEval> {
    if (this.dead) throw new Error('Engine terminated.');
    if (job.multiPv !== undefined && job.multiPv !== this.multiPv) {
      this.send(`setoption name MultiPV value ${job.multiPv}`);
      this.multiPv = job.multiPv;
      await this.ready();
    }
    this.searching = true;
    const collector = new LineCollector();
    try {
      const done = this.collect(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const info = parseInfo(l);
          if (info) {
            collector.push(info);
            onInfo?.(info);
          }
        },
      );
      this.send(`position fen ${job.startFen}${job.moves.length ? ' moves ' + job.moves.join(' ') : ''}`);
      this.send(`go depth ${job.depth}`);
      const best = parseBestMove(await done);
      const lines = collector.lines();
      // Keep the engine's bestmove first even in the rare case its MultiPV order disagrees.
      if (best && lines.length > 1 && lines[0].move !== best) {
        const idx = lines.findIndex((l) => l.move === best);
        if (idx > 0) lines.unshift(...lines.splice(idx, 1));
      }
      return { lines, depth: collector.depth || job.depth };
    } finally {
      this.searching = false;
    }
  }

  /** Abort the current search (its `analyze` promise still resolves, with partial lines). */
  stop(): void {
    if (this.searching) this.send('stop');
  }

  get busy(): boolean {
    return this.searching;
  }

  terminate(): void {
    this.dead = true;
    this.worker.terminate();
    this.fail(new Error('Engine terminated.'));
  }
}
