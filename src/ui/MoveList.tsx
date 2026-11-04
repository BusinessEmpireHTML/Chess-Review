import { useEffect, useRef } from 'preact/hooks';
import type { Ply } from '../lib/pgn';
import type { MoveReport } from '../lib/review';
import { Badge } from './Badge';

interface Props {
  plies: Ply[];
  moves: (MoveReport | null)[];
  /** Current position index (0 = start, i = after ply i-1). */
  current: number;
  onSelect: (position: number) => void;
  /** Show classification badges (off while playing a game). */
  badges?: boolean;
}

export function MoveList({ plies, moves, current, onSelect, badges = true }: Props) {
  const box = useRef<HTMLDivElement>(null);

  // Keep the current move visible by scrolling only the list, never the page.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.mv.active');
    const container = box.current;
    if (!el || !container) return;
    const top = el.offsetTop - container.offsetTop;
    if (top < container.scrollTop + 4) container.scrollTop = top - 36;
    else if (top + el.offsetHeight > container.scrollTop + container.clientHeight - 4)
      container.scrollTop = top + el.offsetHeight - container.clientHeight + 36;
  }, [current]);

  const rows: { num: number; w?: Ply; b?: Ply }[] = [];
  for (const p of plies) {
    let row = rows[rows.length - 1];
    if (!row || row.num !== p.moveNumber) rows.push((row = { num: p.moveNumber }));
    row[p.color] = p;
  }

  const cell = (p?: Ply) => {
    if (!p) return <span class="mv mv-empty">…</span>;
    const report = moves[p.index];
    const pos = p.index + 1;
    return (
      <button type="button" class={`mv ${pos === current ? 'active' : ''} ${report ? 'mv-' + report.classification : ''}`} onClick={() => onSelect(pos)}>
        {badges && <span class="mv-badge">{report ? <Badge c={report.classification} size={16} /> : <span class="mv-pending" />}</span>}
        <span class="mv-san">{p.san}</span>
      </button>
    );
  };

  return (
    <div class="movelist" ref={box}>
      {rows.map((r) => (
        <div class="mv-row" key={r.num}>
          <span class="mv-num">{r.num}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
      {!plies.length && <p class="muted">No moves in this game.</p>}
    </div>
  );
}
