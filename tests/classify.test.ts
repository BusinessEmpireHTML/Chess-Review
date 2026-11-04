import { describe, expect, it } from 'vitest';
import { CLASSIFICATION } from '../src/config/classification';
import { classifyMove, couldBeBrilliant, eplBand, evaluateMove, type MoveFacts } from '../src/lib/classify';
import type { EngineLine, PositionEval, Score } from '../src/lib/types';
import { winPercent } from '../src/lib/winprob';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });
const line = (move: string, score: Score): EngineLine => ({ move, score, pv: [move], depth: 16 });
const pos = (...lines: EngineLine[]): PositionEval => ({ lines, depth: 16 });
const ep = (s: Score) => winPercent(s) / 100;

/** Facts for an ordinary, non-book, non-sacrificial move. */
const facts = (over: Partial<MoveFacts>): MoveFacts => ({
  isBook: false,
  playedIsBest: false,
  bestEP: 0.55,
  playedEP: 0.55,
  secondEP: 0.53,
  sacrifice: 0,
  isRecapture: false,
  ...over,
});

describe('eplBand thresholds (inclusive upper bounds)', () => {
  it.each([
    [0, 'excellent'],
    [0.02, 'excellent'],
    [0.0201, 'good'],
    [0.05, 'good'],
    [0.0501, 'inaccuracy'],
    [0.1, 'inaccuracy'],
    [0.1001, 'mistake'],
    [0.2, 'mistake'],
    [0.2001, 'blunder'],
    [0.9, 'blunder'],
  ] as const)('EPL %f -> %s', (epl, expected) => {
    expect(eplBand(epl)).toBe(expected);
  });
});

