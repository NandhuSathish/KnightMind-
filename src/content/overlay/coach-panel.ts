import type { CoachingHint } from '../../shared/messages/protocol.js';
import type { UserSettings } from '../../shared/storage/schema.js';
import type { RawScore } from '../../shared/engine/types.js';
import type { DifficultyLevel } from '../../shared/storage/schema.js';
import { formatScore } from '../../shared/chess/types.js';
import { setSettings } from '../../shared/storage/client.js';
import { PANEL_STYLES } from './styles.js';

type EngineStatus = 'loading' | 'ready' | 'crashed';

const DIFFICULTY_CYCLE: readonly DifficultyLevel[] = ['beginner', 'intermediate', 'advanced'];

/**
 * Coaching hint panel rendered inside a closed Shadow DOM host.
 *
 * Features:
 *  - Draggable via pointer events on the header (transform-only, no layout thrash).
 *  - Minimizable via the — button or Alt+K keyboard shortcut.
 *  - Theme-aware (dark default / light via @media prefers-color-scheme).
 *  - Inline controls: arrow toggle + difficulty cycle (persisted to storage).
 *  - Engine status indicator (pulsing dot: loading / ready / crashed).
 *  - Evaluation bar (centipawn → 0–100% fill).
 *  - Accessible: role="complementary", aria-live on hint area, focus-visible rings.
 */
export class CoachPanel {
  // ─── DOM refs ──────────────────────────────────────────────────────────────
  private readonly _host:       HTMLElement;
  private readonly _shadow:     ShadowRoot;
  private readonly _panel:      HTMLDivElement;
  private readonly _header:     HTMLDivElement;
  private readonly _statusDot:  HTMLSpanElement;
  private readonly _minimizeBtn: HTMLButtonElement;
  private readonly _evalbarFill: HTMLDivElement;
  private readonly _evalText:   HTMLDivElement;
  private readonly _categories: HTMLDivElement;
  private readonly _theme:      HTMLDivElement;
  private readonly _arrowsBtn:  HTMLButtonElement;
  private readonly _diffBtn:    HTMLButtonElement;
  private readonly _depth:      HTMLDivElement;

  // ─── State ─────────────────────────────────────────────────────────────────
  private _hintDelayMs = 0;
  private _hintTimer:   ReturnType<typeof setTimeout> | null = null;
  private _pendingHint: CoachingHint | null = null;
  private _minimized = false;
  private _showArrows: boolean = true;
  private _difficulty: DifficultyLevel = 'intermediate';

  // ─── Drag state ────────────────────────────────────────────────────────────
  /** false until the first drag initializes absolute transform-based positioning */
  private _positioned = false;
  private _dragging   = false;
  private _posX       = 0;
  private _posY       = 0;
  private _dragOriginX = 0; // clientX_at_down - _posX_at_down
  private _dragOriginY = 0;

  // ─── Keyboard handler (stored for cleanup) ─────────────────────────────────
  private readonly _keyHandler: (e: KeyboardEvent) => void;

