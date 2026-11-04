import { describe, expect, it } from 'vitest';
import { gameAccuracy, moveAccuracy } from '../src/lib/accuracy';

const f = (loss: number) => 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411;

describe('moveAccuracy (Lichess per-move curve)', () => {
  it('is 100 when the mover keeps or improves their win%', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(40, 70)).toBe(100);
  });

  it('follows 103.1668 * exp(-0.04354 * loss) - 3.1669', () => {
    expect(moveAccuracy(60, 50)).toBeCloseTo(f(10), 10);
    expect(moveAccuracy(60, 50)).toBeCloseTo(63.58, 1);
    expect(moveAccuracy(80, 79)).toBeCloseTo(f(1), 10);
  });

  it('is clamped to [0, 100]', () => {
    expect(moveAccuracy(100, 0)).toBe(0);
    expect(moveAccuracy(50, 49.999)).toBeLessThanOrEqual(100);
  });
});

describe('gameAccuracy (volatility-weighted + harmonic mean)', () => {
  it('gives 100 to both players when nobody loses win%', () => {
    const acc = gameAccuracy([50, 50, 50, 50, 50, 50]);
    expect(acc.w).toBeCloseTo(100, 10);
    expect(acc.b).toBeCloseTo(100, 10);
  });

  it('matches a hand-computed example', () => {
    // 4 moves -> window size 2. Windows: [50,40] [40,40] [40,40] [40,40]
    // Weights (population std dev, clamped to [0.5, 12]): 5, 0.5, 0.5, 0.5
    // White: ply 0 loses 10 (weight 5), ply 2 loses 0 (weight 0.5). Black loses nothing.
    const acc = gameAccuracy([50, 40, 40, 40, 40]);
    const a = f(10);
    const weighted = (a * 5 + 100 * 0.5) / 5.5;
    const harmonic = 2 / (1 / a + 1 / 100);
    expect(acc.w).toBeCloseTo((weighted + harmonic) / 2, 10);
    expect(acc.b).toBeCloseTo(100, 10);
    expect(acc.perMove).toHaveLength(4);
    expect(acc.perMove[0]).toBeCloseTo(a, 10);
  });

  it('reads Black win% from White POV correctly (sign flip)', () => {
    // White's win% rises from 50 to 80 on Black's move: that is Black losing 30.
    const acc = gameAccuracy([50, 50, 80, 80]);
    expect(acc.w).toBeCloseTo(100, 10);
    expect(acc.perMove[1]).toBeCloseTo(f(30), 10);
    expect(acc.b!).toBeLessThan(50);
  });

  it('handles games where Black moves first', () => {
    const acc = gameAccuracy([50, 80, 80], 'b');
    // ply 0 is Black's: White's win% going 50 -> 80 is a 30-point loss for Black.
    expect(acc.perMove[0]).toBeCloseTo(f(30), 10);
    expect(acc.w).toBeCloseTo(100, 10);
  });

  it('returns null for a side with no moves', () => {
    const acc = gameAccuracy([50, 55]);
    expect(acc.w).toBeCloseTo(100, 10);
    expect(acc.b).toBeNull();
    expect(gameAccuracy([50]).w).toBeNull();
  });

  it('matches the lichess windowing at window size 3 (30+ moves)', () => {
    // lila: windows = (windowSize - 2) copies of the first window, then sliding windows,
    // so with size 3 move i is weighted by std(x[i-1], x[i], x[i+1]) (move 0 by x[0..2]).
    const x = [50, 52, 48, 55, 40, 45, 70, 30, 35, 60, 58, 20, 25, 90, 85, 50, 52, 49, 47, 60, 30, 33, 31, 35, 80, 78, 20, 22, 50, 51, 49, 55];
    expect(x.length - 1).toBe(31); // 31 moves -> floor(31 / 10) = 3
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    const weights = x.slice(0, -1).map((_, i) => {
      const w = i === 0 ? x.slice(0, 3) : x.slice(i - 1, i + 2);
      return Math.min(12, Math.max(0.5, sd(w)));
    });
    const expected = (color: 'w' | 'b') => {
      const accs: number[] = [];
      const ws: number[] = [];
      for (let i = 0; i < 31; i++) {
        if ((i % 2 === 0 ? 'w' : 'b') !== color) continue;
        const loss = color === 'w' ? x[i] - x[i + 1] : x[i + 1] - x[i];
        accs.push(loss <= 0 ? 100 : Math.min(100, Math.max(0, f(loss))));
        ws.push(weights[i]);
      }
      const weighted = accs.reduce((s, a, k) => s + a * ws[k], 0) / ws.reduce((a, b) => a + b, 0);
      const harmonic = accs.length / accs.reduce((s, a) => s + 1 / Math.max(1, a), 0);
      return (weighted + harmonic) / 2;
    };
    const acc = gameAccuracy(x);
    expect(acc.w).toBeCloseTo(expected('w'), 10);
    expect(acc.b).toBeCloseTo(expected('b'), 10);
  });
});
