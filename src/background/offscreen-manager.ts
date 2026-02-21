const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/index.html');
const OFFSCREEN_REASON = chrome.offscreen.Reason.WORKERS;
const JUSTIFICATION = 'Run Stockfish WASM in a Web Worker for offline chess analysis';

let _creating: Promise<void> | null = null;

/**
 * Ensures the offscreen document exists.
 * Guards against concurrent calls — safe to call from any message handler.
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;

  // Coalesce concurrent creation attempts
  if (_creating) return _creating;

  _creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [OFFSCREEN_REASON],
      justification: JUSTIFICATION,
    })
    .finally(() => { _creating = null; });

  return _creating;
}

/**
 * Closes the offscreen document if it exists.
 * Called when all chess tabs are closed to free ~64MB of WASM memory.
 */
export async function closeOffscreenDocument(): Promise<void> {
  if (!(await chrome.offscreen.hasDocument())) return;
  await chrome.offscreen.closeDocument();
}
