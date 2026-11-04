import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChessComError,
  countMoves,
  fetchArchives,
  fetchMonth,
  formatTimeControl,
  monthLabel,
  outcomeFor,
  parseGames,
  playerColor,
} from '../src/lib/chesscom';

// NOTE: built from the documented API shape. These are not captured responses
// (api.chess.com was unreachable from the build sandbox).
const documentedGame = (over: Record<string, unknown> = {}) => ({
  url: 'https://www.chess.com/game/live/123',
  pgn: '[Event "Live Chess"]\n[White "Alice"]\n[Black "bob"]\n\n1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58]} 2. Nf3 Nc6 3. Bb5 1-0',
  time_control: '180',
  end_time: 1_760_000_000,
  rated: true,
  time_class: 'blitz',
  rules: 'chess',
  white: { rating: 1500, result: 'win', '@id': 'https://api.chess.com/pub/player/alice', username: 'Alice', uuid: 'x' },
  black: { rating: 1480, result: 'resigned', '@id': 'https://api.chess.com/pub/player/bob', username: 'bob', uuid: 'y' },
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchArchives', () => {
  it('lowercases the username and returns months most recent first', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({
        archives: ['https://api.chess.com/pub/player/alice/games/2026/09', 'https://api.chess.com/pub/player/alice/games/2026/10'],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const months = await fetchArchives('  Alice ');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.chess.com/pub/player/alice/games/archives');
    expect(months).toEqual(['https://api.chess.com/pub/player/alice/games/2026/10', 'https://api.chess.com/pub/player/alice/games/2026/09']);
  });

  it('maps 404 to a friendly "no such player" error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 0, message: 'User not found' }, 404)));
    await expect(fetchArchives('nobody_here')).rejects.toThrow(/No Chess.com player named "nobody_here"/);
  });

  it('maps 429 and network/CORS failures to clear errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 429)));
    await expect(fetchArchives('alice')).rejects.toThrow(/rate limiting/);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchArchives('alice')).rejects.toBeInstanceOf(ChessComError);
  });

  it('rejects a response without an archives array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ nope: true })));
    await expect(fetchArchives('alice')).rejects.toThrow(/no archives list/);
  });
});

describe('fetchMonth / parseGames', () => {
  it('sorts most recent first and normalizes fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ games: [documentedGame({ end_time: 1 }), documentedGame({ end_time: 3, url: 'https://www.chess.com/game/live/456' })] })),
    );
    const games = await fetchMonth('https://api.chess.com/pub/player/alice/games/2026/10');
    expect(games.map((g) => g.endTime)).toEqual([3, 1]);
    expect(games[0]).toMatchObject({ timeClass: 'blitz', timeControl: '180', rated: true, rules: 'chess' });
  });

  it('drops malformed entries instead of failing', () => {
    const games = parseGames({ games: [documentedGame(), { url: 'x' }, documentedGame({ pgn: '' }), null, documentedGame({ white: null })] });
    expect(games).toHaveLength(1);
  });

  it('refuses to fetch anything but the Chess.com API', async () => {
    await expect(fetchMonth('https://example.com/evil')).rejects.toThrow(/non-Chess.com/);
  });
});

describe('perspective helpers', () => {
  const [game] = parseGames({ games: [documentedGame()] });
  it('finds the searched player color case-insensitively', () => {
    expect(playerColor(game, 'alice')).toBe('w');
    expect(playerColor(game, 'BOB')).toBe('b');
    expect(playerColor(game, 'carol')).toBeNull();
  });
  it('maps result codes to win/loss/draw from that player view', () => {
    expect(outcomeFor(game, 'w')).toBe('win');
    expect(outcomeFor(game, 'b')).toBe('loss');
    for (const code of ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']) {
      const [g] = parseGames({ games: [documentedGame({ white: { username: 'a', rating: 1, result: code } })] });
      expect(outcomeFor(g, 'w')).toBe('draw');
    }
    for (const code of ['checkmated', 'timeout', 'resigned', 'abandoned', 'lose']) {
      const [g] = parseGames({ games: [documentedGame({ white: { username: 'a', rating: 1, result: code } })] });
      expect(outcomeFor(g, 'w')).toBe('loss');
    }
  });
});

describe('formatting helpers', () => {
  it('counts full moves from PGN with clock comments', () => {
    expect(countMoves(documentedGame().pgn)).toBe(3);
    expect(countMoves('1. e4 e5 2. Nf3 *')).toBe(2);
    expect(countMoves('[Event "x"]\n\n1. d4 $1 d5 (1... Nf6 2. c4) 2. c4 1/2-1/2')).toBe(2);
  });
  it('labels archive months', () => {
    expect(monthLabel('https://api.chess.com/pub/player/a/games/2026/03')).toMatch(/2026/);
  });
  it('formats time controls', () => {
    expect(formatTimeControl('180')).toBe('3 min');
    expect(formatTimeControl('600+5')).toBe('10 | 5');
    expect(formatTimeControl('30')).toBe('30s');
    expect(formatTimeControl('1/86400')).toBe('1 day');
    expect(formatTimeControl('1/259200')).toBe('3 days');
  });
});
