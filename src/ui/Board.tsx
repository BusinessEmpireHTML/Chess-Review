import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawBrush, DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { useEffect, useRef } from 'preact/hooks';
import type { Classification } from '../lib/types';
import { Badge } from './Badge';
import { CLASS_COLORS, withAlpha } from './theme';

export interface Arrow {
  from: string;
  to: string;
  classification: Classification;
}

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string];
  /** Tints the last-move squares and colors the badge. */
  classification?: Classification;
  arrows: Arrow[];
  /** The side to move is in check. */
  inCheck?: boolean;
  /** Changes on every navigation so the badge animation replays. */
  plyKey: number;
}

const brushes: Record<string, DrawBrush> = {
  green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
};
for (const [c, color] of Object.entries(CLASS_COLORS)) brushes[c] = { key: `c-${c}`, color, opacity: 0.9, lineWidth: 11 };

function squarePosition(square: string, orientation: 'white' | 'black') {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { col, row };
}

export function Board({ fen, orientation, lastMove, classification, arrows, inCheck = false, plyKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: true,
      disableContextMenu: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: false, visible: true, brushes: brushes as never },
    });
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    cg.set({ fen, orientation, turnColor: turn, check: inCheck, lastMove: lastMove as Key[] | undefined });
    const shapes: DrawShape[] = arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.classification }));
    cg.setAutoShapes(shapes);
  }, [fen, orientation, inCheck, lastMove?.[0], lastMove?.[1], arrows.map((a) => a.from + a.to + a.classification).join()]);

  const badgeSquare = lastMove?.[1];
  const pos = badgeSquare ? squarePosition(badgeSquare, orientation) : null;
  const tint = classification ? withAlpha(CLASS_COLORS[classification], 0.42) : 'rgba(255, 214, 102, 0.35)';

  return (
    <div class="board" style={{ '--lastmove': tint } as Record<string, string>}>
      <div ref={el} class="board-cg" />
      {pos && classification && (
        <div
          key={plyKey}
          class="board-badge"
          style={{ left: `calc(${(pos.col + 1) * 12.5}% - var(--badge) * 0.62)`, top: `calc(${pos.row * 12.5}% - var(--badge) * 0.38)` }}
        >
          <Badge c={classification} size="var(--badge)" title={false} />
        </div>
      )}
    </div>
  );
}