describe('classifyMove', () => {
  it('Book overrides everything, even a large EPL', () => {
    expect(classifyMove(facts({ isBook: true, bestEP: 0.6, playedEP: 0.2 }))).toBe('book');
    expect(classifyMove(facts({ isBook: true, playedIsBest: true, sacrifice: 9 }))).toBe('book');
  });

  it('Best: the engine top move with a close second', () => {
    expect(classifyMove(facts({ playedIsBest: true, bestEP: 0.6, playedEP: 0.6, secondEP: 0.58 }))).toBe('best');
  });

  it('Best: a forced move (no second line) is never Great', () => {
    expect(classifyMove(facts({ playedIsBest: true, secondEP: null }))).toBe('best');
  });

  it('Great: best move and the second-best loses >= 0.10', () => {
    expect(classifyMove(facts({ playedIsBest: true, bestEP: 0.6, playedEP: 0.6, secondEP: 0.5 }))).toBe('great');
    expect(classifyMove(facts({ playedIsBest: true, bestEP: 0.6, playedEP: 0.6, secondEP: 0.5001 }))).toBe('best');
  });

  it('Great: obvious recaptures stay Best unless the refinement is turned off', () => {
    const f = facts({ playedIsBest: true, bestEP: 0.5, playedEP: 0.5, secondEP: 0.1, isRecapture: true });
    expect(classifyMove(f)).toBe('best');
    const pure = { ...CLASSIFICATION, great: { ...CLASSIFICATION.great, excludeRecaptures: false } };
    expect(classifyMove(f, pure)).toBe('great');
  });

  it('Excellent / Good / Inaccuracy / Mistake / Blunder follow the EPL bands', () => {
    const at = (loss: number) => classifyMove(facts({ bestEP: 0.7, playedEP: 0.7 - loss }));
    expect(at(0.01)).toBe('excellent');
    expect(at(0.04)).toBe('good');
    expect(at(0.08)).toBe('inaccuracy');
    expect(at(0.15)).toBe('mistake');
    expect(at(0.45)).toBe('blunder');
  });

  it('a non-best move that is evaluated better than best clamps to EPL 0 (Excellent)', () => {
    expect(classifyMove(facts({ bestEP: 0.6, playedEP: 0.62 }))).toBe('excellent');
  });

  describe('Brilliant', () => {
    const sac = facts({ playedIsBest: true, bestEP: 0.6, playedEP: 0.6, secondEP: 0.4, sacrifice: 3 });

    it('best move + real sacrifice + not already winning + not losing after', () => {
      expect(classifyMove(sac)).toBe('brilliant');
    });

    it('an Excellent (not top) move can be Brilliant', () => {
      expect(classifyMove({ ...sac, playedIsBest: false, playedEP: 0.585 })).toBe('brilliant');
    });

    it('a merely Good move with a sacrifice is not Brilliant', () => {
      expect(classifyMove({ ...sac, playedIsBest: false, playedEP: 0.56 })).toBe('good');
    });

    it('a pawn sacrifice (below the minimum) is not Brilliant', () => {
      expect(classifyMove({ ...sac, sacrifice: 1 })).toBe('great');
    });

    it('is not Brilliant when the mover was already completely winning (win% >= 90)', () => {
      expect(classifyMove({ ...sac, bestEP: 0.9, playedEP: 0.9, secondEP: 0.85 })).toBe('best');
      expect(classifyMove({ ...sac, bestEP: 0.899, playedEP: 0.899, secondEP: 0.85 })).toBe('brilliant');
    });

    it('is not Brilliant when the mover is losing after the move', () => {
      expect(classifyMove({ ...sac, bestEP: 0.35, playedEP: 0.35, secondEP: 0.3 })).toBe('best');
    });

    it('couldBeBrilliant gates the expensive sacrifice search on the same conditions', () => {
      expect(couldBeBrilliant(sac)).toBe(true);
      expect(couldBeBrilliant({ ...sac, bestEP: 0.95 })).toBe(false);
      expect(couldBeBrilliant({ ...sac, isBook: true })).toBe(false);
      expect(couldBeBrilliant({ ...sac, playedIsBest: false, playedEP: 0.5 })).toBe(false);
    });

    it('works with mate scores: a sacrifice that leads to mate is Brilliant', () => {
      // Position was roughly equal (55%), the sacrifice forces mate (100%).
      expect(classifyMove(facts({ playedIsBest: true, bestEP: 0.55, playedEP: 1, secondEP: 0.5, sacrifice: 5 }))).toBe('brilliant');
    });
  });

  describe('Miss', () => {
    it('failing to punish an opponent blunder is a Miss', () => {
      expect(
        classifyMove(facts({ bestEP: 0.9, playedEP: 0.75, prevClassification: 'blunder', moverEPBeforePrev: 0.5 })),
      ).toBe('miss');
    });

    it('also after an opponent mistake', () => {
      expect(
        classifyMove(facts({ bestEP: 0.7, playedEP: 0.58, prevClassification: 'mistake', moverEPBeforePrev: 0.5 })),
      ).toBe('miss');
    });

    it('needs EPL >= 0.10 against the punishing move', () => {
      expect(
        classifyMove(facts({ bestEP: 0.7, playedEP: 0.62, prevClassification: 'blunder', moverEPBeforePrev: 0.5 })),
      ).toBe('inaccuracy');
    });

    it('is not a Miss after an opponent inaccuracy', () => {
      expect(
        classifyMove(facts({ bestEP: 0.7, playedEP: 0.55, prevClassification: 'inaccuracy', moverEPBeforePrev: 0.5 })),
      ).toBe('mistake');
    });

    it('keeps Blunder when the move leaves the mover worse than before the opponent erred', () => {
      const f = facts({ bestEP: 0.9, playedEP: 0.2, prevClassification: 'blunder', moverEPBeforePrev: 0.5 });
      expect(classifyMove(f)).toBe('blunder');
      const pure = { ...CLASSIFICATION, miss: { ...CLASSIFICATION.miss, keepBlunderIfWorseThanBefore: false } };
      expect(classifyMove(f, pure)).toBe('miss');
    });

    it('the best move after an opponent blunder is Best, not Miss', () => {
      expect(
        classifyMove(facts({ playedIsBest: true, bestEP: 0.9, playedEP: 0.9, secondEP: 0.88, prevClassification: 'blunder' })),
      ).toBe('best');
    });
  });
});

