import type { RawPvLine } from '../../engine/types.js';
import type { BoardState, RuleResult } from '../types.js';
import { URGENCY, PIECE_VALUE } from '../types.js';
import { isAttackedBy, pieceAttacks, getAttackers } from '../attack-gen.js';
import { findKing } from '../board.js';
import { uciToMove } from '../../chess/types.js';
import type { Color, Square } from '../../chess/types.js';

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen',
};

// ─── Mate threat ──────────────────────────────────────────────────────────────

export function detectMate(lines: readonly RawPvLine[]): RuleResult | null {
  const score = lines[0]?.score;
  if (score?.tag !== 'mate' || score.moves <= 0) return null;
  if (score.moves === 1) {
    return { text: 'Checkmate in 1 — deliver the final blow!', urgency: URGENCY.CHECKMATE_IN_1 };
  }
  return {
    text: `Forced checkmate in ${score.moves} — pursue the mating sequence`,
    urgency: URGENCY.CHECKMATE_IN_N,
  };
}

// ─── Material capture ─────────────────────────────────────────────────────────

export function detectMaterialCapture(
  lines: readonly RawPvLine[],
  state: BoardState
): RuleResult | null {
  const uci = lines[0]?.moves[0];
  if (!uci) return null;
  const move = uciToMove(uci);
  if (!move) return null;

  const target = state.board.get(move.to);
  if (!target || target.color === state.sideToMove) return null;

  const value = PIECE_VALUE[target.type] ?? 0;
  if (value < 100) return null;

  return {
    text: `Win material — capture the ${PIECE_NAMES[target.type] ?? target.type} on ${move.to}`,
    urgency: URGENCY.MATERIAL_CAPTURE,
  };
}

// ─── Check move ───────────────────────────────────────────────────────────────

export function detectCheck(
  lines: readonly RawPvLine[],
  state: BoardState
): RuleResult | null {
  const uci = lines[0]?.moves[0];
  if (!uci) return null;
  const move = uciToMove(uci);
  if (!move) return null;

  const movingPiece = state.board.get(move.from);
  if (!movingPiece || movingPiece.color !== state.sideToMove) return null;

  // Simulate the move
  const post = new Map(state.board);
  post.delete(move.from);
  post.set(move.to, movingPiece);

  const opponent: Color = state.sideToMove === 'white' ? 'black' : 'white';
  const kingSquare = findKing(post, opponent);
  if (!kingSquare) return null;
  if (!isAttackedBy(post, kingSquare, state.sideToMove)) return null;

  return {
    text: `Give check — ${move.from}–${move.to} attacks the enemy king`,
    urgency: URGENCY.CHECK_MOVE,
  };
}

// ─── Fork detection ───────────────────────────────────────────────────────────

export function detectFork(
  lines: readonly RawPvLine[],
  state: BoardState
): RuleResult | null {
  const uci = lines[0]?.moves[0];
  if (!uci) return null;
  const move = uciToMove(uci);
  if (!move) return null;

  const movingPiece = state.board.get(move.from);
  if (!movingPiece || movingPiece.color !== state.sideToMove) return null;

  // Simulate the move
  const post = new Map(state.board);
  post.delete(move.from);
  post.set(move.to, movingPiece);

  const opponent: Color = state.sideToMove === 'white' ? 'black' : 'white';
  const attacked = pieceAttacks(move.to, movingPiece, post);

  // Collect valuable enemy targets (>= pawn value; king always counts)
  const targets: Square[] = [];
  for (const sq of attacked) {
    const victim = post.get(sq);
    if (!victim || victim.color !== opponent) continue;
    const value = victim.type === 'k' ? 99999 : (PIECE_VALUE[victim.type] ?? 0);
    if (value >= 100) targets.push(sq);
  }
  if (targets.length < 2) return null;

  // Safety check: can the opponent immediately recapture with a cheaper piece?
  const movingValue = PIECE_VALUE[movingPiece.type] ?? 0;
  const attackersOfLanding = getAttackers(post, move.to, opponent);
  const cheapestAttacker = attackersOfLanding.length > 0
    ? Math.min(...attackersOfLanding.map(sq => PIECE_VALUE[post.get(sq)?.type ?? ''] ?? 0))
    : Infinity;
  const safe = cheapestAttacker >= movingValue;

  return safe
    ? {
        text: `Safe fork! ${move.from}–${move.to} attacks ${targets.length} enemy pieces at once`,
        urgency: URGENCY.FORK,
      }
    : {
        text: `Fork opportunity on ${move.to} — attacks ${targets.length} pieces (verify safety first)`,
        urgency: URGENCY.FORK,
      };
}
