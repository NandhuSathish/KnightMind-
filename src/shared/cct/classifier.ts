/**
 * CCT (Checks → Captures → Threats) move classifier.
 *
 * Generates all legal moves for the side to move, classifies them into the
 * classical human-calculation order, and scores each one.
 *
 * Scoring pipeline:
 *   1. Extract best-move evaluation from PV line 1 (the engine's top choice).
 *   2. For each CCT candidate:
 *       a. If it appears in the engine PV lines → use its exact engine eval.
 *       b. Otherwise → use a local heuristic estimate (SEE or threat value).
 *   3. Compute loss = bestEval − moveEval  (0 = as good as best; larger = worse).
 *   4. Map loss to a quality label/class.
 *   5. Sort each category by loss ascending (engine evals rank above equal heuristics).
 *
 * Quality thresholds (centipawn loss):
 *    0 –  30  → Excellent
 *   30 –  80  → Good
 *   80 – 150  → Playable
 *  150 – 300  → Dubious
 *  300 – 600  → Bad
 *       > 600 → Losing
 *
 * No additional engine calls are made — the existing multiPV result is reused.
 * Mate scores are always prioritised over centipawn scores.
 */

import { Chess } from 'chess.js';
import type { RawPvLine } from '../engine/types.js';
import { PIECE_VALUE } from '../coaching/types.js';
import { fenToBoardState } from '../coaching/board.js';
import { getAttackers } from '../coaching/attack-gen.js';
import type { Square, Color, Piece } from '../chess/types.js';
import type { CCTMove, CCTQuality, CCTResult } from './types.js';

// ─── Quality mapping (loss-based) ─────────────────────────────────────────────

function lossToQuality(
  loss: number,
  isHeuristic: boolean,
): { label: string; cls: CCTQuality } {
  let cls: CCTQuality;
  let label: string;

  if      (loss <= 30)  { cls = 'excellent'; label = 'Excellent'; }
  else if (loss <= 80)  { cls = 'good';      label = 'Good';      }
  else if (loss <= 150) { cls = 'playable';  label = 'Playable';  }
  else if (loss <= 300) { cls = 'dubious';   label = 'Dubious';   }
  else if (loss <= 600) { cls = 'bad';       label = 'Bad';       }
  else                  { cls = 'losing';    label = 'Losing';    }

  // Prefix heuristic evaluations so the user knows they are approximate.
  return { label: isHeuristic ? `~${label}` : label, cls };
}

// ─── PV lookup ────────────────────────────────────────────────────────────────

function scoreToCP(score: RawPvLine['score']): number {
  return score.tag === 'mate'
    ? (score.moves > 0 ? 10_000 : -10_000)
    : score.value;
}

function buildPVLookup(
  lines: readonly RawPvLine[],
): Map<string, { cp: number; mateIn?: number }> {
  const map = new Map<string, { cp: number; mateIn?: number }>();
  for (const line of lines) {
    const uci = line.moves[0];
    if (!uci) continue;
    const cp = scoreToCP(line.score);
    const mateIn =
      line.score.tag === 'mate' && line.score.moves > 0
        ? line.score.moves
        : undefined;
    map.set(uci, mateIn !== undefined ? { cp, mateIn } : { cp });
  }
  return map;
}

// ─── Hanging-piece detection ──────────────────────────────────────────────────

/**
 * Returns squares of opponent pieces that are attacked by `ourColor`
 * but have no defender of their own color.
 */
function getHangingSquares(
  board: ReadonlyMap<Square, Piece>,
  ourColor: Color,
): Set<Square> {
  const opponentColor: Color = ourColor === 'white' ? 'black' : 'white';
  const hanging = new Set<Square>();
  for (const [sq, piece] of board) {
    if (piece.color !== opponentColor) continue;
    if (getAttackers(board, sq, ourColor).length === 0) continue;    // we attack it
    if (getAttackers(board, sq, opponentColor).length === 0) hanging.add(sq); // undefended
  }
  return hanging;
}

// ─── Move builder ─────────────────────────────────────────────────────────────

/**
 * Construct a CCTMove entry.
 *
 * @param bestEval  - Centipawn value of the engine's best move in this position.
 *                    Quality is computed as loss = bestEval − moveEval.
 */
