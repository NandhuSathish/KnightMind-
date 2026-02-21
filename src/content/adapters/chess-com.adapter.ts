import type { BoardContext, ChessVariant, Color, Piece, PieceType, PositionSnapshot, Square } from '../../shared/chess/types.js';
import { piecePlacementFromMap, validateFEN } from '../../shared/chess/fen.js';
import { AdapterError, type IBoardAdapter } from './adapter.interface.js';

// ─── chess-board internal game API (module-private) ──────────────────────────

interface ChessComGame {
  /** Full 6-field FEN when available; may be short-form or absent */
  fen?: string;
  /** Returns active color as a string */
  getTurn?: () => 'white' | 'black' | string;
}

function getChessComGame(doc: Document): ChessComGame | null {
  const el = doc.querySelector('chess-board');
  if (!el) return null;
  // 'game' is a React internal property — not a DOM attribute
  const game = (el as unknown as Record<string, unknown>)['game'];
  if (typeof game !== 'object' || game === null) return null;
  return game as ChessComGame;
}

// ─── Piece type map ───────────────────────────────────────────────────────────

// chess.com uses uppercase letters: K Q R B N P
const CHAR_TO_TYPE: Record<string, PieceType> = {
  K: 'k', Q: 'q', R: 'r', B: 'b', N: 'n', P: 'p',
};

// ─── ChessComAdapter ──────────────────────────────────────────────────────────

/**
 * Adapter for www.chess.com
 *
 * Chess.com renders a <chess-board> custom element via React.
 * Pieces carry semantic data attributes:
 *   - data-piece:  e.g. "wK", "bN"  (color + type)
 *   - data-square: e.g. "51"        (col 1–8, row 1–8)
 *
 * Extraction layers:
 *   1. (chess-board).game.fen  (full 6-field FEN via React internal)
 *   2. [data-piece][data-square] DOM reconstruction + turn inference
 */
export class ChessComAdapter implements IBoardAdapter {
  readonly site = 'chess-com' as const;

  private _document: Document | null = null;
  private _observer: MutationObserver | null = null;
  private readonly _listeners = new Set<(snapshot: PositionSnapshot) => void>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 150;

  // ─── Public lifecycle ───────────────────────────────────────────────────────

