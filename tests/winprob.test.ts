import { describe, expect, it } from 'vitest';
import { scoreToCp, whiteView, winPercent, winPercentFor } from '../src/lib/winprob';

const cp = (value: number) => ({ type: 'cp' as const, value });
const mate = (value: number) => ({ type: 'mate' as const, value });

describe('winPercent (Lichess formula, side-to-move POV)', () => {
  it('is 50% for an equal position', () => {
    expect(winPercent(cp(0))).toBe(50);
  });

  it('matches the Lichess curve at known points', () => {
    // 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
    expect(winPercent(cp(100))).toBeCloseTo(59.1, 1);
    expect(winPercent(cp(300))).toBeCloseTo(75.11, 1);
    expect(winPercent(cp(-300))).toBeCloseTo(24.89, 1);
  });

  it('is symmetric: W(cp) + W(-cp) = 100', () => {
    for (const v of [13, 87, 250, 900, 2400]) expect(winPercent(cp(v)) + winPercent(cp(-v))).toBeCloseTo(100, 10);
  });

  it('treats mate as 100% / 0%, regardless of distance', () => {
    expect(winPercent(mate(1))).toBe(100);
    expect(winPercent(mate(27))).toBe(100);
    expect(winPercent(mate(-1))).toBe(0);
    expect(winPercent(mate(-12))).toBe(0);
  });

  it('treats "mate 0" (side to move is checkmated) as 0%', () => {
    expect(winPercent(mate(0))).toBe(0);
  });

  it('never reaches 100% for a finite centipawn score', () => {
    expect(winPercent(cp(5000))).toBeLessThanOrEqual(100);
    expect(winPercent(cp(900))).toBeLessThan(winPercent(mate(30)));
  });
});

describe('winPercentFor (perspective flips)', () => {
  it('returns the same value when pov is the side to move', () => {
    expect(winPercentFor(cp(120), 'b', 'b')).toBeCloseTo(winPercent(cp(120)), 10);
  });

  it('flips for the other side', () => {
    expect(winPercentFor(cp(120), 'b', 'w')).toBeCloseTo(100 - winPercent(cp(120)), 10);
    expect(winPercentFor(mate(3), 'b', 'w')).toBe(0); // Black to move mates in 3 -> White 0%
    expect(winPercentFor(mate(-3), 'b', 'w')).toBe(100); // Black to move gets mated -> White 100%
    expect(winPercentFor(mate(0), 'b', 'w')).toBe(100); // Black is checkmated
  });
});

describe('scoreToCp', () => {
  it('passes centipawns through', () => expect(scoreToCp(cp(-42))).toBe(-42));
  it('ranks closer mates higher', () => {
    expect(scoreToCp(mate(1))).toBeGreaterThan(scoreToCp(mate(5)));
    expect(scoreToCp(mate(5))).toBeGreaterThan(scoreToCp(cp(5000)));
    expect(scoreToCp(mate(-1))).toBeLessThan(scoreToCp(mate(-5)));
    expect(scoreToCp(mate(0))).toBeLessThan(scoreToCp(mate(-1)));
  });
});

describe('whiteView labels', () => {
  it('formats centipawns from White POV', () => {
    expect(whiteView(cp(124), 'w').label).toBe('+1.24');
    expect(whiteView(cp(124), 'b').label).toBe('-1.24');
    expect(whiteView(cp(0), 'b').label).toBe('0.00');
  });
  it('formats mates from White POV', () => {
    expect(whiteView(mate(3), 'w').label).toBe('M3');
    expect(whiteView(mate(3), 'b').label).toBe('-M3');
    expect(whiteView(mate(-2), 'b').label).toBe('M2');
  });
  it('shows the result for a checkmated side to move', () => {
    expect(whiteView(mate(0), 'w').label).toBe('0-1');
    expect(whiteView(mate(0), 'b').label).toBe('1-0');
    expect(whiteView(mate(0), 'b').win).toBe(100);
  });
});
