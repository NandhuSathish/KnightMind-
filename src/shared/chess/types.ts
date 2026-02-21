// ─── Primitives ──────────────────────────────────────────────────────────────

export type Color = 'white' | 'black';

export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'n' | 'b' | 'r' | 'q';

export interface Piece {
  type: PieceType;
  color: Color;
}

// ─── Move ─────────────────────────────────────────────────────────────────────

export interface Move {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

/** e.g. "e2e4", "e7e8q" */
export type UCIMove = string;

export function moveToUCI(move: Move): UCIMove {
  return move.promotion
    ? `${move.from}${move.to}${move.promotion}`
    : `${move.from}${move.to}`;
}

export function uciToMove(uci: UCIMove): Move | null {
  const match = /^([a-h][1-8])([a-h][1-8])([nbrq]?)$/.exec(uci);
  if (!match) return null;
  const [, from, to, promo] = match;
  return {
    from: from as Square,
    to: to as Square,
    ...(promo ? { promotion: promo as PromotionPiece } : {}),
  };
}

// ─── Score ────────────────────────────────────────────────────────────────────

export type Centipawns = { readonly tag: 'cp'; readonly value: number };
export type MateIn = { readonly tag: 'mate'; readonly moves: number };
export type Score = Centipawns | MateIn;

export const cp = (value: number): Centipawns => ({ tag: 'cp', value });
export const mate = (moves: number): MateIn => ({ tag: 'mate', moves });

export function formatScore(score: Score): string {
  if (score.tag === 'mate') {
    return score.moves > 0 ? `M${score.moves}` : `-M${Math.abs(score.moves)}`;
  }
  const pawns = (score.value / 100).toFixed(2);
  return score.value >= 0 ? `+${pawns}` : pawns;
}

// ─── FEN Components ──────────────────────────────────────────────────────────

export type CastlingRights = string; // e.g. "KQkq", "-"

export interface FENComponents {
  pieces: string;         // piece placement field
  activeColor: Color;
  castling: CastlingRights;
  enPassant: Square | '-';
  halfmoveClock: number;
  fullmoveNumber: number;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

export interface PvLine {
  moves: Move[];
  score: Score;
  depth: number;
  multiPvIndex: number; // 1-based
}

// ─── Site / Variant ──────────────────────────────────────────────────────────

export type ChessSite = 'lichess' | 'chess-com';

export type ChessVariant =
  | 'standard'
  | 'chess960'
  | 'crazyhouse'
  | 'antichess'
  | 'atomic'
  | 'horde'
  | 'kingOfTheHill'
  | 'racingKings'
  | 'threeCheck';

// ─── Position Snapshot ───────────────────────────────────────────────────────

export type BoardContext = 'live' | 'analysis' | 'puzzle' | 'study' | 'unknown';

export interface PositionSnapshot {
  /** Full 6-field FEN. Accuracy varies by confidence level. */
  fen: string;
  /** Which color is at the bottom of the screen. */
  orientation: Color;
  boardContext: BoardContext;
  variant: ChessVariant;
  /**
   * 'full'    — JS API returned a complete, authoritative FEN.
   * 'partial' — piece placement accurate; other fields inferred or estimated.
   */
  confidence: 'full' | 'partial';
}
