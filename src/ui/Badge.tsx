import { LABELS } from '../lib/explain';
import type { Classification } from '../lib/types';

const TEXT_GLYPH: Partial<Record<Classification, string>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

function IconGlyph({ c }: { c: Classification }) {
  switch (c) {
    case 'best':
      return <path d="M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.6l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z" fill="currentColor" />;
    case 'excellent':
      return (
        <path
          d="M7 10.2v9.3H4.4a.9.9 0 0 1-.9-.9v-7.5c0-.5.4-.9.9-.9H7zm2 9.3V10l3.6-5.6c.4-.6 1.3-.7 1.8-.2.4.3.5.9.4 1.4l-.8 3.6h4.6c1.2 0 2.1 1.1 1.8 2.3l-1.5 6.4c-.3 1-1.1 1.6-2.1 1.6H9z"
          fill="currentColor"
        />
      );
    case 'good':
      return <path d="M5.5 12.5l4.2 4.2 8.8-9.2" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />;
    case 'book':
      return (
        <path
          d="M3.5 6.2c0-.7.5-1.2 1.2-1.2h4.1c1.3 0 2.4.6 3.2 1.5v12.7c-.8-.8-1.9-1.2-3-1.2H4.7c-.7 0-1.2-.5-1.2-1.2zm17 0c0-.7-.5-1.2-1.2-1.2h-4.1c-1.3 0-2.4.6-3.2 1.5v12.7c.8-.8 1.9-1.2 3-1.2h4.3c.7 0 1.2-.5 1.2-1.2z"
          fill="currentColor"
        />
      );
    case 'miss':
      return <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" />;
    default:
      return null;
  }
}

/** Round classification badge: a colored disc with a glyph, so identity never depends on color alone. */
export function Badge({ c, size = 18, title = true }: { c: Classification; size?: number | string; title?: boolean }) {
  const text = TEXT_GLYPH[c];
  const len = typeof size === 'number' ? `${size}px` : size;
  const factor = text && text.length > 1 ? 0.5 : 0.62;
  return (
    <span
      class={`badge badge-${c}`}
      style={{ width: len, height: len, fontSize: `calc(${len} * ${factor})` }}
      title={title ? LABELS[c] : undefined}
      role="img"
      aria-label={LABELS[c]}
    >
      {text ?? (
        <svg viewBox="0 0 24 24" width="72%" height="72%" aria-hidden="true">
          <IconGlyph c={c} />
        </svg>
      )}
    </span>
  );
}
