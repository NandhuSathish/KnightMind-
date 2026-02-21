import { StockfishEngine } from './engine-bridge.js';
import { EngineError } from '../shared/engine/types.js';
import type { SWToOffscreen, OffscreenToSW } from '../shared/messages/protocol.js';

const engine = new StockfishEngine();

// ─── Message router: SW → Offscreen ──────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isSWToOffscreen(message)) {
      sendResponse({ ok: false });
      return;
    }

    handleMessage(message).catch(err => {
      console.error('[KnightMind][offscreen] Unhandled error:', err);
    });

    sendResponse({ ok: true });
  }
);

async function handleMessage(msg: SWToOffscreen): Promise<void> {
  switch (msg.type) {
    case 'ENGINE_INIT':
      try {
        await engine.init();
        await sendToSW({ type: 'ENGINE_READY' });
      } catch (err) {
        await sendToSW({ type: 'ENGINE_CRASHED', error: String(err) });
      }
      break;

    case 'ANALYZE':
      try {
        const result = await engine.analyze(msg.fen, {
          depth:    msg.depth,
          movetime: msg.movetime,
          multiPv:  msg.multiPv,
        });
        await sendToSW({ type: 'ANALYSIS_RESULT', fen: result.fen, lines: result.lines });
      } catch (err) {
        if (err instanceof EngineError && err.code === 'CANCELLED') return; // normal stop
        await sendToSW({ type: 'ENGINE_CRASHED', error: String(err) });
      }
      break;

    case 'STOP_ANALYSIS':
      engine.stop();
      break;
  }
}

function sendToSW(msg: OffscreenToSW): Promise<void> {
  return chrome.runtime.sendMessage(msg).catch((err: unknown) => {
    console.warn('[KnightMind][offscreen] Failed to send to SW:', err);
  });
}

function isSWToOffscreen(msg: unknown): msg is SWToOffscreen {
  if (typeof msg !== 'object' || msg === null) return false;
  const t = (msg as Record<string, unknown>)['type'];
  return t === 'ENGINE_INIT' || t === 'ANALYZE' || t === 'STOP_ANALYSIS';
}
