import type { Color } from '../chess/types.js';
import { fenPositionKey, fenActiveColor } from '../chess/fen.js';
import { parsePGN } from './pgn-parser.js';
import { saveRepertoire, loadRepertoire, clearRepertoire } from './storage.js';
import type {
  AnalyzePositionResult,
  PGNLoadResult,
  RepertoireIndex,
  RepertoireMetadata,
} from './types.js';

// ─── RepertoireEngine ─────────────────────────────────────────────────────────
//
// Manages two independent opening repertoires — one for White and one for Black.
//
// How the dual-repertoire design works
// ─────────────────────────────────────
// Each color's repertoire is an independent flat Map<fenKey, RepertoireEntry>.
// On analyzePosition(fen, mode):
//   1. Extract the active side from the FEN (field 2: 'w' or 'b').
//   2. Look up that side's Map.
//   3. Return the matching entry, or signal 'engine' / 'none' appropriately.
//
// This means the engine never needs to know who "the user" is — it answers for
// whichever color is about to move, and the caller decides whether to show it.
//
// Lifecycle
// ──────────
//  1. SW start:     await repertoireEngine.restore()              — loads both colors from IDB.
//  2. Popup upload: await repertoireEngine.load(pgn, color, fn)   — parses and stores one color.
//  3. Each position: repertoireEngine.analyzePosition(fen, mode)  — O(1), synchronous.
//  4. Popup clear:  await repertoireEngine.clear(color)           — clears one color only.

interface ColorSlot {
  index: RepertoireIndex;
  meta:  RepertoireMetadata;
}

export class RepertoireEngine {
  private _white:  ColorSlot | null = null;
  private _black:  ColorSlot | null = null;
  private _enabled = false;

  // ─── Load ──────────────────────────────────────────────────────────────────

