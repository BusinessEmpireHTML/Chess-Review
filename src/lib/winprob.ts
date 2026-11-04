import { WIN_PROBABILITY } from '../config/classification';
import type { Color, Score } from './types';

/**
 * Win probability (0..100) for the side to move, from a score that is also
 * from the side to move's point of view. Lichess formula; mate is 100 / 0.
 */
export function winPercent(score: Score): number {
  if (score.type === 'mate') {
    // mate 0 = side to move is checkmated; negative = side to move gets mated.
    return score.value > 0 ? 100 : 0;
  }
  const x = 2 / (1 + Math.exp(-WIN_PROBABILITY.k * score.value)) - 1;
  return 50 + 50 * x;
}

/** Win probability (0..100) for `pov`, given a score for the side to move `stm`. */
export function winPercentFor(score: Score, stm: Color, pov: Color): number {
  const w = winPercent(score);
  return stm === pov ? w : 100 - w;
}

/**
 * Centipawns from the side to move's point of view, with mate mapped to a
 * large finite value (closer mates are larger). Used for "pawns of advantage"
 * wording and for the eval graph's clamp, never for classification.
 */
export function scoreToCp(score: Score): number {
  if (score.type === 'cp') return score.value;
  if (score.value === 0) return -100_000;
  return score.value > 0 ? 100_000 - score.value * 100 : -100_000 - score.value * 100;
}

export interface WhiteView {
  /** White's win probability, 0..100. */
  win: number;
  /** Label as shown on an eval bar: "+1.24", "-0.30", "M3", "-M2", "1-0", "0-1". */
  label: string;
  /** Centipawns from White's view (mate mapped to a large number). */
  cp: number;
}

/** Everything the eval bar / graph needs, from White's point of view. */
export function whiteView(score: Score, stm: Color): WhiteView {
  const sign = stm === 'w' ? 1 : -1;
  const win = winPercentFor(score, stm, 'w');
  const cp = sign * scoreToCp(score);
  let label: string;
  if (score.type === 'mate') {
    if (score.value === 0) {
      label = stm === 'w' ? '0-1' : '1-0';
    } else {
      const whiteMates = sign * score.value > 0;
      label = (whiteMates ? 'M' : '-M') + Math.abs(score.value);
    }
  } else {
    const p = (sign * score.value) / 100;
    label = Math.abs(p) < 0.005 ? '0.00' : (p > 0 ? '+' : '') + p.toFixed(2);
  }
  return { win, label, cp };
}
