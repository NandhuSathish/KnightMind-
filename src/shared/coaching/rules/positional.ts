import type { BoardState, RuleResult } from '../types.js';
import { URGENCY } from '../types.js';
import type { Color, Square } from '../../chess/types.js';

const CENTER: readonly Square[] = ['d4', 'd5', 'e4', 'e5'];

// ─── Pawn structure ───────────────────────────────────────────────────────────

/**
 * Checks for doubled pawns (two same-color pawns on the same file).
 * Falls back to checking for isolated pawns (no friendly pawns on adjacent files).
 * Returns the first problem found.
 */
export function detectPawnStructure(state: BoardState): RuleResult | null {
  const color = state.sideToMove;
  const byFile = new Map<string, number>();

  for (const [sq, p] of state.board) {
    if (p.type !== 'p' || p.color !== color) continue;
    const f = sq[0]!;
    byFile.set(f, (byFile.get(f) ?? 0) + 1);
  }

  // Doubled pawns
  for (const [file, n] of byFile) {
    if (n >= 2) {
      return {
        text: `Doubled pawns on the ${file}-file — consider exchanging to fix the structure`,
        urgency: URGENCY.PAWN_STRUCTURE,
      };
    }
  }

  // Isolated pawns
  for (const [file] of byFile) {
    const code = file.charCodeAt(0);
    const hasLeft  = byFile.has(String.fromCharCode(code - 1));
    const hasRight = byFile.has(String.fromCharCode(code + 1));
    if (!hasLeft && !hasRight) {
      return {
        text: `Isolated pawn on ${file}-file — it cannot be supported by other pawns`,
        urgency: URGENCY.PAWN_STRUCTURE,
      };
    }
  }

  return null;
}

// ─── Piece activity ───────────────────────────────────────────────────────────

/**
 * Fires when the opponent controls significantly more center squares (d4/d5/e4/e5).
 * Simple occupancy count — presence in the center, not full control calculation.
 */
export function detectPieceActivity(state: BoardState): RuleResult | null {
  const color: Color = state.sideToMove;
  const opp: Color   = color === 'white' ? 'black' : 'white';
  let own = 0;
  let enemy = 0;

  for (const sq of CENTER) {
    const p = state.board.get(sq);
    if (p?.color === color) own++;
    else if (p?.color === opp) enemy++;
  }

  if (enemy > own + 1) {
    return {
      text: `Center control — opponent has ${enemy} pieces in the center vs your ${own}; contest it`,
      urgency: URGENCY.PIECE_ACTIVITY,
    };
  }
  return null;
}