  /**
   * Parse a PGN and store the resulting index for `playerColor`.
   * The opposite color's repertoire is completely unaffected.
   */
  async load(
    pgn:         string,
    playerColor: Color,
    filename?:   string,
  ): Promise<PGNLoadResult> {
    const { index, errors } = parsePGN(pgn, playerColor);

    let moveCount = 0;
    for (const entry of index.values()) moveCount += entry.moves.length;

    let metadata: RepertoireMetadata;
    if (filename !== undefined) {
      metadata = {
        playerColor,
        positionCount: index.size,
        moveCount,
        loadedAt: Date.now(),
        sourceFilename: filename,
      };
    } else {
      metadata = {
        playerColor,
        positionCount: index.size,
        moveCount,
        loadedAt: Date.now(),
      };
    }

    const slot: ColorSlot = { index, meta: metadata };
    if (playerColor === 'white') {
      this._white = slot;
    } else {
      this._black = slot;
    }
    this._enabled = true;

    // Persist to IndexedDB before returning so the SW can't be killed between
    // sendResponse and the write. The caller awaits this result anyway.
    await saveRepertoire(index, metadata, playerColor).catch((err: unknown) => {
      console.warn('[KnightMind] Failed to persist repertoire to IndexedDB:', err);
    });

    return { success: true, metadata, errors };
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  /**
   * Reload both color repertoires from IndexedDB.
   * Called at SW startup so analyzePosition() works immediately after wake.
   * Returns true if at least one color was found in storage.
   */
  async restore(): Promise<boolean> {
    const [white, black] = await Promise.all([
      loadRepertoire('white'),
      loadRepertoire('black'),
    ]);

    if (white) this._white = { index: white.index, meta: white.meta };
    if (black) this._black = { index: black.index, meta: black.meta };

    const found = !!(white ?? black);
    if (found) this._enabled = true;
    return found;
  }

  /**
   * Clear a single color's in-memory slot and its IDB record.
   * The other color is completely untouched.
   */
  async clear(color: Color): Promise<void> {
    if (color === 'white') {
      this._white = null;
    } else {
      this._black = null;
    }
    // Only fully disable when both slots are empty.
    if (!this._white && !this._black) this._enabled = false;
    await clearRepertoire(color);
  }

  // ─── analyzePosition ───────────────────────────────────────────────────────

  /**
   * O(1) synchronous lookup — the primary public API.
   *
   * @param fen  — the current board position as a FEN string
   * @param mode — 'book':   use repertoire when available, fallback to engine;
   *               'engine': skip repertoire entirely, always return source='engine'
   *
   * How to interpret the result
   * ────────────────────────────
   * source === 'book'   → suggestedMoves has the prepared replies; show them to the user.
   * source === 'engine' → position is out of book (or mode forced engine);
   *                       the caller should surface the Stockfish result instead.
   * source === 'none'   → no repertoire loaded for this color; same engine fallback.
   *
   * Player-side gating
   * ────────────────────
   * `playerSide` is the color the user has declared they are playing in this game
   * (selected in the popup). When it is NOT the user's turn (`activeSide !== playerSide`),
   * we return `source:'none'` immediately — no book moves for the opponent's turn.
   * This prevents accidentally showing the Black repertoire when the user is White
   * (or vice-versa) even if both slots are populated.
   */
  analyzePosition(
    fen:        string,
    mode:       'book' | 'engine',
    playerSide: 'white' | 'black',
  ): AnalyzePositionResult {
    const activeSide: Color = fenActiveColor(fen) === 'white' ? 'white' : 'black';
    const bookDepth = parseInt(fen.split(' ')[5] ?? '1', 10) || 1;

    if (mode === 'engine' || !this._enabled) {
      return { source: 'engine', inBook: false, reenteredBook: false, opponentDeviated: false, suggestedMoves: [], color: activeSide, bookDepth };
    }

    // Not the user's turn — tell the panel what state we're in.
    if (activeSide !== playerSide) {
      const ourSlot = playerSide === 'white' ? this._white : this._black;
      if (ourSlot) {
        // Book is loaded, just waiting for the opponent to move.
        return {
          source:           'opponent_turn',
          inBook:           false,
          reenteredBook:    false,
          opponentDeviated: false,
          suggestedMoves:   [],
          color:            activeSide,
          bookDepth,
          ...(ourSlot.meta.sourceFilename !== undefined
            ? { bookName: ourSlot.meta.sourceFilename } : {}),
        };
      }
      return { source: 'none', inBook: false, reenteredBook: false, opponentDeviated: false, suggestedMoves: [], color: activeSide, bookDepth };
    }

    const slot = activeSide === 'white' ? this._white : this._black;
    if (!slot) {
      // No repertoire loaded for this color yet.
      return { source: 'none', inBook: false, reenteredBook: false, opponentDeviated: false, suggestedMoves: [], color: activeSide, bookDepth };
    }

    const entry = slot.index.get(fenPositionKey(fen));
    const bookNameSpread = slot.meta.sourceFilename !== undefined
      ? { bookName: slot.meta.sourceFilename } : {};

    if (!entry || entry.moves.length === 0) {
      // Position is not in any line — out of book; caller falls back to engine.
      return { source: 'engine', inBook: false, reenteredBook: false, opponentDeviated: false, suggestedMoves: [], color: activeSide, bookDepth, ...bookNameSpread };
    }

    return {
      source:           'book',
      inBook:           true,
      reenteredBook:    false,    // set by the SW if the previous user turn was out of book
      opponentDeviated: false,    // set by the SW based on per-tab history
      suggestedMoves:   entry.moves,
      color:            activeSide,
      bookDepth,
      ...(entry.lineName !== undefined ? { lineName: entry.lineName } : {}),
      ...(entry.ecoCode  !== undefined ? { ecoCode:  entry.ecoCode  } : {}),
      ...bookNameSpread,
    };
  }

  // ─── Toggle ────────────────────────────────────────────────────────────────

  enable():    void { this._enabled = true; }
  disable():   void { this._enabled = false; }
  isEnabled(): boolean { return this._enabled; }

  // ─── Metadata accessors (for popup display) ────────────────────────────────

  get whiteMetadata(): RepertoireMetadata | null { return this._white?.meta ?? null; }
  get blackMetadata(): RepertoireMetadata | null { return this._black?.meta ?? null; }
}

export const repertoireEngine = new RepertoireEngine();
