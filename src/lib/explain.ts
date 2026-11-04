import type { Outcome } from './classify';
import type { Opening } from './openings';
import type { MoveReport } from './review';
import type { Classification } from './types';

export const LABELS: Record<Classification, string> = {
  book: 'Book',
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
};

function pawns(cp: number): string {
  const p = Math.abs(cp) / 100;
  const n = p >= 2 ? Math.round(p).toString() : p.toFixed(1);
  return `${n} pawn${n === '1' || n === '1.0' ? '' : 's'}`;
}

function materialName(points: number): string {
  if (points >= 8) return 'the queen';
  if (points >= 5) return 'a rook';
  if (points >= 3) return 'a piece';
  return 'material';
}

/** What the played move costs, compared with the best move, in plain words. */
export function lossPhrase(best: Outcome, played: Outcome): string {
  const bestMates = best.mate !== null && best.mate > 0;
  const playedMates = played.mate !== null && played.mate >= 0;
  const playedGetsMated = played.mate !== null && played.mate < 0;
  const bestGetsMated = best.mate !== null && best.mate < 0;

  if (bestMates && !playedMates) return `This misses mate in ${best.mate}.`;
  if (playedGetsMated && !bestGetsMated) return `This allows mate in ${-played.mate!}.`;
  if (bestMates && playedMates) return `Mate takes longer this way.`;
  if (bestGetsMated && playedGetsMated) return `It speeds up the mate.`;

  const loss = best.cp - played.cp;
  if (best.ep >= 0.75 && played.ep < 0.6) return `This throws away a winning position (about ${pawns(loss)}).`;
  if (best.ep >= 0.4 && played.ep < 0.25) return `This turns the game into a losing position (about ${pawns(loss)}).`;
  return `This loses about ${pawns(loss)} of advantage.`;
}

export interface ExplainContext {
  san: string;
  bestSan: string;
  secondSan?: string;
  prevSan?: string;
  opening?: Opening;
}

/** One-line explanation, e.g. "Blunder — Qxd5 was best. This loses about 3 pawns of advantage." */
export function explain(m: MoveReport, ctx: ExplainContext): string {
  const { best, played, second } = m.evaluation;
  const label = LABELS[m.classification];
  switch (m.classification) {
    case 'book':
      return ctx.opening ? `${label} — ${ctx.opening.name} (${ctx.opening.eco}).` : `${label} — a known opening move.`;
    case 'brilliant':
      return `${label} — ${ctx.san} sacrifices ${materialName(m.sacrifice)}, and it works.`;
    case 'great': {
      const alt = second ? lossPhrase(best, second).replace(/^This/, 'Anything else') : '';
      return `${label} — ${ctx.san} is the only good move here.${alt ? ' ' + alt : ''}`;
    }
    case 'best':
      return played.mate === 0 ? `${label} — ${ctx.san} is checkmate.` : `${label} — ${ctx.san} is the engine's top choice.`;
    case 'excellent':
      return `${label} — nearly as strong as ${ctx.bestSan}.`;
    case 'good':
      return `${label} — a solid move, though ${ctx.bestSan} was stronger.`;
    case 'miss':
      return `${label} — ${ctx.bestSan} would have punished ${ctx.prevSan ?? 'the last move'}. ${lossPhrase(best, played)}`;
    default:
      return `${label} — ${ctx.bestSan} was best. ${lossPhrase(best, played)}`;
  }
}
