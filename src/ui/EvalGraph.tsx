import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LABELS } from '../lib/explain';
import type { Ply } from '../lib/pgn';
import type { MoveReport } from '../lib/review';
import type { WhiteView } from '../lib/winprob';
import { Badge } from './Badge';
import { CLASS_COLORS, NOTABLE } from './theme';

interface Props {
  /** White win% per position (index 0 = start). */
  whiteWin: (number | null)[];
  views: (WhiteView | null)[];
  moves: (MoveReport | null)[];
  plies: Ply[];
  current: number;
  onSelect: (position: number) => void;
}

const PAD_X = 6;

function moveLabel(ply: Ply): string {
  return `${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} ${ply.san}`;
}

/**
 * Eval graph across the whole game: White's win% as the light area (White's
 * share from the bottom), one dot per move colored by classification, a
 * crosshair + tooltip on hover, click to jump.
 */
export function EvalGraph({ whiteWin, views, moves, plies, current, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 112 });
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      // Defer to the next frame so the resize never re-enters layout in the same pass.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize((s) => (s.w === w ? s : { w, h: w < 480 ? 92 : 112 })));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  const n = Math.max(1, whiteWin.length - 1);
  const { w, h } = size;
  const x = (i: number) => PAD_X + (i / n) * (w - 2 * PAD_X);
  const y = (win: number) => h - (win / 100) * h;

  const { area, line } = useMemo(() => {
    let end = 0;
    while (end < whiteWin.length && whiteWin[end] !== null) end++;
    if (end < 2) return { area: '', line: '' };
    const pts = whiteWin.slice(0, end).map((v, i) => `${x(i).toFixed(1)},${y(v!).toFixed(1)}`);
    return {
      line: `M${pts.join('L')}`,
      area: `M${x(0).toFixed(1)},${h}L${pts.join('L')}L${x(end - 1).toFixed(1)},${h}Z`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteWin, w, h]);

  const spacing = (w - 2 * PAD_X) / n;
  const rNotable = Math.max(3.5, Math.min(5, spacing * 0.45));
  const rRoutine = Math.max(1.6, Math.min(3, spacing * 0.28));

  const indexAt = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const i = Math.round(((clientX - rect.left - PAD_X) / (rect.width - 2 * PAD_X)) * n);
    return Math.max(0, Math.min(n, i));
  };

  const hoverMove = hover !== null && hover > 0 ? plies[hover - 1] : null;
  const hoverReport = hover !== null && hover > 0 ? moves[hover - 1] : null;
  const hoverView = hover !== null ? views[hover] : null;

  return (
    <div
      ref={wrap}
      class="graph"
      onPointerMove={(e) => setHover(indexAt(e.clientX))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => onSelect(indexAt(e.clientX))}
      role="img"
      aria-label="Evaluation graph. Click to jump to a move."
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} class="graph-svg">
        <rect x="0" y="0" width={w} height={h} class="graph-bg" />
        {area && <path d={area} class="graph-area" />}
        {line && <path d={line} class="graph-line" />}
        <line x1="0" x2={w} y1={h / 2} y2={h / 2} class="graph-mid" />
        <line x1={x(current)} x2={x(current)} y1="0" y2={h} class="graph-cursor" />
        {hover !== null && hover !== current && <line x1={x(hover)} x2={x(hover)} y1="0" y2={h} class="graph-hover" />}
        {moves.map((m, i) => {
          const v = whiteWin[i + 1];
          if (!m || v === null) return null;
          const notable = NOTABLE.has(m.classification);
          const isCurrent = i + 1 === current;
          return (
            <circle
              key={i}
              cx={x(i + 1)}
              cy={Math.min(h - rNotable - 1, Math.max(rNotable + 1, y(v)))}
              r={isCurrent ? rNotable + 1.5 : notable ? rNotable : rRoutine}
              fill={CLASS_COLORS[m.classification]}
              class={notable || isCurrent ? 'graph-dot ringed' : 'graph-dot'}
            />
          );
        })}
      </svg>
      {hover !== null && (
        <div class="graph-tip" style={{ left: `${Math.min(Math.max(x(hover), 70), w - 70)}px` }}>
          {hoverMove ? (
            <>
              <span class="graph-tip-move">{moveLabel(hoverMove)}</span>
              {hoverReport && (
                <span class="graph-tip-class">
                  <Badge c={hoverReport.classification} size={14} title={false} /> {LABELS[hoverReport.classification]}
                </span>
              )}
            </>
          ) : (
            <span class="graph-tip-move">Start</span>
          )}
          <span class="graph-tip-eval">{hoverView?.label ?? '…'}</span>
        </div>
      )}
    </div>
  );
}
