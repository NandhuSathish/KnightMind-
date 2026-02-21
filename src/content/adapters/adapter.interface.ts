import type { ChessSite, PositionSnapshot } from '../../shared/chess/types.js';

export type { PositionSnapshot };

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * - BOARD_NOT_FOUND:     No board element present (wrong page, not yet rendered).
 * - VARIANT_UNSUPPORTED: Variant that cannot produce a valid standard FEN
 *                        (e.g. Crazyhouse with pieces-in-hand).
 * - PIECE_DECODE_FAILED: DOM data is internally inconsistent.
 */
export type AdapterErrorCode =
  | 'BOARD_NOT_FOUND'
  | 'VARIANT_UNSUPPORTED'
  | 'PIECE_DECODE_FAILED';

export class AdapterError extends Error {
  override readonly name = 'AdapterError' as const;

  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

// ─── Adapter contract ─────────────────────────────────────────────────────────

/**
 * Contract for site-specific board reading.
 *
 * Adapters are pure DOM observers — they must not send messages or interact
 * with the engine. They emit position snapshots via a callback.
 *
 * Lifecycle:  attach → [onPositionChange callbacks...] → detach
 *
 * ## Implementing a new site adapter
 *
 * 1. Create `src/content/adapters/[hostname].adapter.ts` implementing this interface.
 * 2. Register in `registry.ts`: `['hostname.com', () => new MyAdapter()]`
 * 3. Add host to `manifest.json` host_permissions and content_scripts.matches.
 * 4. Add site key to `ChessSite` union in `src/shared/chess/types.ts`.
 * 5. Add default config to `DEFAULT_STORAGE.siteConfig` in `src/shared/storage/schema.ts`.
 *
 * ## Extraction strategy (two layers)
 *
 * Layer 1 — JS state injection (confidence: 'full'):
 *   Read full 6-field FEN from the site's own JavaScript API.
 *   Active color, castling rights, and en passant are authoritative.
 *
 * Layer 2 — DOM reconstruction (confidence: 'partial'):
 *   Parse piece elements from the DOM, infer active color from move-list
 *   parity or API turn indicator, estimate castling rights from king/rook
 *   home squares, default en passant to '-'
 *   (PositionTracker may upgrade en passant via cross-snapshot inference).
 *
 * ## MutationObserver discipline
 *
 * - Observe the minimal subtree: piece container only, not whole document.
 * - Use attributeFilter to avoid firing on irrelevant attribute changes.
 * - Debounce 150ms before calling getCurrentPosition().
 * - Observe orientation element separately with { attributes: true,
 *   attributeFilter: ['class'] }.
 */
export interface IBoardAdapter {
  readonly site: ChessSite;

  /**
   * Mount the adapter. Called once after the adapter is resolved.
   * Set up MutationObservers and event listeners here.
   */
  attach(document: Document): void;

  /**
   * Synchronously return the current position snapshot.
   * Returns null if the board is not ready or the position cannot be read.
   * Throws AdapterError for unrecoverable structural failures
   * (VARIANT_UNSUPPORTED, PIECE_DECODE_FAILED).
   */
  getCurrentPosition(): PositionSnapshot | null;

  /**
   * Subscribe to position changes. Callback fires after internal 150ms
   * debouncing — not on every DOM mutation.
   * Returns an unsubscribe function (idempotent).
   */
  onPositionChange(callback: (snapshot: PositionSnapshot) => void): () => void;

  /**
   * Tear down all observers and listeners.
   * Idempotent — safe to call multiple times.
   */
  detach(): void;
}
