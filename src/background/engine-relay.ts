import type { SWToOffscreen, OffscreenToSW } from '../shared/messages/protocol.js';
import type { UserSettings } from '../shared/storage/schema.js';

/**
 * Sends an analysis request to the offscreen document.
 * The offscreen document routes it to the Stockfish worker.
 *
 * Engine parameters are chosen adaptively from the `timeControl` setting:
 *   'blitz'  → MultiPV 10, Depth 16  (fast; covers most CCT moves in blitz)
 *   'rapid'  → MultiPV 13, Depth 20  (deeper; better CCT coverage in longer games)
 *
 * High MultiPV is critical for CCT quality: more PV lines mean more forcing moves
 * receive accurate engine evaluations instead of heuristic estimates.
 */
export async function requestAnalysis(
  fen: string,
  settings: Pick<UserSettings, 'maxDepth' | 'multiPv' | 'timeControl'>
): Promise<void> {
  const isBlitz = settings.timeControl === 'blitz';
  const multiPv = isBlitz ? 10 : 13;
  const depth   = isBlitz ? 16 : 20;

  const msg: SWToOffscreen = {
    type: 'ANALYZE',
    fen,
    depth,
    multiPv,
    movetime: 800,
  };
  await sendToOffscreen(msg);
}

export async function stopAnalysis(): Promise<void> {
  await sendToOffscreen({ type: 'STOP_ANALYSIS' });
}

export async function initEngine(): Promise<void> {
  await sendToOffscreen({ type: 'ENGINE_INIT' });
}

/** Type-safe send to the offscreen document via chrome.runtime.sendMessage */
async function sendToOffscreen(msg: SWToOffscreen): Promise<void> {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch (err) {
    // Offscreen doc may not exist yet — caller should have called ensureOffscreenDocument
    console.warn('[KnightMind][engine-relay] sendMessage failed:', err);
  }
}

/**
 * Parses an incoming message as OffscreenToSW.
 * Returns null if the message is not from the offscreen document.
 */
export function parseOffscreenMessage(
  msg: unknown,
  sender: chrome.runtime.MessageSender
): OffscreenToSW | null {
  // Offscreen docs send messages with no tab context
  if (sender.tab !== undefined) return null;
  if (!isOffscreenMsg(msg)) return null;
  return msg;
}

function isOffscreenMsg(msg: unknown): msg is OffscreenToSW {
  if (typeof msg !== 'object' || msg === null) return false;
  const t = (msg as Record<string, unknown>)['type'];
  return t === 'ANALYSIS_RESULT' || t === 'ENGINE_READY' || t === 'ENGINE_CRASHED';
}
