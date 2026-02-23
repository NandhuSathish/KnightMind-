import type { BoardState } from '../coaching/types.js';
import type { Color, Move, PieceType, PromotionPiece, Square } from '../chess/types.js';
import { moveToUCI } from '../chess/types.js';
import { squareToCoords, coordsToSquare } from '../coaching/board.js';
import { pieceAttacks } from '../coaching/attack-gen.js';

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a SAN move string to a UCI move + Move object given the current position.
 * Returns null if the SAN cannot be parsed or the move is ambiguous / illegal.
 */
export function sanToUCI(
  state: BoardState,
  san: string
): { uci: string; move: Move } | null {
  // Strip check/checkmate/annotation suffixes
  const clean = san.replace(/[+#!?]+$/, '').trim();

  // Castling
  if (clean === 'O-O' || clean === '0-0') return makeCastle(state, 'kingside');
  if (clean === 'O-O-O' || clean === '0-0-0') return makeCastle(state, 'queenside');

  const parsed = parseSAN(clean);
  if (!parsed) return null;

  const from = findPiece(state, parsed);
  if (!from) return null;

  const move: Move = {
    from,
    to: parsed.to,
    ...(parsed.promo ? { promotion: parsed.promo } : {}),
  };

  return { uci: moveToUCI(move), move };
}

// ─── Internals ─────────────────────────────────────────────────────────────────

interface ParsedSAN {
  piece:    PieceType;
  fromFile: number | null; // 0–7
  fromRank: number | null; // 0–7
  to:       Square;
  promo:    PromotionPiece | null;
}

/** Produce a UCI move for castling (verifies king is on its start square). */
function makeCastle(
  state: BoardState,
  side: 'kingside' | 'queenside'
): { uci: string; move: Move } | null {
  const rank: '1' | '8' = state.sideToMove === 'white' ? '1' : '8';
  const from = `e${rank}` as Square;
  const to   = side === 'kingside'
    ? (`g${rank}` as Square)
    : (`c${rank}` as Square);

  const king = state.board.get(from);
  if (!king || king.type !== 'k' || king.color !== state.sideToMove) return null;

  const move: Move = { from, to };
  return { uci: moveToUCI(move), move };
}

/** Parse SAN into structured components. Returns null if malformed. */
function parseSAN(san: string): ParsedSAN | null {
  let s = san;

  // Promotion suffix: =Q or =N etc. (or just 'Q' for some exporters)
  let promo: PromotionPiece | null = null;
  const promoMatch = /=([NBRQ])$/i.exec(s);
  if (promoMatch) {
    promo = promoMatch[1]!.toLowerCase() as PromotionPiece;
    s = s.slice(0, -2);
  } else if (/[NBRQ]$/.test(s) && s.length > 2) {
    // Some exporters write e8Q without '='
    const last = s[s.length - 1]!;
    const lastLower = last.toLowerCase();
    // Only treat it as promotion if the 2nd-to-last char is a rank digit
    if (/[18]/.test(s[s.length - 2] ?? '')) {
      promo = lastLower as PromotionPiece;
      s = s.slice(0, -1);
    }
  }

  if (s.length < 2) return null;

  // Destination is always the last 2 chars
  const toStr = s.slice(-2);
  if (!/^[a-h][1-8]$/.test(toStr)) return null;
  const to = toStr as Square;

  let rest = s.slice(0, -2).replace('x', ''); // strip capture marker

  // Determine piece type
  let piece: PieceType;
  let fromFile: number | null = null;
  let fromRank: number | null = null;

  if (rest.length > 0 && /^[NBRQK]/.test(rest)) {
    // Non-pawn piece
    piece = rest[0]!.toLowerCase() as PieceType;
    const disambig = rest.slice(1);

    if (disambig.length === 2) {
      // Full: file + rank, e.g. "d1" in "Qd1f3"
      fromFile = disambig.charCodeAt(0) - 97;
      fromRank = parseInt(disambig[1]!, 10) - 1;
    } else if (disambig.length === 1) {
      const ch = disambig[0]!;
      if (/[a-h]/.test(ch)) {
        fromFile = ch.charCodeAt(0) - 97;
      } else if (/[1-8]/.test(ch)) {
        fromRank = parseInt(ch, 10) - 1;
      }
    }
  } else {
    // Pawn
    piece = 'p';
    if (rest.length === 1 && /[a-h]/.test(rest)) {
      // Capture from a specific file: "exd5" → fromFile = e
      fromFile = rest.charCodeAt(0) - 97;
    }
    // rest.length === 0: straight pawn push — no disambiguation needed
  }

  return { piece, fromFile, fromRank, to, promo };
}

/** Find the square of the piece that can legally make the described move. */
function findPiece(state: BoardState, parsed: ParsedSAN): Square | null {
  const color = state.sideToMove;
  const candidates: Square[] = [];

  for (const [sq, piece] of state.board) {
    if (piece.color !== color || piece.type !== parsed.piece) continue;

    // Disambiguation filter
    const [file, rank] = squareToCoords(sq);
    if (parsed.fromFile !== null && file !== parsed.fromFile) continue;
    if (parsed.fromRank !== null && rank !== parsed.fromRank) continue;

    if (canReach(state, sq, piece.type, color, parsed.to)) {
      candidates.push(sq);
    }
  }

  if (candidates.length === 1) return candidates[0]!;
  return null; // 0 = no legal move found; >1 = ambiguous (bad PGN)
}

/** Check whether a piece on `from` can reach `to` given the board state. */
function canReach(
  state: BoardState,
  from:  Square,
  pieceType: PieceType,
  color: Color,
  to:    Square
): boolean {
  if (pieceType === 'p') return canPawnReach(state, from, color, to);

  const piece   = state.board.get(from)!;
  const attacks = pieceAttacks(from, piece, state.board);
  if (!attacks.includes(to)) return false;

  // Can't capture own piece
  const target = state.board.get(to);
  return !target || target.color !== color;
}

/** Pawn movement logic (pushes + diagonal captures + en passant). */
function canPawnReach(
  state:  BoardState,
  from:   Square,
  color:  Color,
  to:     Square
): boolean {
  const [ff, fr] = squareToCoords(from);
  const [tf, tr] = squareToCoords(to);

  if (ff !== tf) {
    // Diagonal: must differ by exactly 1 file and 1 rank in the correct direction
    if (Math.abs(tf - ff) !== 1) return false;
    const dir = color === 'white' ? 1 : -1;
    if (tr !== fr + dir) return false;

    const target = state.board.get(to);
    const isEP   = state.enPassant === to;
    return (!!target && target.color !== color) || isEP;
  }

  // Straight push (same file)
  const dir = color === 'white' ? 1 : -1;
  const rankDiff = tr - fr;

  if (rankDiff === dir) {
    // Single push: destination must be empty
    return !state.board.has(to);
  }

  if (rankDiff === 2 * dir) {
    // Double push: pawn on starting rank; both intermediate and target empty
    const startRank = color === 'white' ? 1 : 6;
    if (fr !== startRank) return false;
    const mid = coordsToSquare(ff, fr + dir);
    return !!mid && !state.board.has(mid) && !state.board.has(to);
  }

  return false;
}
