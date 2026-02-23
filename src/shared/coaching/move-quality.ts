import type { Color } from '../chess/types.js';
import type { RawScore } from '../engine/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Standard chess move-quality grades (same scale as lichess / chess.com). */
export type MoveGrade = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveQualityResult {
  /** Categorical grade for the move. */
  grade:   MoveGrade;
  /**
   * Centipawns lost compared to the engine's best available reply.
   * 0 = the player played the engine's top move.
   * Negative values (better than expected) are clamped to 0.
   */
  cpLoss:  number;
  /** Short human label shown in the panel (e.g. "Best", "Inaccuracy"). */
  label:   string;
  /** Single glyph annotation symbol matching the grade (e.g. "!!" / "?"). */
  symbol:  string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────
//
// These mirror the lichess analysis thresholds (in centipawns lost).
// The key insight: cpLoss is measured from the ENGINE'S perspective of the
// position BEFORE the user moved — that eval represents the theoretically
// achievable result; the actual result after the user's move is the
// current eval (flipped to user's perspective).

const GRADE_THRESHOLDS: Array<[number, MoveGrade]> = [
  [  0, 'best'       ],
  [ 10, 'excellent'  ],
  [ 25, 'good'       ],
  [ 50, 'inaccuracy' ],
  [100, 'mistake'    ],
  // everything above 100 cp loss → blunder
];

const GRADE_META: Record<MoveGrade, { label: string; symbol: string }> = {
  best:       { label: 'Best',       symbol: '!!' },
  excellent:  { label: 'Excellent',  symbol: '!'  },
  good:       { label: 'Good',       symbol: '✓'  },
  inaccuracy: { label: 'Inaccuracy', symbol: '⁈'  },
  mistake:    { label: 'Mistake',    symbol: '?'  },
  blunder:    { label: 'Blunder',    symbol: '??' },
};

function gradeFromLoss(cpLoss: number): MoveGrade {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (cpLoss <= threshold) return grade;
  }
  return 'blunder';
}

// ─── Evaluation helpers ───────────────────────────────────────────────────────

function rawToCP(score: RawScore): number {
  return score.tag === 'mate'
    ? (score.moves > 0 ? 10_000 : -10_000)
    : score.value;
}

/**
 * Convert a Stockfish score (always from side-to-move's perspective) into
 * centipawns from `ourSide`'s perspective.
 */
function cpFromOurPerspective(score: RawScore, sideToMove: Color, ourSide: Color): number {
  const cp = rawToCP(score);
  return sideToMove === ourSide ? cp : -cp;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assess the quality of the user's most recent move.
 *
 * Call this when the current position has `sideToMove !== playerSide`,
 * i.e., the user just moved and it is now the opponent's turn.
 *
 * @param prevScore - Engine score from the position BEFORE the user moved
 *                   (it was the user's turn; prevScore.sideToMove === playerSide).
 * @param prevSide  - Side to move at that preceding position.
 * @param currScore - Engine score from the current position (opponent's turn,
 *                   after the user's move).
 * @param currSide  - Side to move now (should be the opponent).
 * @param playerSide - Which color the user is playing.
 *
 * Returns null when the precondition isn't met (e.g. currSide === playerSide).
 */
export function assessUserMove(
  prevScore:  RawScore,
  prevSide:   Color,
  currScore:  RawScore,
  currSide:   Color,
  playerSide: Color,
): MoveQualityResult | null {
  // Only assess when the current position is the opponent's turn
  // (the user has just finished their move).
  if (currSide === playerSide) return null;

  const prevCP = cpFromOurPerspective(prevScore, prevSide,  playerSide);
  const currCP = cpFromOurPerspective(currScore, currSide,  playerSide);

  // cpLoss: how much evaluation the user gave up.
  // Negative means the user "improved" on the engine's prediction (clamp to 0).
  const cpLoss = Math.max(0, prevCP - currCP);
  const grade  = gradeFromLoss(cpLoss);
  const meta   = GRADE_META[grade];

  return { grade, cpLoss, label: meta.label, symbol: meta.symbol };
}
