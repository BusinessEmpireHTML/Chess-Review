import type { BotLevel } from '../config/play';
import type { EngineLine } from './types';
import { winPercent } from './winprob';

/**
 * Choose the bot's move from the engine's MultiPV lines (best first, scores
 * from the bot's point of view). Pure apart from the injected `rng`, which
 * returns numbers in [0, 1).
 */
export function pickBotMove(lines: EngineLine[], level: BotLevel, legalMoves: string[], rng: () => number): string {
  if (!legalMoves.length) throw new Error('No legal moves.');
  const randomLegal = () => legalMoves[Math.min(legalMoves.length - 1, Math.floor(rng() * legalMoves.length))];
  if (level.randomMove > 0 && rng() < level.randomMove) return randomLegal();

  const candidates = lines.filter((l) => legalMoves.includes(l.move));
  if (!candidates.length) return randomLegal();
  if (level.temperature <= 0 || candidates.length === 1) return candidates[0].move;

  const wins = candidates.map((l) => winPercent(l.score));
  const best = Math.max(...wins);
  const weights = wins.map((w) => Math.exp(-(best - w) / level.temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r < 0) return candidates[i].move;
  }
  return candidates[candidates.length - 1].move;
}

/** Small seeded PRNG (mulberry32), for reproducible tests. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
