export type Color = 'w' | 'b';

/**
 * An engine score, always from the point of view of the side to move in the
 * position that was searched (this is what UCI reports).
 *  - cp:   centipawns
 *  - mate: moves to mate; > 0 means the side to move mates, < 0 means it gets
 *          mated. `mate 0` means the side to move is already checkmated.
 */
export type Score = { type: 'cp'; value: number } | { type: 'mate'; value: number };

export interface EngineLine {
  /** First move of the line, in UCI notation (e2e4, e7e8q). */
  move: string;
  score: Score;
  /** Full principal variation in UCI notation, starting with `move`. */
  pv: string[];
  depth: number;
}

/** Raw engine result for one position. Lines are ordered best first (MultiPV 1, 2). */
export interface PositionEval {
  /** Lines from the engine, best first. Empty for terminal positions. */
  lines: EngineLine[];
  /** Set for positions with no legal moves (or a dead draw), where no search runs. */
  terminal?: 'checkmate' | 'draw';
  depth: number;
}

export type Classification =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export const CLASSIFICATION_ORDER: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];
