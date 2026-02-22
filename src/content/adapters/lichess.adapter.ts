import type { BoardContext, ChessVariant, Color, Piece, PieceType, PositionSnapshot, Square } from '../../shared/chess/types.js';
import { piecePlacementFromMap, validateFEN } from '../../shared/chess/fen.js';
import { AdapterError, type IBoardAdapter } from './adapter.interface.js';

// ─── window.lichess type (module-private) ─────────────────────────────────────

interface LichessAnalysis {
  data?: {
    game?: {
      /** Full 6-field FEN for current position on analysis/study boards */
      fen?: string;
      /** Total half-moves played so far (parity → active color) */
      turns?: number;
      castles?: {
        K?: boolean; // white kingside
        Q?: boolean; // white queenside
        k?: boolean; // black kingside
        q?: boolean; // black queenside
      };
      variant?: { key?: string };
    };
  };
}

function getLichessAnalysis(doc: Document): LichessAnalysis | null {
  const win = doc.defaultView;
  if (!win) return null;
  const raw = (win as unknown as Record<string, unknown>)['lichess'];
  if (typeof raw !== 'object' || raw === null) return null;
  const api = raw as Record<string, unknown>;
  const analysis = api['analysis'];
  if (typeof analysis !== 'object' || analysis === null) return null;
  return analysis as LichessAnalysis;
}

// ─── Piece type map ───────────────────────────────────────────────────────────

const CLASS_TO_TYPE: Readonly<Record<string, PieceType>> = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p',
};

// ─── LichessAdapter ───────────────────────────────────────────────────────────

/**
 * Adapter for lichess.org
 *
 * Lichess uses chessground (cg-board custom element).
 * Pieces are children of cg-board with class "piece" and:
 *   - class:  e.g. "white king", "black pawn"
 *   - style:  "transform: translate(Xpx, Ypx)" for board position
 *
 * Extraction layers:
 *   1. window.lichess.analysis.data.game.fen  (full FEN — analysis/study)
 *   2. DOM piece reconstruction + move-list parity + castling inference
 */
export class LichessAdapter implements IBoardAdapter {
  readonly site = 'lichess' as const;

  private _document: Document | null = null;
  private _pieceObserver: MutationObserver | null = null;
  private _orientationObserver: MutationObserver | null = null;
  private readonly _listeners = new Set<(snapshot: PositionSnapshot) => void>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 150;

  // ─── Public lifecycle ───────────────────────────────────────────────────────

