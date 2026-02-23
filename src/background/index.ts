import { ensureOffscreenDocument, closeOffscreenDocument } from './offscreen-manager.js';
import { requestAnalysis, stopAnalysis, initEngine, parseOffscreenMessage } from './engine-relay.js';
import { TabRegistry } from './tab-registry.js';
import { isContentToSW } from '../shared/messages/protocol.js';
import type { SWToContent, ContentToSW, CoachingHint } from '../shared/messages/protocol.js';
import { fenPositionKey, fenActiveColor } from '../shared/chess/fen.js';
import { getSettings } from '../shared/storage/client.js';
import type { RawPvLine } from '../shared/engine/types.js';
import { hintGenerator } from '../shared/coaching/index.js';
import type { DifficultyLevel } from '../shared/coaching/index.js';
import { detectOpponentBlunder } from '../shared/coaching/blunder-punisher.js';
import { assessUserMove } from '../shared/coaching/move-quality.js';
import { repertoireEngine } from '../shared/repertoire/index.js';
import type { PGNLoadResult } from '../shared/repertoire/index.js';

const registry = new TabRegistry();

// ─── Lazy restore ─────────────────────────────────────────────────────────────
// MV3 service workers are ephemeral and can be killed + restarted at any time.
// onInstalled / onStartup do NOT fire on every wakeup, so we restore the
// in-memory repertoire from IndexedDB on the first message of each SW lifetime.

let _restorePromise: Promise<void> | null = null;
function ensureRepertoireRestored(): Promise<void> {
  return (_restorePromise ??= repertoireEngine.restore().then(() => {}, () => {}));
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await ensureOffscreenDocument();
  await initEngine();
  await repertoireEngine.restore().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureOffscreenDocument();
  await initEngine();
  await repertoireEngine.restore().catch(() => undefined);
});

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
    // We handle async responses — must return true to keep the channel open
    void handleMessage(message, sender, sendResponse);
    return true;
  }
);

