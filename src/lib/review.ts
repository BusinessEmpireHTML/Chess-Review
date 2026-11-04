import { CLASSIFICATION, type ClassificationConfig } from '../config/classification';
import { gameAccuracy } from './accuracy';
import { classifyMove, couldBeBrilliant, evaluateMove, type MoveEvaluation, type MoveFacts } from './classify';
import { sacrificeSize } from './material';
import type { BookInfo } from './openings';
import { isRecapture, sideToMove, type ParsedGame } from './pgn';
import { CLASSIFICATION_ORDER, type Classification, type Color, type PositionEval } from './types';
import { winPercentFor } from './winprob';

export interface MoveReport {
  ply: number;
  color: Color;
  classification: Classification;
  epl: number;
  evaluation: MoveEvaluation;
  sacrifice: number;
  /** Lichess per-move accuracy, 0..100. */
  accuracy: number;
}

export type ClassCounts = Record<Classification, number>;

export interface GameReport {
  /** One entry per ply; null until both surrounding positions have been analyzed. */
  moves: (MoveReport | null)[];
  /** White's win% for each position (index 0 = start), null until analyzed. */
  whiteWin: (number | null)[];
  accuracy: { w: number | null; b: number | null };
  counts: { w: ClassCounts; b: ClassCounts };
  /** Number of positions analyzed so far. */
  analyzed: number;
  complete: boolean;
}

export const emptyCounts = (): ClassCounts =>
  Object.fromEntries(CLASSIFICATION_ORDER.map((c) => [c, 0])) as ClassCounts;

/** Engine evaluation of position i, or a synthesized one for a terminal final position. */
export function positionEval(game: ParsedGame, evals: (PositionEval | undefined)[], i: number): PositionEval | undefined {
  if (i === game.plies.length && game.finalTerminal) return { lines: [], terminal: game.finalTerminal, depth: 0 };
  return evals[i];
}

function whiteWinAt(game: ParsedGame, pe: PositionEval | undefined, i: number): number | null {
  if (!pe) return null;
  const stm = sideToMove(game.fens[i]);
  if (pe.terminal === 'checkmate') return stm === 'w' ? 0 : 100;
  if (pe.terminal === 'draw') return 50;
  const top = pe.lines[0];
  return top ? winPercentFor(top.score, stm, 'w') : null;
}

/**
 * Build the full review from whatever positions have been analyzed so far.
 * Pure apart from the optional sacrifice memo (keyed by ply), which callers
 * pass in so incremental rebuilds don't redo the capture search.
 */
export function buildReport(
  game: ParsedGame,
  evals: (PositionEval | undefined)[],
  book: BookInfo,
  sacrificeMemo: Map<number, number> = new Map(),
  cfg: ClassificationConfig = CLASSIFICATION,
): GameReport {
  const n = game.plies.length;
  const whiteWin = game.fens.map((_, i) => whiteWinAt(game, positionEval(game, evals, i), i));
  const moves: (MoveReport | null)[] = [];

  for (let i = 0; i < n; i++) {
    const ply = game.plies[i];
    const before = positionEval(game, evals, i);
    const after = positionEval(game, evals, i + 1);
    const evaluation = before && after ? evaluateMove(before, after, ply.uci) : null;
    if (!evaluation) {
      moves.push(null);
      continue;
    }

    const prev = moves[i - 1] ?? undefined;
    const facts: Omit<MoveFacts, 'sacrifice'> = {
      isBook: book.isBook[i] ?? false,
      playedIsBest: evaluation.playedIsBest,
      bestEP: evaluation.best.ep,
      playedEP: evaluation.played.ep,
      secondEP: evaluation.second?.ep ?? null,
      isRecapture: isRecapture(game, i),
      prevClassification: prev?.classification,
      // The mover's standing before the opponent's last move = 1 - opponent's best EP then.
      moverEPBeforePrev: prev ? 1 - prev.evaluation.best.ep : undefined,
    };

    let sacrifice = 0;
    if (couldBeBrilliant(facts, cfg)) {
      let memo = sacrificeMemo.get(i);
      if (memo === undefined) {
        memo = sacrificeSize(ply.fenBefore, ply.uci);
        sacrificeMemo.set(i, memo);
      }
      sacrifice = memo;
    }

    const classification = classifyMove({ ...facts, sacrifice }, cfg);
    moves.push({
      ply: i,
      color: ply.color,
      classification,
      epl: evaluation.epl,
      evaluation,
      sacrifice,
      accuracy: 0,
    });
  }

  // Accuracy over the contiguous analyzed prefix, so it fills in live.
  let prefix = 0;
  while (prefix < whiteWin.length && whiteWin[prefix] !== null) prefix++;
  const acc = gameAccuracy(whiteWin.slice(0, prefix) as number[], game.startColor);
  acc.perMove.forEach((a, i) => {
    const m = moves[i];
    if (m) m.accuracy = a;
  });

  const counts = { w: emptyCounts(), b: emptyCounts() };
  for (const m of moves) if (m) counts[m.color][m.classification]++;

  const analyzed = whiteWin.filter((w) => w !== null).length;
  return {
    moves,
    whiteWin,
    accuracy: { w: acc.w, b: acc.b },
    counts,
    analyzed,
    complete: analyzed === whiteWin.length,
  };
}
