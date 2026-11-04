import type { Classification } from '../lib/types';

/**
 * Classification colors, validated against the dark surface (#14171c) with
 * the dataviz palette checker: chroma >= 0.10, adjacent-pair CVD dE >= 8,
 * normal-vision dE >= 15, contrast >= 3:1. Lightness deliberately runs above
 * the chart band so each class reads as its conventional hue (yellow
 * inaccuracy, red blunder); identity never relies on color alone because every
 * badge also carries a glyph.
 */
export const CLASS_COLORS: Record<Classification, string> = {
  brilliant: '#1fc6b3',
  great: '#6e9dff',
  best: '#45b54d',
  excellent: '#b8d84e',
  good: '#46b39b',
  book: '#c48b52',
  inaccuracy: '#f6cb45',
  mistake: '#f2852b',
  miss: '#df7ad8',
  blunder: '#e8453c',
};

/** Moves worth calling out on the graph and in summaries. */
export const NOTABLE: ReadonlySet<Classification> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

export function applyThemeVars(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(CLASS_COLORS)) root.style.setProperty(`--c-${k}`, v);
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
