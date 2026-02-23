import type { Color } from '../chess/types.js';

// ─── Repertoire data types ─────────────────────────────────────────────────────

export interface RepertoireMove {
  uci: string;                   // e.g. "e2e4"
  /** Display-friendly SAN stored from the original PGN token (e.g. "e4", "Nf3", "O-O"). */
  san?: string;
  annotation?: string;           // PGN comment attached to this move { ... }
  opponentResponse?: string;     // UCI of the expected opponent reply (for line preview)
  /** SAN of the expected opponent reply (display version, e.g. "e5"). */
  opponentResponseSan?: string;
}

/**
 * Public alias for RepertoireMove.
 * Represents a single prepared response move with its UCI string and optional annotation.
 */
export type PreparedMove = RepertoireMove;

/** All candidate moves the user wants to play from one position. */
export interface RepertoireEntry {
  moves: RepertoireMove[];
  /** Opening/variation name from PGN [Opening]/[Variation]/[Event] headers. */
  lineName?: string;
  /** ECO classification code from PGN [ECO] header (e.g. "C45"). */
  ecoCode?: string;
}

/**
 * Flat map keyed by fenPositionKey (first 4 FEN fields).
 * Handles transpositions automatically: same position → same entry.
 *
 * Why a flat Map and not a tree?
 * ────────────────────────────────
 * A tree would require traversal to find a position. A flat Map keyed by FEN
 * fingerprint gives O(1) lookup and handles transpositions for free: two
 * different move-order paths that reach the same board position share one entry.
 */
export type RepertoireIndex = Map<string, RepertoireEntry>;

export interface RepertoireMetadata {
  playerColor:   Color;
  positionCount: number;
  moveCount:     number;
  /** Date.now() at load time */
  loadedAt:      number;
  sourceFilename?: string;
}

// ─── API types ─────────────────────────────────────────────────────────────────

/**
 * Result of analyzePosition().
 *
 * source:
 *   'book'          — position in repertoire; suggestedMoves has prepared replies.
 *   'engine'        — out of book (or mode === 'engine'); show engine result instead.
 *   'none'          — no repertoire loaded for the user's color.
 *   'opponent_turn' — it's the opponent's turn; user's book IS loaded, just not applicable yet.
 */
export interface AnalyzePositionResult {
  source:         'book' | 'engine' | 'none' | 'opponent_turn';
  inBook:         boolean;
  /**
   * True when the current position IS in the repertoire but the previous
   * position was NOT — i.e. the game has transposed back into preparation.
   * Always false when source !== 'book'.
   * Set by the service worker (per-tab), not by RepertoireEngine itself.
   */
  reenteredBook:  boolean;
  /**
   * True when the opponent just played outside of known theory — the user
   * was in book on their previous turn but is now out of book after the
   * opponent's reply. Set by the service worker (per-tab).
   */
  opponentDeviated: boolean;
  suggestedMoves: PreparedMove[];
  /** Which color's repertoire was consulted (derived from the FEN active color). */
  color:          Color;
  /** PGN filename of the playerSide's loaded repertoire, if available. */
  bookName?:      string;
  /** Opening/variation name derived from PGN game headers; only set when source='book'. */
  lineName?:      string;
  /** ECO code for the current line (e.g. "C45"); only set when source='book'. */
  ecoCode?:       string;
  /** Fullmove number from the FEN (1-based, as chess players count moves). Always present. */
  bookDepth:      number;
}

export interface PGNLoadResult {
  success:  boolean;
  metadata: RepertoireMetadata | null;
  /** Non-fatal parse warnings (malformed SAN, etc.) */
  errors:   string[];
}
