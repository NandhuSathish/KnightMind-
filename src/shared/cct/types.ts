// ─── CCT Quality ─────────────────────────────────────────────────────────────

/**
 * Quality classification based on centipawn loss relative to the best engine move.
 *
 * Loss thresholds (cp):
 *   0 – 30   → excellent
 *  30 – 80   → good
 *  80 – 150  → playable
 * 150 – 300  → dubious
 * 300 – 600  → bad
 *      > 600 → losing
 */
export type CCTQuality =
  | 'excellent'
  | 'good'
  | 'playable'
  | 'dubious'
  | 'bad'
  | 'losing';

// ─── Move entry ───────────────────────────────────────────────────────────────

export interface CCTMove {
  /** Standard Algebraic Notation, e.g. "Rxf7+", "Nxe4", "d5" */
  moveSAN: string;
  /** UCI notation, e.g. "f1f7", "g1f3" */
  moveUCI: string;
  /**
   * Evaluation from the current side-to-move's perspective (positive = we are winning).
   * Centipawns, capped at ±10 000 for mate scores.
   * Sourced from engine PV lines when available; otherwise from a heuristic estimate.
   */
  evaluation: number;
  /** Indicates whether the eval came from engine PV data or a local heuristic. */
  evalSource: 'engine' | 'heuristic';
  /**
   * Human-readable quality label based on loss from best move.
   * Heuristic evaluations are prefixed with "~" (e.g. "~Good").
   */
  qualityLabel: string;
  /** CSS class identifier for colour coding. */
  qualityClass: CCTQuality;
  /** Set when the move delivers forced checkmate. */
  mateIn?: number;
}

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * Structured CCT (Checks → Captures → Threats) analysis of a position.
 * Each category is sorted by loss ascending (best first).
 * A move appears in exactly one category (highest priority wins: check > capture > threat).
 */
export interface CCTResult {
  checks:   CCTMove[];
  captures: CCTMove[];
  threats:  CCTMove[];
}
