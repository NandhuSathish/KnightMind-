import type { CoachingHint, MoveQualityResult } from '../../shared/messages/protocol.js';
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
  private readonly _bookBtn:       HTMLButtonElement;
  private readonly _whiteSideBtn:  HTMLButtonElement;
  private readonly _blackSideBtn:  HTMLButtonElement;
  private readonly _sourceBadge:       HTMLDivElement;
  private readonly _moveQualitySection: HTMLDivElement;
  private readonly _punisherSection:   HTMLDivElement;
  private readonly _coachLabel:      HTMLDivElement;
  private readonly _bookSection:     HTMLDivElement;
  private readonly _bookNameEl:      HTMLDivElement;
  private readonly _linesSection:    HTMLDivElement;
  private readonly _depth:      HTMLDivElement;
  private readonly _fab:        HTMLButtonElement;

  // ─── State ─────────────────────────────────────────────────────────────────
  private _hintDelayMs = 0;
  private _hintTimer:   ReturnType<typeof setTimeout> | null = null;
  private _pendingHint: CoachingHint | null = null;
  private _minimized = false;
  private _showArrows:  boolean = true;
  private _difficulty:  DifficultyLevel = 'intermediate';
  private _bookEnabled: boolean = true;
  private _playerSide: 'white' | 'black' = 'white';
  private _whiteBookName: string | null = null;
  private _blackBookName: string | null = null;
  /** Cached quality of the user's most recent move (persists until next non-null arrives). */
  private _lastMoveQuality: MoveQualityResult | null = null;

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

    this._bookBtn = document.createElement('button');
    this._bookBtn.className = 'km-ctrl-btn';
    this._bookBtn.setAttribute('aria-pressed', 'true');
    this._bookBtn.setAttribute('aria-label', 'Toggle repertoire book moves');

    controls.append(this._arrowsBtn, this._diffBtn, this._bookBtn);

    // Side toggle — "Playing as: [♙ White] [♟ Black]"
    const sideRow = document.createElement('div');
    sideRow.className = 'km-side-row';

    const sideLabel = document.createElement('span');
    sideLabel.className = 'km-side-label';
    sideLabel.textContent = 'Playing as';

    const sideToggle = document.createElement('div');
    sideToggle.className = 'km-side-toggle';

    this._whiteSideBtn = document.createElement('button');
    this._whiteSideBtn.className = 'km-side-btn km-side-white';
    this._whiteSideBtn.textContent = '♙ White';
    this._whiteSideBtn.setAttribute('aria-pressed', 'true');
    this._whiteSideBtn.setAttribute('aria-label', 'Play as White');

    this._blackSideBtn = document.createElement('button');
    this._blackSideBtn.className = 'km-side-btn km-side-black';
    this._blackSideBtn.textContent = '♟ Black';
    this._blackSideBtn.setAttribute('aria-pressed', 'false');
    this._blackSideBtn.setAttribute('aria-label', 'Play as Black');

    sideToggle.append(this._whiteSideBtn, this._blackSideBtn);
    sideRow.append(sideLabel, sideToggle);

    // Move quality section — shows grade of user's last move, color coded by quality
    this._moveQualitySection = document.createElement('div');
    this._moveQualitySection.className = 'km-move-quality hidden';
    this._moveQualitySection.setAttribute('aria-live', 'polite');
    this._moveQualitySection.setAttribute('aria-label', 'Your last move quality');

    // Source badge — always-visible strip showing book vs engine
    this._sourceBadge = document.createElement('div');
    this._sourceBadge.className = 'km-source-badge km-source-none';

    // Coaching section label
    this._coachLabel = document.createElement('div');
    this._coachLabel.className = 'km-section-label hidden';
    this._coachLabel.textContent = '💡 Coaching Tips';

    // Repertoire book moves section
    this._bookSection = document.createElement('div');
    this._bookSection.className = 'km-repertoire hidden';

    // Book name — shows the active PGN filename for the selected color
    this._bookNameEl = document.createElement('div');
    this._bookNameEl.className = 'km-book-name km-book-name--empty';
    this._bookNameEl.textContent = 'No book for this color';

    // Blunder Punisher section
    this._punisherSection = document.createElement('div');
    this._punisherSection.className = 'km-punisher hidden';
    this._punisherSection.setAttribute('aria-live', 'assertive');
    this._punisherSection.setAttribute('aria-label', 'Blunder punishment suggestion');

    // Alternative engine lines (PV2, PV3)
    this._linesSection = document.createElement('div');
    this._linesSection.className = 'km-lines hidden';

    // Depth footer
    this._depth = document.createElement('div');
    this._depth.className = 'km-depth';

    body.append(evalbarWrap, this._evalText, this._moveQualitySection, this._punisherSection, this._sourceBadge, this._bookSection, this._coachLabel, this._categories, this._theme, this._linesSection, sideRow, this._bookNameEl, controls, this._depth);
    this._panel.append(this._header, body);

    // ── Re-open FAB (visible only when panel is closed) ───────────────────────
    this._fab = document.createElement('button');
    this._fab.className = 'km-fab hidden';
    this._fab.setAttribute('aria-label', 'Open KnightMind coaching panel');
    this._fab.title = 'Open KnightMind';
    this._fab.textContent = '♞';
    this._shadow.appendChild(this._fab);

    // ── Event listeners ───────────────────────────────────────────────────────
    closeBtn.addEventListener('click', () => this.hide());
    this._fab.addEventListener('click', () => this._showPanel());
    this._minimizeBtn.addEventListener('click', () => this._toggleMinimize());
    this._arrowsBtn.addEventListener('click',  () => this._toggleArrows());
    this._diffBtn.addEventListener('click',    () => this._cycleDifficulty());
    this._bookBtn.addEventListener('click',      () => this._toggleBook());
    this._whiteSideBtn.addEventListener('click', () => this._setSide('white'));
    this._blackSideBtn.addEventListener('click', () => this._setSide('black'));

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
    this._syncBookBtn();
    this._syncSideToggle();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Mounts the panel and registers global keyboard listener. */
  mount(settings: UserSettings): void {
    this._hintDelayMs = settings.hintDelayMs;
    this._showArrows  = settings.showArrows;
    this._difficulty  = settings.difficulty;
    this._bookEnabled = settings.repertoireMode === 'book';
    this._playerSide  = settings.playerSide;
    this._syncArrowsBtn();
    this._syncDiffBtn();
    this._syncBookBtn();
    this._syncSideToggle();
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
    this._showPanel();
  }

  showEngineUnavailable(): void {
    this._theme.textContent = 'Engine unavailable';
    this._theme.className = 'km-theme';
    this.setEngineStatus('crashed');
    this._showPanel();
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
    this._fab.classList.remove('hidden');
  }

  private _showPanel(): void {
    this._panel.classList.remove('hidden');
    this._fab.classList.add('hidden');
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

    // ── Move quality (user's last move) ──────────────────────────────────────
    if (hint.myMoveQuality !== null) {
      this._lastMoveQuality = hint.myMoveQuality;
    }
    const mq = this._lastMoveQuality;
    if (mq) {
      const GRADE_CLASS: Record<string, string> = {
        best:       'km-mq--best',
        excellent:  'km-mq--excellent',
        good:       'km-mq--good',
        inaccuracy: 'km-mq--inaccuracy',
        mistake:    'km-mq--mistake',
        blunder:    'km-mq--blunder',
      };
      const gradeClass = GRADE_CLASS[mq.grade] ?? 'km-mq--good';
      const lossStr = mq.cpLoss === 0
        ? '±0.00'
        : `-${(mq.cpLoss / 100).toFixed(2)}`;
      this._moveQualitySection.className = `km-move-quality ${gradeClass}`;
      this._moveQualitySection.innerHTML =
        `<span class="km-mq-symbol">${esc(mq.symbol)}</span>` +
        `<span class="km-mq-label">${esc(mq.label)}</span>` +
        `<span class="km-mq-loss">${esc(lossStr)}</span>`;
      this._moveQualitySection.classList.remove('hidden');
    } else {
      this._moveQualitySection.classList.add('hidden');
    }

    // ── Blunder Punisher ─────────────────────────────────────────────────────
    const p = hint.punishment;
    if (p) {
      const SEVERITY_CLASS: Record<string, string> = {
        inaccuracy: 'km-punisher--inaccuracy',
        mistake:    'km-punisher--mistake',
        blunder:    'km-punisher--blunder',
      };
      const cls = SEVERITY_CLASS[p.blunderSeverity] ?? 'km-punisher--blunder';
      const confPct = Math.round(p.confidence * 100);
      const evalStr = p.evaluation >= 0
        ? `+${(p.evaluation / 100).toFixed(2)}`
        : `${(p.evaluation / 100).toFixed(2)}`;
      this._punisherSection.className = `km-punisher ${cls}`;
      this._punisherSection.innerHTML =
        `<div class="km-punisher-header">${esc(p.uiMessage)}</div>` +
        `<div class="km-punisher-body">` +
          `<div class="km-punisher-move">${esc(p.moveSAN)}</div>` +
          `<div class="km-punisher-meta">` +
            `<span class="km-punisher-type">${esc(p.punishmentType)}</span>` +
            `<span class="km-punisher-eval">${esc(evalStr)}</span>` +
            `<span class="km-punisher-conf">${confPct}% sure</span>` +
          `</div>` +
          `<div class="km-punisher-explain">${esc(p.explanation)}</div>` +
        `</div>`;
      this._punisherSection.classList.remove('hidden');
    } else {
      this._punisherSection.innerHTML = '';
      this._punisherSection.classList.add('hidden');
    }

    // ── Source badge (always visible — tells the user what's driving suggestions) ──
    const rep = hint.repertoire;

    // Track per-color book names so switching the side toggle shows the right name.
    if (rep?.bookName) {
      if (this._playerSide === 'white') this._whiteBookName = rep.bookName;
      else                              this._blackBookName = rep.bookName;
      this._syncBookName();
    }

    if (!this._bookEnabled) {
      this._sourceBadge.className = 'km-source-badge km-source-engine';
      this._sourceBadge.textContent = '🤖 Engine mode';
    } else if (rep?.reenteredBook) {
      // Was out of book, now transposed back into known preparation
      this._sourceBadge.className = 'km-source-badge km-source-reentered';
      this._sourceBadge.textContent = '✔ Back in book line';
    } else if (rep?.source === 'book') {
      this._sourceBadge.className = 'km-source-badge km-source-book';
      this._sourceBadge.textContent = '✔ You are still in your prep';
    } else if (rep?.opponentDeviated) {
      // Was in book on user's last turn; opponent deviated
      this._sourceBadge.className = 'km-source-badge km-source-deviated';
      this._sourceBadge.textContent = '⚠ Opponent left theory';
    } else if (rep?.source === 'engine') {
      this._sourceBadge.className = 'km-source-badge km-source-outofbook';
      this._sourceBadge.textContent = '🔎 New position — out of repertoire';
    } else if (rep?.source === 'opponent_turn') {
      this._sourceBadge.className = 'km-source-badge km-source-waiting';
      this._sourceBadge.textContent = '⏳ Opponent to move…';
    } else {
      // source === 'none' — no book loaded for this color
      this._sourceBadge.className = 'km-source-badge km-source-none';
      this._sourceBadge.textContent = '📂 No book loaded — upload a PGN';
    }

    // ── Book moves (only when actively following repertoire) ──────────────────
    if (this._bookEnabled && rep?.source === 'book') {
      // ── Variation identification (ECO · line name · depth) ────────────────
      const infoParts: string[] = [];
      if (rep.ecoCode)  infoParts.push(`<span class="km-rep-eco">${esc(rep.ecoCode)}</span>`);
      if (rep.lineName) infoParts.push(esc(rep.lineName));
      if (rep.bookDepth > 1) infoParts.push(`Move ${rep.bookDepth}`);
      const infoHtml = infoParts.length > 0
        ? `<div class="km-rep-line-info">${infoParts.join(' · ')}</div>`
        : '';

      // ── Next move suggestion + key ideas from annotations ─────────────────
      const movesHtml = rep.suggestedMoves.map(m => {
        // Prefer SAN (human-readable) over UCI fallback
        const moveLabel = m.san ?? m.uci;
        const oppLabel  = m.opponentResponseSan ?? m.opponentResponse;

        const oppHtml = oppLabel
          ? `<div class="km-rep-response"><span class="km-rep-then">then opponent:</span><span class="km-rep-opp">${esc(oppLabel)}</span></div>`
          : '';

        // PGN annotation → "Key Ideas" section for conceptual guidance
        const ideaHtml = m.annotation
          ? `<div class="km-rep-ideas"><span class="km-rep-ideas-label">Key idea</span>${esc(m.annotation)}</div>`
          : '';

        return `<div class="km-rep-entry">` +
          `<div class="km-rep-line"><span class="km-rep-you">You play</span><span class="km-rep-move">${esc(moveLabel)}</span></div>` +
          oppHtml + ideaHtml +
          `</div>`;
      }).join('');

      this._bookSection.innerHTML =
        `<div class="km-rep-header">Book move${rep.suggestedMoves.length > 1 ? 's' : ''}:</div>${infoHtml}${movesHtml}`;
      this._bookSection.classList.remove('hidden');
    } else {
      this._bookSection.innerHTML = '';
      this._bookSection.classList.add('hidden');
    }

    // ── Coaching categories ───────────────────────────────────────────────────
    const c = hint.coaching;
    if (c && (c.tactical || c.risk || c.strategic || c.positional || c.blunder)) {
      this._coachLabel.classList.remove('hidden');
      this._categories.innerHTML = [
        c.blunder    ? `<div class="km-category km-blunder"><span class="km-cat-label">Blunder</span>${esc(c.blunder)}</div>`        : '',
        c.tactical   ? `<div class="km-category km-tactical"><span class="km-cat-label">Tactic</span>${esc(c.tactical)}</div>`       : '',
        c.risk       ? `<div class="km-category km-risk"><span class="km-cat-label">Risk</span>${esc(c.risk)}</div>`                 : '',
        c.strategic  ? `<div class="km-category km-strategic"><span class="km-cat-label">Strategy</span>${esc(c.strategic)}</div>`   : '',
        c.positional ? `<div class="km-category km-positional"><span class="km-cat-label">Position</span>${esc(c.positional)}</div>` : '',
      ].join('');
      this._theme.textContent = '';
      this._theme.className = 'km-theme';
    } else {
      this._coachLabel.classList.add('hidden');
      this._categories.innerHTML = '';
      this._theme.textContent = hint.themeSuggestion ?? '';
      this._theme.className = 'km-theme';
    }

    // ── Alternative lines (PV2, PV3) ─────────────────────────────────────────
    const altLines = hint.pvLines.slice(1);   // skip the best (PV1)
    if (altLines.length > 0) {
      const linesHtml = altLines.map((line, i) => {
        const label  = `PV${i + 2}`;
        const score  = line.score.tag === 'mate'
          ? (line.score.moves > 0 ? `M${line.score.moves}` : `-M${Math.abs(line.score.moves)}`)
          : (line.score.value >= 0 ? `+${(line.score.value / 100).toFixed(2)}` : `${(line.score.value / 100).toFixed(2)}`);
        const moves  = line.moves.slice(0, 3).map(esc).join(' ');
        return `<div class="km-line-entry">` +
          `<span class="km-line-label">${label}</span>` +
          `<span class="km-line-score">${esc(score)}</span>` +
          `<span class="km-line-moves">${moves}</span>` +
          `</div>`;
      }).join('');
      this._linesSection.innerHTML =
        `<div class="km-lines-header">Alternative lines</div>${linesHtml}`;
      this._linesSection.classList.remove('hidden');
    } else {
      this._linesSection.innerHTML = '';
      this._linesSection.classList.add('hidden');
    }

    this._depth.textContent = hint.depth > 0 ? `depth ${hint.depth}` : '';
    this._showPanel();
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

  private _toggleBook(): void {
    this._bookEnabled = !this._bookEnabled;
    this._syncBookBtn();
    // Persist the choice so the SW uses the right mode on the next position.
    setSettings({ repertoireMode: this._bookEnabled ? 'book' : 'engine' }).catch(() => undefined);
    // Re-render current hint if available
    if (this._pendingHint) this._render(this._pendingHint);
  }

  private _syncBookBtn(): void {
    const on = this._bookEnabled;
    this._bookBtn.setAttribute('aria-pressed', String(on));
    this._bookBtn.textContent = on ? '♟ Book' : '♟ Off';
  }

  private _setSide(side: 'white' | 'black'): void {
    this._playerSide = side;
    this._syncSideToggle();
    this._syncBookName();
    setSettings({ playerSide: side }).catch(() => undefined);
    if (this._pendingHint) this._render(this._pendingHint);
  }

  private _syncSideToggle(): void {
    const isWhite = this._playerSide === 'white';
    this._whiteSideBtn.setAttribute('aria-pressed', String(isWhite));
    this._blackSideBtn.setAttribute('aria-pressed', String(!isWhite));
  }

  private _syncBookName(): void {
    const name = this._playerSide === 'white'
      ? this._whiteBookName
      : this._blackBookName;
    if (name) {
      this._bookNameEl.textContent = `📚 ${name}`;
      this._bookNameEl.className = 'km-book-name km-book-name--loaded';
    } else {
      this._bookNameEl.textContent = 'No book for this color';
      this._bookNameEl.className = 'km-book-name km-book-name--empty';
    }
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
