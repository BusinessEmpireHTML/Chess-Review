import { describe, expect, it } from 'vitest';
import { explain } from '../src/lib/explain';
import { createBook, detectBook, positionKey, type OpeningsData } from '../src/lib/openings';
import { parseGame, isRecapture } from '../src/lib/pgn';
import { buildReport } from '../src/lib/review';
import type { EngineLine, PositionEval, Score } from '../src/lib/types';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });
const line = (move: string, score: Score): EngineLine => ({ move, score, pv: [move], depth: 16 });
const pos = (...lines: EngineLine[]): PositionEval => ({ lines, depth: 16 });

// Scholar's mate: 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7#
const SCHOLAR = `[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

// Hand-written engine output (side-to-move POV), one entry per position before each ply.
const scholarEvals: PositionEval[] = [
  pos(line('e2e4', cp(30)), line('d2d4', cp(28))), // W
  pos(line('e7e5', cp(-30)), line('c7c5', cp(-32))), // B
  pos(line('g1f3', cp(35)), line('b1c3', cp(30))), // W plays Qh5 (not listed)
  pos(line('b8c6', cp(0)), line('g7g6', cp(-5))), // B (after Qh5 Black is fine: 0.00)
  pos(line('g1f3', cp(10)), line('f1c4', cp(5))), // W plays Bc4 = second line
  pos(line('g7g6', cp(-10)), line('d8e7', cp(-15))), // B plays Nf6?? (not listed)
  pos(line('h5f7', mate(1)), line('c4f7', cp(250))), // W mates
];

// A tiny fake book that knows 1. e4 and 1. e4 e5 only.
function fakeBook() {
  const g = parseGame(SCHOLAR);
  const data: OpeningsData = {
    names: { [positionKey(g.plies[0].fenAfter)]: ['B00', "King's Pawn"], [positionKey(g.plies[1].fenAfter)]: ['C20', "King's Pawn Game"] },
    book: [],
  };
  return createBook(data);
}

describe('buildReport on a full game', () => {
  const game = parseGame(SCHOLAR);
  const book = detectBook(game, fakeBook());
  const report = buildReport(game, scholarEvals, book);

  it('parses the game and detects the final checkmate', () => {
    expect(game.plies.map((p) => p.san)).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(game.finalTerminal).toBe('checkmate');
    expect(report.complete).toBe(true);
  });

  it('classifies every move', () => {
    expect(report.moves.map((m) => m?.classification)).toEqual([
      'book', // e4
      'book', // e5
      'good', // Qh5: best +0.35 (53.2%) vs 0.00 (50%) -> EPL 0.032
      'best', // Nc6
      'excellent', // Bc4: second MultiPV line, +0.05 vs +0.10 -> EPL 0.005
      'blunder', // Nf6?? allows mate in 1
      'great', // Qxf7#: mate vs +2.50 -> the only move
    ]);
  });

  it('computes White win% for every position, including the terminal one', () => {
    expect(report.whiteWin[0]).toBeGreaterThan(50);
    expect(report.whiteWin[6]).toBe(100); // White to move with mate in 1
    expect(report.whiteWin[7]).toBe(100); // Black is checkmated
    expect(report.whiteWin[3]).toBeCloseTo(50, 5); // Black to move, 0.00
  });

  it('gives the blunderer a much lower accuracy', () => {
    expect(report.accuracy.w!).toBeGreaterThan(report.accuracy.b!);
    expect(report.accuracy.b!).toBeLessThan(60);
    // Lichess per-move accuracy uses position evals: 50.9% -> 0% for Black is a 49.1-point loss.
    const loss = 100 - report.whiteWin[5]!;
    expect(report.moves[5]!.accuracy).toBeCloseTo(103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411, 8);
    expect(report.moves[5]!.accuracy).toBeLessThan(10);
  });

  it('counts classifications per player', () => {
    expect(report.counts.w.book).toBe(1);
    expect(report.counts.b.book).toBe(1);
    expect(report.counts.b.blunder).toBe(1);
    expect(report.counts.w.great).toBe(1);
    expect(Object.values(report.counts.w).reduce((a, b) => a + b, 0)).toBe(4);
    expect(Object.values(report.counts.b).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('explains the blunder in plain words', () => {
    const m = report.moves[5]!;
    expect(explain(m, { san: 'Nf6', bestSan: 'g6' })).toBe('Blunder — g6 was best. This allows mate in 1.');
    expect(explain(report.moves[6]!, { san: 'Qxf7#', bestSan: 'Qxf7#' })).toMatch(/^Great — Qxf7# is the only good move here/);
  });

  it('fills in progressively: moves without both evaluations stay null', () => {
    const partial = buildReport(game, scholarEvals.slice(0, 3), book);
    expect(partial.moves.slice(0, 2).map((m) => m?.classification)).toEqual(['book', 'book']);
    expect(partial.moves[2]).toBeNull(); // needs position 3
    expect(partial.complete).toBe(false);
    expect(partial.analyzed).toBe(4); // 3 searched + the synthesized checkmate position
    expect(partial.accuracy.w).not.toBeNull();
  });
});

describe('Miss over a sequence of moves', () => {
  // 1. e4 e5 2. Nf3 Qh4?? (hangs nothing, but pretend the engine says it is a blunder) 3. d3 (fails to punish)
  const game = parseGame('1. e4 e5 2. Nf3 Qh4 3. d3 *');
  const evals: PositionEval[] = [
    pos(line('e2e4', cp(30)), line('d2d4', cp(28))),
    pos(line('e7e5', cp(-30)), line('c7c5', cp(-32))),
    pos(line('g1f3', cp(35)), line('b1c3', cp(30))),
    pos(line('b8c6', cp(-35)), line('g8f6', cp(-40))), // Black plays Qh4 (not listed)
    pos(line('f3h4', cp(800)), line('b1c3', cp(90))), // after Qh4: White wins the queen with Nxh4
    pos(line('h4e4', cp(-120))), // after 3. d3 White is only +1.20
  ];
  const report = buildReport(game, evals, { isBook: [], openingAtPly: [], opening: undefined });

  it('marks the opponent error and the failure to punish it', () => {
    expect(report.moves[3]!.classification).toBe('blunder');
    expect(report.moves[4]!.classification).toBe('miss');
  });

  it('explains the miss', () => {
    // White is still +1.20 afterwards (60.8%), so this is "loses", not "throws away the win".
    expect(explain(report.moves[4]!, { san: 'd3', bestSan: 'Nxh4', prevSan: 'Qh4' })).toBe(
      'Miss — Nxh4 would have punished Qh4. This loses about 7 pawns of advantage.',
    );
  });
});

describe('Brilliant end to end (engine facts + real sacrifice search)', () => {
  // Greek gift position; the "engine" says Bxh7+ is best and keeps a healthy edge.
  const fen = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8';
  const game = parseGame(`[SetUp "1"]\n[FEN "${fen}"]\n\n8. Bxh7+ *`);
  const evals: PositionEval[] = [pos(line('d3h7', cp(120)), line('e1g1', cp(20))), pos(line('g8h7', cp(-120)))];

  it('is Brilliant when best + a piece sacrifice + not already winning', () => {
    const report = buildReport(game, evals, { isBook: [], openingAtPly: [], opening: undefined });
    expect(report.moves[0]!.sacrifice).toBe(2);
    expect(report.moves[0]!.classification).toBe('brilliant');
    expect(explain(report.moves[0]!, { san: 'Bxh7+', bestSan: 'Bxh7+' })).toBe('Brilliant — Bxh7+ sacrifices material, and it works.');
  });

  it('is not Brilliant when White was already completely winning', () => {
    const winning: PositionEval[] = [pos(line('d3h7', cp(900)), line('e1g1', cp(850))), pos(line('g8h7', cp(-900)))];
    expect(buildReport(game, winning, { isBook: [], openingAtPly: [], opening: undefined }).moves[0]!.classification).toBe('best');
  });
});

describe('isRecapture', () => {
  it('detects a recapture on the same square', () => {
    const g = parseGame('1. e4 d5 2. exd5 Qxd5 3. Nc3 *');
    expect(isRecapture(g, 3)).toBe(true); // Qxd5
    expect(isRecapture(g, 2)).toBe(false); // exd5 (previous move was not a capture)
    expect(isRecapture(g, 4)).toBe(false);
  });
});
