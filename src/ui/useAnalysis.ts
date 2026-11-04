import { useEffect, useRef, useState } from 'preact/hooks';
import { EnginePool, type EngineFlavor, type RunHandle } from '../engine/pool';
import { cacheKey, getCached, putCached } from '../lib/cache';
import type { ParsedGame } from '../lib/pgn';
import type { PositionEval } from '../lib/types';

export type AnalysisStatus =
  | { phase: 'idle' }
  | { phase: 'loading-engine'; percent?: number }
  | { phase: 'analyzing'; workers: number }
  | { phase: 'done'; fromCache: boolean; seconds?: number }
  | { phase: 'error'; message: string };

let pool: EnginePool | null = null;

/** One pool for the whole session; replaced only when the engine build changes. */
function getPool(flavor: EngineFlavor): EnginePool {
  if (pool && pool.flavor.id !== flavor.id) {
    pool.terminate();
    pool = null;
  }
  return (pool ??= new EnginePool(flavor));
}

export function useAnalysis(game: ParsedGame | null, gameId: string, depth: number, flavor: EngineFlavor) {
  const [evals, setEvals] = useState<(PositionEval | undefined)[]>([]);
  const [status, setStatus] = useState<AnalysisStatus>({ phase: 'idle' });
  const run = useRef<RunHandle | null>(null);

  useEffect(() => {
    if (!game) return;
    let cancelled = false;
    const buffer: (PositionEval | undefined)[] = new Array(game.fens.length);
    setEvals([]);
    const key = cacheKey(gameId, flavor.id, depth);

    (async () => {
      const cached = await getCached(key);
      if (cancelled) return;
      if (cached && cached.length === game.fens.length) {
        setEvals(cached);
        setStatus({ phase: 'done', fromCache: true });
        return;
      }

      setStatus({ phase: 'loading-engine' });
      const engines = getPool(flavor);
      await engines.start((p) => !cancelled && setStatus({ phase: 'loading-engine', percent: p.percent }));
      if (cancelled) return;
      setStatus({ phase: 'analyzing', workers: engines.workerCount });

      const started = performance.now();
      const indices = game.fens.map((_, i) => i).filter((i) => !(i === game.plies.length && game.finalTerminal));
      let frame = 0;
      const flush = () => {
        frame = 0;
        if (!cancelled) setEvals(buffer.slice());
      };
      const handle = engines.run({ startFen: game.startFen, uciMoves: game.plies.map((p) => p.uci) }, indices, depth, (i, result) => {
        buffer[i] = result;
        frame ||= requestAnimationFrame(flush);
      });
      run.current = handle;
      await handle.done;
      if (cancelled) return;
      if (frame) cancelAnimationFrame(frame);
      flush();
      setStatus({ phase: 'done', fromCache: false, seconds: (performance.now() - started) / 1000 });
      await putCached(key, buffer as PositionEval[]);
    })().catch((err: Error) => {
      if (!cancelled) setStatus({ phase: 'error', message: err.message });
    });

    return () => {
      cancelled = true;
      run.current?.cancel();
      run.current = null;
    };
  }, [game, gameId, depth, flavor.id]);

  /** Bump positions the user is looking at to the front of the queue. */
  const prioritize = (indices: number[]) => run.current?.prioritize(indices);

  return { evals, status, prioritize };
}
