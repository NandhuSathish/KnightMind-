import type { Color } from '../chess/types.js';
import type { RepertoireEntry, RepertoireIndex, RepertoireMetadata } from './types.js';

// ─── IndexedDB constants ───────────────────────────────────────────────────────

const DB_NAME    = 'knightmind';
const STORE_NAME = 'repertoire';
// Version 2: no schema change (same object store), but signals the dual-key upgrade path.
const DB_VERSION = 2;

// ─── Key scheme ────────────────────────────────────────────────────────────────
//
// Each color's repertoire is stored under its own key:
//   'data-white'  →  white repertoire
//   'data-black'  →  black repertoire
//
// This lets us load, save, and clear each color independently without touching
// the other, and keeps IndexedDB reads small (fetch only what you need).

function dataKey(color: Color): string {
  return `data-${color}`;
}

// ─── DB open ───────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      // No structural changes needed — the object store is a plain key-value map.
      // Old 'data' key (from v1) is simply orphaned; clearRepertoire(color) won't
      // touch it, but that's harmless since we look up 'data-white' / 'data-black'.
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

// ─── Low-level helpers ─────────────────────────────────────────────────────────

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ─── Serialisation helpers ─────────────────────────────────────────────────────
//
// IndexedDB stores plain objects; Map<string, RepertoireEntry> must be converted
// to/from Record<string, RepertoireEntry> because Maps are not structurally
// cloneable in the way IDB needs them.

interface SerializedData {
  index: Record<string, RepertoireEntry>;
  meta:  RepertoireMetadata;
}

function serializeIndex(index: RepertoireIndex): Record<string, RepertoireEntry> {
  return Object.fromEntries(index);
}

function deserializeIndex(raw: Record<string, RepertoireEntry>): RepertoireIndex {
  return new Map(Object.entries(raw));
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a single color's repertoire to IndexedDB.
 * Called fire-and-forget from RepertoireEngine.load() — the sendResponse deadline
 * must not be blocked by this write.
 */
export async function saveRepertoire(
  index: RepertoireIndex,
  meta:  RepertoireMetadata,
  color: Color,
): Promise<void> {
  const db   = await openDB();
  const data: SerializedData = { index: serializeIndex(index), meta };
  await idbPut(db, dataKey(color), data);
}

/**
 * Load one color's repertoire from IndexedDB.
 * Returns null if nothing has been stored for that color yet.
 */
export async function loadRepertoire(color: Color): Promise<{
  index: RepertoireIndex;
  meta:  RepertoireMetadata;
} | null> {
  const db   = await openDB();
  const data = await idbGet<SerializedData>(db, dataKey(color));
  if (!data) return null;
  return { index: deserializeIndex(data.index), meta: data.meta };
}

/**
 * Delete one color's repertoire from IndexedDB.
 * The other color's entry is untouched.
 */
export async function clearRepertoire(color: Color): Promise<void> {
  const db = await openDB();
  await idbDelete(db, dataKey(color));
}
