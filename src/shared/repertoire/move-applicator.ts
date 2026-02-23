import type { BoardState } from '../coaching/types.js';
import type { Move, Square } from '../chess/types.js';
import { squareToCoords, coordsToSquare } from '../coaching/board.js';

/**
 * Apply a Move to a BoardState and return the resulting BoardState.
 * Handles: normal moves, captures, castling, en passant, promotions.
 * Does NOT validate legality — caller is responsible for providing valid moves.
 */
export function applyMove(state: BoardState, move: Move): BoardState {
  const board = new Map(state.board);
  const piece  = board.get(move.from);
  if (!piece) return state; // defensive: shouldn't happen with valid input

  // ── En passant capture ───────────────────────────────────────────────────────
  if (piece.type === 'p' && state.enPassant !== null && move.to === state.enPassant) {
    const [f, r] = squareToCoords(move.to);
    // The captured pawn is one rank behind the EP target square
    const dir     = piece.color === 'white' ? -1 : 1;
    const captured = coordsToSquare(f, r + dir);
    if (captured) board.delete(captured);
  }

  // ── Castling: teleport rook ───────────────────────────────────────────────────
  if (piece.type === 'k') {
    const [ff] = squareToCoords(move.from);
    const [tf, fr] = squareToCoords(move.to);
    if (Math.abs(tf - ff) === 2) {
      // Kingside (tf > ff): rook from h-file (7) to tf-1
      // Queenside (tf < ff): rook from a-file (0) to tf+1
      const rookFromFile = tf > ff ? 7 : 0;
      const rookToFile   = tf > ff ? tf - 1 : tf + 1;
      const rookFrom = coordsToSquare(rookFromFile, fr);
      const rookTo   = coordsToSquare(rookToFile,   fr);
      if (rookFrom && rookTo) {
        const rook = board.get(rookFrom);
        if (rook) {
          board.delete(rookFrom);
          board.set(rookTo, rook);
        }
      }
    }
  }

  // ── Move piece (with optional promotion) ─────────────────────────────────────
  board.delete(move.from);
  board.set(move.to, move.promotion
    ? { type: move.promotion, color: piece.color }
    : piece
  );

  // ── Castling rights ───────────────────────────────────────────────────────────
  const castling = updateCastling(state.castling, move);

  // ── En passant square ─────────────────────────────────────────────────────────
  let enPassant: Square | null = null;
  if (piece.type === 'p') {
    const [fromFile, fromRank] = squareToCoords(move.from);
    const [,         toRank  ] = squareToCoords(move.to);
    if (Math.abs(toRank - fromRank) === 2) {
      // Double pawn push → set EP square between from and to
      enPassant = coordsToSquare(fromFile, (fromRank + toRank) >> 1);
    }
  }

  return {
    board,
    sideToMove: state.sideToMove === 'white' ? 'black' : 'white',
    enPassant,
    castling,
  };
}

function updateCastling(rights: string, move: Move): string {
  let r = rights;
  // King moves → lose all rights for that color
  if (move.from === 'e1' || move.to === 'e1') r = r.replace(/[KQ]/g, '');
  if (move.from === 'e8' || move.to === 'e8') r = r.replace(/[kq]/g, '');
  // Rook moves or rook captured → lose that specific right
  if (move.from === 'h1' || move.to === 'h1') r = r.replace('K', '');
  if (move.from === 'a1' || move.to === 'a1') r = r.replace('Q', '');
  if (move.from === 'h8' || move.to === 'h8') r = r.replace('k', '');
  if (move.from === 'a8' || move.to === 'a8') r = r.replace('q', '');
  return r || '-';
}