async function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: unknown) => void
): Promise<void> {
  // Restore repertoire from IndexedDB if this is the first message after SW wakeup.
  await ensureRepertoireRestored();

  // ── From offscreen document ──────────────────────────────────────────────
  const offscreenMsg = parseOffscreenMessage(message, sender);
  if (offscreenMsg) {
    switch (offscreenMsg.type) {
      case 'ENGINE_READY':
        registry.evictStale();
        break;

      case 'ENGINE_CRASHED':
        console.error('[KnightMind][SW] Engine crashed:', offscreenMsg.error);
        // Attempt recovery: recreate offscreen doc and re-init
        await closeOffscreenDocument();
        await ensureOffscreenDocument();
        await initEngine();
        break;

      case 'ANALYSIS_RESULT': {
        const { fen, lines } = offscreenMsg;
        const settings = await getSettings();
        // Build the base hint (same for all tabs on this position)
        const baseHint = buildBaseHint(lines, fen, settings.difficulty, settings.repertoireMode, settings.playerSide);
        // Broadcast with per-tab punishment computation and eval advancement
        await broadcastToTabs(fen, lines, baseHint, settings.playerSide);
        break;
      }
    }
    sendResponse({ ok: true });
    return;
  }

  // ── From content scripts ─────────────────────────────────────────────────
  if (!isContentToSW(message)) {
    sendResponse({ ok: false });
    return;
  }

  const tabId = sender.tab?.id;
  const contentMsg = message as ContentToSW;

  switch (contentMsg.type) {
    case 'PING':
      sendResponse({ type: 'PONG' } satisfies SWToContent);
      return;

    case 'GAME_STARTED': {
      if (tabId == null) break;
      registry.upsert(tabId, contentMsg.site);
      await ensureOffscreenDocument();
      await initEngine();
      const readyMsg: SWToContent = { type: 'ENGINE_READY' };
      await chrome.tabs.sendMessage(tabId, readyMsg).catch(() => undefined);
      break;
    }

    case 'GAME_ENDED': {
      if (tabId == null) break;
      registry.remove(tabId);
      if (registry.size === 0) {
        await stopAnalysis();
        await closeOffscreenDocument();
      }
      break;
    }

    case 'LOAD_REPERTOIRE': {
      const result: PGNLoadResult = await repertoireEngine.load(
        contentMsg.pgn,
        contentMsg.playerColor,
        contentMsg.filename
      ).catch((err: unknown) => ({
        success:  false,
        metadata: null,
        errors:   [String(err)],
      }));
      sendResponse({ type: 'REPERTOIRE_STATUS', result });
      return;
    }

    case 'CLEAR_REPERTOIRE': {
      await repertoireEngine.clear(contentMsg.color).catch(() => undefined);
      sendResponse({ type: 'REPERTOIRE_STATUS', result: { success: true, metadata: null, errors: [] } });
      return;
    }

    case 'QUERY_REPERTOIRE': {
      sendResponse({
        white: repertoireEngine.whiteMetadata,
        black: repertoireEngine.blackMetadata,
      });
      return;
    }

    case 'POSITION_CHANGED': {
      if (tabId == null) break;

      const { fen } = contentMsg;
      const posKey = fenPositionKey(fen);

      // Dedup: skip if same position as last time
      const state = registry.get(tabId);
      if (state?.lastFEN && fenPositionKey(state.lastFEN) === posKey) break;

      registry.updateFEN(tabId, fen);
      // Ensure tab is tracked — site is inferred from sender URL if not yet registered
      const senderHost = sender.tab?.url ? new URL(sender.tab.url).hostname : '';
      const inferredSite = senderHost.includes('chess.com') ? 'chess-com' : 'lichess';
      registry.upsert(tabId, inferredSite);

      await ensureOffscreenDocument();
      const settings = await getSettings();
      await requestAnalysis(fen, settings);
      break;
    }
  }

  sendResponse({ ok: true });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Broadcasts the coaching hint to all matching tabs.
 * Computes per-tab data: punishment (blunder detection) and reenteredBook.
 * Advances each tab's stored evaluation after computing the punishment.
 */
async function broadcastToTabs(
  fen:        string,
  lines:      readonly RawPvLine[],
  baseHint:   CoachingHint,
  playerSide: 'white' | 'black',
): Promise<void> {
  const posKey         = fenPositionKey(fen);
  const currSideToMove = fenActiveColor(fen) ?? 'white';
  const currScore      = lines[0]?.score ?? { tag: 'cp' as const, value: 0 };

  const tabs = await chrome.tabs.query({
    url: ['*://lichess.org/*', '*://www.chess.com/*'],
  });

  await Promise.allSettled(
    tabs.map(tab => {
      if (tab.id == null) return Promise.resolve();
      const state = registry.get(tab.id);
      if (!state?.lastFEN || fenPositionKey(state.lastFEN) !== posKey) {
        return Promise.resolve();
      }

      // ── Per-tab: opponent blunder detection ──────────────────────────────
      const punishment = state.prevEval
        ? detectOpponentBlunder(
            state.prevEval.score,
            state.prevEval.sideToMove,
            lines,
            fen,
            playerSide,
          )
        : null;

      // ── Per-tab: user move quality assessment ────────────────────────────
      // `state.lastEval` (before advancing) is the eval from the position
      // immediately before the current one. When it is now the opponent's turn
      // (user just moved), state.lastEval is the eval at the user's position
      // before they moved — exactly what assessUserMove needs.
      const myMoveQuality = state.lastEval !== null
        ? assessUserMove(
            state.lastEval.score,
            state.lastEval.sideToMove,
            currScore,
            currSideToMove,
            playerSide,
          )
        : null;

      // ── Per-tab: opponent deviation detection ─────────────────────────────
      // `state.lastEval` (before advancing) is from the immediately preceding
      // position. If that position was the opponent's turn (sideToMove !== playerSide)
      // and the user was in book on their previous turn (state.lastInBook=true) but
      // the current position is out of book → the opponent left theory.
      const oppDeviated =
        baseHint.repertoire !== null &&
        baseHint.repertoire.source === 'engine' &&
        state.lastInBook &&
        state.lastEval !== null &&
        state.lastEval.sideToMove !== playerSide;

      // Advance this tab's eval history (prevEval ← lastEval ← current)
      registry.advanceEval(tab.id, currScore, currSideToMove);

      // ── Per-tab: repertoire status ────────────────────────────────────────
      let hint: CoachingHint = { ...baseHint, punishment, myMoveQuality };

      if (hint.repertoire !== null) {
        const rep = hint.repertoire;

        // Track lastInBook on user's turns ONLY — not on opponent_turn.
        // This preserves the "was user's last turn in book" status so that
        // reenteredBook and opponentDeviated detection work correctly across
        // the full white→black→white move cycle.
        if (rep.source !== 'opponent_turn') {
          registry.updateBookStatus(tab.id, rep.inBook);
        }

        const reenteredBook = rep.inBook && !state.lastInBook;
        if (reenteredBook || oppDeviated) {
          hint = {
            ...hint,
            repertoire: { ...rep, reenteredBook, opponentDeviated: oppDeviated },
          };
        }
      }

      const msg: SWToContent = { type: 'COACHING_HINT', hint };
      return chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined);
    })
  );
}

function buildBaseHint(
  lines:          readonly RawPvLine[],
  fen:            string,
  difficulty:     DifficultyLevel,
  repertoireMode: 'book' | 'engine',
  playerSide:     'white' | 'black',
): CoachingHint {
  const best = lines[0];
  const bestMove = best?.moves[0] ?? '';
  const score    = best?.score ?? { tag: 'cp' as const, value: 0 };

  return {
    bestMove,
    evaluation:      score,
    pvLines:         lines,
    themeSuggestion: deriveTheme(lines),
    depth:           best?.depth ?? 0,
    coaching:       hintGenerator.generate(lines, fen, difficulty),
    repertoire:     repertoireEngine.analyzePosition(fen, repertoireMode, playerSide),
    punishment:     null,   // filled in per-tab by broadcastToTabs
    myMoveQuality:  null,   // filled in per-tab by broadcastToTabs
  };
}

function deriveTheme(lines: readonly RawPvLine[]): string | null {
  const best = lines[0];
  if (!best || best.moves.length === 0) return null;

  const score = best.score;
  if (score.tag === 'mate') {
    return score.moves === 1
      ? 'Checkmate in 1!'
      : `Forced checkmate in ${score.moves}`;
  }
  if (score.tag === 'cp') {
    const abs = Math.abs(score.value);
    if (abs > 300) return 'Large material advantage — look to simplify';
    if (abs > 100) return 'Slight edge — maintain piece activity';
  }
  return null;
}
