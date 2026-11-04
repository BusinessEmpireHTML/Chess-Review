import type { PositionEval } from './types';

/**
 * IndexedDB cache of raw engine output, keyed by game + engine + depth.
 * Classifications are recomputed from this on load, so tuning thresholds
 * never needs a re-analysis. Every call degrades to a no-op if IndexedDB is
 * unavailable (private windows, file://, blocked storage).
 */

const DB_NAME = 'chess-review';
const STORE = 'analyses';
const SCHEMA = 1;
const MAX_ENTRIES = 300;
const MAX_PV = 12;

interface Entry {
  key: string;
  schema: number;
  savedAt: number;
  positions: PositionEval[];
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export function cacheKey(gameId: string, engineId: string, depth: number): string {
  return `${gameId}|${engineId}|d${depth}`;
}

export async function getCached(key: string): Promise<PositionEval[] | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const e = req.result as Entry | undefined;
        resolve(e && e.schema === SCHEMA && Array.isArray(e.positions) ? e.positions : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putCached(key: string, positions: PositionEval[]): Promise<void> {
  const db = await open();
  if (!db) return;
  const trimmed = positions.map((p) => ({ ...p, lines: p.lines.map((l) => ({ ...l, pv: l.pv.slice(0, MAX_PV) })) }));
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put({ key, schema: SCHEMA, savedAt: Date.now(), positions: trimmed } satisfies Entry);
      // Drop the oldest entries beyond the cap.
      const countReq = store.count();
      countReq.onsuccess = () => {
        let excess = countReq.result - MAX_ENTRIES;
        if (excess <= 0) return;
        store.index('savedAt').openCursor().onsuccess = (ev) => {
          const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor || excess-- <= 0) return;
          cursor.delete();
          cursor.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** For tests: forget the open connection. */
export function _resetCacheConnection(): void {
  dbPromise = null;
}
