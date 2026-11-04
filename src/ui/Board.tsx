import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawBrush, DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Classification } from '../lib/types';
import { Badge } from './Badge';
import { CLASS_COLORS, withAlpha } from './theme';

export interface Arrow {
  from: string;
  to: string;
  classification: Classification;
}

export interface Movable {
  /** Which side may move now; undefined disables moving. */
  color: 'white' | 'black' | undefined;
  /** Legal destinations per origin square. */
  dests: Map<string, string[]>;
  /** Tells whether from -> to is a promotion (so the board asks which piece). */
  isPromotion: (from: string, to: string) => boolean;
  onMove: (uci: string) => void;
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
  plyKey: number | string;
  movable?: Movable;
}

const brushes: Record<string, DrawBrush> = {
  green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
};
for (const [c, color] of Object.entries(CLASS_COLORS)) brushes[c] = { key: `c-${c}`, color, opacity: 0.9, lineWidth: 11 };

const PROMOTION_PIECES = [
  ['q', 'queen'],
  ['n', 'knight'],
  ['r', 'rook'],
  ['b', 'bishop'],
] as const;

function squarePosition(square: string, orientation: 'white' | 'black') {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { col, row };
}

export function Board({ fen, orientation, lastMove, classification, arrows, inCheck = false, plyKey, movable }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const movableRef = useRef(movable);
  movableRef.current = movable;
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: 'white' | 'black' } | null>(null);
  const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen,
      orientation,
      coordinates: true,
      disableContextMenu: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const m = movableRef.current;
            if (!m) return;
            if (m.isPromotion(orig, dest)) setPromotion({ from: orig, to: dest, color: m.color ?? 'white' });
            else m.onMove(orig + dest);
          },
        },
      },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      drawable: { enabled: false, visible: true, brushes: brushes as never },
    });
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const destsKey = movable ? `${movable.color}|${[...movable.dests].map(([k, v]) => k + v.join('')).join()}` : '';
  const promotionOpen = useRef(false);
  promotionOpen.current = promotion !== null;

  // A pending promotion is abandoned only when the position itself changes.
  useEffect(() => setPromotion(null), [fen, orientation]);

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    if (promotionOpen.current) {
      // Keep the pawn where the user dropped it while they pick a piece.
      cg.setAutoShapes(arrows.map((a): DrawShape => ({ orig: a.from as Key, dest: a.to as Key, brush: a.classification })));
      return;
    }
    cg.set({
      fen,
      orientation,
      turnColor: turn,
      check: inCheck,
      lastMove: lastMove as Key[] | undefined,
      movable: { color: movable?.color, dests: (movable?.dests ?? new Map()) as Map<Key, Key[]> },
    });
    cg.setAutoShapes(arrows.map((a): DrawShape => ({ orig: a.from as Key, dest: a.to as Key, brush: a.classification })));
  }, [fen, orientation, inCheck, lastMove?.[0], lastMove?.[1], arrows.map((a) => a.from + a.to + a.classification).join(), destsKey]);

  const choosePromotion = (piece: string | null) => {
    const p = promotion;
    setPromotion(null);
    if (!p) return;
    if (piece) movableRef.current?.onMove(p.from + p.to + piece);
    else api.current?.set({ fen, lastMove: lastMove as Key[] | undefined }); // cancelled: put the pawn back
  };

  const badgeSquare = lastMove?.[1];
  const pos = badgeSquare ? squarePosition(badgeSquare, orientation) : null;
  const tint = classification ? withAlpha(CLASS_COLORS[classification], 0.42) : 'rgba(255, 214, 102, 0.35)';

  return (
    <div class={`board ${movable?.color ? 'board-movable' : ''}`} style={{ '--lastmove': tint } as Record<string, string>}>
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
      {promotion && (
        <div class="promo-backdrop" onClick={() => choosePromotion(null)}>
          <div class="promo cg-wrap" role="dialog" aria-label="Promote to" onClick={(e) => e.stopPropagation()}>
            {PROMOTION_PIECES.map(([letter, role]) => (
              <button key={letter} type="button" class="promo-btn" onClick={() => choosePromotion(letter)} aria-label={`Promote to ${role}`}>
                {/* chessground's <piece> element, so its piece-set CSS draws the icon */}
                {h('piece', { class: `${role} ${promotion.color}` })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
