import type { Color, Piece, Square } from '../chess/types.js';

// ─── Difficulty ───────────────────────────────────────────────────────────────

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

// ─── Board State ──────────────────────────────────────────────────────────────

/**
 * Parsed, indexed board state derived from a FEN string.
 * Pre-computed once per analysis call; all rules receive this.
 */
export interface BoardState {
  readonly board: ReadonlyMap<Square, Piece>;
  readonly sideToMove: Color;
  readonly enPassant: Square | null;
  readonly castling: string;
}

// ─── Rule Result ─────────────────────────────────────────────────────────────

/**
 * A rule returns a RuleResult when it fires, null otherwise.
 * Urgency drives deterministic selection when multiple rules match in one category.
 */
export interface RuleResult {
  readonly text: string;
  readonly urgency: number;
}

// ─── Coaching Output ─────────────────────────────────────────────────────────

export interface CoachingHints {
  tactical:   string | null;
  strategic:  string | null;
  positional: string | null;
  risk:       string | null;
  blunder:    string | null;
}

// ─── Urgency Constants ────────────────────────────────────────────────────────

export const URGENCY = {
  CHECKMATE_IN_1:   100,
  CHECKMATE_IN_N:    90,
  BLUNDER_ALERT:     88,
  HANGING_OWN:       85,
  MATERIAL_CAPTURE:  80,
  FORK:              75,
  CHECK_MOVE:        70,
  OPPONENT_THREAT:   65,
  KING_SAFETY:       60,
  DEVELOPMENT:       50,
  PAWN_STRUCTURE:    40,
  PIECE_ACTIVITY:    30,
} as const;

// ─── Material Values ─────────────────────────────────────────────────────────

export const PIECE_VALUE: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};
