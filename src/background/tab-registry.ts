import type { ChessSite } from '../shared/chess/types.js';

export interface TabState {
  tabId: number;
  site: ChessSite;
  lastFEN: string | null;
  engineReady: boolean;
  /** Timestamp of last position change — used to expire stale tabs */
  lastActivityAt: number;
}

/**
 * In-memory registry of active chess tabs.
 *
 * Because the Service Worker is ephemeral, this state is rebuilt from
 * incoming messages whenever the SW wakes up. It is NOT persisted to storage.
 */
export class TabRegistry {
  private readonly _tabs = new Map<number, TabState>();

  upsert(tabId: number, site: ChessSite): TabState {
    const existing = this._tabs.get(tabId);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return existing;
    }
    const state: TabState = {
      tabId,
      site,
      lastFEN: null,
      engineReady: false,
      lastActivityAt: Date.now(),
    };
    this._tabs.set(tabId, state);
    return state;
  }

  get(tabId: number): TabState | undefined {
    return this._tabs.get(tabId);
  }

  updateFEN(tabId: number, fen: string): void {
    const state = this._tabs.get(tabId);
    if (state) {
      state.lastFEN = fen;
      state.lastActivityAt = Date.now();
    }
  }

  setEngineReady(tabId: number, ready: boolean): void {
    const state = this._tabs.get(tabId);
    if (state) state.engineReady = ready;
  }

  remove(tabId: number): void {
    this._tabs.delete(tabId);
  }

  /** Evict tabs that have been inactive for more than ttlMs */
  evictStale(ttlMs = 30 * 60 * 1000): void {
    const cutoff = Date.now() - ttlMs;
    for (const [id, state] of this._tabs) {
      if (state.lastActivityAt < cutoff) this._tabs.delete(id);
    }
  }

  get size(): number {
    return this._tabs.size;
  }
}
