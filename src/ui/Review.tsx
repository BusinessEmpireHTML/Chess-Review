import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ANALYSIS_PRESETS, type AnalysisPreset } from '../config/classification';
import type { EngineFlavor } from '../engine/pool';
import { explain, LABELS } from '../lib/explain';
import { detectBook, loadOpeningBook, type BookInfo } from '../lib/openings';
import { parseGame, PgnError, sideToMove, uciLineToSan, uciToSan, type ParsedGame, type Ply } from '../lib/pgn';
import { buildReport, positionEval, type GameReport } from '../lib/review';
import { CLASSIFICATION_ORDER, type Color, type PositionEval } from '../lib/types';
import { whiteView, type WhiteView } from '../lib/winprob';
import { Badge } from './Badge';
import { Board, type Arrow } from './Board';
import { EvalBar } from './EvalBar';
import { EvalGraph } from './EvalGraph';
import { MoveList } from './MoveList';
import { useAnalysis, type AnalysisStatus } from './useAnalysis';

export interface GameSource {
  /** Cache identity: the game URL, or a fingerprint for pasted PGNs. */
  id: string;
  pgn: string;
  url?: string;
  white: { name: string; rating?: number };
  black: { name: string; rating?: number };
  /** The searched user's color, if known. Sets the default orientation. */
  userColor?: Color;
  subtitle?: string;
}

interface Props {
  source: GameSource;
  preset: AnalysisPreset;
  onPreset: (p: AnalysisPreset) => void;
  flavors: EngineFlavor[];
  flavor: EngineFlavor;
  onFlavor: (f: EngineFlavor) => void;
  onBack: () => void;
}

const EMPTY_BOOK: BookInfo = { isBook: [], openingAtPly: [], opening: undefined };

function viewAt(game: ParsedGame, evals: (PositionEval | undefined)[], i: number): WhiteView | null {
  const pe = positionEval(game, evals, i);
  if (!pe) return null;
  const stm = sideToMove(game.fens[i]);
  if (pe.terminal === 'checkmate') return { win: stm === 'w' ? 0 : 100, label: stm === 'w' ? '0-1' : '1-0', cp: 0 };
  if (pe.terminal === 'draw') return { win: 50, label: '½-½', cp: 0 };
  return pe.lines[0] ? whiteView(pe.lines[0].score, stm) : null;
}

function moveLabel(p: Ply) {
  return `${p.moveNumber}${p.color === 'w' ? '.' : '...'} ${p.san}`;
}

/** SAN line with move numbers, e.g. "12. Nf3 Nc6 13. Bb5" or "12... Nc6 13. Bb5". */
function formatLine(fen: string, pv: string[], max = 10): string {
  const sans = uciLineToSan(fen, pv, max);
  const parts = fen.split(' ');
  let n = Number(parts[5]) || 1;
  let white = parts[1] === 'w';
  const out: string[] = [];
  sans.forEach((san, k) => {
    if (white) out.push(`${n}. ${san}`);
    else out.push(k === 0 ? `${n}... ${san}` : san);
    if (!white) n++;
    white = !white;
  });
  return out.join(' ');
}

function resultText(game: ParsedGame): { score: string; detail: string } {
  const r = game.headers.Result ?? '*';
  const score = r === '1/2-1/2' ? '½–½' : r === '*' ? '–' : r.replace('-', '–');
  return { score, detail: game.headers.Termination ?? (r === '*' ? 'Game in progress' : '') };
}

function Accuracy({ value, pending }: { value: number | null; pending: boolean }) {
  return (
    <div class={`acc ${pending ? 'acc-pending' : ''}`}>
      <span class="acc-num">{value === null ? '—' : value.toFixed(1)}</span>
      <span class="acc-label">Accuracy</span>
    </div>
  );
}

