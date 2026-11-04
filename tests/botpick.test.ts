import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, botLevel } from '../src/config/play';
import { pickBotMove, seededRng } from '../src/lib/botpick';
import type { EngineLine, Score } from '../src/lib/types';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });
const line = (move: string, score: Score): EngineLine => ({ move, score, pv: [move], depth: 8 });
const legal = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'h2h4'];

function tally(lines: EngineLine[], level: number, n = 4000, seed = 1) {
  const rng = seededRng(seed);
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const m = pickBotMove(lines, botLevel(level), legal, rng);
    counts[m] = (counts[m] ?? 0) + 1;
  }
  return counts;
}

describe('pickBotMove', () => {
  const lines = [line('e2e4', cp(40)), line('d2d4', cp(30)), line('g1f3', cp(-250))];

  it('level 8 always plays the top line', () => {
    expect(Object.keys(tally(lines, 8))).toEqual(['e2e4']);
  });

  it('prefers better moves and makes big mistakes rarely at mid levels', () => {
    const c = tally(lines, 4);
    expect(c.e2e4).toBeGreaterThan(c.d2d4);
    expect(c.d2d4).toBeGreaterThan(c.g1f3 ?? 0);
    expect((c.g1f3 ?? 0) / 4000).toBeLessThan(0.05);
  });

  it('makes big mistakes far more often at level 1 than level 5', () => {
    const blunders = (lvl: number) => 4000 - (tally(lines, lvl).e2e4 ?? 0) - (tally(lines, lvl).d2d4 ?? 0);
    expect(blunders(1)).toBeGreaterThan(blunders(5) * 5);
  });

  it('finds a mate in one almost always from level 4 up', () => {
    const withMate = [line('d2d4', mate(1)), line('e2e4', cp(300))];
    for (const lvl of [4, 5, 6, 7, 8]) {
      const c = tally(withMate, lvl);
      expect(c.d2d4 / 4000).toBeGreaterThan(0.95);
    }
  });

  it('ignores engine lines that are not legal and falls back to a random legal move', () => {
    const rng = seededRng(3);
    expect(legal).toContain(pickBotMove([line('a7a5', cp(10))], botLevel(8), legal, rng));
    expect(legal).toContain(pickBotMove([], botLevel(8), legal, rng));
  });

  it('throws when there are no legal moves', () => {
    expect(() => pickBotMove(lines, botLevel(8), [], Math.random)).toThrow();
  });

  it('defines eight levels from weakest to strongest', () => {
    expect(BOT_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < BOT_LEVELS.length; i++) {
      expect(BOT_LEVELS[i].depth).toBeGreaterThanOrEqual(BOT_LEVELS[i - 1].depth);
      expect(BOT_LEVELS[i].temperature).toBeLessThanOrEqual(BOT_LEVELS[i - 1].temperature);
    }
  });
});
