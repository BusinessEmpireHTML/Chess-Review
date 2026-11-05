import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { botLevel } from '../src/config/play';
import { replay } from '../src/lib/explore';
import { parseGame } from '../src/lib/pgn';
import { appendUserMove, botName, buildPlayPgn, describeResult, detectResult, resignation } from '../src/lib/play';

const START = new Chess().fen();

describe('detectResult', () => {
  it('is null mid-game', () => {
    expect(detectResult(replay(START, ['e2e4', 'e7e5']))).toBeNull();
  });
  it('detects checkmate and the winner', () => {
    const r = detectResult(replay(START, ['f2f3', 'e7e5', 'g2g4', 'd8h4']))!;
    expect(r).toEqual({ result: '0-1', winner: 'b', reason: 'checkmate' });
    expect(describeResult(r, 'w')).toBe('Stockfish won by checkmate');
    expect(describeResult(r, 'b')).toBe('You won by checkmate');
  });
  it('detects draws by rule', () => {
    expect(detectResult(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))!.reason).toBe('stalemate');
    expect(detectResult(new Chess('8/8/4k3/8/8/3K4/8/8 w - - 0 1'))!.reason).toBe('insufficient');
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const rep = detectResult(replay(START, shuffle))!;
    expect(rep).toMatchObject({ result: '1/2-1/2', winner: null, reason: 'repetition' });
    expect(describeResult(rep, 'w')).toBe('Draw by repetition');
  });
  it('scores a resignation for the bot', () => {
    expect(resignation('w')).toEqual({ result: '0-1', winner: 'b', reason: 'resignation' });
    expect(describeResult(resignation('b'), 'b')).toBe('You resigned');
  });
});

describe('buildPlayPgn', () => {
  it('round-trips through the review parser with players, result and termination', () => {
    const moves = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    const result = detectResult(replay(START, moves));
    const pgn = buildPlayPgn({ moves, userColor: 'b', level: botLevel(3), result, date: new Date(2026, 10, 4) });
    const game = parseGame(pgn);
    expect(game.plies.map((p) => p.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(game.headers).toMatchObject({
      White: botName(botLevel(3)),
      Black: 'You',
      Result: '0-1',
      Termination: 'You won by checkmate',
      Date: '2026.11.04',
    });
    expect(game.finalTerminal).toBe('checkmate');
  });
  it('marks unfinished games with *', () => {
    expect(parseGame(buildPlayPgn({ moves: ['e2e4'], userColor: 'w', level: botLevel(1), result: null })).headers.Result).toBe('*');
  });
});

describe('appendUserMove (never trust a lagging board)', () => {
  const beforePromo = ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'e7e6'];

  it('adds a legal move on the user\'s turn, including a promotion', () => {
    expect(appendUserMove(['e2e4', 'e7e5'], 'g1f3', 'w')).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(appendUserMove(beforePromo, 'b7a8q', 'w')).toEqual([...beforePromo, 'b7a8q']);
  });

  it('ignores a move from a stale board after a take-back', () => {
    // The promotion picker was opened at b7, then the user took back two plies.
    const afterTakeBack = beforePromo.slice(0, 6);
    expect(appendUserMove(afterTakeBack, 'b7a8q', 'w')).toBe(afterTakeBack);
    // ...but the move that is actually legal there still works.
    expect(appendUserMove(afterTakeBack, 'a6b7', 'w')).toEqual([...afterTakeBack, 'a6b7']);
  });

  it('ignores moves when it is not the user\'s turn or the game is over', () => {
    expect(appendUserMove(['e2e4'], 'e7e5', 'w')).toEqual(['e2e4']);
    const mated = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    expect(appendUserMove(mated, 'a2a3', 'w')).toBe(mated);
  });
});