  constructor() {
    // ── Shadow host ──────────────────────────────────────────────────────────
    this._host = document.createElement('div');
    this._host.setAttribute('data-knightmind', 'panel');
    this._shadow = this._host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PANEL_STYLES;
    this._shadow.appendChild(style);

    // ── Panel root ───────────────────────────────────────────────────────────
    this._panel = document.createElement('div');
    this._panel.className = 'km-panel hidden';
    this._panel.setAttribute('role', 'complementary');
    this._panel.setAttribute('aria-label', 'KnightMind coaching panel');
    this._shadow.appendChild(this._panel);

    // ── Header ───────────────────────────────────────────────────────────────
    this._header = document.createElement('div');
    this._header.className = 'km-header';
    this._header.setAttribute('aria-hidden', 'true');

    const logo = document.createElement('span');
    logo.className = 'km-logo';
    logo.setAttribute('aria-hidden', 'true');
    logo.textContent = '♞';

    const title = document.createElement('span');
    title.className = 'km-title';
    title.textContent = 'KnightMind';

    this._statusDot = document.createElement('span');
    this._statusDot.className = 'km-status km-status--loading';
    this._statusDot.title = 'Engine loading…';

    const headerBtns = document.createElement('div');
    headerBtns.className = 'km-header-btns';

    this._minimizeBtn = document.createElement('button');
    this._minimizeBtn.className = 'km-btn';
    this._minimizeBtn.setAttribute('aria-label', 'Minimize panel (Alt+K)');
    this._minimizeBtn.title = 'Minimize (Alt+K)';
    this._minimizeBtn.textContent = '−';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'km-btn';
    closeBtn.setAttribute('aria-label', 'Close panel');
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';

    headerBtns.append(this._minimizeBtn, closeBtn);
    this._header.append(logo, title, this._statusDot, headerBtns);

    // ── Body ─────────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'km-body';

    // Eval bar
    const evalbarWrap = document.createElement('div');
    evalbarWrap.className = 'km-evalbar-wrap';
    evalbarWrap.setAttribute('aria-hidden', 'true');
    this._evalbarFill = document.createElement('div');
    this._evalbarFill.className = 'km-evalbar-fill';
    evalbarWrap.appendChild(this._evalbarFill);

    // Eval text
    this._evalText = document.createElement('div');
    this._evalText.className = 'km-eval neutral';
    this._evalText.textContent = '—';

    // Coaching categories (aria-live so screen readers announce updates)
    this._categories = document.createElement('div');
    this._categories.className = 'km-categories';
    this._categories.setAttribute('aria-live', 'polite');
    this._categories.setAttribute('aria-label', 'Coaching hints');

    // Theme fallback text
    this._theme = document.createElement('div');
    this._theme.className = 'km-theme km-hint-delay';
    this._theme.textContent = 'Waiting for game…';

    // Controls
    const controls = document.createElement('div');
    controls.className = 'km-controls';
    controls.setAttribute('aria-label', 'Panel controls');

    this._arrowsBtn = document.createElement('button');
    this._arrowsBtn.className = 'km-ctrl-btn';
    this._arrowsBtn.setAttribute('aria-pressed', 'true');
    this._arrowsBtn.setAttribute('aria-label', 'Toggle move arrows');

    this._diffBtn = document.createElement('button');
    this._diffBtn.className = 'km-ctrl-btn';
    this._diffBtn.setAttribute('aria-label', 'Cycle coaching difficulty');

    controls.append(this._arrowsBtn, this._diffBtn);

    // Depth footer
    this._depth = document.createElement('div');
    this._depth.className = 'km-depth';

    body.append(evalbarWrap, this._evalText, this._categories, this._theme, controls, this._depth);
    this._panel.append(this._header, body);

    // ── Event listeners ───────────────────────────────────────────────────────
    closeBtn.addEventListener('click', () => this.hide());
    this._minimizeBtn.addEventListener('click', () => this._toggleMinimize());
    this._arrowsBtn.addEventListener('click',  () => this._toggleArrows());
    this._diffBtn.addEventListener('click',    () => this._cycleDifficulty());

    // Drag: pointerdown on header, move/up on panel (after capture)
    this._header.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this._panel.addEventListener('pointermove',  (e) => this._onPointerMove(e));
    this._panel.addEventListener('pointerup',    ()  => this._onPointerUp());
    this._panel.addEventListener('pointercancel',()  => this._onPointerUp());

    // Keyboard toggle: Alt+K
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'k') {
        e.preventDefault();
        this._toggleMinimize();
      }
    };

    // Sync button labels to default state
    this._syncArrowsBtn();
    this._syncDiffBtn();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Mounts the panel and registers global keyboard listener. */
  mount(settings: UserSettings): void {
    this._hintDelayMs = settings.hintDelayMs;
    this._showArrows  = settings.showArrows;
    this._difficulty  = settings.difficulty;
    this._syncArrowsBtn();
    this._syncDiffBtn();
    document.body.appendChild(this._host);
    document.addEventListener('keydown', this._keyHandler);
  }

  unmount(): void {
    if (this._hintTimer !== null) {
      clearTimeout(this._hintTimer);
      this._hintTimer = null;
    }
    document.removeEventListener('keydown', this._keyHandler);
    this._host.remove();
  }

  showHint(hint: CoachingHint): void {
    this._pendingHint = hint;
    if (this._hintDelayMs > 0) {
      if (this._hintTimer !== null) clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => {
        this._hintTimer = null;
        if (this._pendingHint) this._render(this._pendingHint);
      }, this._hintDelayMs);
    } else {
      this._render(hint);
    }
  }

  showWaiting(): void {
    this._theme.textContent = 'Analyzing…';
    this._theme.className = 'km-theme km-hint-delay';
    this._panel.classList.remove('hidden');
  }

  showEngineUnavailable(): void {
    this._theme.textContent = 'Engine unavailable';
    this._theme.className = 'km-theme';
    this.setEngineStatus('crashed');
    this._panel.classList.remove('hidden');
  }

  /** Updates the pulsing status dot in the header. */
  setEngineStatus(status: EngineStatus): void {
    this._statusDot.className = `km-status km-status--${status}`;
    const TITLES: Record<EngineStatus, string> = {
      loading: 'Engine loading…',
      ready:   'Engine ready',
      crashed: 'Engine crashed',
    };
    this._statusDot.title = TITLES[status];
  }

  hide(): void {
    this._panel.classList.add('hidden');
  }

  /** Whether the arrows feature is currently enabled (may be toggled by user). */
  get showArrows(): boolean { return this._showArrows; }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  private _render(hint: CoachingHint): void {
    // Eval bar
    this._evalbarFill.style.width = `${this._evalBarPct(hint.evaluation)}%`;

    // Eval text + colour class
    this._evalText.textContent = formatScore(hint.evaluation);
    const score = hint.evaluation;
    const isPositive = score.tag === 'mate' ? score.moves > 0 : score.value > 0;
    const isNegative = score.tag === 'mate' ? score.moves < 0 : score.value < 0;
    this._evalText.className = 'km-eval ' +
      (isPositive ? 'positive' : isNegative ? 'negative' : 'neutral');

    // Coaching categories
    const c = hint.coaching;
    if (c) {
      this._categories.innerHTML = [
        c.tactical   ? `<div class="km-category km-tactical"><span class="km-cat-label">Tactic</span>${esc(c.tactical)}</div>`       : '',
        c.risk       ? `<div class="km-category km-risk"><span class="km-cat-label">Risk</span>${esc(c.risk)}</div>`                 : '',
        c.strategic  ? `<div class="km-category km-strategic"><span class="km-cat-label">Strategy</span>${esc(c.strategic)}</div>`   : '',
        c.positional ? `<div class="km-category km-positional"><span class="km-cat-label">Position</span>${esc(c.positional)}</div>` : '',
      ].join('');
      this._theme.textContent = '';
      this._theme.className = 'km-theme';
    } else {
      this._categories.innerHTML = '';
      this._theme.textContent = hint.themeSuggestion ?? '';
      this._theme.className = 'km-theme';
    }

    this._depth.textContent = hint.depth > 0 ? `depth ${hint.depth}` : '';
    this._panel.classList.remove('hidden');
  }

  /** Maps a RawScore to an eval-bar fill percentage (0–100). */
  private _evalBarPct(score: RawScore): number {
    if (score.tag === 'mate') return score.moves > 0 ? 100 : 0;
    // Clamp at ±500 cp → 0–100 %
    const clamped = Math.max(-500, Math.min(500, score.value));
    return (clamped + 500) / 10;
  }

  // ─── Minimize ──────────────────────────────────────────────────────────────

  private _toggleMinimize(): void {
    this._minimized = !this._minimized;
    this._panel.classList.toggle('km-minimized', this._minimized);
    if (this._minimized) {
      this._minimizeBtn.textContent = '+';
      this._minimizeBtn.setAttribute('aria-label', 'Restore panel (Alt+K)');
      this._minimizeBtn.title = 'Restore (Alt+K)';
    } else {
      this._minimizeBtn.textContent = '−';
      this._minimizeBtn.setAttribute('aria-label', 'Minimize panel (Alt+K)');
      this._minimizeBtn.title = 'Minimize (Alt+K)';
    }
  }

  // ─── Controls ──────────────────────────────────────────────────────────────

  private _toggleArrows(): void {
    this._showArrows = !this._showArrows;
    this._syncArrowsBtn();
    setSettings({ showArrows: this._showArrows }).catch(() => undefined);
  }

  private _cycleDifficulty(): void {
    const idx  = DIFFICULTY_CYCLE.indexOf(this._difficulty);
    const next = DIFFICULTY_CYCLE[(idx + 1) % DIFFICULTY_CYCLE.length];
    if (!next) return;
    this._difficulty = next;
    this._syncDiffBtn();
    setSettings({ difficulty: next }).catch(() => undefined);
  }

  private _syncArrowsBtn(): void {
    const on = this._showArrows;
    this._arrowsBtn.setAttribute('aria-pressed', String(on));
    this._arrowsBtn.textContent = on ? '→ Arrows' : '→ Off';
  }

  private _syncDiffBtn(): void {
    const LABELS: Record<DifficultyLevel, string> = {
      beginner:     '★ Beginner',
      intermediate: '★★ Medium',
      advanced:     '★★★ Expert',
    };
    this._diffBtn.textContent = LABELS[this._difficulty];
    this._diffBtn.setAttribute('aria-label', `Difficulty: ${this._difficulty} — click to cycle`);
  }

  // ─── Drag ──────────────────────────────────────────────────────────────────

  private _onPointerDown(e: PointerEvent): void {
    // Ignore clicks on the header's own buttons
    if ((e.target as Element | null)?.closest('.km-btn')) return;

    e.preventDefault(); // prevent text selection during drag

    // On first drag: read current rect and switch to transform-based positioning
    if (!this._positioned) {
      const rect = this._panel.getBoundingClientRect();
      this._posX = rect.left;
      this._posY = rect.top;
      this._panel.style.bottom = 'auto';
      this._panel.style.right  = 'auto';
      this._panel.style.left   = '0';
      this._panel.style.top    = '0';
      this._positioned = true;
      this._applyPosition();
    }

    this._dragging   = true;
    this._dragOriginX = e.clientX - this._posX;
    this._dragOriginY = e.clientY - this._posY;
    this._panel.classList.add('km-dragging');

    // Route subsequent pointer events to _panel so pointermove/pointerup fire there
    this._panel.setPointerCapture(e.pointerId);
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this._dragging) return;

    this._posX = e.clientX - this._dragOriginX;
    this._posY = e.clientY - this._dragOriginY;

    // Clamp inside viewport
    const maxX = window.innerWidth  - this._panel.offsetWidth;
    const maxY = window.innerHeight - this._panel.offsetHeight;
    this._posX = Math.max(0, Math.min(maxX > 0 ? maxX : 0, this._posX));
    this._posY = Math.max(0, Math.min(maxY > 0 ? maxY : 0, this._posY));

    this._applyPosition();
  }

  private _onPointerUp(): void {
    if (!this._dragging) return;
    this._dragging = false;
    this._panel.classList.remove('km-dragging');
  }

  /** Applies stored _posX/_posY via CSS transform — no layout reads. */
  private _applyPosition(): void {
    this._panel.style.transform = `translate(${this._posX}px, ${this._posY}px)`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
