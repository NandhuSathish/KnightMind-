import type { BoardContext, ChessSite, Color } from '../chess/types.js';
import type { RawPvLine, RawScore } from '../engine/types.js';

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
  | { type: 'PING' };

// ─── Service Worker → Content Script ─────────────────────────────────────────

export type SWToContent =
  | { type: 'COACHING_HINT'; hint: CoachingHint }
  | { type: 'ENGINE_READY' }
  | { type: 'ENGINE_UNAVAILABLE'; reason: string }
  | { type: 'PONG' };

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

export type OffscreenToSW =
  | { type: 'ANALYSIS_RESULT'; fen: string; lines: readonly RawPvLine[] }
  | { type: 'ENGINE_READY' }
  | { type: 'ENGINE_CRASHED'; error: string };

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
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isContentToSW(msg: unknown): msg is ContentToSW {
  return isRecord(msg) && typeof msg['type'] === 'string' && (
    msg['type'] === 'POSITION_CHANGED' ||
    msg['type'] === 'GAME_STARTED' ||
    msg['type'] === 'GAME_ENDED' ||
    msg['type'] === 'PING'
  );
}

export function isSWToContent(msg: unknown): msg is SWToContent {
  return isRecord(msg) && typeof msg['type'] === 'string' && (
    msg['type'] === 'COACHING_HINT' ||
    msg['type'] === 'ENGINE_READY' ||
    msg['type'] === 'ENGINE_UNAVAILABLE' ||
    msg['type'] === 'PONG'
  );
}

export function isOffscreenToSW(msg: unknown): msg is OffscreenToSW {
  return isRecord(msg) && typeof msg['type'] === 'string' && (
    msg['type'] === 'ANALYSIS_RESULT' ||
    msg['type'] === 'ENGINE_READY' ||
    msg['type'] === 'ENGINE_CRASHED'
  );
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