function StatusLine({ status, report, depth, flavor }: { status: AnalysisStatus; report: GameReport; depth: number; flavor: EngineFlavor }) {
  const total = report.whiteWin.length;
  const pct = status.phase === 'done' ? 100 : (report.analyzed / Math.max(1, total)) * 100;
  let text: string;
  switch (status.phase) {
    case 'idle':
      text = 'Preparing…';
      break;
    case 'loading-engine':
      text = `Loading ${flavor.label}${status.percent !== undefined ? ` · ${Math.round(status.percent * 100)}%` : '…'}`;
      break;
    case 'analyzing':
      text = `Analyzing · ${report.analyzed} / ${total} positions · depth ${depth} · ${status.workers} worker${status.workers > 1 ? 's' : ''}`;
      break;
    case 'done':
      text = status.fromCache ? `Loaded from cache · depth ${depth}` : `Analyzed ${total} positions at depth ${depth} in ${status.seconds?.toFixed(1)}s`;
      break;
    case 'error':
      text = status.message;
  }
  const loadPct = status.phase === 'loading-engine' ? (status.percent ?? 0) * 100 : pct;
  return (
    <div class={`status status-${status.phase}`} role="status" aria-live="polite">
      <div class="status-bar">
        <div class="status-fill" style={{ width: `${loadPct}%` }} />
      </div>
      <span class="status-text">{text}</span>
    </div>
  );
}

