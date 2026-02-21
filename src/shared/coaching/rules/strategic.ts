import type { BoardState, RuleResult } from '../types.js';
import { URGENCY } from '../types.js';
import { STARTING_SQUARES, findKing, squareToCoords, coordsToSquare } from '../board.js';
import { getAttackers } from '../attack-gen.js';
import type { Color, Square } from '../../chess/types.js';

// ─── Development ──────────────────────────────────────────────────────────────

/**
 * Fires when the side to move has 1+ minor pieces still on starting squares.
 * Only tracks knights and bishops (the pieces that benefit most from early development).
 */
export function detectDevelopment(state: BoardState): RuleResult | null {
  const color = state.sideToMove;
  const starts = STARTING_SQUARES[color];
  let count = 0;
  const names: string[] = [];

  for (const [type, squares] of Object.entries(starts) as [string, readonly Square[]][]) {
    for (const sq of squares) {
      const p = state.board.get(sq);
      if (p?.type === type && p.color === color) {
        count++;
        names.push(`${type === 'n' ? 'Knight' : 'Bishop'} on ${sq}`);
      }
    }
  }

  if (count < 1) return null;

  return {
    text: count === 1
      ? `Develop your pieces — ${names[0]!} is still on its starting square`
      : `Develop your pieces — ${count} minor pieces undeveloped (${names.slice(0, 2).join(', ')})`,
    urgency: URGENCY.DEVELOPMENT,
  };
}

// ─── King safety ─────────────────────────────────────────────────────────────

/**
 * Fires when the king has 2+ distinct enemy attackers in its 3×3 zone AND no
 * friendly pawns in the same zone (no pawn shield).
 */
export function detectKingSafety(state: BoardState): RuleResult | null {
  const color    = state.sideToMove;
  const opponent: Color = color === 'white' ? 'black' : 'white';

  const kingSq = findKing(state.board, color);
  if (!kingSq) return null;

  const [kf, kr] = squareToCoords(kingSq);

  // Build the 3×3 king zone
  const zone: Square[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const sq = coordsToSquare(kf + df, kr + dr);
      if (sq) zone.push(sq);
    }
  }

  // Count distinct opponent pieces attacking any zone square
  const attackerSet = new Set<Square>();
  for (const sq of zone) {
    for (const a of getAttackers(state.board, sq, opponent)) {
      attackerSet.add(a);
    }
  }

  // Count friendly pawns in the king zone (pawn shield)
  let pawnShield = 0;
  for (const sq of zone) {
    const p = state.board.get(sq);
    if (p?.type === 'p' && p.color === color) pawnShield++;
  }

  if (attackerSet.size >= 2 && pawnShield < 1) {
    return {
      text: `King safety concern — ${attackerSet.size} enemy pieces target your king zone with no pawn shield`,
      urgency: URGENCY.KING_SAFETY,
    };
  }
  return null;
}
