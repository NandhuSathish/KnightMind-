import type { Color, Piece, Square } from '../chess/types.js';
import { squareToCoords, coordsToSquare } from './board.js';

// ─── Delta tables ─────────────────────────────────────────────────────────────

const KING_DELTAS   = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] as const;
const KNIGHT_DELTAS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as const;
const ROOK_RAYS     = [[1,0],[-1,0],[0,1],[0,-1]] as const;
const BISHOP_RAYS   = [[1,1],[1,-1],[-1,1],[-1,-1]] as const;
const QUEEN_RAYS    = [...ROOK_RAYS, ...BISHOP_RAYS] as const;

type Delta = readonly [number, number];

// ─── Per-piece attack generators ─────────────────────────────────────────────

function kingAttacks(from: Square): Square[] {
  const [f, r] = squareToCoords(from);
  return KING_DELTAS.flatMap(([df, dr]) => {
    const sq = coordsToSquare(f + df, r + dr);
    return sq ? [sq] : [];
  });
}

function knightAttacks(from: Square): Square[] {
  const [f, r] = squareToCoords(from);
  return KNIGHT_DELTAS.flatMap(([df, dr]) => {
    const sq = coordsToSquare(f + df, r + dr);
    return sq ? [sq] : [];
  });
}

function pawnAttacks(from: Square, color: Color): Square[] {
  const [f, r] = squareToCoords(from);
  const dir = color === 'white' ? 1 : -1;
  return ([-1, 1] as const).flatMap(df => {
    const sq = coordsToSquare(f + df, r + dir);
    return sq ? [sq] : [];
  });
}

/**
 * Sliding piece attacks along a set of rays.
 * Each ray continues until the board edge or a blocking piece.
 * The blocking piece's square IS included (it may be capturable).
 */
function sliderAttacks(
  from: Square,
  rays: readonly Delta[],
  board: ReadonlyMap<Square, Piece>
): Square[] {
  const [f, r] = squareToCoords(from);
  const result: Square[] = [];
  for (const [df, dr] of rays) {
    let cf = f + df;
    let cr = r + dr;
    while (cf >= 0 && cf <= 7 && cr >= 0 && cr <= 7) {
      // bounds already verified above, so non-null assertion is safe
      const sq = coordsToSquare(cf, cr)!;
      result.push(sq);
      if (board.has(sq)) break; // piece blocks ray
      cf += df;
      cr += dr;
    }
  }
  return result;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Returns all squares attacked by the piece on `from`, given the current board.
 * Does not filter by color — callers filter for targets of interest.
 */
export function pieceAttacks(
  from: Square,
  piece: Piece,
  board: ReadonlyMap<Square, Piece>
): Square[] {
  switch (piece.type) {
    case 'p': return pawnAttacks(from, piece.color);
    case 'n': return knightAttacks(from);
    case 'b': return sliderAttacks(from, BISHOP_RAYS, board);
    case 'r': return sliderAttacks(from, ROOK_RAYS, board);
    case 'q': return sliderAttacks(from, QUEEN_RAYS, board);
    case 'k': return kingAttacks(from);
  }
}

/**
 * Returns all squares from which `byColor` pieces attack `target`.
 * Used for: is this square defended? is this piece hanging?
 */
export function getAttackers(
  board: ReadonlyMap<Square, Piece>,
  target: Square,
  byColor: Color
): Square[] {
  const result: Square[] = [];
  for (const [sq, piece] of board) {
    if (piece.color !== byColor) continue;
    if (pieceAttacks(sq, piece, board).includes(target)) result.push(sq);
  }
  return result;
}

/**
 * Returns true if `target` is attacked by any piece of `byColor`.
 * Exits early — more efficient than `getAttackers().length > 0`.
 */
export function isAttackedBy(
  board: ReadonlyMap<Square, Piece>,
  target: Square,
  byColor: Color
): boolean {
  for (const [sq, piece] of board) {
    if (piece.color !== byColor) continue;
    if (pieceAttacks(sq, piece, board).includes(target)) return true;
  }
  return false;
}
