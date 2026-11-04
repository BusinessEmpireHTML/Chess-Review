import { describe, expect, it } from 'vitest';
import type { Outcome } from '../src/lib/classify';
import { lossPhrase } from '../src/lib/explain';

const o = (ep: number, cp: number, mate: number | null = null): Outcome => ({ ep, cp, mate });

describe('lossPhrase', () => {
  it('reports pawns of advantage lost', () => {
    expect(lossPhrase(o(0.6, 100), o(0.35, -200))).toBe('This loses about 3 pawns of advantage.');
    expect(lossPhrase(o(0.55, 50), o(0.5, 0))).toBe('This loses about 0.5 pawns of advantage.');
    expect(lossPhrase(o(0.55, 50), o(0.52, -50))).toBe('This loses about 1.0 pawn of advantage.');
  });
  it('reports missed and allowed mates', () => {
    expect(lossPhrase(o(1, 99_700, 3), o(0.9, 600))).toBe('This misses mate in 3.');
    expect(lossPhrase(o(0.55, 50), o(0, -99_800, -2))).toBe('This allows mate in 2.');
  });
  it('calls out thrown-away wins and turned-around games', () => {
    expect(lossPhrase(o(0.85, 500), o(0.5, 0))).toMatch(/^This throws away a winning position/);
    expect(lossPhrase(o(0.5, 0), o(0.2, -400))).toMatch(/^This turns the game into a losing position/);
  });
});
