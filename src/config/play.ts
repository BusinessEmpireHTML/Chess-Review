/**
 * Play-vs-Stockfish difficulty levels. Stockfish's own strength limiter
 * bottoms out around 1320 Elo, so instead each level searches to a shallow
 * depth with several MultiPV lines and picks among them at random, weighted
 * by how much win% each line gives up (see src/lib/botpick.ts):
 *
 *   weight = exp(-winPercentLoss / temperature)
 *
 * A higher temperature means bigger mistakes are more likely. `randomMove` is
 * an extra chance of playing any legal move at all (the beginner blunder).
 * Level 8 always plays the engine's top move.
 */
export interface BotLevel {
  level: number;
  name: string;
  blurb: string;
  depth: number;
  multiPv: number;
  /** In win% points; 0 = always the best move. */
  temperature: number;
  /** Probability of a uniformly random legal move. */
  randomMove: number;
}

export const BOT_LEVELS: BotLevel[] = [
  { level: 1, name: 'Beginner', blurb: 'Just learning the moves. Hangs pieces often.', depth: 1, multiPv: 8, temperature: 30, randomMove: 0.25 },
  { level: 2, name: 'Novice', blurb: 'Knows the basics, misses simple tactics.', depth: 2, multiPv: 6, temperature: 18, randomMove: 0.12 },
  { level: 3, name: 'Casual', blurb: 'Plays sensible moves with regular slips.', depth: 4, multiPv: 5, temperature: 10, randomMove: 0.05 },
  { level: 4, name: 'Club', blurb: 'Solid, but drifts in complicated positions.', depth: 6, multiPv: 4, temperature: 5, randomMove: 0.02 },
  { level: 5, name: 'Strong club', blurb: 'Punishes most mistakes.', depth: 8, multiPv: 4, temperature: 2.5, randomMove: 0 },
  { level: 6, name: 'Expert', blurb: 'Rarely errs. Bring your best.', depth: 11, multiPv: 3, temperature: 1.2, randomMove: 0 },
  { level: 7, name: 'Master', blurb: 'Near-perfect, with the occasional second-best move.', depth: 14, multiPv: 2, temperature: 0.5, randomMove: 0 },
  { level: 8, name: 'Maximum', blurb: 'Full-strength Stockfish.', depth: 18, multiPv: 1, temperature: 0, randomMove: 0 },
];

/** Minimum time the bot appears to think, so instant replies don't feel jarring. */
export const BOT_MIN_THINK_MS = 450;

export function botLevel(level: number): BotLevel {
  return BOT_LEVELS.find((l) => l.level === level) ?? BOT_LEVELS[3];
}
