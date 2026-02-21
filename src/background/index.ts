import { ensureOffscreenDocument, closeOffscreenDocument } from './offscreen-manager.js';
import { requestAnalysis, stopAnalysis, initEngine, parseOffscreenMessage } from './engine-relay.js';
import { TabRegistry } from './tab-registry.js';
import { isContentToSW } from '../shared/messages/protocol.js';
import type { SWToContent, ContentToSW, CoachingHint } from '../shared/messages/protocol.js';
import { fenPositionKey } from '../shared/chess/fen.js';
import { getSettings } from '../shared/storage/client.js';
import type { RawPvLine } from '../shared/engine/types.js';
import { hintGenerator } from '../shared/coaching/index.js';
import type { DifficultyLevel } from '../shared/coaching/index.js';

const registry = new TabRegistry();

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await ensureOffscreenDocument();
  await initEngine();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureOffscreenDocument();
  await initEngine();
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
        // Broadcast to all tabs that sent this FEN
        const settings = await getSettings();
        const hint = buildCoachingHint(lines, fen, settings.difficulty);
        const msg: SWToContent = { type: 'COACHING_HINT', hint };
        await broadcastToTabs(fen, msg);
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

async function broadcastToTabs(fen: string, msg: SWToContent): Promise<void> {
  const posKey = fenPositionKey(fen);
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
      return chrome.tabs.sendMessage(tab.id, msg);
    })
  );
}

function buildCoachingHint(
  lines: readonly RawPvLine[],
  fen: string,
  difficulty: DifficultyLevel
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
    coaching:        hintGenerator.generate(lines, fen, difficulty),
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
