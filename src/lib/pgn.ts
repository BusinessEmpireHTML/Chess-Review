import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Color } from './types';

export interface Ply {
  /** 0-based index into the game's plies. */
  index: number;
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  promotion?: string;
  fenBefore: string;
  fenAfter: string;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  startColor: Color;
  plies: Ply[];
  /** Position before ply i is fens[i]; fens[plies.length] is the final position. */
  fens: string[];
  /** Set when the final position has no legal moves or is a draw by rule. */
  finalTerminal?: 'checkmate' | 'draw';
}

export class PgnError extends Error {}

export function parseGame(pgn: string): ParsedGame {
  const chess = new Chess();
  const text = pgn.trim();
  if (!text) throw new PgnError('The PGN is empty.');
  try {
    chess.loadPgn(text);
  } catch (e) {
    throw new PgnError(`Could not read this PGN: ${(e as Error).message}`);
  }
  const headers = Object.fromEntries(
    Object.entries(chess.getHeaders()).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const history = chess.history({ verbose: true });
  const startFen = history[0]?.before ?? (headers.FEN || DEFAULT_POSITION);
  const startColor = (startFen.split(' ')[1] as Color) ?? 'w';
  const startMoveNumber = Number(startFen.split(' ')[5] ?? 1) || 1;

  const plies: Ply[] = history.map((m, i) => {
    // Move number of this ply, accounting for games that start with Black to move.
    const offset = startColor === 'w' ? i : i + 1;
    return {
      index: i,
      moveNumber: startMoveNumber + Math.floor(offset / 2),
      color: m.color,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      fenBefore: m.before,
      fenAfter: m.after,
    };
  });

  const fens = [startFen, ...plies.map((p) => p.fenAfter)];
  let finalTerminal: ParsedGame['finalTerminal'];
  if (chess.isCheckmate()) finalTerminal = 'checkmate';
  else if (chess.isDraw() || chess.isStalemate()) finalTerminal = 'draw';

  return { headers, startFen, startColor, plies, fens, finalTerminal };
}

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** The move recaptures on the square where the opponent's previous move captured. */
export function isRecapture(game: ParsedGame, plyIndex: number): boolean {
  const ply = game.plies[plyIndex];
  const prev = game.plies[plyIndex - 1];
  return !!(ply?.captured && prev?.captured && ply.to === prev.to);
}

/** Convert a UCI line from `fen` into SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uciMoves: string[], max = uciMoves.length): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciMoves.slice(0, max)) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

export function uciToSan(fen: string, uci: string): string {
  return uciLineToSan(fen, [uci], 1)[0] ?? uci;
}

/** A stable identifier for a game without a URL (pasted PGN). */
export function gameFingerprint(game: ParsedGame): string {
  const s = game.startFen + '|' + game.plies.map((p) => p.uci).join(' ');
  let h1 = 0x811c9dc5;
  let h2 = 0x12345678;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return 'pgn:' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + ':' + game.plies.length;
}