  attach(document: Document): void {
    this._document = document;
    this._pieceObserver = new MutationObserver(this._onMutation);

    const board = document.querySelector('cg-board');
    if (board) {
      this._pieceObserver.observe(board, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    } else {
      // Board not yet rendered — observe body until it appears
      this._pieceObserver.observe(document.body, {
        childList: true,
        subtree: false,
      });
    }

    // Separate observer for orientation (class on cg-wrap, not cg-board)
    const wrap = document.querySelector('cg-wrap');
    if (wrap) {
      this._orientationObserver = new MutationObserver(this._onMutation);
      this._orientationObserver.observe(wrap, {
        attributes: true,
        attributeFilter: ['class'],
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

    return this._tryLayer1(doc) ?? this._tryLayer2(doc, variant);
  }

  onPositionChange(callback: (snapshot: PositionSnapshot) => void): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  detach(): void {
    this._pieceObserver?.disconnect();
    this._orientationObserver?.disconnect();
    this._pieceObserver = null;
    this._orientationObserver = null;
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
    }, LichessAdapter.DEBOUNCE_MS);
  };

  // ─── Layer 1: JS state injection ────────────────────────────────────────────

  private _tryLayer1(doc: Document): PositionSnapshot | null {
    const game = getLichessAnalysis(doc)?.data?.game;
    if (!game?.fen || !validateFEN(game.fen)) return null;

    return {
      fen: game.fen,
      orientation: this._readOrientation(doc),
      boardContext: this._detectContext(doc),
      variant: this._readVariant(doc),
      confidence: 'full',
    };
  }

  // ─── Layer 2: DOM reconstruction ────────────────────────────────────────────

  private _tryLayer2(doc: Document, variant: ChessVariant): PositionSnapshot | null {
    const board = doc.querySelector('cg-board');
    if (!board) return null;

    const pieceMap = this._buildPieceMap(board, doc);
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

  private _buildPieceMap(board: Element, doc: Document): Map<Square, Piece> | null {
    const pieces = board.querySelectorAll<HTMLElement>('piece');
    if (pieces.length === 0) return null;

    const boardRect = (board as HTMLElement).getBoundingClientRect();
    const squareSize = boardRect.width / 8;
    if (squareSize === 0) return null;

    const isFlipped = this._readOrientation(doc) === 'black';
    const map = new Map<Square, Piece>();

    for (const el of pieces) {
      if (!el.classList.contains('white') && !el.classList.contains('black')) continue;
      const color: Color = el.classList.contains('white') ? 'white' : 'black';

      const type = this._classToType(el);
      if (!type) continue;

      const style = el.style.transform;
      const m = /translate\(([0-9.]+)px,\s*([0-9.]+)px\)/.exec(style);
      if (!m) continue;

      const px = parseFloat(m[1] ?? '0');
      const py = parseFloat(m[2] ?? '0');
      const fileIdx = isFlipped
        ? 7 - Math.round(px / squareSize)
        : Math.round(px / squareSize);
      const rankIdx = isFlipped
        ? Math.round(py / squareSize)
        : 7 - Math.round(py / squareSize);

      if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) continue;

      const fileChar = 'abcdefgh'[fileIdx];
      const rankChar = '12345678'[rankIdx];
      if (!fileChar || !rankChar) continue;

      map.set(`${fileChar}${rankChar}` as Square, { type, color });
    }

    return map.size > 0 ? map : null;
  }

  private _classToType(el: HTMLElement): PieceType | null {
    for (const [cls, type] of Object.entries(CLASS_TO_TYPE)) {
      if (el.classList.contains(cls)) return type;
    }
    return null;
  }

  private _readOrientation(doc: Document | null): Color {
    const wrap = doc?.querySelector('cg-wrap');
    return wrap?.classList.contains('orientation-black') ? 'black' : 'white';
  }

  private _inferActiveColor(doc: Document): Color {
    // Cover all page types: analysis/study (.tview2), old move list (.moves),
    // live game move list (.rmoves, l4x)
    const moves = doc.querySelectorAll('.tview2 move, .moves move, .rmoves move, l4x move');
    return moves.length % 2 === 0 ? 'white' : 'black';
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
    if (
      doc.querySelector('.puzzle__side') ||
      path.includes('/training') ||
      path.includes('/puzzle')
    ) return 'puzzle';
    if (doc.querySelector('.rclock')) return 'live';
    if (path.includes('/study')) return 'study';
    if (path.includes('/analysis') || doc.querySelector('.analyse__board')) return 'analysis';
    return 'unknown';
  }

  private _readVariant(doc: Document): ChessVariant {
    const path = doc.location?.pathname ?? '';
    if (path.includes('/chess960') || path.includes('/chess-960')) return 'chess960';
    if (path.includes('/crazyhouse')) return 'crazyhouse';
    if (path.includes('/antichess')) return 'antichess';
    if (path.includes('/atomic')) return 'atomic';
    if (path.includes('/horde')) return 'horde';
    if (path.includes('/kingOfTheHill') || path.includes('/king-of-the-hill')) return 'kingOfTheHill';
    if (path.includes('/racingKings') || path.includes('/racing-kings')) return 'racingKings';
    if (path.includes('/threeCheck') || path.includes('/three-check')) return 'threeCheck';
    return 'standard';
  }
}

