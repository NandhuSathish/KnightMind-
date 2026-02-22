import type { IBoardAdapter } from '../adapters/adapter.interface.js';
import type { PositionSnapshot } from '../../shared/chess/types.js';
import { PositionTracker } from './position-tracker.js';

export type Unsubscribe = () => void;
export type PositionCallback = (snapshot: PositionSnapshot) => void;

export interface PositionWatcherOptions {
  /**
   * Trailing-edge debounce (ms) applied before emitting to subscribers.
   * Suppresses intermediate positions during rapid analysis navigation.
   * Default: 0 (emit immediately on each unique position).
   */
  throttleMs?: number;
  /**
   * Interval (ms) between DOM recovery checks.
   * Detects board element replacement caused by SPA navigation.
   * Default: 2000. Set to 0 to disable.
   */
  recoveryIntervalMs?: number;
}

/**
 * Multi-subscriber observable stream of chess positions.
 *
 * Wraps PositionTracker to add:
 *  1. Fan-out to N subscribers (vs PositionTracker's single callback).
 *  2. Optional trailing-edge debounce to suppress rapid analysis navigation.
 *  3. DOM recovery: detects board element replacement (SPA navigation) and
 *     re-attaches the adapter automatically.
 *
 * Usage:
 *   const watcher = new PositionWatcher(adapter, { throttleMs: 300 });
 *   const unsub = watcher.subscribe(snapshot => { ... });
 *   watcher.start(document);
 *   // later:
 *   watcher.stop(); // clears all subscribers
 */
export class PositionWatcher {
  private readonly _subscribers = new Set<PositionCallback>();
  private readonly _tracker: PositionTracker;
  private _throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private _recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private _pendingSnapshot: PositionSnapshot | null = null;
  private _document: Document | null = null;
  private _lastBoardEl: Element | null = null;

  private readonly _throttleMs: number;
  private readonly _recoveryIntervalMs: number;

  private static readonly DEFAULT_RECOVERY_INTERVAL_MS = 2000;

  constructor(
    private readonly _adapter: IBoardAdapter,
    options: PositionWatcherOptions = {}
  ) {
    this._throttleMs = options.throttleMs ?? 0;
    this._recoveryIntervalMs =
      options.recoveryIntervalMs ?? PositionWatcher.DEFAULT_RECOVERY_INTERVAL_MS;

    this._tracker = new PositionTracker(_adapter, snapshot => {
      this._handleSnapshot(snapshot);
    });
  }

  /** Register a position-change listener. Returns an idempotent unsubscribe fn. */
  subscribe(callback: PositionCallback): Unsubscribe {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  start(document: Document): void {
    this._document = document;
    this._lastBoardEl = this._findBoardEl(document);

    this._tracker.start();
    this._tracker.emitCurrent();

    if (this._recoveryIntervalMs > 0) {
      this._recoveryTimer = setInterval(
        () => this._tryRecover(),
        this._recoveryIntervalMs
      );
    }
  }

  stop(): void {
    this._tracker.stop();

    if (this._throttleTimer !== null) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
    if (this._recoveryTimer !== null) {
      clearInterval(this._recoveryTimer);
      this._recoveryTimer = null;
    }

    this._pendingSnapshot = null;
    this._document = null;
    this._lastBoardEl = null;
    this._subscribers.clear(); // release all callback closure references
  }

  // ─── Throttle ──────────────────────────────────────────────────────────────

  private _handleSnapshot(snapshot: PositionSnapshot): void {
    if (this._throttleMs <= 0) {
      this._emit(snapshot);
      return;
    }
    // Trailing-edge debounce: suppress rapid-fire positions, emit the latest
    this._pendingSnapshot = snapshot;
    if (this._throttleTimer !== null) clearTimeout(this._throttleTimer);
    this._throttleTimer = setTimeout(() => {
      this._throttleTimer = null;
      const pending = this._pendingSnapshot;
      this._pendingSnapshot = null;
      if (pending) this._emit(pending);
    }, this._throttleMs);
  }

  private _emit(snapshot: PositionSnapshot): void {
    for (const cb of this._subscribers) cb(snapshot);
  }

  // ─── DOM Recovery ──────────────────────────────────────────────────────────

  /**
   * Runs on every recovery interval tick.
   *
   * - Board absent: clear reference, wait for re-mount.
   * - Board replaced (new element): re-attach adapter so MutationObserver tracks
   *   the new element. Guard: only re-attach if a board was present before.
   * - emitCurrent() is always called; it's idempotent (FEN-key dedup).
   */
  private _tryRecover(): void {
    const doc = this._document;
    if (!doc) return;

    const board = this._findBoardEl(doc);

    if (board === null) {
      this._lastBoardEl = null; // Board gone mid-navigation
      return;
    }

    if (board !== this._lastBoardEl) {
      const isReattach = this._lastBoardEl !== null;
      this._lastBoardEl = board;

      if (isReattach) {
        // Adapter's MutationObserver points to the old (detached) element — re-attach
        this._adapter.detach();
        this._adapter.attach(doc);
        this._tracker.stop();
        this._tracker.start();
      }
    }

    // Idempotent: only emits if FEN key changed since last emission
    this._tracker.emitCurrent();
  }

  private _findBoardEl(doc: Document): Element | null {
    return doc.querySelector('cg-board') ?? doc.querySelector('wc-chess-board');
  }
}
