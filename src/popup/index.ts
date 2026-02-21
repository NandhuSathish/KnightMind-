import { getSettings, setSettings } from '../shared/storage/client.js';
import type { UserSettings } from '../shared/storage/schema.js';

// ─── Element refs ─────────────────────────────────────────────────────────────

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const enabledToggle  = el<HTMLInputElement>('enabledToggle');
const hintDelay      = el<HTMLInputElement>('hintDelay');
const hintDelayVal   = el<HTMLSpanElement>('hintDelayVal');
const depthRange     = el<HTMLInputElement>('depthRange');
const depthVal       = el<HTMLSpanElement>('depthVal');
const multiPvRange   = el<HTMLInputElement>('multiPvRange');
const multiPvVal     = el<HTMLSpanElement>('multiPvVal');
const arrowsToggle   = el<HTMLInputElement>('arrowsToggle');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const settings = await getSettings();
  applyToUI(settings);
  attachListeners();
}

function applyToUI(s: UserSettings): void {
  enabledToggle.checked   = s.enabled;
  hintDelay.value         = String(s.hintDelayMs);
  hintDelayVal.textContent = formatDelay(s.hintDelayMs);
  depthRange.value        = String(s.maxDepth);
  depthVal.textContent    = String(s.maxDepth);
  multiPvRange.value      = String(s.multiPv);
  multiPvVal.textContent  = String(s.multiPv);
  arrowsToggle.checked    = s.showArrows;
}

function attachListeners(): void {
  enabledToggle.addEventListener('change', () =>
    save({ enabled: enabledToggle.checked })
  );

  hintDelay.addEventListener('input', () => {
    const ms = parseInt(hintDelay.value, 10);
    hintDelayVal.textContent = formatDelay(ms);
    save({ hintDelayMs: ms });
  });

  depthRange.addEventListener('input', () => {
    const d = parseInt(depthRange.value, 10);
    depthVal.textContent = String(d);
    save({ maxDepth: d });
  });

  multiPvRange.addEventListener('input', () => {
    const v = parseInt(multiPvRange.value, 10);
    multiPvVal.textContent = String(v);
    save({ multiPv: v });
  });

  arrowsToggle.addEventListener('change', () =>
    save({ showArrows: arrowsToggle.checked })
  );
}

function save(patch: Partial<UserSettings>): void {
  setSettings(patch).catch(console.error);
}

function formatDelay(ms: number): string {
  return ms === 0 ? 'Off' : `${(ms / 1000).toFixed(1)}s`;
}

init().catch(console.error);
