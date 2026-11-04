import { explain, LABELS } from '../lib/explain';
import { sideToMove, uciLineToSan, uciToSan, type ParsedGame, type Ply } from '../lib/pgn';
import { Badge } from './Badge';
import type { Explore } from './useExplore';

function plyLabel(p: Pick<Ply, 'moveNumber' | 'color' | 'san'>) {
  return `${p.moveNumber}${p.color === 'w' ? '.' : '...'} ${p.san}`;
}

/** Move number of a move made in `fenBefore`. */
const moveNumberOf = (fenBefore: string) => Number(fenBefore.split(' ')[5]) || 1;

export function ExplorePanel({ ex, game }: { ex: Explore; game: ParsedGame }) {
  const s = ex.state!;
  const base = s.basePly === 0 ? 'the starting position' : `after ${plyLabel(game.plies[s.basePly - 1])}`;
  const k = ex.lastUserIndex;
  const tried = k >= 0 ? s.moves[k] : null;
  const grade = k >= 0 ? ex.grades[k] : null;
  const bestSan = tried && grade ? uciToSan(tried.fenBefore, grade.evaluation.bestMove) : '';
  const text = tried && grade ? explain(grade, { san: tried.san, bestSan }) : null;
  const toMove = ex.fen ? sideToMove(ex.fen) : 'w';
  const realMove = game.plies[s.basePly];

  let status: string;
  if (ex.error) status = ex.error;
  else if (ex.terminal === 'checkmate') status = `Checkmate. ${toMove === 'w' ? 'Black' : 'White'} wins this line.`;
  else if (ex.terminal === 'draw') status = 'This line ends in a draw.';
  else if (ex.engineToMove) status = 'Stockfish is thinking…';
  else if (!ex.currentEval) status = 'Analyzing this position…';
  else status = `${toMove === 'w' ? 'White' : 'Black'} to move. Play a move on the board.`;

  return (
    <div class={`coach card explore ${grade ? 'coach-' + grade.classification : ''}`} aria-live="polite">
      <div class="explore-head">
        <span class="explore-tag">Exploring</span>
        <span class="explore-from">from {base}</span>
        <button type="button" class="btn btn-sm btn-primary explore-back" onClick={ex.exit} title="Back to the game (Esc)">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Back to game
        </button>
      </div>

      <div class="explore-line" role="list">
        <button type="button" role="listitem" class={`xl-move xl-start ${s.cursor === 0 ? 'active' : ''}`} onClick={() => ex.goTo(0)} title="Branch point">
          ◆
        </button>
        {s.moves.map((m, i) => {
          const n = moveNumberOf(m.fenBefore);
          const num = m.color === 'w' ? `${n}.` : i === 0 ? `${n}...` : '';
          const g = ex.grades[i];
          return (
            <button
              type="button"
              role="listitem"
              key={i}
              class={`xl-move ${i === s.cursor - 1 ? 'active' : ''} ${m.byEngine ? 'xl-engine' : ''}`}
              onClick={() => ex.goTo(i + 1)}
              title={m.byEngine ? 'Stockfish' : g ? LABELS[g.classification] : undefined}
            >
              {num && <span class="xl-num">{num}</span>}
              {g && <Badge c={g.classification} size={14} title={false} />}
              {m.san}
            </button>
          );
        })}
      </div>

      {tried && grade && text ? (
        <div class="explore-feedback">
          <div class="coach-head">
            <Badge c={grade.classification} size={28} />
            <div class="coach-title">
              <span class="coach-move">Your try: {plyLabel({ moveNumber: moveNumberOf(tried.fenBefore), color: tried.color, san: tried.san })}</span>
              <span class="coach-class">{LABELS[grade.classification]}</span>
            </div>
          </div>
          <p class="coach-text">
            <strong>{text.split(' — ')[0]}</strong> — {text.split(' — ').slice(1).join(' — ')}
          </p>
          {!grade.evaluation.playedIsBest && (
            <div class="coach-best">
              <Badge c="best" size={16} />
              <span>
                Best was <strong>{bestSan}</strong>
              </span>
              <span class="coach-best-line">{uciLineToSan(tried.fenBefore, grade.evaluation.lines[0]?.pv ?? [], 6).join(' ')}</span>
            </div>
          )}
          {k === 0 && realMove && tried.uci !== realMove.uci && <p class="explore-note muted">In the game, {plyLabel(realMove)} was played.</p>}
        </div>
      ) : tried ? (
        <div class="coach-head explore-feedback">
          <span class="badge-skeleton" />
          <div class="coach-title">
            <span class="coach-move">Your try: {tried.san}</span>
            <span class="coach-class muted">Grading…</span>
          </div>
        </div>
      ) : null}

      <div class="explore-foot">
        <span class={`explore-status ${ex.thinking ? 'is-thinking' : ''}`}>{status}</span>
        <label class="switch">
          <input type="checkbox" checked={ex.replies} onChange={(e) => ex.setReplies((e.target as HTMLInputElement).checked)} />
          <span class="switch-track" aria-hidden="true" />
          Stockfish replies
        </label>
      </div>
    </div>
  );
}
