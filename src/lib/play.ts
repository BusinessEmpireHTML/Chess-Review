import { Chess } from 'chess.js';
import type { BotLevel } from '../config/play';
import { uciToMove } from './material';
import type { Color } from './types';

export type ResultReason = 'checkmate' | 'stalemate' | 'repetition' | 'insufficient' | 'fifty-move' | 'resignation';

export interface PlayResult {
  result: '1-0' | '0-1' | '1/2-1/2';
  winner: Color | null;
  reason: ResultReason;
}

/** The game's result if it is over by rule, otherwise null. */
export function detectResult(chess: Chess): PlayResult | null {
  if (chess.isCheckmate()) {
    const winner: Color = chess.turn() === 'w' ? 'b' : 'w';
    return { result: winner === 'w' ? '1-0' : '0-1', winner, reason: 'checkmate' };
  }
  const draw = (reason: ResultReason): PlayResult => ({ result: '1/2-1/2', winner: null, reason });
  if (chess.isStalemate()) return draw('stalemate');
  if (chess.isInsufficientMaterial()) return draw('insufficient');
  if (chess.isThreefoldRepetition()) return draw('repetition');
  if (chess.isDrawByFiftyMoves()) return draw('fifty-move');
  return null;
}

export function resignation(userColor: Color): PlayResult {
  const winner: Color = userColor === 'w' ? 'b' : 'w';
  return { result: winner === 'w' ? '1-0' : '0-1', winner, reason: 'resignation' };
}

const DRAW_TEXT: Record<string, string> = {
  stalemate: 'Draw by stalemate',
  repetition: 'Draw by repetition',
  insufficient: 'Draw by insufficient material',
  'fifty-move': 'Draw by the fifty-move rule',
};

/** "You won by checkmate", "Stockfish won by checkmate", "You resigned", "Draw by stalemate". */
export function describeResult(r: PlayResult, userColor: Color): string {
  if (r.reason === 'resignation') return 'You resigned';
  if (r.winner === null) return DRAW_TEXT[r.reason] ?? 'Draw';
  return `${r.winner === userColor ? 'You' : 'Stockfish'} won by ${r.reason}`;
}

export function botName(level: BotLevel): string {
  return `Stockfish (Level ${level.level} · ${level.name})`;
}

/** PGN of a finished (or abandoned) game against the bot, ready for review. */
export function buildPlayPgn(opts: { moves: string[]; userColor: Color; level: BotLevel; result: PlayResult | null; date?: Date }): string {
  const chess = new Chess();
  for (const uci of opts.moves) chess.move(uciToMove(uci));
  const d = opts.date ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const bot = botName(opts.level);
  chess.setHeader('Event', 'Ply vs Stockfish');
  chess.setHeader('Site', 'Ply');
  chess.setHeader('Date', `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`);
  chess.setHeader('White', opts.userColor === 'w' ? 'You' : bot);
  chess.setHeader('Black', opts.userColor === 'b' ? 'You' : bot);
  chess.setHeader('Result', opts.result?.result ?? '*');
  if (opts.result) chess.setHeader('Termination', describeResult(opts.result, opts.userColor));
  return chess.pgn();
}
