import { Chess } from 'chess.js';
import { CLASSIFICATION, type ClassificationConfig } from '../config/classification';
import { moveAccuracy } from './accuracy';
import { classifyMove, couldBeBrilliant, evaluateMove } from './classify';
import { sacrificeSize, uciToMove } from './material';
import type { MoveReport } from './review';
import type { Color, PositionEval } from './types';

/** A move in an explored side line (or a game against the bot). */
export interface LineMove {
  uci: string;
  san: string;
  from: string;
  to: string;
  color: Color;
  captured?: string;
  fenBefore: string;
  fenAfter: string;
  /** Played by Stockfish rather than the user. */
  byEngine: boolean;
}

/** Make `uci` in `fenBefore`; null if the move is illegal there. */
export function lineMove(fenBefore: string, uci: string, byEngine = false): LineMove | null {
  const chess = new Chess(fenBefore);
  try {
    const m = chess.move(uciToMove(uci));
    return {
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
      from: m.from,
      to: m.to,
      color: m.color,
      captured: m.captured,
      fenBefore,
      fenAfter: chess.fen(),
      byEngine,
    };
  } catch {
    return null;
  }
}

/** Replay a game from its start so repetition and fifty-move history are known. */
export function replay(startFen: string, uciMoves: string[]): Chess {
  const chess = new Chess(startFen);
  for (const uci of uciMoves) chess.move(uciToMove(uci));
  return chess;
}

export function terminalState(chess: Chess): 'checkmate' | 'draw' | undefined {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isDraw() || chess.isStalemate()) return 'draw';
  return undefined;
}

/** Legal destinations per origin square, in the shape chessground expects. */
export function legalDests(fen: string): Map<string, string[]> {
  const dests = new Map<string, string[]>();
  for (const m of new Chess(fen).moves({ verbose: true })) {
    const list = dests.get(m.from);
    if (list) {
      if (!list.includes(m.to)) list.push(m.to);
    } else dests.set(m.from, [m.to]);
  }
  return dests;
}

export function legalUcis(fen: string): string[] {
  return new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
}

/** Is a pawn move from `from` to `to` a promotion in this position? */
export function isPromotion(fen: string, from: string, to: string): boolean {
  return new Chess(fen).moves({ verbose: true }).some((m) => m.from === from && m.to === to && !!m.promotion);
}

/**
 * Grade a move the user tried, with exactly the same rules as a game move.
 * `before` is the engine search of the position the move was played in,
 * `after` the search (or terminal state) of the resulting position.
 */
export function gradeMove(
  before: PositionEval,
  after: PositionEval,
  move: Pick<LineMove, 'fenBefore' | 'uci' | 'color' | 'to' | 'captured'>,
  prev?: { to: string; captured?: string },
  cfg: ClassificationConfig = CLASSIFICATION,
): MoveReport | null {
  const evaluation = evaluateMove(before, after, move.uci);
  if (!evaluation) return null;
  const facts = {
    isBook: false,
    playedIsBest: evaluation.playedIsBest,
    bestEP: evaluation.best.ep,
    playedEP: evaluation.played.ep,
    secondEP: evaluation.second?.ep ?? null,
    isRecapture: !!(move.captured && prev?.captured && prev.to === move.to),
  };
  const sacrifice = couldBeBrilliant(facts, cfg) ? sacrificeSize(move.fenBefore, move.uci) : 0;
  return {
    ply: -1,
    color: move.color,
    classification: classifyMove({ ...facts, sacrifice }, cfg),
    epl: evaluation.epl,
    evaluation,
    sacrifice,
    accuracy: moveAccuracy(evaluation.best.ep * 100, evaluation.played.ep * 100),
  };
}
