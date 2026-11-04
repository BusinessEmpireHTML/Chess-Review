import type { EngineLine, Score } from '../lib/types';

export interface InfoLine {
  depth: number;
  multipv: number;
  score: Score;
  /** Set when the score is only a bound (aspiration window fail-high/low); such lines are not final. */
  bound?: 'upper' | 'lower';
  pv: string[];
  nodes?: number;
  nps?: number;
  time?: number;
}

/** Parse a UCI `info` line that carries a score. Returns null for other lines (currmove, string, ...). */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null;
  const t = line.split(/\s+/);
  let depth: number | undefined;
  let multipv = 1;
  let score: Score | undefined;
  let bound: InfoLine['bound'];
  let pv: string[] = [];
  let nodes: number | undefined;
  let nps: number | undefined;
  let time: number | undefined;

  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'multipv':
        multipv = Number(t[++i]);
        break;
      case 'nodes':
        nodes = Number(t[++i]);
        break;
      case 'nps':
        nps = Number(t[++i]);
        break;
      case 'time':
        time = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const value = Number(t[++i]);
        if (kind === 'cp' || kind === 'mate') score = { type: kind, value };
        if (t[i + 1] === 'upperbound' || t[i + 1] === 'lowerbound') bound = t[++i] === 'upperbound' ? 'upper' : 'lower';
        break;
      }
      case 'pv':
        pv = t.slice(i + 1);
        i = t.length;
        break;
      case 'string':
        return null;
    }
  }
  if (depth === undefined || !score) return null;
  return { depth, multipv, score, bound, pv, nodes, nps, time };
}

export function parseBestMove(line: string): string | null | undefined {
  if (!line.startsWith('bestmove')) return undefined;
  const m = line.split(/\s+/)[1];
  return !m || m === '(none)' ? null : m;
}

/**
 * Accumulates info lines during one search and yields the final MultiPV lines
 * (deepest exact score per multipv index, best first).
 */
export class LineCollector {
  private byPv = new Map<number, InfoLine>();
  /** Deepest completed depth seen for multipv 1. */
  depth = 0;

  push(info: InfoLine): void {
    if (info.bound || info.pv.length === 0) return;
    const prev = this.byPv.get(info.multipv);
    if (!prev || info.depth >= prev.depth) this.byPv.set(info.multipv, info);
    if (info.multipv === 1) this.depth = Math.max(this.depth, info.depth);
  }

  lines(): EngineLine[] {
    return [...this.byPv.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, l]) => ({ move: l.pv[0], score: l.score, pv: l.pv, depth: l.depth }));
  }
}
