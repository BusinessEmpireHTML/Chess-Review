import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { cacheKey, getCached, putCached } from '../src/lib/cache';
import type { PositionEval } from '../src/lib/types';

describe('IndexedDB analysis cache', () => {
  const positions: PositionEval[] = [
    { depth: 16, lines: [{ move: 'e2e4', score: { type: 'cp', value: 30 }, pv: Array(30).fill('e2e4'), depth: 16 }] },
    { depth: 0, lines: [], terminal: 'checkmate' },
  ];

  it('keys by game, engine, and depth', () => {
    expect(cacheKey('https://www.chess.com/game/live/1', 'lite', 16)).toBe('https://www.chess.com/game/live/1|lite|d16');
  });

  it('round-trips an analysis and trims long PVs', async () => {
    const key = cacheKey('g1', 'lite', 16);
    await putCached(key, positions);
    const back = await getCached(key);
    expect(back).toHaveLength(2);
    expect(back![0].lines[0].score).toEqual({ type: 'cp', value: 30 });
    expect(back![0].lines[0].pv.length).toBe(12);
    expect(back![1].terminal).toBe('checkmate');
  });

  it('misses for a different depth', async () => {
    expect(await getCached(cacheKey('g1', 'lite', 20))).toBeNull();
  });
});
