import { Chess } from 'chess.js';
import { CLASSIFICATION, PIECE_VALUES } from '../config/classification';
import type { Color } from './types';

type PieceType = keyof typeof PIECE_VALUES;

/** The few move fields the capture search needs. */
interface TacticalMove {
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
}

/**
 * Thin adapter over chess.js move generation. chess.js's public `moves()`
 * builds SAN and two FEN strings for every move, which is far too slow inside
 * a search, so we use its internal generator when it is present and fall back
 * to the public API (slow but correct) if a future version renames it.
 */
interface MoveOps<M extends TacticalMove> {
  moves(): M[];
  make(m: M): void;
  undo(): void;
  inCheck(): boolean;
}

interface ChessInternals {
  _moves(opts: { legal: boolean }): TacticalMove[];
  _makeMove(m: TacticalMove): void;
  _undoMove(): unknown;
}

function moveOps(chess: Chess): MoveOps<TacticalMove> {
  const internal = chess as unknown as Partial<ChessInternals>;
  if (typeof internal._moves === 'function' && typeof internal._makeMove === 'function' && typeof internal._undoMove === 'function') {
    const c = internal as ChessInternals;
    return {
      moves: () => c._moves({ legal: true }),
      make: (m) => c._makeMove(m),
      undo: () => void c._undoMove(),
      inCheck: () => chess.inCheck(),
    };
  }
  return {
    moves: () => chess.moves({ verbose: true }) as unknown as TacticalMove[],
    make: (m) => void chess.move(m as never),
    undo: () => void chess.undo(),
    inCheck: () => chess.inCheck(),
  };
}

/** Material balance in pawn units from `pov`'s side (own material minus opponent's). */
export function materialBalance(chess: Chess, pov: Color): number {
  let balance = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      const v = PIECE_VALUES[sq.type as PieceType];
      balance += sq.color === pov ? v : -v;
    }
  }
  return balance;
}

const MATE_VALUE = 1000;

function tacticalGain(m: TacticalMove): number {
  let gain = m.captured ? PIECE_VALUES[m.captured] : 0;
  if (m.promotion) gain += PIECE_VALUES[m.promotion] - PIECE_VALUES.p;
  return gain;
}

/**
 * Capture-only alpha-beta search over material. Returns the material balance
 * (side to move's view) the side to move can secure with captures and queen
 * promotions, standing pat when that is better.
 */
function qsearch(
  ops: MoveOps<TacticalMove>,
  balance: number,
  alpha: number,
  beta: number,
  budget: { nodes: number },
): number {
  const moves = ops.moves();
  if (moves.length === 0) return ops.inCheck() ? -MATE_VALUE : balance;

  let best = balance; // stand pat
  if (best >= beta) return best;
  if (best > alpha) alpha = best;

  const tactical = moves
    .filter((m) => m.captured || m.promotion === 'q')
    .sort((x, y) => tacticalGain(y) - tacticalGain(x) || PIECE_VALUES[x.piece] - PIECE_VALUES[y.piece]);

  for (const m of tactical) {
    if (budget.nodes-- <= 0) break;
    ops.make(m);
    const score = -qsearch(ops, -(balance + tacticalGain(m)), -beta, -alpha, budget);
    ops.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Material the mover gives up by playing `move` in `fen`: raw material before
 * the move minus what the mover keeps after the opponent's best capture
 * sequence (which may include the mover recapturing elsewhere). Positive
 * means material was given up and not immediately recouped.
 */
export function materialGivenUp(
  fen: string,
  move: string | { from: string; to: string; promotion?: string },
  nodeLimit: number = CLASSIFICATION.brilliant.qsearchNodeLimit,
): number {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const before = materialBalance(chess, mover);
  chess.move(typeof move === 'string' ? uciToMove(move) : move);
  const afterMove = materialBalance(chess, mover);
  const ops = moveOps(chess);
  const opponentBest = qsearch(ops, -afterMove, -Infinity, Infinity, { nodes: nodeLimit });
  const moverKeeps = -opponentBest;
  return before - moverKeeps;
}

/**
 * Sacrifice size for the played move: material given up beyond what the
 * mover's most material-preserving legal alternative would lose anyway.
 * This keeps forced losses (escaping a fork, a pinned piece falling) from
 * looking like sacrifices.
 *
 * Only call this for candidate moves; it searches every legal alternative
 * when the played move itself gives material up.
 */
export function sacrificeSize(fen: string, uci: string, minInteresting = CLASSIFICATION.brilliant.minSacrifice): number {
  const played = materialGivenUp(fen, uci);
  if (played < minInteresting) return Math.max(0, played);
  const chess = new Chess(fen);
  let leastLoss = played;
  for (const m of chess.moves({ verbose: true })) {
    if (m.from + m.to + (m.promotion ?? '') === uci) continue;
    const loss = materialGivenUp(fen, { from: m.from, to: m.to, promotion: m.promotion });
    if (loss < leastLoss) leastLoss = loss;
    if (leastLoss <= 0) break;
  }
  return Math.max(0, played - Math.max(0, leastLoss));
}

export function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}
