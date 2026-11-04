import { describe, expect, it } from 'vitest';
import { gradeMove, isPromotion, legalDests, legalUcis, lineMove, replay, terminalState } from '../src/lib/explore';
import type { EngineLine, PositionEval, Score } from '../src/lib/types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const cp = (value: number): Score => ({ type: 'cp', value });
const line = (move: string, score: Score): EngineLine => ({ move, score, pv: [move], depth: 16 });
const pos = (...lines: EngineLine[]): PositionEval => ({ lines, depth: 16 });

describe('lineMove', () => {
  it('makes a move and records SAN, squares and the resulting FEN', () => {
    const m = lineMove(START, 'g1f3')!;
    expect(m).toMatchObject({ san: 'Nf3', from: 'g1', to: 'f3', color: 'w', byEngine: false });
    expect(m.fenAfter.split(' ')[1]).toBe('b');
  });
  it('handles promotion and captures', () => {
    const m = lineMove('1n6/P6k/8/8/8/8/8/K7 w - - 0 1', 'a7b8n', true)!;
    expect(m.san).toBe('axb8=N');
    expect(m.captured).toBe('n');
    expect(m.byEngine).toBe(true);
  });
  it('returns null for an illegal move', () => {
    expect(lineMove(START, 'e2e5')).toBeNull();
  });
});

describe('board helpers', () => {
  it('lists legal destinations per square', () => {
    const d = legalDests(START);
    expect(d.size).toBe(10);
    expect(d.get('g1')!.sort()).toEqual(['f3', 'h3']);
    expect(legalUcis(START)).toHaveLength(20);
  });
  it('detects promotions', () => {
    expect(isPromotion('8/P6k/8/8/8/8/8/K7 w - - 0 1', 'a7', 'a8')).toBe(true);
    expect(isPromotion(START, 'e2', 'e4')).toBe(false);
  });
  it('detects game over with full history (checkmate, repetition)', () => {
    expect(terminalState(replay(START, ['f2f3', 'e7e5', 'g2g4', 'd8h4']))).toBe('checkmate');
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
    expect(terminalState(replay(START, shuffle))).toBe('draw');
    expect(terminalState(replay(START, shuffle.slice(0, 4)))).toBeUndefined();
  });
});

describe('gradeMove (same rules as game moves)', () => {
  const before = pos(line('e2e4', cp(30)), line('d2d4', cp(25)));

  it('grades the engine top move as Best', () => {
    const m = lineMove(START, 'e2e4')!;
    expect(gradeMove(before, pos(line('e7e5', cp(-30))), m)!.classification).toBe('best');
  });

  it('grades a weak try by expected-points loss', () => {
    const m = lineMove(START, 'g2g4')!;
    // After g4 the opponent is +1.50: the mover went from +0.30 to -1.50.
    const r = gradeMove(before, pos(line('d7d5', cp(150))), m)!;
    expect(r.classification).toBe('mistake');
    expect(r.evaluation.bestMove).toBe('e2e4');
    expect(r.accuracy).toBeLessThan(100);
  });

  it('spots a sacrifice the same way (Greek gift is Brilliant)', () => {
    const fen = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8';
    const m = lineMove(fen, 'd3h7')!;
    const r = gradeMove(pos(line('d3h7', cp(120)), line('e1g1', cp(20))), pos(line('g8h7', cp(-120))), m)!;
    expect(r.classification).toBe('brilliant');
    expect(r.sacrifice).toBe(2);
  });
});
