import type { BoardContext, ChessSite, Color } from '../chess/types.js';
import type { RawPvLine, RawScore } from '../engine/types.js';
import type { CoachingHints } from '../coaching/index.js';
import type { PunishmentResult } from '../coaching/blunder-punisher.js';
import type { MoveQualityResult } from '../coaching/move-quality.js';
import type { AnalyzePositionResult, PGNLoadResult, RepertoireMetadata } from '../repertoire/types.js';
import type { CCTResult } from '../cct/types.js';

export type { AnalyzePositionResult, PGNLoadResult, RepertoireMetadata };

/** Response payload for QUERY_REPERTOIRE. */
export interface RepertoireStatusResponse {
    white: RepertoireMetadata | null;
    black: RepertoireMetadata | null;
}

// ─── Content Script → Service Worker ─────────────────────────────────────────

export type ContentToSW =
    | {
          type: 'POSITION_CHANGED';
          fen: string;
          orientation: Color;
          boardContext: BoardContext;
          /** Populated by SW from sender.tab.id — not set by content script */
          tabId?: number;
      }
    | { type: 'GAME_STARTED'; site: ChessSite; tabId?: number }
    | { type: 'GAME_ENDED'; tabId?: number }
    | { type: 'PING' }
    | { type: 'LOAD_REPERTOIRE'; pgn: string; playerColor: Color; filename?: string }
    | { type: 'CLEAR_REPERTOIRE'; color: Color }
    | { type: 'QUERY_REPERTOIRE' };

// ─── Service Worker → Content Script ─────────────────────────────────────────

export type SWToContent = { type: 'COACHING_HINT'; hint: CoachingHint } | { type: 'ENGINE_READY' } | { type: 'ENGINE_UNAVAILABLE'; reason: string } | { type: 'PONG' };

// ─── Service Worker → Offscreen Document ─────────────────────────────────────

export type SWToOffscreen =
    | {
          type: 'ANALYZE';
          fen: string;
          depth: number;
          multiPv: number;
          movetime: number;
      }
    | { type: 'STOP_ANALYSIS' }
    | { type: 'ENGINE_INIT' };

// ─── Offscreen Document → Service Worker ─────────────────────────────────────

export type OffscreenToSW = { type: 'ANALYSIS_RESULT'; fen: string; lines: readonly RawPvLine[] } | { type: 'ENGINE_READY' } | { type: 'ENGINE_CRASHED'; error: string };

// ─── Union of all messages crossing the chrome.runtime boundary ──────────────

export type ExtensionMessage = ContentToSW | SWToContent | SWToOffscreen | OffscreenToSW;

// ─── Domain ──────────────────────────────────────────────────────────────────

export interface CoachingHint {
    /** Best move in UCI notation, e.g. "e2e4" — shown after hintDelayMs */
    bestMove: string;
    evaluation: RawScore;
    pvLines: readonly RawPvLine[];
    /** Human-readable theme hint derived from the position */
    themeSuggestion: string | null;
    depth: number;
    /** Structured coaching hints by category; null if FEN was unavailable */
    coaching: CoachingHints | null;
    /** Repertoire analysis for this position; null when no repertoire loaded */
    repertoire: AnalyzePositionResult | null;
    /**
     * Human-style punishment recommendation when opponent just blundered.
     * null when no significant eval swing was detected or on the very first position.
     */
    punishment: PunishmentResult | null;
    /**
     * Quality grade for the user's most recent move.
     * Set only when it is now the opponent's turn (user just moved).
     * null on the user's own turn or before the first move.
     */
    myMoveQuality: MoveQualityResult | null;
    /**
     * CCT (Checks → Captures → Threats) classification of all forcing moves in
     * the current position, scored from the side-to-move's perspective.
     * null when classification is unavailable (e.g. invalid FEN, no legal moves).
     */
    cctMoves: CCTResult | null;
}

export type { PunishmentResult, MoveQualityResult, CCTResult };

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isContentToSW(msg: unknown): msg is ContentToSW {
    return (
        isRecord(msg) &&
        typeof msg['type'] === 'string' &&
        (msg['type'] === 'POSITION_CHANGED' ||
            msg['type'] === 'GAME_STARTED' ||
            msg['type'] === 'GAME_ENDED' ||
            msg['type'] === 'PING' ||
            msg['type'] === 'LOAD_REPERTOIRE' ||
            msg['type'] === 'CLEAR_REPERTOIRE' ||
            msg['type'] === 'QUERY_REPERTOIRE')
    );
}

export function isSWToContent(msg: unknown): msg is SWToContent {
    return (
        isRecord(msg) &&
        typeof msg['type'] === 'string' &&
        (msg['type'] === 'COACHING_HINT' || msg['type'] === 'ENGINE_READY' || msg['type'] === 'ENGINE_UNAVAILABLE' || msg['type'] === 'PONG')
    );
}

export function isOffscreenToSW(msg: unknown): msg is OffscreenToSW {
    return isRecord(msg) && typeof msg['type'] === 'string' && (msg['type'] === 'ANALYSIS_RESULT' || msg['type'] === 'ENGINE_READY' || msg['type'] === 'ENGINE_CRASHED');
}

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}
