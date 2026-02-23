import type { RawPvLine, RawScore } from '../engine/types.js';
import type { BoardState } from './types.js';
import { PIECE_VALUE } from './types.js';
import { fenToBoardState, findKing, squareToCoords } from './board.js';
import { isAttackedBy, getAttackers, pieceAttacks } from './attack-gen.js';
import { uciToMove } from '../chess/types.js';
import type { Color, Square } from '../chess/types.js';

// ─── Output Types ─────────────────────────────────────────────────────────────

export type BlunderSeverity = 'inaccuracy' | 'mistake' | 'blunder';
export type PunishmentType  = 'simple tactic' | 'material win' | 'attack' | 'positional squeeze';

export interface PunishmentResult {
  /** Best punishment move in UCI notation, e.g. "d4e5" */
  moveUCI:         string;
  /** Best punishment move in SAN notation, e.g. "Nxe5+" */
  moveSAN:         string;
  /** Engine evaluation from our perspective in centipawns (positive = good for us) */
  evaluation:      number;
  /** Category of the best punishment */
  punishmentType:  PunishmentType;
  /** 0–1 confidence that this is the right practical choice */
  confidence:      number;
  /** Human-readable explanation of why this move is recommended */
  explanation:     string;
  /** Severity of the opponent's mistake */
  blunderSeverity: BlunderSeverity;
  /** Centipawns gained due to opponent's mistake */
  evalSwing:       number;
  /** Short UI message, e.g. "💥 Blunder! (+3.2) Best: Nxe5+" */
  uiMessage:       string;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const INACCURACY_CP = 50;   // 0.5 pawns
const MISTAKE_CP    = 150;  // 1.5 pawns
const BLUNDER_CP    = 300;  // 3.0 pawns

function classifySeverity(swing: number): BlunderSeverity | null {
  if (swing >= BLUNDER_CP)    return 'blunder';
  if (swing >= MISTAKE_CP)    return 'mistake';
  if (swing >= INACCURACY_CP) return 'inaccuracy';
  return null;
}

// ─── Evaluation normalization ─────────────────────────────────────────────────

function rawToCP(score: RawScore): number {
  return score.tag === 'mate'
    ? (score.moves > 0 ? 10000 : -10000)
    : score.value;
}

/**
 * Converts a Stockfish score (always from side-to-move's perspective) into
 * centipawns from `ourSide`'s perspective.
 */
function cpFromOurPerspective(score: RawScore, sideToMove: Color, ourSide: Color): number {
  const cp = rawToCP(score);
  return sideToMove === ourSide ? cp : -cp;
}

// ─── UCI → SAN converter ──────────────────────────────────────────────────────

const PIECE_LETTER: Record<string, string> = {
  n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
};

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

/**
 * Converts a UCI move string to algebraic notation given the current board state.
 * Produces check suffix (+) but not checkmate (#) — detecting checkmate would
 * require full legal-move enumeration.
 */
export function uciToSAN(uci: string, state: BoardState): string {
  const move = uciToMove(uci);
  if (!move) return uci;

  const moving = state.board.get(move.from);
  if (!moving) return uci;

  const target    = state.board.get(move.to);
  const isCapture = !!target
    || (moving.type === 'p' && move.from[0] !== move.to[0]); // en passant

  // Simulate move on a scratch board
  const post = new Map(state.board);
  post.delete(move.from);
  if (moving.type === 'p' && move.from[0] !== move.to[0] && !state.board.has(move.to)) {
    // En passant: remove the captured pawn from its actual square
    post.delete(`${move.to[0]}${move.from[1]}` as Square);
  }
  const promotedPiece = move.promotion
    ? { type: move.promotion, color: moving.color }
    : moving;
  post.set(move.to, promotedPiece);

  // Check detection
  const opponent: Color  = moving.color === 'white' ? 'black' : 'white';
  const oppKing          = findKing(post, opponent);
  const givesCheck       = oppKing ? isAttackedBy(post, oppKing, moving.color) : false;

  let san: string;

  // ── Castling ──────────────────────────────────────────────────────────────
  if (moving.type === 'k') {
    const [fromFile] = squareToCoords(move.from);
    const [toFile]   = squareToCoords(move.to);
    if (Math.abs(toFile - fromFile) === 2) {
      san = toFile > fromFile ? 'O-O' : 'O-O-O';
      return givesCheck ? san + '+' : san;
    }
  }

  // ── Pawn ──────────────────────────────────────────────────────────────────
  if (moving.type === 'p') {
    san = isCapture ? `${move.from[0]}x${move.to}` : move.to;
    if (move.promotion) {
      san += '=' + (PIECE_LETTER[move.promotion] ?? move.promotion.toUpperCase());
    }
    if (givesCheck) san += '+';
    return san;
  }

  // ── Piece ─────────────────────────────────────────────────────────────────
  const letter = PIECE_LETTER[moving.type] ?? moving.type.toUpperCase();
  const disambig = _disambig(state, move.from, moving.type, moving.color, move.to);
  san = letter + disambig + (isCapture ? 'x' : '') + move.to;
  if (givesCheck) san += '+';
  return san;
}

/** Returns the minimum disambiguation suffix needed to make the move unique. */
function _disambig(
  state:     BoardState,
  from:      Square,
  pieceType: string,
  color:     Color,
  to:        Square,
): string {
  const rivals: Square[] = [];
  for (const [sq, piece] of state.board) {
    if (sq === from || piece.type !== pieceType || piece.color !== color) continue;
    const attacks = pieceAttacks(sq, piece, state.board);
    const victim  = state.board.get(to);
    if (attacks.includes(to) && (!victim || victim.color !== color)) rivals.push(sq);
  }
  if (rivals.length === 0) return '';

  const [fromFile, fromRank] = squareToCoords(from);
  const sameFile = rivals.some(sq => squareToCoords(sq)[0] === fromFile);
  const sameRank = rivals.some(sq => squareToCoords(sq)[1] === fromRank);

  if (!sameFile) return from[0]!;       // file letter
  if (!sameRank) return from[1]!;       // rank digit
  return from;                           // full square
}

// ─── Human-style candidate scoring ───────────────────────────────────────────

interface CandidateScore {
  line:        RawPvLine;
  san:         string;
  practical:   number;
  type:        PunishmentType;
  explanation: string;
  evalCP:      number;
}

/**
 * Scores a single candidate line for human practicality.
 *
 * Heuristic weights (all additive):
 *  +0.30  — move gives check            (forcing, limits replies)
 *  +0.25  — safe capture of a piece     (concrete, easy to evaluate)
 *  +var   — material gain bonus         (materialGain / 1000, proportional)
 *  +0.15  — move threatens a piece ≥ 300 cp (creates immediate problem)
 *  −0.10  — quiet positional move        (harder for humans to calculate)
 *  base   — engine centipawn eval / 100  (pawns)
 *
 * Rationale: checks and captures are concrete, verifiable in blitz.
 * Quiet engine moves require deep tree search that humans cannot do OTB.
 *
 * @param clockMs  Optional remaining clock in milliseconds.
 *                 When < 30 000 ms, penalty for non-forcing moves is doubled.
 */
function scoreCandidate(
  line:    RawPvLine,
  state:   BoardState,
  ourSide: Color,
  clockMs?: number,
): CandidateScore {
  const uci    = line.moves[0] ?? '';
  const san    = uciToSAN(uci, state);
  const evalCP = cpFromOurPerspective(line.score, state.sideToMove, ourSide);

  const move    = uciToMove(uci);
  let practical  = evalCP / 100;
  let type: PunishmentType = 'positional squeeze';
  let explanation = 'Improves the position — opponent must respond carefully.';

  if (!move) return { line, san, practical, type, explanation, evalCP };

  const moving  = state.board.get(move.from);
  const target  = state.board.get(move.to);
  if (!moving) return { line, san, practical, type, explanation, evalCP };

  const isCapture    = !!target && target.color !== ourSide;
  const materialGain = isCapture ? (PIECE_VALUE[target.type] ?? 0) : 0;
  const movingValue  = PIECE_VALUE[moving.type] ?? 0;

  // Simulate move to analyze post-move state
  const post = new Map(state.board);
  post.delete(move.from);
  post.set(move.to, moving);

  // Check detection
  const opponent: Color = ourSide === 'white' ? 'black' : 'white';
  const oppKing         = findKing(post, opponent);
  const givesCheck      = oppKing ? isAttackedBy(post, oppKing, ourSide) : false;

  // Safety: can opponent immediately recapture with a cheaper piece?
  const attackers        = getAttackers(post, move.to, opponent);
  const cheapestAttacker = attackers.length > 0
    ? Math.min(...attackers.map(sq => PIECE_VALUE[post.get(sq)?.type ?? ''] ?? 9999))
    : Infinity;
  const isSafe = attackers.length === 0 || cheapestAttacker >= movingValue;

  // ── Check bonus ───────────────────────────────────────────────────────────
  if (givesCheck) {
    practical  += 0.30;
    type        = 'attack';
    explanation = 'Gives check — forces the opponent to react immediately.';
  }

  // ── Capture bonus ─────────────────────────────────────────────────────────
  if (isCapture) {
    const pieceName = PIECE_NAMES[target.type] ?? target.type;
    if (isSafe) {
      practical += 0.25 + materialGain / 1000;
      if (materialGain >= 500) {
        type        = 'material win';
        explanation = `Captures the ${pieceName} safely — wins decisive material.`;
      } else if (materialGain >= 300) {
        type        = 'simple tactic';
        explanation = `Captures the ${pieceName} with no immediate risk — clean material gain.`;
      } else {
        type        = 'simple tactic';
        explanation = `Takes the ${pieceName} — good trade, easy to calculate.`;
      }
    } else {
      // Unsound capture: only worthwhile if net material gain
      const net = materialGain - movingValue;
      practical += net / 1000;
      type        = 'simple tactic';
      explanation = net >= 0
        ? `Exchange on ${move.to} — slight material edge despite recapture.`
        : `Capture on ${move.to} — verify you won't lose material.`;
    }
  }

  // ── Threat bonus (quiet threatening move) ─────────────────────────────────
  if (!isCapture && !givesCheck) {
    const threats = pieceAttacks(move.to, moving, post).filter(sq => {
      const p = post.get(sq);
      return p && p.color === opponent && (PIECE_VALUE[p.type] ?? 0) >= 300;
    });
    if (threats.length > 0) {
      practical  += 0.15;
      type        = 'attack';
      explanation = threats.length > 1
        ? `Threatens multiple enemy pieces — opponent is overloaded.`
        : `Threatens a valuable enemy piece — demands an immediate response.`;
    } else {
      // Plain quiet move — harder for humans under time pressure
      const timePressure = clockMs !== undefined && clockMs < 30_000;
      practical -= timePressure ? 0.20 : 0.10;
      explanation = 'Positional improvement — best move but requires deeper calculation.';
    }
  }

  return { line, san, practical, type, explanation, evalCP };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Detects whether the opponent just made a significant mistake and, if so,
 * returns the most practical human-style punishment from the MultiPV lines.
 *
 * Call this on each new position when it is `ourSide`'s turn.
 *
 * @param prevScore  - Engine score from the immediately preceding position
 *                     (opponent's turn, before they moved).
 * @param prevSide   - Side to move at the preceding position.
 * @param lines      - Current engine MultiPV lines (our turn, post-blunder).
 * @param fen        - Current FEN string.
 * @param ourSide    - Color we are playing.
 * @param clockMs    - Optional remaining clock time in milliseconds.
 */
export function detectOpponentBlunder(
  prevScore: RawScore,
  prevSide:  Color,
  lines:     readonly RawPvLine[],
  fen:       string,
  ourSide:   Color,
  clockMs?:  number,
): PunishmentResult | null {
  if (lines.length === 0) return null;

  const state = fenToBoardState(fen);
  if (!state) return null;

  // Only fire when it is our turn (opponent just moved)
  if (state.sideToMove !== ourSide) return null;

  const currScore = lines[0]!.score;

  // Compute eval swing from our perspective
  const prevCP  = cpFromOurPerspective(prevScore, prevSide, ourSide);
  const currCP  = cpFromOurPerspective(currScore, state.sideToMove, ourSide);
  const swing   = currCP - prevCP;   // positive = we gained from opponent's mistake

  const severity = classifySeverity(swing);
  if (!severity) return null;

  // Score every candidate for human practicality
  const candidates = lines
    .map(line => scoreCandidate(line, state, ourSide, clockMs))
    .sort((a, b) => b.practical - a.practical);

  const best = candidates[0];
  if (!best) return null;

  // Confidence: gap between best and 2nd-best practical scores
  const second     = candidates[1];
  const gap        = second ? best.practical - second.practical : 1;
  const confidence = Math.min(1, Math.max(0, 0.5 + gap * 0.5));

  const EMOJI: Record<BlunderSeverity, string> = {
    inaccuracy: '⚠️',
    mistake:    '❌',
    blunder:    '💥',
  };

  const swingStr   = (swing / 100).toFixed(1);
  const severityLbl = severity.charAt(0).toUpperCase() + severity.slice(1);
  const uiMessage  = `${EMOJI[severity]} ${severityLbl}! (+${swingStr}) Best: ${best.san}`;

  return {
    moveUCI:         best.line.moves[0] ?? '',
    moveSAN:         best.san,
    evaluation:      best.evalCP,
    punishmentType:  best.type,
    confidence,
    explanation:     best.explanation,
    blunderSeverity: severity,
    evalSwing:       swing,
    uiMessage,
  };
}
