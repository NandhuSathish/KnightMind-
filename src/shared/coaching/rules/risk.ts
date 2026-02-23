import type { RawPvLine, RawScore } from '../../engine/types.js';
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

// ─── Blunder alert ────────────────────────────────────────────────────────────

function scoreToVal(s: RawScore): number {
  return s.tag === 'mate' ? (s.moves > 0 ? 10000 : -10000) : s.value;
}

/**
 * Warns about positions where a wrong move causes a large material loss.
 *
 * Three signals (checked in order of severity):
 *  1. Being mated — opponent has a forced mate sequence.
 *  2. Eval cliff — best move is >= 150 cp better than the 2nd-best move.
 *  3. Hanging piece that must be addressed immediately.
 */
export function detectBlunder(
  lines: readonly RawPvLine[],
  state: BoardState
): RuleResult | null {
  const best   = lines[0];
  const second = lines[1];

  // Signal 1: we are being mated
  if (best?.score.tag === 'mate' && best.score.moves < 0) {
    const n = Math.abs(best.score.moves);
    return {
      text: n === 1
        ? 'You are already in checkmate — game over'
        : `Opponent forces checkmate in ${n} — every move loses`,
      urgency: URGENCY.BLUNDER_ALERT,
    };
  }

  // Signal 2: eval cliff between best and 2nd-best PV
  if (best && second) {
    const gap = scoreToVal(best.score) - scoreToVal(second.score);
    if (gap >= 300) {
      return {
        text: 'Only one move keeps the position — most moves drop 3+ pawns of material',
        urgency: URGENCY.BLUNDER_ALERT,
      };
    }
    if (gap >= 150) {
      const pawns = (gap / 100).toFixed(1);
      return {
        text: `Precise play needed — the second-best move is ${pawns} pawns worse`,
        urgency: URGENCY.BLUNDER_ALERT - 5,
      };
    }
  }

  // Signal 3: hanging piece that the player must address
  const color: Color = state.sideToMove;
  const opp:   Color = color === 'white' ? 'black' : 'white';
  let worst: { sq: Square; value: number } | null = null;

  for (const [sq, piece] of state.board) {
    if (piece.color !== color || piece.type === 'k') continue;
    const value = PIECE_VALUE[piece.type] ?? 0;
    if (value < 100) continue;
    if (getAttackers(state.board, sq, opp).length === 0) continue;
    if (getAttackers(state.board, sq, color).length > 0) continue;
    if (!worst || value > worst.value) worst = { sq, value };
  }

  if (worst) {
    const piece = state.board.get(worst.sq)!;
    return {
      text: `Don't ignore your ${PIECE_NAMES[piece.type] ?? piece.type} on ${worst.sq} — leaving it hanging is a blunder`,
      urgency: URGENCY.BLUNDER_ALERT - 10,
    };
  }

  return null;
}
