import { resolveAdapter } from './adapters/registry.js';
import { PositionWatcher } from './board/position-watcher.js';
import { CoachPanel } from './overlay/coach-panel.js';
import { ArrowCanvas } from './overlay/arrow-canvas.js';
import type { ContentToSW, SWToContent } from '../shared/messages/protocol.js';
import { isSWToContent } from '../shared/messages/protocol.js';
import { getSettings } from '../shared/storage/client.js';
import { uciToMove } from '../shared/chess/types.js';
import type { Move, Color } from '../shared/chess/types.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const adapter = resolveAdapter(location.hostname);
  if (!adapter) return; // unsupported site — silent exit

  const settings = await getSettings();
  if (!settings.enabled) return;

  adapter.attach(document);

  const panel = new CoachPanel();
  panel.mount(settings);

  const arrows = new ArrowCanvas();

  // ─── Tactic hover → arrow ─────────────────────────────────────────────────
  let lastPvMoves: Move[] = [];
  let lastOrientation: Color = 'white';

  panel.setTacticHoverCallback((uci) => {
    if (!panel.showArrows) return;
    if (uci === null) {
      arrows.restoreMoves();
    } else {
      const move = uciToMove(uci);
      if (move) arrows.highlightMove(move, lastOrientation);
    }
  });

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
    if (!isContextValid()) { clearInterval(pingInterval); return; }
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

        if (panel.showArrows && hint.pvLines.length > 0) {
          const boardEl = document.querySelector('cg-board, wc-chess-board');
          if (boardEl) {
            const currentSnapshot = adapter.getCurrentPosition();
            lastOrientation = currentSnapshot?.orientation ?? 'white';
            arrows.attachTo(boardEl, lastOrientation);

            lastPvMoves = hint.pvLines
              .slice(0, 3) // show at most 3 arrows; extra PV lines are for CCT scoring only
              .map(line => line.moves[0])
              .filter((m): m is string => m != null)
              .map(uci => uciToMove(uci))
              .filter((m): m is NonNullable<typeof m> => m !== null);
            arrows.drawMoves(lastPvMoves, lastOrientation);
          }
        }
        break;
      }

      case 'ENGINE_READY':
        panel.setEngineStatus('ready');
        break;

      case 'ENGINE_UNAVAILABLE':
        panel.showEngineUnavailable(); // internally calls setEngineStatus('crashed')
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

/** Returns false once the extension has been reloaded and this context is stale. */
function isContextValid(): boolean {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

async function sendToSW(msg: ContentToSW): Promise<void> {
  if (!isContextValid()) return;
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // SW may be starting up — non-critical
  }
}

async function pingServiceWorker(): Promise<boolean> {
  if (!isContextValid()) return false;
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), 3000);
    try {
      chrome.runtime.sendMessage({ type: 'PING' } satisfies ContentToSW, response => {
        clearTimeout(timeout);
        void chrome.runtime.lastError; // consume to prevent "unchecked lastError" error
        resolve(response?.type === 'PONG');
      });
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

bootstrap().catch(console.error);
