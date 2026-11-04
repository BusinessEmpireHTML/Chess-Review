import type { WhiteView } from '../lib/winprob';

/** Vertical evaluation bar. White's share grows from White's side of the board. */
export function EvalBar({ view, orientation }: { view: WhiteView | null; orientation: 'white' | 'black' }) {
  const white = view ? view.win : 50;
  const whiteAhead = white >= 50;
  // Keep a sliver of each color visible unless the game is decided.
  const shown = view && (view.label === '1-0' || view.label === '0-1') ? white : Math.min(97, Math.max(3, white));
  const whiteAtBottom = orientation === 'white';
  return (
    <div class={`evalbar ${view ? '' : 'evalbar-pending'}`} role="meter" aria-label="Evaluation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(white)} aria-valuetext={view?.label ?? 'pending'}>
      <div class="evalbar-fill" style={{ height: `${shown}%`, [whiteAtBottom ? 'bottom' : 'top']: 0 }} />
      {view && (
        <span class={`evalbar-label ${whiteAhead ? 'on-white' : 'on-black'}`} style={{ [whiteAhead === whiteAtBottom ? 'bottom' : 'top']: '6px' }}>
          {view.label.replace(/^\+/, '')}
        </span>
      )}
    </div>
  );
}