  attach(document: Document): void {
    this._document = document;
    this._observer = new MutationObserver(this._onMutation);

    const piecesLayer = this._findPiecesLayer(document);
    if (piecesLayer) {
      this._observer.observe(piecesLayer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'data-piece', 'data-square'],
      });
    } else {
      // Board not yet rendered — wait for it
      this._observer.observe(document.body, {
        childList: true,
        subtree: false,
      });
    }
  }

  getCurrentPosition(): PositionSnapshot | null {
    const doc = this._document;
    if (!doc) return null;

    const variant = this._readVariant(doc);
    if (variant === 'crazyhouse') {
      throw new AdapterError('VARIANT_UNSUPPORTED', 'Crazyhouse is not supported');
    }

    return this._tryLayer1(doc, variant) ?? this._tryLayer2(doc, variant);
  }

  onPositionChange(callback: (snapshot: PositionSnapshot) => void): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  detach(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._listeners.clear();
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._document = null;
  }

  // ─── Debounced mutation handler ─────────────────────────────────────────────

  private readonly _onMutation = (): void => {
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      const snapshot = this.getCurrentPosition();
      if (snapshot) {
        for (const cb of this._listeners) cb(snapshot);
      }
    }, ChessComAdapter.DEBOUNCE_MS);
  };

  // ─── Layer 1: JS state injection ────────────────────────────────────────────

  private _tryLayer1(doc: Document, variant: ChessVariant): PositionSnapshot | null {
    const rawFen = getChessComGame(doc)?.fen;
    if (!rawFen || !validateFEN(rawFen)) return null;

    return {
      fen: rawFen,
      orientation: this._readOrientation(doc),
      boardContext: this._detectContext(doc),
      variant,
      confidence: 'full',
    };
  }

  // ─── Layer 2: DOM reconstruction ────────────────────────────────────────────

  private _tryLayer2(doc: Document, variant: ChessVariant): PositionSnapshot | null {
    const board = doc.querySelector('chess-board');
    if (!board) return null;

    const pieceMap = this._buildPieceMap(board);
    if (!pieceMap) return null;

    const placement = piecePlacementFromMap(pieceMap);
    const activeColor = this._inferActiveColor(doc);
    const castling = this._inferCastling(pieceMap);
    const colorChar = activeColor === 'white' ? 'w' : 'b';
    const fen = `${placement} ${colorChar} ${castling} - 0 1`;

    if (!validateFEN(fen)) return null;

    return {
      fen,
      orientation: this._readOrientation(doc),
      boardContext: this._detectContext(doc),
      variant,
      confidence: 'partial',
    };
  }

  // ─── DOM helpers ────────────────────────────────────────────────────────────

  private _findPiecesLayer(doc: Document): Element | null {
    return (
      doc.querySelector('chess-board .pieces') ??
      doc.querySelector('chess-board [class*="pieces"]') ??
      doc.querySelector('chess-board') ??
      null
    );
  }

  private _buildPieceMap(board: Element): Map<Square, Piece> | null {
    const els = board.querySelectorAll<HTMLElement>('[data-piece][data-square]');
    if (els.length === 0) return null;

    const map = new Map<Square, Piece>();

    for (const el of els) {
      const pieceAttr = el.dataset['piece'];   // e.g. "wK"
      const sqAttr    = el.dataset['square'];  // e.g. "51" = e1
      if (!pieceAttr || !sqAttr) continue;

      const colorChar = pieceAttr[0];  // 'w' or 'b'
      const typeChar  = pieceAttr[1];  // e.g. 'K'
      if (!colorChar || !typeChar) continue;

      const color: Color = colorChar === 'w' ? 'white' : 'black';

      // CHAR_TO_TYPE has string index — noUncheckedIndexedAccess returns PieceType | undefined
      const type = CHAR_TO_TYPE[typeChar.toUpperCase()];
      if (!type) continue;

      // data-square: col(1–8) + row(1–8), e.g. "51" = col 5 = e-file, row 1
      const col = parseInt(sqAttr[0] ?? '0', 10);
      const row = parseInt(sqAttr[1] ?? '0', 10);
      if (col < 1 || col > 8 || row < 1 || row > 8) continue;

      const fileChar = 'abcdefgh'[col - 1];
      if (!fileChar) continue;

      map.set(`${fileChar}${row}` as Square, { type, color });
    }

    return map.size > 0 ? map : null;
  }

  private _readOrientation(doc: Document): Color {
    const board = doc.querySelector('chess-board');
    if (!board) return 'white';
    return board.classList.contains('flipped') || board.hasAttribute('flipped')
      ? 'black'
      : 'white';
  }

  private _inferActiveColor(doc: Document): Color {
    const turn = getChessComGame(doc)?.getTurn?.();
    if (turn === 'white' || turn === 'black') return turn;
    return 'white'; // conservative default
  }

  private _inferCastling(map: ReadonlyMap<Square, Piece>): string {
    let rights = '';
    const we1 = map.get('e1');
    const be8 = map.get('e8');
    if (we1?.type === 'k' && we1.color === 'white') {
      const h1 = map.get('h1');
      const a1 = map.get('a1');
      if (h1?.type === 'r' && h1.color === 'white') rights += 'K';
      if (a1?.type === 'r' && a1.color === 'white') rights += 'Q';
    }
    if (be8?.type === 'k' && be8.color === 'black') {
      const h8 = map.get('h8');
      const a8 = map.get('a8');
      if (h8?.type === 'r' && h8.color === 'black') rights += 'k';
      if (a8?.type === 'r' && a8.color === 'black') rights += 'q';
    }
    return rights || '-';
  }

  private _detectContext(doc: Document): BoardContext {
    const path = doc.location?.pathname ?? '';
    if (path.startsWith('/puzzles')) return 'puzzle';
    if (path.startsWith('/game/live') || path.startsWith('/live')) return 'live';
    if (path.startsWith('/analysis')) return 'analysis';
    if (path.startsWith('/study')) return 'study';
    // DOM fallback for live context
    if (
      doc.querySelector('[class*="clock"]') &&
      doc.querySelector('[class*="game-controls"]')
    ) return 'live';
    return 'unknown';
  }

  private _readVariant(doc: Document): ChessVariant {
    const path = doc.location?.pathname ?? '';
    if (path.includes('/chess960') || path.includes('/x-chess')) return 'chess960';
    if (path.includes('/crazyhouse')) return 'crazyhouse';
    if (path.includes('/antichess') || path.includes('/anti')) return 'antichess';
    if (path.includes('/atomic')) return 'atomic';
    if (path.includes('/horde')) return 'horde';
    if (path.includes('/king-of-the-hill') || path.includes('/koth')) return 'kingOfTheHill';
    if (path.includes('/racing-kings') || path.includes('/racing')) return 'racingKings';
    if (path.includes('/three-check') || path.includes('/threecheck')) return 'threeCheck';
    return 'standard';
  }
}
