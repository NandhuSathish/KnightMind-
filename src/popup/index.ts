import { getSettings, setSettings } from '../shared/storage/client.js';
import type { UserSettings } from '../shared/storage/schema.js';
import type { PGNLoadResult, RepertoireMetadata } from '../shared/repertoire/types.js';
import type { Color } from '../shared/chess/types.js';
import type { RepertoireStatusResponse } from '../shared/messages/protocol.js';

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
  repColor.value          = s.playerSide;
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

  // Changing "Play as" also persists the user's declared side so the
  // service worker only shows book moves on that color's turns.
  repColor.addEventListener('change', () =>
    save({ playerSide: repColor.value as 'white' | 'black' })
  );
}

function save(patch: Partial<UserSettings>): void {
  setSettings(patch).catch(console.error);
}

function formatDelay(ms: number): string {
  return ms === 0 ? 'Off' : `${(ms / 1000).toFixed(1)}s`;
}

init().catch(console.error);

// ─── Repertoire upload ────────────────────────────────────────────────────────

const repColor    = el<HTMLSelectElement>('repColor');
const repFileInput = el<HTMLInputElement>('repFileInput');
const repFileLabel = el<HTMLLabelElement>('repFileLabel');
const repLoadBtn  = el<HTMLButtonElement>('repLoadBtn');
const repStatus   = el<HTMLDivElement>('repStatus');
const repBookList = el<HTMLDivElement>('repBookList');

let _pendingPGN:      string | null = null;
let _pendingFilename: string | null = null;

repFileInput.addEventListener('change', () => {
  const file = repFileInput.files?.[0];
  if (!file) return;
  _pendingFilename = file.name;
  repFileLabel.textContent = file.name;
  repLoadBtn.disabled = false;

  const reader = new FileReader();
  reader.onload = () => {
    _pendingPGN = typeof reader.result === 'string' ? reader.result : null;
  };
  reader.readAsText(file);
});

repLoadBtn.addEventListener('click', () => {
  if (!_pendingPGN) return;
  const playerColor = repColor.value as Color;
  const pgn         = _pendingPGN;
  const filename    = _pendingFilename ?? undefined;

  repLoadBtn.disabled = true;
  repStatus.className = 'rep-status';
  repStatus.textContent = 'Loading…';

  void chrome.runtime.sendMessage(
    { type: 'LOAD_REPERTOIRE', pgn, playerColor, ...(filename !== undefined ? { filename } : {}) },
    (response: unknown) => {
      void chrome.runtime.lastError;
      const r = response as { type: string; result: PGNLoadResult } | null;
      const result = r?.result;
      if (!result) {
        repStatus.className = 'rep-status err';
        repStatus.textContent = 'Failed to load repertoire.';
        repLoadBtn.disabled = false;
        return;
      }
      if (result.success && result.metadata) {
        const { positionCount, moveCount } = result.metadata;
        repStatus.className = 'rep-status ok';
        repStatus.textContent = `Loaded ${positionCount} positions, ${moveCount} moves.`;
        if (result.errors.length > 0) {
          repStatus.textContent += ` (${result.errors.length} warnings)`;
        }
        // Reset file picker so the same file can be re-selected later
        _pendingPGN = null;
        _pendingFilename = null;
        repFileInput.value = '';
        repFileLabel.textContent = 'Choose file…';
        repLoadBtn.disabled = true;
      } else {
        repStatus.className = 'rep-status err';
        repStatus.textContent = result.errors[0] ?? 'Unknown error.';
        repLoadBtn.disabled = false;
      }
      void queryAndRenderBookList();
    }
  );
});

// ─── Book list ────────────────────────────────────────────────────────────────

function queryAndRenderBookList(): Promise<void> {
  return new Promise(resolve => {
    void chrome.runtime.sendMessage({ type: 'QUERY_REPERTOIRE' }, (response: unknown) => {
      void chrome.runtime.lastError;
      const r = response as RepertoireStatusResponse | null;
      renderBookList(r?.white ?? null, r?.black ?? null);
      resolve();
    });
  });
}

function renderBookList(white: RepertoireMetadata | null, black: RepertoireMetadata | null): void {
  if (!white && !black) {
    repBookList.innerHTML = '<div class="rep-book-empty">No books loaded</div>';
    return;
  }

  const items: string[] = [];

  const makeItem = (meta: RepertoireMetadata, color: Color): string => {
    const icon = color === 'white' ? '♙' : '♟';
    const name = meta.sourceFilename ?? `${color} repertoire`;
    const info = `${meta.positionCount} positions · ${meta.moveCount} moves`;
    return `<div class="rep-book-item">
      <span class="rep-book-icon">${icon}</span>
      <div class="rep-book-info">
        <span class="rep-book-name">${escHtml(name)}</span>
        <span class="rep-book-meta">${escHtml(info)}</span>
      </div>
      <button class="rep-book-del" data-color="${color}" title="Remove ${color} book">✕</button>
    </div>`;
  };

  if (white) items.push(makeItem(white, 'white'));
  if (black) items.push(makeItem(black, 'black'));

  repBookList.innerHTML = items.join('');

  repBookList.querySelectorAll<HTMLButtonElement>('.rep-book-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset['color'] as Color;
      void chrome.runtime.sendMessage({ type: 'CLEAR_REPERTOIRE', color }, () => {
        void chrome.runtime.lastError;
        void queryAndRenderBookList();
      });
    });
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Load book list on popup open
void queryAndRenderBookList();
