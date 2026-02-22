import type { BoardContext, ChessVariant, Color, Piece, PieceType, PositionSnapshot, Square } from '../../shared/chess/types.js';
import { piecePlacementFromMap, validateFEN, fenActiveColor } from '../../shared/chess/fen.js';
import { AdapterError, type IBoardAdapter } from './adapter.interface.js';

// ─── chess-board internal game API (module-private) ──────────────────────────

interface ChessComGame {
  /** Full 6-field FEN when available; may be short-form or absent */
  fen?: string;
  /** Returns active color as a string */
  getTurn?: () => 'white' | 'black' | string;
}

/**
 * Reads the game object from chess-board.
 *
 * Tries three access paths in order:
 *  1. Direct `el.game` property (Web Component internal state)
 *  2. React 17+ fiber props under `__reactProps$*` key
 *  3. Legacy React fiber under `__reactFiber$*` → memoizedProps
 */
function getChessComGame(doc: Document): ChessComGame | null {
  const el = doc.querySelector('wc-chess-board');
  if (!el) return null;

  const elRecord = el as unknown as Record<string, unknown>;

  // Path 1: direct DOM property
  const direct = elRecord['game'];
  if (isGameLike(direct)) return direct as ChessComGame;

  // Path 2: React 17+ __reactProps$xxxx
  const propsKey = Object.keys(elRecord).find(k => k.startsWith('__reactProps$'));
  if (propsKey) {
    const props = elRecord[propsKey];
    if (typeof props === 'object' && props !== null) {
      const game = (props as Record<string, unknown>)['game'];
      if (isGameLike(game)) return game as ChessComGame;
    }
  }

  // Path 3: React 16 __reactFiber$xxxx → memoizedProps
  const fiberKey = Object.keys(elRecord).find(k => k.startsWith('__reactFiber$'));
  if (fiberKey) {
    const fiber = elRecord[fiberKey] as Record<string, unknown> | null | undefined;
    const memoized = fiber?.['memoizedProps'];
    if (typeof memoized === 'object' && memoized !== null) {
      const game = (memoized as Record<string, unknown>)['game'];
      if (isGameLike(game)) return game as ChessComGame;
    }
  }

  return null;
}

function isGameLike(val: unknown): boolean {
  return typeof val === 'object' && val !== null;
}

// ─── Piece type map ───────────────────────────────────────────────────────────

// chess.com uses uppercase letters for CHAR_TO_TYPE lookup
const CHAR_TO_TYPE: Record<string, PieceType> = {
  K: 'k', Q: 'q', R: 'r', B: 'b', N: 'n', P: 'p',
};

// ─── ChessComAdapter ──────────────────────────────────────────────────────────

