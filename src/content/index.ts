import { resolveAdapter } from './adapters/registry.js';
import { PositionWatcher } from './board/position-watcher.js';
import { CoachPanel } from './overlay/coach-panel.js';
import { ArrowCanvas } from './overlay/arrow-canvas.js';
import type { ContentToSW, SWToContent } from '../shared/messages/protocol.js';
import { isSWToContent } from '../shared/messages/protocol.js';
import { getSettings } from '../shared/storage/client.js';
import { uciToMove } from '../shared/chess/types.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const adapter = resolveAdapter(location.hostname);
  if (!adapter) return; // unsupported site — silent exit

  const settings = await getSettings();
  if (!settings.enabled) return;

  adapter.attach(document);

  const panel = new CoachPanel();
  panel.mount(settings.hintDelayMs);

  const arrows = new ArrowCanvas();

  const watcher = new PositionWatcher(adapter, { throttleMs: 300 });

  watcher.subscribe(async (snapshot) => {
    // Notify SW that a game is in progress (lazy — only on first position)
    await sendToSW({ type: 'GAME_STARTED', site: adapter.site });
    panel.showWaiting();

    // Send position for analysis
    await sendToSW({
      type: 'POSITION_CHANGED',
      fen: snapshot.fen,
      orientation: snapshot.orientation,
      boardContext: snapshot.boardContext,
    });
  });

  watcher.start(document);

  // ─── SW Reconnection: ping every 25s ──────────────────────────────────────
  const pingInterval = setInterval(async () => {
    const alive = await pingServiceWorker();
    if (!alive) {
      // SW restarted — re-announce current position
      const snapshot = adapter.getCurrentPosition();
      if (snapshot) {
        await sendToSW({
          type: 'POSITION_CHANGED',
          fen: snapshot.fen,
          orientation: snapshot.orientation,
          boardContext: snapshot.boardContext,
        });
      }
    }
  }, 25_000);

  // ─── Incoming messages from SW ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!isSWToContent(message)) return;
    const msg = message as SWToContent;

    switch (msg.type) {
      case 'COACHING_HINT': {
        const hint = msg.hint;
        panel.showHint(hint);

        if (settings.showArrows && hint.pvLines.length > 0) {
          const boardEl = document.querySelector('cg-board, chess-board');
          if (boardEl) {
            const currentSnapshot = adapter.getCurrentPosition();
            const orientation = currentSnapshot?.orientation ?? 'white';
            arrows.attachTo(boardEl, orientation);

            const moves = hint.pvLines
              .map(line => line.moves[0])
              .filter((m): m is string => m != null)
              .map(uci => uciToMove(uci))
              .filter((m): m is NonNullable<typeof m> => m !== null);
            arrows.drawMoves(moves, orientation);
          }
        }
        break;
      }

      case 'ENGINE_READY':
        // Engine is up — nothing to do, next position change will trigger analysis
        break;

      case 'ENGINE_UNAVAILABLE':
        panel.showEngineUnavailable();
        break;

      case 'PONG':
        // Handled by pingServiceWorker() via promise resolution
        break;
    }
  });

  // ─── Cleanup on navigation ────────────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      sendToSW({ type: 'GAME_ENDED' }).catch(() => undefined);
    }
  });

  window.addEventListener('beforeunload', () => {
    clearInterval(pingInterval);
    watcher.stop();
    adapter.detach();
    arrows.detach();
    panel.unmount();
    sendToSW({ type: 'GAME_ENDED' }).catch(() => undefined);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sendToSW(msg: ContentToSW): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // SW may be starting up — non-critical
  }
}

async function pingServiceWorker(): Promise<boolean> {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), 3000);
    chrome.runtime.sendMessage({ type: 'PING' } satisfies ContentToSW, response => {
      clearTimeout(timeout);
      resolve(response?.type === 'PONG');
    });
  });
}

bootstrap().catch(console.error);
