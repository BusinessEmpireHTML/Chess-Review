/**
 * Every tunable number used by move classification and accuracy lives here.
 *
 * Units:
 *  - "EP" (expected points) are 0..1 from the mover's point of view, derived
 *    from win probability (win% / 100). EPL = EP(best move) - EP(played move).
 *  - Material is in pawn units (P=1, N=3, B=3, R=5, Q=9).
 *
 * Classification results are recomputed from raw engine output every time a
 * game is opened, so editing this file re-grades cached games without
 * re-running Stockfish.
 */
import type { Classification } from '../lib/types';

export interface ClassificationConfig {
  epl: { excellent: number; good: number; inaccuracy: number; mistake: number };
  great: { minSecondBestGap: number; excludeRecaptures: boolean };
  brilliant: { minSacrifice: number; maxWinBefore: number; minWinAfter: number; maxEpl: number; qsearchNodeLimit: number };
  miss: { afterOpponent: readonly Classification[]; minEpl: number; keepBlunderIfWorseThanBefore: boolean };
  book: { maxPly: number };
}

export const CLASSIFICATION: ClassificationConfig = {
  /** Upper EPL bounds (inclusive) for each quality band. Anything above `mistake` is a blunder. */
  epl: {
    excellent: 0.02,
    good: 0.05,
    inaccuracy: 0.1,
    mistake: 0.2,
  },

  great: {
    /** The played move must be the engine's top move and the second-best move must lose at least this much EP. */
    minSecondBestGap: 0.1,
    /**
     * Refinement beyond the base rule: a recapture on the square the opponent
     * just captured on is usually the obvious "only move", and Chess.com shows
     * those as Best rather than Great. Set to false for the pure rule.
     */
    excludeRecaptures: true,
  },

  brilliant: {
    /** Net material given up (pawn units) after the opponent's best immediate captures. 2 = a minor piece for a pawn, or the exchange. */
    minSacrifice: 2,
    /** The mover must NOT already be completely winning before the move (mover win probability, 0..1). */
    maxWinBefore: 0.9,
    /** The mover must not be losing after the move (mover win probability after the played move, 0..1). */
    minWinAfter: 0.4,
    /** The move must be Best or within this EPL of best (defaults to the Excellent band). */
    maxEpl: 0.02,
    /** Node budget for the capture-only search used to measure the sacrifice. */
    qsearchNodeLimit: 4000,
  },

  miss: {
    /** The opponent's previous move must have been one of these. */
    afterOpponent: ['mistake', 'blunder'],
    /** This move counts as failing to punish when its EPL vs. the punishing move is at least this. */
    minEpl: 0.1,
    /**
     * Refinement beyond the base rule: if the move not only fails to punish
     * but leaves the mover worse off than before the opponent's error, keep
     * the harsher Mistake/Blunder label instead of Miss. Set to false for the
     * pure rule.
     */
    keepBlunderIfWorseThanBefore: true,
  },

  book: {
    /** Stop looking for book moves after this many plies. */
    maxPly: 40,
  },
};

export const ACCURACY = {
  /** Lichess per-move accuracy curve: a * exp(-b * winPercentLoss) + c, clamped to [0, 100]. */
  a: 103.1668100711649,
  b: 0.04354415386753951,
  c: -3.166924740191411,
  /**
   * Lichess's source adds a +1 "uncertainty bonus" to each move's accuracy
   * (lila AccuracyPercent.scala). Set this to 1 to match lichess.org numbers
   * exactly; it is 0 here to follow the formula as specified.
   */
  uncertaintyBonus: 0,
  /** Volatility weights (standard deviation of win%) are clamped to this range. */
  minWeight: 0.5,
  maxWeight: 12,
} as const;

export const WIN_PROBABILITY = {
  /** Lichess logistic coefficient: win% = 50 + 50 * (2 / (1 + exp(-k * cp)) - 1). */
  k: 0.00368208,
} as const;

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;

export const ANALYSIS_PRESETS = {
  fast: { label: 'Fast', depth: 12 },
  standard: { label: 'Standard', depth: 16 },
  deep: { label: 'Deep', depth: 20 },
} as const;

export type AnalysisPreset = keyof typeof ANALYSIS_PRESETS;