export function Review({ source, preset, onPreset, flavors, flavor, onFlavor, onBack }: Props) {
  const parsed = useMemo(() => {
    try {
      return { game: parseGame(source.pgn), error: null };
    } catch (e) {
      return { game: null, error: e instanceof PgnError ? e.message : String(e) };
    }
  }, [source.pgn]);
  const game = parsed.game;

  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<'white' | 'black'>(source.userColor === 'b' ? 'black' : 'white');
  const [book, setBook] = useState<BookInfo>(EMPTY_BOOK);
  const sacrificeMemo = useRef(new Map<number, number>());
  const depth = ANALYSIS_PRESETS[preset].depth;

  useEffect(() => {
    sacrificeMemo.current = new Map();
    setPly(0);
    setBook(EMPTY_BOOK);
    if (!game) return;
    let live = true;
    loadOpeningBook()
      .then((b) => live && setBook(detectBook(game, b)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [game]);

  const { evals, status, prioritize } = useAnalysis(game, source.id, depth, flavor);

  const report = useMemo<GameReport | null>(
    () => (game ? buildReport(game, evals, book, sacrificeMemo.current) : null),
    [game, evals, book],
  );
  const views = useMemo(() => (game ? game.fens.map((_, i) => viewAt(game, evals, i)) : []), [game, evals]);

  const last = game ? game.plies.length : 0;
  const go = (p: number) => setPly(Math.max(0, Math.min(last, p)));

  useEffect(() => {
    if (ply > 0) prioritize([ply - 1, ply]);
  }, [ply]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || t?.isContentEditable) return;
      const actions: Record<string, () => void> = {
        ArrowLeft: () => setPly((p) => Math.max(0, p - 1)),
        ArrowRight: () => setPly((p) => Math.min(last, p + 1)),
        Home: () => setPly(0),
        End: () => setPly(last),
        f: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
        F: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
      };
      const act = actions[e.key];
      if (act) {
        e.preventDefault();
        act();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  if (!game || !report) {
    return (
      <div class="review-error card">
        <h2>Couldn't open this game</h2>
        <p class="muted">{parsed.error}</p>
        <button class="btn" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  const move = ply > 0 ? game.plies[ply - 1] : null;
  const moveReport = ply > 0 ? report.moves[ply - 1] : null;
  const fen = game.fens[ply];
  const currentEval = positionEval(game, evals, ply);

  const arrows: Arrow[] = [];
  if (move && moveReport) {
    const best = moveReport.evaluation.bestMove;
    arrows.push({ from: best.slice(0, 2), to: best.slice(2, 4), classification: 'best' });
    if (!moveReport.evaluation.playedIsBest) arrows.push({ from: move.from, to: move.to, classification: moveReport.classification });
  }

  const bestSan = move && moveReport ? uciToSan(move.fenBefore, moveReport.evaluation.bestMove) : '';
  const explanation =
    move && moveReport
      ? explain(moveReport, {
          san: move.san,
          bestSan,
          prevSan: ply > 1 ? game.plies[ply - 2].san : undefined,
          opening: book.openingAtPly[ply - 1],
        })
      : null;

  const { score, detail } = resultText(game);
  const pending = !report.complete;
  const players = { w: source.white, b: source.black };

  const engineLines = currentEval?.lines ?? [];

  return (
    <div class="review">
      <header class="summary card">
        <button class="btn btn-ghost back" onClick={onBack} aria-label="Back to games">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>Games</span>
        </button>
        <div class="summary-main">
          {(['w', 'b'] as const).map((c) => (
            <div class={`player player-${c} ${source.userColor === c ? 'player-you' : ''}`} key={c}>
              <span class={`piece-dot piece-dot-${c}`} aria-hidden="true" />
              <div class="player-id">
                <span class="player-name">{players[c].name}</span>
                <span class="player-rating">{players[c].rating ? players[c].rating : c === 'w' ? 'White' : 'Black'}</span>
              </div>
              <Accuracy value={report.accuracy[c]} pending={pending} />
            </div>
          ))}
          <div class="summary-result">
            <span class="result-score">{score}</span>
            <span class="result-detail">{detail}</span>
          </div>
        </div>
        <div class="summary-meta">
          <span class="opening" title={book.opening ? `${book.opening.eco} · ${book.opening.name}` : undefined}>
            {book.opening ? (
              <>
                <span class="eco">{book.opening.eco}</span> {book.opening.name}
              </>
            ) : (
              <span class="muted">{game.headers.ECO ? `ECO ${game.headers.ECO}` : 'Opening not in book'}</span>
            )}
          </span>
          {source.subtitle && <span class="muted">{source.subtitle}</span>}
          <div class="summary-controls">
            <div class="seg" role="radiogroup" aria-label="Analysis depth">
              {(Object.keys(ANALYSIS_PRESETS) as AnalysisPreset[]).map((p) => (
                <button
                  key={p}
                  role="radio"
                  aria-checked={p === preset}
                  class={p === preset ? 'on' : ''}
                  onClick={() => onPreset(p)}
                  title={`Depth ${ANALYSIS_PRESETS[p].depth}`}
                >
                  {ANALYSIS_PRESETS[p].label}
                  <small>{ANALYSIS_PRESETS[p].depth}</small>
                </button>
              ))}
            </div>
            {flavors.length > 1 && (
              <select
                class="select"
                value={flavor.id}
                aria-label="Engine"
                onChange={(e) => onFlavor(flavors.find((f) => f.id === (e.target as HTMLSelectElement).value) ?? flavor)}
              >
                {flavors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.sizeMB} MB)
                  </option>
                ))}
              </select>
            )}
            {source.url && (
              <a class="btn btn-ghost" href={source.url} target="_blank" rel="noopener noreferrer">
                Chess.com ↗
              </a>
            )}
          </div>
        </div>
        <StatusLine status={status} report={report} depth={depth} flavor={flavor} />
      </header>

      <section class="board-col">
        <div class="board-row">
          <EvalBar view={views[ply]} orientation={orientation} />
          <Board
            fen={fen}
            orientation={orientation}
            lastMove={move ? [move.from, move.to] : undefined}
            classification={moveReport?.classification}
            arrows={arrows}
            inCheck={!!move && /[+#]$/.test(move.san)}
            plyKey={ply}
          />
        </div>
        <nav class="controls" aria-label="Move navigation">
          <button class="btn icon" onClick={() => go(0)} disabled={ply === 0} title="First move (Home)" aria-label="First move">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 5l-8 7 8 7z" /></svg>
          </button>
          <button class="btn icon" onClick={() => go(ply - 1)} disabled={ply === 0} title="Previous (←)" aria-label="Previous move">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5l-8 7 8 7z" /></svg>
          </button>
          <span class="controls-pos">{move ? moveLabel(move) : 'Start'}</span>
          <button class="btn icon" onClick={() => go(ply + 1)} disabled={ply === last} title="Next (→)" aria-label="Next move">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l8 7-8 7z" /></svg>
          </button>
          <button class="btn icon" onClick={() => go(last)} disabled={ply === last} title="Last move (End)" aria-label="Last move">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 5l8 7-8 7z" /></svg>
          </button>
          <button
            class="btn icon"
            onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
            title="Flip board (F)"
            aria-label="Flip board"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" class="stroke">
              <path d="M7 4v13m0 0l-3-3m3 3l3-3M17 20V7m0 0l-3 3m3-3l3 3" />
            </svg>
          </button>
        </nav>
      </section>

      <section class="side">
        <div class={`coach card ${moveReport ? 'coach-' + moveReport.classification : ''}`} aria-live="polite">
          {move && moveReport && explanation ? (
            <>
              <div class="coach-head">
                <Badge c={moveReport.classification} size={30} />
                <div class="coach-title">
                  <span class="coach-move">{moveLabel(move)}</span>
                  <span class="coach-class">{LABELS[moveReport.classification]}</span>
                </div>
                <span class="coach-eval">{views[ply]?.label ?? ''}</span>
              </div>
              <p class="coach-text">
                <strong>{explanation.split(' — ')[0]}</strong> — {explanation.split(' — ').slice(1).join(' — ')}
              </p>
              {!moveReport.evaluation.playedIsBest && moveReport.classification !== 'book' && (
                <div class="coach-best">
                  <Badge c="best" size={16} />
                  <span>
                    Best was <strong>{bestSan}</strong>
                  </span>
                  <span class="coach-best-line">{formatLine(move.fenBefore, moveReport.evaluation.lines[0]?.pv ?? [], 6)}</span>
                </div>
              )}
            </>
          ) : move ? (
            <div class="coach-head">
              <span class="badge-skeleton" />
              <div class="coach-title">
                <span class="coach-move">{moveLabel(move)}</span>
                <span class="coach-class muted">Analyzing this move…</span>
              </div>
            </div>
          ) : (
            <div class="coach-head">
              <div class="coach-title">
                <span class="coach-move">Starting position</span>
                <span class="coach-class muted">Step through with → or click a move. F flips the board.</span>
              </div>
            </div>
          )}
        </div>

        <div class="card graph-card">
          <EvalGraph whiteWin={report.whiteWin} views={views} moves={report.moves} plies={game.plies} current={ply} onSelect={go} />
        </div>

        <div class="card engine">
          <div class="card-title">
            <span>Engine</span>
            <span class="muted">
              {flavor.label} · depth {currentEval?.depth || depth}
            </span>
          </div>
          {currentEval?.terminal ? (
            <p class="engine-terminal">{currentEval.terminal === 'checkmate' ? `Checkmate · ${sideToMove(fen) === 'w' ? 'Black' : 'White'} wins` : 'Draw'}</p>
          ) : engineLines.length ? (
            engineLines.map((l, k) => (
              <div class="engine-line" key={k}>
                <span class={`engine-eval ${whiteView(l.score, sideToMove(fen)).win >= 50 ? 'pos' : 'neg'}`}>{whiteView(l.score, sideToMove(fen)).label}</span>
                <span class="engine-pv">{formatLine(fen, l.pv, 10)}</span>
              </div>
            ))
          ) : (
            <p class="muted engine-wait">Waiting for analysis of this position…</p>
          )}
        </div>

        <div class="card moves-card">
          <MoveList plies={game.plies} moves={report.moves} current={ply} onSelect={go} />
        </div>

        <div class="card counts">
          <table>
            <thead>
              <tr>
                <th scope="col">
                  <span class="sr-only">Classification</span>
                </th>
                <th scope="col" title={players.w.name}>
                  <span class="piece-dot piece-dot-w" /> {players.w.name}
                </th>
                <th scope="col" title={players.b.name}>
                  <span class="piece-dot piece-dot-b" /> {players.b.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {CLASSIFICATION_ORDER.map((c) => (
                <tr key={c} class={report.counts.w[c] + report.counts.b[c] === 0 ? 'zero' : ''}>
                  <th scope="row">
                    <Badge c={c} size={18} /> {LABELS[c]}
                  </th>
                  <td>{report.counts.w[c]}</td>
                  <td>{report.counts.b[c]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
