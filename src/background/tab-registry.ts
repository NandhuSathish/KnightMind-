import type { ChessSite, Color } from '../shared/chess/types.js';
import type { RawScore } from '../shared/engine/types.js';

/** Eval snapshot stored per-tab for blunder detection. */
export interface StoredEval {
  score:      RawScore;
  sideToMove: Color;
}

export interface TabState {
  tabId: number;
  site: ChessSite;
  lastFEN: string | null;
  engineReady: boolean;
  /** Timestamp of last position change — used to expire stale tabs */
  lastActivityAt: number;
  /**
   * Whether the last analyzed position for this tab was in the repertoire.
   * Used to detect re-entry into book after going out of book (transposition).
   * Reset to false when a new game starts (upsert with a fresh state).
   */
  lastInBook: boolean;
  /**
   * Engine evaluation from the most recently completed analysis.
   * Updated after each ANALYSIS_RESULT for this tab.
   */
  lastEval: StoredEval | null;
  /**
   * Evaluation from the position BEFORE the current one.
   * Copied from lastEval when a new POSITION_CHANGED arrives.
   * Used as the baseline for opponent blunder detection.
   */
  prevEval: StoredEval | null;
  /**
   * Board orientation detected from the content script (POSITION_CHANGED.orientation).
   * 'white' = user is seated as white; 'black' = user is seated as black.
   * Updated on every position change. Null until the first position arrives.
   */
  detectedSide: Color | null;
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
      lastInBook: false,
      lastEval:  null,
      prevEval:  null,
      detectedSide: null,
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

  /** Update whether the last known position for this tab was in the repertoire. */
  updateBookStatus(tabId: number, inBook: boolean): void {
    const state = this._tabs.get(tabId);
    if (state) state.lastInBook = inBook;
  }

  /** Store the board orientation reported by the content script for this tab. */
  updateDetectedSide(tabId: number, side: Color): void {
    const state = this._tabs.get(tabId);
    if (state) state.detectedSide = side;
  }

  /**
   * Roll the eval forward: saves current lastEval as prevEval, then stores the new eval.
   * Call this after each analysis result is received for the tab.
   */
  advanceEval(tabId: number, score: RawScore, sideToMove: Color): void {
    const state = this._tabs.get(tabId);
    if (!state) return;
    state.prevEval  = state.lastEval;
    state.lastEval  = { score, sideToMove };
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
