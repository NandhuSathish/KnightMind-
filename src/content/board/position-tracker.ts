import type { IBoardAdapter, PositionSnapshot } from '../adapters/adapter.interface.js';
import { fenPositionKey, parseFEN, serializeFEN } from '../../shared/chess/fen.js';
import type { Square } from '../../shared/chess/types.js';

export type PositionChangeCallback = (snapshot: PositionSnapshot) => void;

/**
 * Wraps an IBoardAdapter to:
 *  1. Deduplicate snapshots — only emit when fenPositionKey changes.
 *  2. Infer en passant for partial-confidence snapshots by comparing
 *     the previous position to the current one (double pawn advance detection).
 */
export class PositionTracker {
  private _lastPositionKey: string | null = null;
  private _lastSnapshot: PositionSnapshot | null = null;
  private _unsubscribe: (() => void) | null = null;

  constructor(
    private readonly _adapter: IBoardAdapter,
    private readonly _onChange: PositionChangeCallback
  ) {}

  start(): void {
    this._unsubscribe = this._adapter.onPositionChange(snapshot => {
      const enriched = this._enrich(snapshot);
      const key = fenPositionKey(enriched.fen);
      if (key === this._lastPositionKey) return;
      this._lastPositionKey = key;
      this._lastSnapshot = enriched;
      this._onChange(enriched);
    });
  }

  stop(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  /** Force-emit the current board position, e.g. on page load. */
  emitCurrent(): void {
    const snapshot = this._adapter.getCurrentPosition();
    if (!snapshot) return;
    const enriched = this._enrich(snapshot);
    const key = fenPositionKey(enriched.fen);
    if (key === this._lastPositionKey) return;
    this._lastPositionKey = key;
    this._lastSnapshot = enriched;
    this._onChange(enriched);
  }

  // ─── Enrichment ────────────────────────────────────────────────────────────

  private _enrich(snapshot: PositionSnapshot): PositionSnapshot {
    // Full-confidence snapshots already have accurate en passant from the JS API.
    if (snapshot.confidence === 'full') return snapshot;
    if (!this._lastSnapshot) return snapshot;

    const ep = this._inferEnPassant(this._lastSnapshot.fen, snapshot.fen);
    if (ep === '-') return snapshot;

    const components = parseFEN(snapshot.fen);
    if (!components) return snapshot;

    return {
      ...snapshot,
      fen: serializeFEN({ ...components, enPassant: ep }),
    };
  }

  // ─── En passant inference ──────────────────────────────────────────────────

  /**
   * Compares previous and current FEN piece placements to detect a double pawn
   * advance. Returns the en passant target square, or '-' if none detected.
   *
   * curr.activeColor is the side to move NEXT → the side that just moved is
   * the other color:
   *   - curr is white to move: black just moved → look for b-pawn 7→5
   *   - curr is black to move: white just moved → look for W-pawn 2→4
   */
  private _inferEnPassant(prevFen: string, currFen: string): Square | '-' {
    const prev = parseFEN(prevFen);
    const curr = parseFEN(currFen);
    if (!prev || !curr) return '-';

    const prevSq = this._fenToSquareChars(prev.pieces);
    const currSq = this._fenToSquareChars(curr.pieces);

    if (curr.activeColor === 'white') {
      // Black just moved — look for black pawn double advance (rank 7 → rank 5)
      for (const f of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
        if (
          prevSq.get(`${f}7`) === 'p' &&  // black pawn was on rank 7
          currSq.get(`${f}5`) === 'p' &&  // black pawn is now on rank 5
          !currSq.has(`${f}7`)            // and is no longer on rank 7
        ) {
          return `${f}6` as Square;
        }
      }
    } else {
      // White just moved — look for white pawn double advance (rank 2 → rank 4)
      for (const f of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
        if (
          prevSq.get(`${f}2`) === 'P' &&
          currSq.get(`${f}4`) === 'P' &&
          !currSq.has(`${f}2`)
        ) {
          return `${f}3` as Square;
        }
      }
    }

    return '-';
  }

  /**
   * Parses a FEN piece-placement field into a Map<square, fenChar>.
   * FEN char is uppercase for white ('P') and lowercase for black ('p').
   * FEN encodes rank 8 first (index 0), rank 1 last (index 7).
   */
  private _fenToSquareChars(placement: string): Map<string, string> {
    const map = new Map<string, string>();
    const ranks = placement.split('/');
    for (let ri = 0; ri < ranks.length; ri++) {
      const rankStr = ranks[ri];
      if (!rankStr) continue;
      const rankNum = 8 - ri; // rank 8 = ri 0, rank 1 = ri 7
      let fileIdx = 0;
      for (const ch of rankStr) {
        if (ch >= '1' && ch <= '8') {
          fileIdx += parseInt(ch, 10);
        } else {
          const f = 'abcdefgh'[fileIdx];
          if (f) map.set(`${f}${rankNum}`, ch);
          fileIdx++;
        }
      }
    }
    return map;
  }
}
