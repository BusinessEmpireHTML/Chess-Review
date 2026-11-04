/**
 * Chess.com Published-Data API client (no auth). The only external host this
 * app talks to.
 *
 * Shapes follow the documented API (https://www.chess.com/news/view/published-data-api):
 *   GET /pub/player/{username}/games/archives -> { archives: string[] }  (oldest first)
 *   GET {archive url}                         -> { games: Game[] }       (ascending end_time)
 * Everything is parsed defensively; unknown or malformed entries are dropped.
 * Chess.com asks clients to make requests serially, so callers fetch one month at a time.
 */

export interface ChessComSide {
  username: string;
  rating: number;
  result: string;
}

export interface ChessComGame {
  url: string;
  pgn: string;
  timeControl: string;
  timeClass: TimeClass;
  endTime: number;
  rated: boolean;
  rules: string;
  white: ChessComSide;
  black: ChessComSide;
}

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type Outcome = 'win' | 'loss' | 'draw';

export class ChessComError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const API = 'https://api.chess.com/pub';
const DRAW_CODES = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

export function isValidUsername(u: string): boolean {
  return /^[a-z0-9_-]{2,50}$/i.test(u);
}

async function getJson(url: string, signal?: AbortSignal, notFound?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ChessComError("Couldn't reach Chess.com. Check your connection (or a browser extension blocking api.chess.com).");
  }
  if (res.status === 404) throw new ChessComError(notFound ?? 'Not found on Chess.com.', 404);
  if (res.status === 429) throw new ChessComError('Chess.com is rate limiting requests. Wait a few seconds and try again.', 429);
  if (!res.ok) throw new ChessComError(`Chess.com returned an error (${res.status}).`, res.status);
  try {
    return await res.json();
  } catch {
    throw new ChessComError('Chess.com sent a response that could not be read.');
  }
}

/** Monthly archive URLs, most recent first. */
export async function fetchArchives(username: string, signal?: AbortSignal): Promise<string[]> {
  const u = normalizeUsername(username);
  const data = (await getJson(
    `${API}/player/${encodeURIComponent(u)}/games/archives`,
    signal,
    `No Chess.com player named "${username.trim()}".`,
  )) as { archives?: unknown };
  if (!Array.isArray(data?.archives)) throw new ChessComError('Unexpected response from Chess.com (no archives list).');
  return data.archives.filter((a): a is string => typeof a === 'string' && a.startsWith('https://')).reverse();
}

function parseSide(x: unknown): ChessComSide | null {
  const s = x as Partial<Record<keyof ChessComSide, unknown>> | null;
  if (!s || typeof s.username !== 'string') return null;
  return {
    username: s.username,
    rating: typeof s.rating === 'number' ? s.rating : 0,
    result: typeof s.result === 'string' ? s.result : '',
  };
}

const TIME_CLASSES: TimeClass[] = ['bullet', 'blitz', 'rapid', 'daily'];

export function parseGames(data: unknown): ChessComGame[] {
  const raw = (data as { games?: unknown })?.games;
  if (!Array.isArray(raw)) throw new ChessComError('Unexpected response from Chess.com (no games list).');
  const games: ChessComGame[] = [];
  for (const g of raw as Record<string, unknown>[]) {
    const white = parseSide(g?.white);
    const black = parseSide(g?.black);
    if (!white || !black || typeof g.pgn !== 'string' || !g.pgn || typeof g.url !== 'string') continue;
    const tc = String(g.time_class ?? '');
    games.push({
      url: g.url,
      pgn: g.pgn,
      timeControl: String(g.time_control ?? ''),
      timeClass: (TIME_CLASSES as string[]).includes(tc) ? (tc as TimeClass) : 'rapid',
      endTime: typeof g.end_time === 'number' ? g.end_time : 0,
      rated: g.rated === true,
      rules: typeof g.rules === 'string' ? g.rules : 'chess',
      white,
      black,
    });
  }
  return games.sort((a, b) => b.endTime - a.endTime);
}

/** Games of one monthly archive, most recent first. */
export async function fetchMonth(archiveUrl: string, signal?: AbortSignal): Promise<ChessComGame[]> {
  if (!archiveUrl.startsWith(API + '/')) throw new ChessComError('Refusing to fetch a non-Chess.com URL.');
  return parseGames(await getJson(archiveUrl, signal));
}

export function playerColor(game: ChessComGame, username: string): 'w' | 'b' | null {
  const u = normalizeUsername(username);
  if (game.white.username.toLowerCase() === u) return 'w';
  if (game.black.username.toLowerCase() === u) return 'b';
  return null;
}

export function outcomeFor(game: ChessComGame, color: 'w' | 'b'): Outcome {
  const result = (color === 'w' ? game.white : game.black).result;
  if (result === 'win') return 'win';
  if (DRAW_CODES.has(result)) return 'draw';
  return 'loss';
}

/** "October 2026" from .../games/2026/10 */
export function monthLabel(archiveUrl: string): string {
  const m = archiveUrl.match(/\/(\d{4})\/(\d{2})\/?$/);
  if (!m) return archiveUrl;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Full-move count from PGN movetext without running a full parse. */
export function countMoves(pgn: string): number {
  const movetext = pgn
    .replace(/^\s*\[[^\]]*\]\s*$/gm, '')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ');
  const plies = movetext
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, ''))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).length;
  return Math.ceil(plies / 2);
}

/** "3 min", "10 | 5", "1 day" from Chess.com's time_control ("180", "600+5", "1/86400"). */
export function formatTimeControl(tc: string): string {
  if (tc.includes('/')) {
    const secs = Number(tc.split('/')[1]);
    const days = Math.round(secs / 86400);
    return days ? `${days} day${days > 1 ? 's' : ''}` : tc;
  }
  const [base, inc] = tc.split('+').map(Number);
  if (!Number.isFinite(base)) return tc;
  const mins = base >= 60 ? `${base / 60}` : `${base}s`;
  return inc ? `${mins} | ${inc}` : base >= 60 ? `${mins} min` : mins;
}