function makeCCTMove(
  san:         string,
  uci:         string,
  pvLookup:    Map<string, { cp: number; mateIn?: number }>,
  fallbackCP:  number,
  bestEval:    number,
  forcedMate?: number,
): CCTMove {
  const pvEntry    = pvLookup.get(uci);
  const evaluation = pvEntry?.cp ?? fallbackCP;
  const isEngine   = pvEntry !== undefined;
  const mateIn     = forcedMate ?? pvEntry?.mateIn;

  // Loss = how much worse this move is relative to the engine's best choice.
  // Clamped to 0 to avoid negative values from heuristic overestimates.
  const loss = Math.max(0, bestEval - evaluation);

  const q =
    mateIn !== undefined && mateIn > 0
      ? { label: `Mate in ${mateIn}`, cls: 'excellent' as CCTQuality }
      : lossToQuality(loss, !isEngine);

  return {
    moveSAN:      san,
    moveUCI:      uci,
    evaluation,
    evalSource:   isEngine ? 'engine' : 'heuristic',
    qualityLabel: q.label,
    qualityClass: q.cls,
    ...(mateIn !== undefined ? { mateIn } : {}),
  };
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

/**
 * Sort by evaluation descending (≡ loss ascending, since bestEval is constant).
 * Tie-break 1: engine evals rank above equal-valued heuristics.
 * Tie-break 2: alphabetical SAN for full determinism.
 */
function sortMoves(a: CCTMove, b: CCTMove): number {
  if (b.evaluation !== a.evaluation) return b.evaluation - a.evaluation;
  if (a.evalSource === 'engine' && b.evalSource === 'heuristic') return -1;
  if (a.evalSource === 'heuristic' && b.evalSource === 'engine') return  1;
  return a.moveSAN < b.moveSAN ? -1 : a.moveSAN > b.moveSAN ? 1 : 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify all legal moves in `fen` into checks, captures, and threats.
 *
 * @param fen      - Full 6-field FEN of the position to analyse.
 * @param pvLines  - Engine PV lines from the current analysis (used for scoring).
 * @returns CCTResult with three sorted arrays. All detected moves are included.
 */
export function classifyMoves(
  fen:     string,
  pvLines: readonly RawPvLine[],
): CCTResult {
  let chess: InstanceType<typeof Chess>;
  try {
    chess = new Chess(fen);
  } catch {
    return { checks: [], captures: [], threats: [] };
  }

  const verboseMoves = chess.moves({ verbose: true });
  if (verboseMoves.length === 0) return { checks: [], captures: [], threats: [] };

  const sideToMove: Color = chess.turn() === 'w' ? 'white' : 'black';
  const pvLookup          = buildPVLookup(pvLines);

  // Best-move evaluation: PV line 1 score, converted to centipawns.
  // Quality of every CCT move is expressed as loss relative to this baseline.
  const bestEval = pvLines.length > 0 ? scoreToCP(pvLines[0]!.score) : 0;

  // Baseline: opponent pieces that are already hanging before any move.
  const initState        = fenToBoardState(fen);
  const initiallyHanging = initState
    ? getHangingSquares(initState.board, sideToMove)
    : new Set<Square>();

  const checks:   CCTMove[] = [];
  const captures: CCTMove[] = [];
  const threats:  CCTMove[] = [];

  for (const move of verboseMoves) {
    // Keep only queen promotions to avoid quadruplicating promotion moves.
    // Knight promotions that give check are included separately below.
    if (move.promotion !== undefined && move.promotion !== 'q') continue;

    const uci        = move.from + move.to + (move.promotion ?? '');
    const isCapture  = move.captured !== undefined;
    // SAN ends with '+' for check and '#' for checkmate (standard chess notation).
    const givesCheck = move.san.endsWith('+') || move.san.endsWith('#');
    const isMate     = move.san.endsWith('#');
    const forcedMate = isMate ? 1 : undefined;

    if (givesCheck) {
      // Capturing checks: use the captured piece value as heuristic floor.
      const capGain    = isCapture ? (PIECE_VALUE[move.captured!] ?? 0) : 0;
      const fallbackCP = capGain > 0 ? capGain : 50; // bare check = modest heuristic
      checks.push(makeCCTMove(move.san, uci, pvLookup, fallbackCP, bestEval, forcedMate));

    } else if (isCapture) {
      // SEE approximation: material gained minus material at risk.
      const gain       = PIECE_VALUE[move.captured!] ?? 0;
      const loss       = PIECE_VALUE[move.piece]     ?? 0;
      const fallbackCP = gain - loss;
      captures.push(makeCCTMove(move.san, uci, pvLookup, fallbackCP, bestEval));

    } else {
      // Threat: does this move create newly hanging opponent pieces?
      const afterState = fenToBoardState(move.after);
      if (!afterState) continue;

      const nowHanging  = getHangingSquares(afterState.board, sideToMove);
      const newThreats  = (Array.from(nowHanging) as Square[]).filter(
        sq => !initiallyHanging.has(sq),
      );

      if (newThreats.length > 0) {
        const maxPieceVal = Math.max(
          ...newThreats.map(sq => PIECE_VALUE[afterState.board.get(sq)?.type ?? ''] ?? 0),
        );
        // Conservative estimate: ~30% of the threatened piece value.
        // (The threat may not materialise — opponent can defend or escape.)
        const fallbackCP = Math.round(maxPieceVal * 0.3);
        threats.push(makeCCTMove(move.san, uci, pvLookup, fallbackCP, bestEval));
      }
    }
  }

  // Also include knight promotions that give check (not covered by queen promotion filter).
  for (const move of verboseMoves) {
    if (move.promotion !== 'n') continue;
    if (!(move.san.endsWith('+') || move.san.endsWith('#'))) continue;
    const uci        = move.from + move.to + 'n';
    const fallbackCP = 50;
    const forcedMate = move.san.endsWith('#') ? 1 : undefined;
    checks.push(makeCCTMove(move.san, uci, pvLookup, fallbackCP, bestEval, forcedMate));
  }

  return {
    checks:   checks.sort(sortMoves),
    captures: captures.sort(sortMoves),
    threats:  threats.sort(sortMoves),
  };
}
