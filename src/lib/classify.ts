import { CLASSIFICATION, type ClassificationConfig } from '../config/classification';
import type { Classification, EngineLine, PositionEval, Score } from './types';
import { scoreToCp, winPercent } from './winprob';

type Config = ClassificationConfig;

/**
 * An outcome seen from the mover's point of view.
 *  - ep:   expected points 0..1
 *  - cp:   centipawns (mate mapped to a large number)
 *  - mate: null, or moves to mate (> 0 mover mates, < 0 mover gets mated,
 *          0 = the mover has just delivered checkmate)
 */
export interface Outcome {
  ep: number;
  cp: number;
  mate: number | null;
}

/** Outcome of a score that belongs to a position where the mover is to move. */
export function outcomeForMover(score: Score): Outcome {
  return {
    ep: winPercent(score) / 100,
    cp: scoreToCp(score),
    mate: score.type === 'mate' ? score.value : null,
  };
}

/** Outcome for the mover of a score that belongs to the position after the move (opponent to move). */
export function outcomeAfterMove(scoreForOpponent: Score): Outcome {
  return {
    ep: 1 - winPercent(scoreForOpponent) / 100,
    cp: -scoreToCp(scoreForOpponent),
    // mate 0 for the opponent (they are mated) becomes 0 = "mover delivered mate".
    mate: scoreForOpponent.type === 'mate' ? (scoreForOpponent.value === 0 ? 0 : -scoreForOpponent.value) : null,
  };
}

/** Outcome for the mover when the position after the move is terminal. */
export function terminalOutcome(terminal: 'checkmate' | 'draw'): Outcome {
  return terminal === 'checkmate' ? { ep: 1, cp: 100_000, mate: 0 } : { ep: 0.5, cp: 0, mate: null };
}

const sameScore = (a: Score, b: Score) => a.type === b.type && a.value === b.value;

export interface MoveEvaluation {
  /** The engine's top move (UCI) in the position before the move. */
  bestMove: string;
  best: Outcome;
  played: Outcome;
  /** Second-best line, if the engine found one (absent when only one move was legal). */
  second: (Outcome & { move: string }) | null;
  /** True if the played move is the engine's top move, ties it exactly, or delivers mate. */
  playedIsBest: boolean;
  /** Expected-points loss of the played move vs. the best move, >= 0. */
  epl: number;
  /** Lines from the position before the move, for display. */
  lines: EngineLine[];
}

/**
 * Compare the played move to the engine's best move from the mover's point of
 * view. `before` is the search of the position where the move was played,
 * `after` is the search (or terminal state) of the resulting position.
 *
 * The played move's value comes from the same search as the best move when the
 * played move is one of the MultiPV lines (same depth, directly comparable);
 * otherwise from the search of the resulting position.
 */
export function evaluateMove(before: PositionEval, after: PositionEval, playedUci: string): MoveEvaluation | null {
  const top = before.lines[0];
  if (!top) return null;
  const best = outcomeForMover(top.score);
  const secondLine = before.lines[1];
  const second = secondLine ? { ...outcomeForMover(secondLine.score), move: secondLine.move } : null;

  let played: Outcome;
  if (after.terminal) {
    played = terminalOutcome(after.terminal);
  } else if (top.move === playedUci) {
    played = best;
  } else if (secondLine && secondLine.move === playedUci) {
    played = outcomeForMover(secondLine.score);
  } else if (after.lines[0]) {
    played = outcomeAfterMove(after.lines[0].score);
  } else {
    return null;
  }

  const deliversMate = after.terminal === 'checkmate';
  const tiesBest = secondLine?.move === playedUci && sameScore(secondLine.score, top.score);
  const playedIsBest = top.move === playedUci || tiesBest || deliversMate;
  const epl = playedIsBest ? 0 : Math.max(0, best.ep - played.ep);

  return { bestMove: top.move, best, played, second, playedIsBest, epl, lines: before.lines };
}

/** Everything `classifyMove` needs, as plain values, so it is trivial to test. */
export interface MoveFacts {
  isBook: boolean;
  playedIsBest: boolean;
  /** Mover's expected points with the best move (= how good the position was before the move). */
  bestEP: number;
  /** Mover's expected points after the played move. */
  playedEP: number;
  /** Mover's expected points with the engine's second-best move, or null if there is none. */
  secondEP: number | null;
  /** Material sacrificed in pawn units (see material.ts `sacrificeSize`). */
  sacrifice: number;
  /** The move recaptures on the square where the opponent just captured. */
  isRecapture: boolean;
  /** Classification of the opponent's previous move, if any. */
  prevClassification?: Classification;
  /** Mover's expected points before the opponent's previous move. */
  moverEPBeforePrev?: number;
}

/**
 * Threshold comparisons with a tiny tolerance, so a boundary value reads the
 * way the config does (0.6 - 0.5 is 0.09999999999999998 in floating point).
 */
const EPS = 1e-9;
const atMost = (x: number, limit: number) => x <= limit + EPS;
const atLeast = (x: number, limit: number) => x >= limit - EPS;

export function eplBand(epl: number, cfg: Config = CLASSIFICATION): Classification {
  if (atMost(epl, cfg.epl.excellent)) return 'excellent';
  if (atMost(epl, cfg.epl.good)) return 'good';
  if (atMost(epl, cfg.epl.inaccuracy)) return 'inaccuracy';
  if (atMost(epl, cfg.epl.mistake)) return 'mistake';
  return 'blunder';
}

/** Cheap pre-check so the (expensive) sacrifice search only runs when it could matter. */
export function couldBeBrilliant(f: Omit<MoveFacts, 'sacrifice'>, cfg: Config = CLASSIFICATION): boolean {
  if (f.isBook) return false;
  const epl = f.playedIsBest ? 0 : Math.max(0, f.bestEP - f.playedEP);
  return (
    (f.playedIsBest || atMost(epl, cfg.brilliant.maxEpl)) &&
    f.bestEP < cfg.brilliant.maxWinBefore - EPS &&
    atLeast(f.playedEP, cfg.brilliant.minWinAfter)
  );
}

export function classifyMove(f: MoveFacts, cfg: Config = CLASSIFICATION): Classification {
  if (f.isBook) return 'book';

  const epl = f.playedIsBest ? 0 : Math.max(0, f.bestEP - f.playedEP);

  if (couldBeBrilliant(f, cfg) && atLeast(f.sacrifice, cfg.brilliant.minSacrifice)) return 'brilliant';

  if (f.playedIsBest) {
    const onlyMove = f.secondEP !== null && atLeast(f.bestEP - f.secondEP, cfg.great.minSecondBestGap);
    if (onlyMove && !(cfg.great.excludeRecaptures && f.isRecapture)) return 'great';
    return 'best';
  }

  const band = eplBand(epl, cfg);
  const prevWasError = f.prevClassification !== undefined && cfg.miss.afterOpponent.includes(f.prevClassification);
  if (prevWasError && atLeast(epl, cfg.miss.minEpl)) {
    const worseThanBefore = f.moverEPBeforePrev !== undefined && f.playedEP < f.moverEPBeforePrev - EPS;
    const harsh = band === 'mistake' || band === 'blunder';
    if (!(cfg.miss.keepBlunderIfWorseThanBefore && worseThanBefore && harsh)) return 'miss';
  }
  return band;
}
