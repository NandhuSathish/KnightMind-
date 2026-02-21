import type { Color, Piece, PieceType, Square } from '../chess/types.js';
import { parseFEN } from '../chess/fen.js';
import type { BoardState } from './types.js';

// ─── Coordinate helpers ───────────────────────────────────────────────────────

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

/** Convert a Square to [file 0–7, rank 0–7] indices. */
export function squareToCoords(sq: Square): [number, number] {
  return [sq.charCodeAt(0) - 97, parseInt(sq[1]!, 10) - 1];
}

/** Convert [file 0–7, rank 0–7] back to a Square, or null if out of bounds. */
export function coordsToSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  const f = FILES[file];
  const r = RANKS[rank];
  if (!f || !r) return null;
  return `${f}${r}` as Square;
}

// ─── FEN → BoardState ─────────────────────────────────────────────────────────

/**
 * Parses a full 6-field FEN into a BoardState.
 * Returns null if the FEN is malformed.
 */
export function fenToBoardState(fen: string): BoardState | null {
  const components = parseFEN(fen);
  if (!components) return null;

  const board = new Map<Square, Piece>();
  const ranks = components.pieces.split('/');

  // FEN encodes rank 8 first (ri=0), rank 1 last (ri=7)
  for (let ri = 0; ri < 8; ri++) {
    const rankStr = ranks[ri];
    if (!rankStr) return null;
    let fileIdx = 0;
    for (const ch of rankStr) {
      if (ch >= '1' && ch <= '8') {
        fileIdx += parseInt(ch, 10);
      } else {
        const sq = coordsToSquare(fileIdx, 7 - ri);
        if (!sq) return null;
        const lower = ch.toLowerCase() as PieceType;
        const color: Color = ch === ch.toUpperCase() ? 'white' : 'black';
        board.set(sq, { type: lower, color });
        fileIdx++;
      }
    }
  }

  return {
    board,
    sideToMove: components.activeColor,
    enPassant: components.enPassant === '-' ? null : components.enPassant,
    castling: components.castling,
  };
}

// ─── Board queries ────────────────────────────────────────────────────────────

/** Find the king square for the given color. Returns null if not found. */
export function findKing(
  board: ReadonlyMap<Square, Piece>,
  color: Color
): Square | null {
  for (const [sq, piece] of board) {
    if (piece.type === 'k' && piece.color === color) return sq;
  }
  return null;
}

// ─── Development tracking ─────────────────────────────────────────────────────

/**
 * Starting squares for minor pieces (knights + bishops).
 * A piece on its starting square is considered undeveloped.
 */
export const STARTING_SQUARES: Record<Color, Partial<Record<string, readonly Square[]>>> = {
  white: { n: ['b1', 'g1'], b: ['c1', 'f1'] },
  black: { n: ['b8', 'g8'], b: ['c8', 'f8'] },
};