describe('evaluateMove (scores, sign flips, mate edge cases)', () => {
  it('top move: EPL 0 and playedIsBest', () => {
    const ev = evaluateMove(pos(line('e2e4', cp(30)), line('d2d4', cp(25))), pos(line('e7e5', cp(-35))), 'e2e4')!;
    expect(ev.playedIsBest).toBe(true);
    expect(ev.epl).toBe(0);
  });

  it('uses the second MultiPV line directly when the played move is the second-best', () => {
    const ev = evaluateMove(pos(line('e2e4', cp(60)), line('d2d4', cp(20))), pos(line('d7d5', cp(-80))), 'd2d4')!;
    expect(ev.played.ep).toBeCloseTo(ep(cp(20)), 10);
    expect(ev.epl).toBeCloseTo(ep(cp(60)) - ep(cp(20)), 10);
  });

  it('otherwise flips the next position eval (opponent to move) to the mover', () => {
    // After the move the opponent is +150 => the mover is -150.
    const ev = evaluateMove(pos(line('e2e4', cp(30)), line('d2d4', cp(25))), pos(line('e7e5', cp(150))), 'g2g4')!;
    expect(ev.played.ep).toBeCloseTo(ep(cp(-150)), 10);
    expect(ev.played.cp).toBe(-150);
    expect(ev.epl).toBeCloseTo(ep(cp(30)) - ep(cp(-150)), 10);
    expect(ev.playedIsBest).toBe(false);
  });

  it('treats a move that still mates (more slowly) as no loss', () => {
    // Best is mate in 3; the played move leaves the opponent getting mated in 5.
    const ev = evaluateMove(pos(line('d1h5', mate(3)), line('d1f3', cp(400))), pos(line('g7g6', mate(-5))), 'f1c4')!;
    expect(ev.played.ep).toBe(1);
    expect(ev.played.mate).toBe(5);
    expect(ev.epl).toBe(0);
    expect(classifyMove(facts({ bestEP: ev.best.ep, playedEP: ev.played.ep, playedIsBest: ev.playedIsBest }))).toBe('excellent');
  });

  it('missing a mate but staying clearly winning is a small loss', () => {
    // Best mate in 2 (100%); played move leaves the opponent at -8.00 (mover +8).
    const ev = evaluateMove(pos(line('d1h5', mate(2))), pos(line('g7g6', cp(-800))), 'b1c3')!;
    expect(ev.epl).toBeCloseTo(1 - ep(cp(800)), 10);
    expect(eplBand(ev.epl)).toBe('good');
  });

  it('allowing a forced mate from a level position is a Blunder', () => {
    const ev = evaluateMove(pos(line('g1f3', cp(50))), pos(line('d8h4', mate(3))), 'f2f3')!;
    expect(ev.played.ep).toBe(0);
    expect(ev.played.mate).toBe(-3);
    expect(eplBand(ev.epl)).toBe('blunder');
  });

  it('when every move gets mated, a slower mate is no loss', () => {
    const ev = evaluateMove(pos(line('e1f1', mate(-4)), line('e1d1', mate(-2))), pos(line('a8a1', mate(2))), 'e1e2')!;
    expect(ev.best.ep).toBe(0);
    expect(ev.played.ep).toBe(0);
    expect(ev.epl).toBe(0);
  });

  it('delivering checkmate counts as best even if the engine listed another mate first', () => {
    const ev = evaluateMove(pos(line('h5f7', mate(1)), line('c4f7', mate(1))), { lines: [], terminal: 'checkmate', depth: 0 }, 'h5f7')!;
    expect(ev.playedIsBest).toBe(true);
    const other = evaluateMove(pos(line('d1d8', mate(1))), { lines: [], terminal: 'checkmate', depth: 0 }, 'h5f7')!;
    expect(other.playedIsBest).toBe(true);
    expect(other.played.mate).toBe(0);
  });

  it('stalemating a won position is a Blunder', () => {
    const ev = evaluateMove(pos(line('g7g8q', mate(1))), { lines: [], terminal: 'draw', depth: 0 }, 'b6c7')!;
    expect(ev.played.ep).toBe(0.5);
    expect(ev.epl).toBe(0.5);
    expect(eplBand(ev.epl)).toBe('blunder');
  });

  it('a second line with an identical score is a tie for best', () => {
    const ev = evaluateMove(pos(line('a1a8', mate(2)), line('h1h8', mate(2))), pos(line('g8h7', mate(-1))), 'h1h8')!;
    expect(ev.playedIsBest).toBe(true);
  });

  it('returns null when the position has no engine lines', () => {
    expect(evaluateMove(pos(), pos(line('e7e5', cp(0))), 'e2e4')).toBeNull();
  });
});
