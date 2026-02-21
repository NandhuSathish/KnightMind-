import type { CoachingHint } from '../../shared/messages/protocol.js';
import { formatScore } from '../../shared/chess/types.js';
import { PANEL_STYLES } from './styles.js';

/**
 * Coaching hint panel rendered inside a Shadow DOM host.
 *
 * Uses Shadow DOM for complete style isolation — zero risk of breaking
 * the host page's CSS or being broken by it.
 */
export class CoachPanel {
  private readonly _host: HTMLElement;
  private readonly _shadow: ShadowRoot;
  private readonly _panel: HTMLDivElement;
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingHint: CoachingHint | null = null;
  private _hintDelayMs = 0;

  constructor() {
    this._host = document.createElement('div');
    this._host.setAttribute('data-knightmind', 'panel');
    this._shadow = this._host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PANEL_STYLES;
    this._shadow.appendChild(style);

    this._panel = document.createElement('div');
    this._panel.className = 'km-panel hidden';
    this._panel.innerHTML = this._renderEmpty();
    this._shadow.appendChild(this._panel);

    // Close button
    this._panel.querySelector('.km-close')?.addEventListener('click', () => {
      this.hide();
    });
  }

  mount(hintDelayMs = 0): void {
    this._hintDelayMs = hintDelayMs;
    document.body.appendChild(this._host);
  }

  unmount(): void {
    if (this._hintTimer !== null) {
      clearTimeout(this._hintTimer);
      this._hintTimer = null;
    }
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
    this._panel.querySelector('.km-theme')?.replaceWith(
      Object.assign(document.createElement('div'), {
        className: 'km-theme km-hint-delay',
        textContent: 'Analyzing…',
      })
    );
    this._panel.classList.remove('hidden');
  }

  showEngineUnavailable(): void {
    const theme = this._panel.querySelector('.km-theme');
    if (theme) theme.textContent = 'Engine unavailable';
    this._panel.classList.remove('hidden');
  }

  hide(): void {
    this._panel.classList.add('hidden');
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _render(hint: CoachingHint): void {
    const evalText = formatScore(hint.evaluation);
    const isPositive = hint.evaluation.tag === 'cp' && hint.evaluation.value > 0;
    const isNegative = hint.evaluation.tag === 'cp' && hint.evaluation.value < 0;
    const evalClass = isPositive ? 'positive' : isNegative ? 'negative' : 'neutral';

    this._panel.innerHTML = `
      <button class="km-close" aria-label="Close">✕</button>
      <div class="km-header">
        <span class="km-logo">♞</span>
        KnightMind
      </div>
      <div class="km-eval ${evalClass}">${evalText}</div>
      <div class="km-theme">${hint.themeSuggestion ?? ''}</div>
      <div class="km-depth">depth ${hint.depth}</div>
    `;

    this._panel.querySelector('.km-close')?.addEventListener('click', () => this.hide());
    this._panel.classList.remove('hidden');
  }

  private _renderEmpty(): string {
    return `
      <button class="km-close" aria-label="Close">✕</button>
      <div class="km-header">
        <span class="km-logo">♞</span>
        KnightMind
      </div>
      <div class="km-eval neutral">—</div>
      <div class="km-theme km-hint-delay">Waiting for game…</div>
      <div class="km-depth"></div>
    `;
  }
}
