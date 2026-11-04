import { describe, expect, it } from 'vitest';
import { LineCollector, parseBestMove, parseInfo } from '../src/engine/uci';

// Real Stockfish 19 (lite, single-threaded) output captured from the bundled engine.
const D15_1 = 'info depth 15 seldepth 24 multipv 1 score cp -31 nodes 250956 nps 549137 hashfull 40 time 457 pv b8c6 d2d4 e5d4 f3d4 f8c5 d4f5';
const D15_2 = 'info depth 15 seldepth 25 multipv 2 score cp -46 nodes 250956 nps 549137 hashfull 40 time 457 pv g8f6 f3e5 d7d6 e5f3 f6e4';
const D16_1 = 'info depth 16 seldepth 26 multipv 1 score cp -23 nodes 335789 nps 547779 hashfull 50 time 613 pv b8c6 d2d4 e5d4 f3d4 g8f6 d4c6';
const D16_2 = 'info depth 16 seldepth 30 multipv 2 score cp -41 nodes 335789 nps 547779 hashfull 50 time 613 pv g8f6 f3e5 d7d6 e5f3 f6e4 d2d4';

describe('parseInfo', () => {
  it('parses depth, multipv, score, and pv', () => {
    const i = parseInfo(D16_2)!;
    expect(i.depth).toBe(16);
    expect(i.multipv).toBe(2);
    expect(i.score).toEqual({ type: 'cp', value: -41 });
    expect(i.pv.slice(0, 3)).toEqual(['g8f6', 'f3e5', 'd7d6']);
    expect(i.nodes).toBe(335789);
    expect(i.bound).toBeUndefined();
  });

  it('parses mate scores, including "mate 0" for a checkmated side', () => {
    expect(parseInfo('info depth 12 seldepth 2 multipv 1 score mate 1 nodes 16276 nps 775047 hashfull 3 time 21 pv a1a8')!.score).toEqual({ type: 'mate', value: 1 });
    expect(parseInfo('info depth 20 multipv 1 score mate -3 nodes 1 pv e1d1')!.score).toEqual({ type: 'mate', value: -3 });
    expect(parseInfo('info depth 0 score mate 0')!.score).toEqual({ type: 'mate', value: 0 });
  });

  it('flags bound scores', () => {
    expect(parseInfo('info depth 14 multipv 1 score cp 50 lowerbound nodes 10 pv e2e4')!.bound).toBe('lower');
    expect(parseInfo('info depth 14 multipv 1 score cp 50 upperbound nodes 10 pv e2e4')!.bound).toBe('upper');
  });

  it('ignores lines without a score', () => {
    expect(parseInfo('info string Network replica 1: Local memory.')).toBeNull();
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('bestmove e2e4')).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('reads the move, null for "(none)", undefined for other lines', () => {
    expect(parseBestMove('bestmove b8c6 ponder d2d4')).toBe('b8c6');
    expect(parseBestMove('bestmove (none)')).toBeNull();
    expect(parseBestMove('info depth 1')).toBeUndefined();
  });
});

describe('LineCollector', () => {
  it('keeps the deepest exact line per multipv, best first', () => {
    const c = new LineCollector();
    for (const l of [D15_1, D15_2, 'info depth 16 multipv 1 score cp 80 lowerbound nodes 1 pv d2d4', D16_2, D16_1]) c.push(parseInfo(l)!);
    const lines = c.lines();
    expect(lines.map((l) => l.move)).toEqual(['b8c6', 'g8f6']);
    expect(lines[0].score).toEqual({ type: 'cp', value: -23 });
    expect(lines[0].depth).toBe(16);
    expect(c.depth).toBe(16);
  });

  it('handles a single line (MultiPV 2 with one legal move)', () => {
    const c = new LineCollector();
    c.push(parseInfo('info depth 12 multipv 1 score cp 3 nodes 5 pv e1d2 e8f7')!);
    expect(c.lines()).toHaveLength(1);
  });
});
