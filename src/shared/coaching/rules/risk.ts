import type { RawPvLine } from '../../engine/types.js';
import type { BoardState, RuleResult } from '../types.js';
import { URGENCY, PIECE_VALUE } from '../types.js';
import { getAttackers } from '../attack-gen.js';
import { uciToMove } from '../../chess/types.js';
import type { Color, Square } from '../../chess/types.js';

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen',
};

// ─── Hanging piece ────────────────────────────────────────────────────────────

/**
 * Returns a hint for the highest-value piece of the side to move that is:
 *  - Attacked by at least one enemy piece
 *  - Defended by zero friendly pieces
 */
export function detectHanging(state: BoardState): RuleResult | null {
  const color: Color = state.sideToMove;
  const opp: Color   = color === 'white' ? 'black' : 'white';
  let worst: { sq: Square; value: number } | null = null;

  for (const [sq, piece] of state.board) {
    if (piece.color !== color || piece.type === 'k') continue;
    const value = PIECE_VALUE[piece.type] ?? 0;
    if (value < 100) continue;

    if (getAttackers(state.board, sq, opp).length === 0) continue;   // not attacked
    if (getAttackers(state.board, sq, color).length > 0) continue;   // defended

    if (!worst || value > worst.value) worst = { sq, value };
  }

  if (!worst) return null;

  const piece = state.board.get(worst.sq)!;
  return {
    text: `Hanging piece — your ${PIECE_NAMES[piece.type] ?? piece.type} on ${worst.sq} is undefended and under attack`,
    urgency: URGENCY.HANGING_OWN,
  };
}

// ─── Opponent threat ──────────────────────────────────────────────────────────

/**
 * Reads the opponent's response in pvLines[0].moves[1] (after our best move).
 * Fires when that response captures a friendly piece worth >= 100 cp.
 */
export function detectOpponentThreat(
  lines: readonly RawPvLine[],
  state: BoardState
): RuleResult | null {
  // moves[0] = our best move, moves[1] = opponent's response
  const ourUci = lines[0]?.moves[0];
  const oppUci = lines[0]?.moves[1];
  if (!ourUci || !oppUci) return null;

  const ourMove = uciToMove(ourUci);
  const oppMove = uciToMove(oppUci);
  if (!ourMove || !oppMove) return null;

  // Simulate our move first
  const post = new Map(state.board);
  const ours = post.get(ourMove.from);
  if (!ours) return null;
  post.delete(ourMove.from);
  post.set(ourMove.to, ours);

  // Check if the opponent's response captures our piece
  const target = post.get(oppMove.to);
  if (!target || target.color !== state.sideToMove || target.type === 'k') return null;

  const value = PIECE_VALUE[target.type] ?? 0;
  if (value < 100) return null;

  return {
    text: `Opponent threat — after your move they can capture your ${PIECE_NAMES[target.type] ?? target.type} on ${oppMove.to}`,
    urgency: URGENCY.OPPONENT_THREAT,
  };
}
