import type { PositionEval } from '../lib/types';
import { UciEngine, type AnalysisJob } from './engine';
import { engineUrl, startTimeout, type EngineFlavor } from './pool';

/**
 * One dedicated Stockfish worker for interactive use (trying moves during a
 * review, playing against the bot). Separate from the analysis pool so a
 * user's move never waits behind the background game analysis. Only the
 * latest request matters: a new search stops the previous one, whose promise
 * resolves to null.
 */
export class InteractiveEngine {
  private engine: UciEngine | null = null;
  private starting: Promise<UciEngine> | null = null;
  private generation = 0;

  constructor(readonly flavor: EngineFlavor) {}

  private start(): Promise<UciEngine> {
    if (this.engine && !this.engine.dead) return Promise.resolve(this.engine);
    this.starting ??= (async () => {
      const e = new UciEngine(engineUrl(this.flavor));
      try {
        await e.init({ MultiPV: 2, Hash: this.flavor.hashMB }, startTimeout(this.flavor));
      } catch (err) {
        e.terminate();
        throw err;
      }
      this.engine = e;
      return e;
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Search a position; resolves null if a newer search superseded this one. */
  async search(job: AnalysisJob): Promise<PositionEval | null> {
    const gen = ++this.generation;
    const engine = await this.start();
    if (gen !== this.generation) return null;
    engine.stop();
    const result = await engine.analyzeIf(job, () => gen === this.generation);
    return gen === this.generation ? result : null;
  }

  /** Drop any pending or running search. */
  cancel(): void {
    this.generation++;
    this.engine?.stop();
  }

  terminate(): void {
    this.cancel();
    this.engine?.terminate();
    this.engine = null;
  }
}

let shared: InteractiveEngine | null = null;

export function getInteractiveEngine(flavor: EngineFlavor): InteractiveEngine {
  if (shared && shared.flavor.id !== flavor.id) {
    shared.terminate();
    shared = null;
  }
  return (shared ??= new InteractiveEngine(flavor));
}
