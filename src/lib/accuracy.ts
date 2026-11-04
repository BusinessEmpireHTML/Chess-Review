import { ACCURACY } from '../config/classification';
import type { Color } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Lichess per-move accuracy from the mover's win% before and after the move
 * (both 0..100, mover's point of view).
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const loss = winBefore - winAfter;
  const raw = ACCURACY.a * Math.exp(-ACCURACY.b * loss) + ACCURACY.c + ACCURACY.uncertaintyBonus;
  return clamp(raw, 0, 100);
}

function stdDev(xs: number[]): number {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function weightedMean(pairs: Array<[value: number, weight: number]>): number | null {
  let sum = 0;
  let totalWeight = 0;
  for (const [v, w] of pairs) {
    sum += v * w;
    totalWeight += w;
  }
  return totalWeight === 0 ? null : sum / totalWeight;
}

function harmonicMean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  // Lichess floors each value at 1 to avoid dividing by zero.
  return xs.length / xs.reduce((s, x) => s + 1 / Math.max(1, x), 0);
}

/** Sliding windows of the win% sequence, padded at the start the way lichess does it. */
function volatilityWindows(values: number[], windowSize: number): number[][] {
  const size = Math.min(windowSize, values.length);
  const first = values.slice(0, size);
  const windows: number[][] = [];
  for (let i = 0; i < size - 2; i++) windows.push(first);
  if (values.length <= windowSize) {
    windows.push(values.slice());
  } else {
    for (let i = 0; i + windowSize <= values.length; i++) windows.push(values.slice(i, i + windowSize));
  }
  return windows;
}

export interface GameAccuracy {
  w: number | null;
  b: number | null;
  /** Accuracy of each move (index = ply - 1), for the side that played it. */
  perMove: number[];
}

/**
 * Lichess game accuracy: the average of a volatility-weighted mean and a
 * harmonic mean of per-move accuracies, computed separately per color.
 *
 * @param whiteWin White's win% (0..100) for every position: index 0 is the
 *                 starting position, index i is the position after ply i.
 * @param startColor the color that makes the first move.
 */
export function gameAccuracy(whiteWin: number[], startColor: Color = 'w'): GameAccuracy {
  const moves = whiteWin.length - 1;
  if (moves < 1) return { w: null, b: null, perMove: [] };

  const windowSize = clamp(Math.floor(moves / 10), 2, 8);
  const weights = volatilityWindows(whiteWin, windowSize).map((xs) =>
    clamp(stdDev(xs), ACCURACY.minWeight, ACCURACY.maxWeight),
  );

  const perMove: number[] = [];
  const byColor: Record<Color, Array<[number, number]>> = { w: [], b: [] };
  for (let i = 0; i < moves; i++) {
    const color: Color = (i % 2 === 0) === (startColor === 'w') ? 'w' : 'b';
    const prev = whiteWin[i];
    const next = whiteWin[i + 1];
    const acc = color === 'w' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);
    perMove.push(acc);
    byColor[color].push([acc, weights[i]]);
  }

  const colorAccuracy = (c: Color): number | null => {
    const weighted = weightedMean(byColor[c]);
    const harmonic = harmonicMean(byColor[c].map(([a]) => a));
    if (weighted === null || harmonic === null) return null;
    return (weighted + harmonic) / 2;
  };

  return { w: colorAccuracy('w'), b: colorAccuracy('b'), perMove };
}