/**
 * Adapter for www.chess.com
 *
 * Chess.com renders a <chess-board> custom element via React.
 * Pieces are rendered as divs with CSS classes:
 *   - Color+type: "wp" (white pawn), "bk" (black king), etc.
 *   - Square:     "square-XY" where X=file(1–8=a–h), Y=rank(1–8)
 *
 * Some older/API game modes additionally set data attributes:
 *   - data-piece:  e.g. "wK", "bN"
 *   - data-square: e.g. "51"
 *
 * Extraction layers:
 *   1. (chess-board).game.fen  (full 6-field FEN via React / Web Component prop)
 *   2. CSS-class DOM reconstruction (primary), data-attribute (fallback)
 *
 * Shadow DOM is handled: if chess-board exposes an open shadowRoot,
 * queries and MutationObserver target the shadow root instead.
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
      // Board not yet rendered — watch until wc-chess-board appears (subtree: true for SPA)
      this._observer.observe(document.body, {
        childList: true,
        subtree: true,
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
    const board = doc.querySelector('wc-chess-board');
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

  /**
   * Returns the best subtree to observe for piece mutations.
   * Checks for open Shadow DOM, then falls back to light-DOM .pieces container.
   */
  private _findPiecesLayer(doc: Document): Element | ShadowRoot | null {
    const board = doc.querySelector('wc-chess-board');
    if (!board) return null;

    // Prefer shadow root (open) so we observe the actual render surface
    const shadow = (board as HTMLElement).shadowRoot;
    if (shadow) return shadow;

    return (
      board.querySelector('.pieces') ??
      board.querySelector('[class*="pieces"]') ??
      board
    );
  }

  /**
   * Builds the piece map from the chess-board element.
   *
   * Tries (in order):
   *  A. Shadow DOM + CSS classes
   *  B. Shadow DOM + data attributes
   *  C. Light DOM + CSS classes   (primary for current chess.com)
   *  D. Light DOM + data attributes
   */
  private _buildPieceMap(board: Element): Map<Square, Piece> | null {
    const shadow = (board as HTMLElement).shadowRoot;
    const roots: (Element | ShadowRoot)[] = shadow ? [shadow, board] : [board];

    for (const root of roots) {
      // CSS-class notation: <div class="piece wn square-71">
      const byClass = root.querySelectorAll<HTMLElement>('.piece[class*="square-"]');
      if (byClass.length > 0) {
        const map = this._parseByClass(byClass);
        if (map) return map;
      }

      // Data-attribute notation: <div data-piece="wN" data-square="71">
      const byAttr = root.querySelectorAll<HTMLElement>('[data-piece][data-square]');
      if (byAttr.length > 0) {
        const map = this._parseByDataAttr(byAttr);
        if (map) return map;
      }
    }

    return null;
  }

  /**
   * Parses pieces encoded as CSS classes.
   * Class format: "piece [wb][kqrbnp] square-XY [...]"
   *   - X = file 1–8 (a–h), Y = rank 1–8
   */
  private _parseByClass(els: NodeListOf<HTMLElement>): Map<Square, Piece> | null {
    const map = new Map<Square, Piece>();

    for (const el of els) {
      // Find the color+type token: exactly 2 chars, w/b + piece letter
      let colorChar: string | undefined;
      let typeChar:  string | undefined;
      let col = 0, row = 0;

      for (const cls of el.classList) {
        if (cls.length === 2 && /^[wb][kqrbnpKQRBNP]$/.test(cls)) {
          colorChar = cls[0];
          typeChar  = cls[1];
        }
        if (/^square-[1-8][1-8]$/.test(cls)) {
          col = parseInt(cls[7] ?? '0', 10); // "square-XY"[7] = X
          row = parseInt(cls[8] ?? '0', 10); // "square-XY"[8] = Y
        }
      }

      if (!colorChar || !typeChar) continue;
      if (col < 1 || col > 8 || row < 1 || row > 8) continue;

      const color: Color = colorChar === 'w' ? 'white' : 'black';
      const type = CHAR_TO_TYPE[typeChar.toUpperCase()];
      if (!type) continue;

      const fileChar = 'abcdefgh'[col - 1];
      if (!fileChar) continue;

      map.set(`${fileChar}${row}` as Square, { type, color });
    }

    return map.size > 0 ? map : null;
  }

  /**
   * Parses pieces encoded as data attributes.
   * data-piece="wK"  →  white king
   * data-square="51" →  col 5 = e-file, row 1
   */
  private _parseByDataAttr(els: NodeListOf<HTMLElement>): Map<Square, Piece> | null {
    const map = new Map<Square, Piece>();

    for (const el of els) {
      const pieceAttr = el.dataset['piece'];   // e.g. "wK"
      const sqAttr    = el.dataset['square'];  // e.g. "51"
      if (!pieceAttr || !sqAttr) continue;

      const colorChar = pieceAttr[0];
      const typeChar  = pieceAttr[1];
      if (!colorChar || !typeChar) continue;

      const color: Color = colorChar === 'w' ? 'white' : 'black';
      const type = CHAR_TO_TYPE[typeChar.toUpperCase()];
      if (!type) continue;

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
    const board = doc.querySelector('wc-chess-board');
    if (!board) return 'white';
    // Flipped attribute or class signals black-at-bottom
    return board.classList.contains('flipped') || board.hasAttribute('flipped')
      ? 'black'
      : 'white';
  }

  private _inferActiveColor(doc: Document): Color {
    // 1. JS API — most reliable
    const game = getChessComGame(doc);
    const turn = game?.getTurn?.();
    if (turn === 'white' || turn === 'black') return turn;

    // 2. Parse active color from game.fen (present but getTurn() absent)
    const rawFen = game?.fen;
    if (rawFen) {
      const c = fenActiveColor(rawFen);
      if (c) return c;
    }

    // 3. Count half-moves via data-ply in chess.com move-list web components
    for (const sel of ['wc-simple-move-list', 'vertical-move-list']) {
      const listEl = doc.querySelector(sel);
      if (!listEl) continue;
      const plies = listEl.querySelectorAll('[data-ply]');
      if (plies.length > 0) {
        const last = plies[plies.length - 1];
        const ply = parseInt(last?.getAttribute('data-ply') ?? '', 10);
        if (!isNaN(ply)) return ply % 2 === 0 ? 'white' : 'black';
      }
    }

    return 'white';
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
    if (path.startsWith('/play')) return 'live';
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
