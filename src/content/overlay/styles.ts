/**
 * All overlay styles as CSS template literals.
 * Injected into Shadow DOM — zero pollution of host page styles.
 *
 * Design principles:
 *  - Position via transform only (compositor-friendly, no layout thrash).
 *  - Transitions on opacity/max-height/width — never on top/left.
 *  - Light theme via @media prefers-color-scheme.
 *  - Focus-visible rings for keyboard accessibility.
 */
export const PANEL_STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  /* ─── Panel container ─────────────────────────────────────────────────── */

  .km-panel {
    position: fixed;
    z-index: 2147483647;
    bottom: 80px;
    right: 16px;
    width: 240px;
    background: #1a1a2e;
    color: #e0e0e0;
    border-radius: 10px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    font-size: 13px;
    line-height: 1.5;
    contain: layout style;
    user-select: none;
    transition: opacity 0.2s ease, box-shadow 0.15s ease;
  }

  .km-panel.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .km-panel.km-dragging {
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.7);
    cursor: grabbing !important;
  }

  /* ─── Header (drag handle) ────────────────────────────────────────────── */

  .km-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 10px 8px 12px;
    cursor: grab;
    border-radius: 10px 10px 0 0;
  }

  .km-panel.km-minimized .km-header {
    border-radius: 10px;
    padding-bottom: 10px;
  }

  .km-logo {
    font-size: 16px;
    flex-shrink: 0;
  }

  .km-title {
    flex: 1;
    color: #a0c4ff;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ─── Engine status dot ───────────────────────────────────────────────── */

  .km-status {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: #555577;
    transition: background 0.3s ease;
  }

  .km-status--ready   { background: #7bffb2; }
  .km-status--crashed { background: #ff6464; }
  .km-status--loading {
    background: #ffb43c;
    animation: km-pulse 1.2s ease-in-out infinite;
  }

  @keyframes km-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  /* ─── Header buttons ──────────────────────────────────────────────────── */

  .km-header-btns {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .km-btn {
    background: none;
    border: none;
    color: #555577;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 5px;
    border-radius: 4px;
    line-height: 1;
    transition: color 0.1s, background 0.1s;
  }

  .km-btn:hover { color: #e0e0e0; background: rgba(255, 255, 255, 0.07); }
  .km-btn:focus-visible { outline: 2px solid #a0c4ff; outline-offset: 2px; }

  /* ─── Collapsible body ────────────────────────────────────────────────── */

  .km-body {
    padding: 0 12px 10px;
    max-height: 600px;
    overflow: hidden;
    transition: max-height 0.22s ease, opacity 0.15s ease;
  }

  .km-panel.km-minimized .km-body {
    max-height: 0;
    opacity: 0;
    pointer-events: none;
  }

  /* ─── Evaluation bar ──────────────────────────────────────────────────── */

  .km-evalbar-wrap {
    height: 4px;
    background: rgba(255, 100, 100, 0.22);
    border-radius: 2px;
    margin-bottom: 7px;
    overflow: hidden;
  }

  .km-evalbar-fill {
    height: 100%;
    background: #7bffb2;
    border-radius: 2px;
    width: 50%;
    transition: width 0.4s ease;
  }

  /* ─── Evaluation text ─────────────────────────────────────────────────── */

  .km-eval {
    font-size: 22px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 4px;
  }

  .km-eval.negative { color: #ff7b7b; }
  .km-eval.positive { color: #7bffb2; }
  .km-eval.neutral  { color: #ffffff; }

  /* ─── Theme fallback text ─────────────────────────────────────────────── */

  .km-theme {
    color: #b0b0cc;
    font-size: 12px;
    margin-bottom: 6px;
    min-height: 16px;
  }

  .km-hint-delay {
    color: #666688;
    font-size: 11px;
    font-style: italic;
  }

  /* ─── Coaching categories ─────────────────────────────────────────────── */

  .km-categories {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 6px;
  }

  .km-category {
    font-size: 11px;
    line-height: 1.4;
    padding: 3px 6px;
    border-radius: 4px;
    color: #c0c0d8;
  }

  .km-cat-label {
    font-weight: 700;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: 5px;
    opacity: 0.7;
  }

  .km-tactical   { background: rgba(255, 100, 100, 0.12); border-left: 2px solid #ff6464; }
  .km-risk       { background: rgba(255, 180,  60, 0.12); border-left: 2px solid #ffb43c; }
  .km-strategic  { background: rgba(100, 180, 255, 0.12); border-left: 2px solid #64b4ff; }
  .km-positional { background: rgba(100, 220, 130, 0.12); border-left: 2px solid #64dc82; }

  /* ─── Controls row ────────────────────────────────────────────────────── */

  .km-controls {
    display: flex;
    gap: 4px;
    margin-bottom: 5px;
    flex-wrap: wrap;
  }

  .km-ctrl-btn {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #9090b0;
    font-size: 10px;
    padding: 3px 5px;
    border-radius: 4px;
    cursor: pointer;
    text-align: center;
    white-space: nowrap;
    font-family: inherit;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .km-ctrl-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e0e0e0;
  }

  .km-ctrl-btn[aria-pressed="true"] {
    color: #a0c4ff;
    border-color: rgba(160, 196, 255, 0.35);
  }

  .km-ctrl-btn:focus-visible { outline: 2px solid #a0c4ff; outline-offset: 2px; }

  /* ─── Depth footer ────────────────────────────────────────────────────── */

  .km-depth {
    color: #555577;
    font-size: 10px;
    text-align: right;
  }

  /* ─── Light theme ─────────────────────────────────────────────────────── */

  @media (prefers-color-scheme: light) {
    .km-panel {
      background: #f4f4fb;
      color: #1a1a2e;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
    }

    .km-title { color: #2e5fb5; }

    .km-btn { color: #aaaacc; }
    .km-btn:hover { color: #1a1a2e; background: rgba(0, 0, 0, 0.06); }

    .km-evalbar-wrap  { background: rgba(200, 50, 50, 0.12); }
    .km-evalbar-fill  { background: #00b35a; }

    .km-eval.neutral  { color: #1a1a2e; }
    .km-eval.positive { color: #007a38; }
    .km-eval.negative { color: #cc2222; }

    .km-theme      { color: #444460; }
    .km-hint-delay { color: #8888aa; }
    .km-depth      { color: #aaaacc; }

    .km-category   { color: #303050; }
    .km-tactical   { background: rgba(200,  60,  60, 0.10); }
    .km-risk       { background: rgba(200, 130,  20, 0.10); }
    .km-strategic  { background: rgba( 40, 120, 220, 0.10); }
    .km-positional { background: rgba( 20, 160,  80, 0.10); }

    .km-ctrl-btn {
      background: rgba(0, 0, 0, 0.04);
      border-color: rgba(0, 0, 0, 0.12);
      color: #555577;
    }
    .km-ctrl-btn:hover { background: rgba(0, 0, 0, 0.08); color: #1a1a2e; }
    .km-ctrl-btn[aria-pressed="true"] { color: #2e5fb5; border-color: rgba(46, 95, 181, 0.35); }
  }
`;
