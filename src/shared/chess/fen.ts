import type { Color, FENComponents, Piece, PieceType, Square } from './types.js';

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Parses a FEN string into its components. Returns null if malformed. */
export function parseFEN(fen: string): FENComponents | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) return null;

  const [pieces, activeRaw, castling, enPassantRaw, halfRaw, fullRaw] = parts;

  if (!pieces || !activeRaw || !castling || !enPassantRaw || !halfRaw || !fullRaw) {
    return null;
  }

  if (activeRaw !== 'w' && activeRaw !== 'b') return null;

  const halfmoveClock = parseInt(halfRaw, 10);
  const fullmoveNumber = parseInt(fullRaw, 10);
  if (isNaN(halfmoveClock) || isNaN(fullmoveNumber)) return null;

  const enPassant = enPassantRaw === '-'
    ? '-'
    : isValidSquare(enPassantRaw) ? (enPassantRaw as Square) : null;

  if (enPassant === null) return null;

  return {
    pieces,
    activeColor: activeRaw === 'w' ? 'white' : 'black',
    castling,
    enPassant,
    halfmoveClock,
    fullmoveNumber,
  };
}

/** Serializes FEN components back to a FEN string. */
export function serializeFEN(components: FENComponents): string {
  const color = components.activeColor === 'white' ? 'w' : 'b';
  return [
    components.pieces,
    color,
    components.castling,
    components.enPassant,
    components.halfmoveClock,
    components.fullmoveNumber,
  ].join(' ');
}

/** Validates a FEN string without full parsing overhead. */
export function validateFEN(fen: string): boolean {
  const components = parseFEN(fen);
  if (!components) return false;

  // Validate piece placement: 8 ranks separated by '/'
  const ranks = components.pieces.split('/');
  if (ranks.length !== 8) return false;

  for (const rank of ranks) {
    let count = 0;
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        count += parseInt(ch, 10);
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        count += 1;
      } else {
        return false;
      }
    }
    if (count !== 8) return false;
  }

  return true;
}

/** Returns a stable hash of the position (pieces + active color + castling + ep).
 *  Ignores clock counters — suitable for deduplication. */
export function fenPositionKey(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  // First 4 fields identify the position uniquely for analysis purposes
  return parts.slice(0, 4).join(' ');
}

/** Returns the active color from a FEN string without full parse. */
export function fenActiveColor(fen: string): Color | null {
  const parts = fen.trim().split(/\s+/);
  if (parts[1] === 'w') return 'white';
  if (parts[1] === 'b') return 'black';
  return null;
}

function isValidSquare(s: string): boolean {
  return /^[a-h][1-8]$/.test(s);
}

/**
 * Builds the FEN piece-placement field (field 1) from a typed square→piece map.
 * Iterates ranks 8→1, files a→h. Run-length encodes consecutive empty squares.
 */
export function piecePlacementFromMap(map: ReadonlyMap<Square, Piece>): string {
  const CHAR: Record<PieceType, string> = {
    k: 'k', q: 'q', r: 'r', b: 'b', n: 'n', p: 'p',
  };
  const ranks: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let rank = '';
    let empty = 0;
    for (const f of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
      const piece = map.get(`${f}${r}` as Square);
      if (piece) {
        if (empty) { rank += empty; empty = 0; }
        const ch = CHAR[piece.type];
        rank += piece.color === 'white' ? ch.toUpperCase() : ch;
      } else {
        empty++;
      }
    }
    if (empty) rank += empty;
    ranks.push(rank);
  }
  return ranks.join('/');
}
