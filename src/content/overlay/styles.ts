/**
 * All overlay styles as CSS template literals.
 * Injected into Shadow DOM — zero pollution of host page styles.
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
    bottom: 48px;
    right: 18px;
    width: 340px;
    background: #1a1a2e;
    color: #e0e0e0;
    border-radius: 12px;
    box-shadow: 0 5px 28px rgba(0, 0, 0, 0.5);
    font-size: 14px;
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
    box-shadow: 0 16px 56px rgba(0, 0, 0, 0.7);
    cursor: grabbing !important;
  }

  /* ─── Header (drag handle) ────────────────────────────────────────────── */

  .km-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 12px 10px 14px;
    cursor: grab;
    border-radius: 12px 12px 0 0;
  }

  .km-panel.km-minimized .km-header {
    border-radius: 12px;
    padding-bottom: 12px;
  }

  .km-logo {
    font-size: 18px;
    flex-shrink: 0;
  }

  .km-title {
    flex: 1;
    color: #a0c4ff;
    font-weight: 600;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ─── Engine status dot ───────────────────────────────────────────────── */

  .km-status {
    width: 8px;
    height: 8px;
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
    gap: 3px;
    flex-shrink: 0;
  }

  .km-btn {
    background: none;
    border: none;
    color: #555577;
    cursor: pointer;
    font-size: 14px;
    padding: 3px 6px;
    border-radius: 5px;
    line-height: 1;
    transition: color 0.1s, background 0.1s;
  }

  .km-btn:hover { color: #e0e0e0; background: rgba(255, 255, 255, 0.07); }
  .km-btn:focus-visible { outline: 2px solid #a0c4ff; outline-offset: 2px; }

  /* ─── Collapsible body ────────────────────────────────────────────────── */

  .km-body {
    padding: 0 14px 12px;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    overflow-x: hidden;
    transition: max-height 0.22s ease, opacity 0.15s ease;
    scrollbar-width: thin;
    scrollbar-color: rgba(160, 196, 255, 0.3) transparent;
  }

  .km-body::-webkit-scrollbar { width: 5px; }
  .km-body::-webkit-scrollbar-track { background: transparent; }
  .km-body::-webkit-scrollbar-thumb { background: rgba(160, 196, 255, 0.3); border-radius: 3px; }
  .km-body::-webkit-scrollbar-thumb:hover { background: rgba(160, 196, 255, 0.55); }

  .km-panel.km-minimized .km-body {
    max-height: 0;
    opacity: 0;
    pointer-events: none;
  }

  /* ─── Evaluation bar ──────────────────────────────────────────────────── */

  .km-evalbar-wrap {
    height: 5px;
    background: rgba(255, 100, 100, 0.22);
    border-radius: 3px;
    margin-bottom: 9px;
    overflow: hidden;
  }

  .km-evalbar-fill {
    height: 100%;
    background: #7bffb2;
    border-radius: 3px;
    width: 50%;
    transition: width 0.4s ease;
  }

  /* ─── Evaluation text ─────────────────────────────────────────────────── */

  .km-eval {
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 5px;
  }

  .km-eval.negative { color: #ff7b7b; }
  .km-eval.positive { color: #7bffb2; }
  .km-eval.neutral  { color: #ffffff; }

  /* ─── Move quality row ────────────────────────────────────────────────── */

  .km-move-quality {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    border-radius: 6px;
    margin-bottom: 7px;
    border-left: 3px solid transparent;
    transition: background 0.2s, border-color 0.2s;
  }

  .km-move-quality.hidden { display: none; }

  .km-mq-symbol {
    font-size: 15px;
    font-weight: 800;
    font-family: 'Georgia', serif;
    flex-shrink: 0;
    width: 22px;
    text-align: center;
    line-height: 1;
  }

  .km-mq-label {
    font-size: 12px;
    font-weight: 700;
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .km-mq-loss {
    font-size: 11px;
    font-family: 'Courier New', monospace;
    font-weight: 600;
    opacity: 0.75;
    flex-shrink: 0;
  }

  .km-mq--best       { background: rgba( 74, 158, 255, 0.14); border-color: #4a9eff; color: #a0c4ff; }
  .km-mq--excellent  { background: rgba(123, 255, 178, 0.14); border-color: #7bffb2; color: #7bffb2; }
  .km-mq--good       { background: rgba(160, 220, 100, 0.13); border-color: #a0dc64; color: #a0dc64; }
  .km-mq--inaccuracy { background: rgba(255, 200,  60, 0.14); border-color: #ffc83c; color: #ffc83c; }
  .km-mq--mistake    { background: rgba(255, 140,  40, 0.14); border-color: #ff8c28; color: #ff9a60; }
  .km-mq--blunder    { background: rgba(255,  60,  60, 0.14); border-color: #ff3c3c; color: #ff7878; }

  /* ─── Theme fallback text ─────────────────────────────────────────────── */

  .km-theme {
    color: #b0b0cc;
    font-size: 13px;
    margin-bottom: 7px;
    min-height: 18px;
  }

  .km-hint-delay {
    color: #666688;
    font-size: 12px;
    font-style: italic;
  }

  /* ─── Coaching categories ─────────────────────────────────────────────── */

  .km-categories {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 7px;
  }

  .km-category {
    font-size: 12px;
    line-height: 1.4;
    padding: 4px 7px;
    border-radius: 5px;
    color: #c0c0d8;
  }

  .km-cat-label {
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: 6px;
    opacity: 0.7;
  }

  .km-blunder    { background: rgba(220,  80, 255, 0.12); border-left: 3px solid #dc50ff; }
  .km-tactical   { background: rgba(255, 100, 100, 0.12); border-left: 3px solid #ff6464; }
  .km-tactic-item { cursor: pointer; transition: background 0.15s, border-color 0.15s; }
  .km-tactic-item:hover { background: rgba(255, 152, 0, 0.16); border-left-color: #ff9800; }
  .km-risk       { background: rgba(255, 180,  60, 0.12); border-left: 3px solid #ffb43c; }
  .km-strategic  { background: rgba(100, 180, 255, 0.12); border-left: 3px solid #64b4ff; }
  .km-positional { background: rgba(100, 220, 130, 0.12); border-left: 3px solid #64dc82; }

  /* ─── Blunder Punisher ────────────────────────────────────────────────── */

  .km-punisher {
    border-radius: 9px;
    margin-bottom: 9px;
    overflow: hidden;
    border: 1px solid transparent;
  }

  .km-punisher-header {
    font-size: 12px;
    font-weight: 700;
    padding: 6px 11px 4px;
    letter-spacing: 0.01em;
  }

  .km-punisher-body {
    padding: 3px 11px 9px;
  }

  .km-punisher-move {
    font-size: 26px;
    font-weight: 800;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.03em;
    line-height: 1.2;
    margin-bottom: 4px;
  }

  .km-punisher-meta {
    display: flex;
    gap: 7px;
    align-items: center;
    margin-bottom: 5px;
    flex-wrap: wrap;
  }

  .km-punisher-type {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.08);
  }

  .km-punisher-eval {
    font-size: 12px;
    font-weight: 700;
    color: #7bffb2;
  }

  .km-punisher-conf {
    font-size: 10px;
    opacity: 0.55;
    margin-left: auto;
  }

  .km-punisher-explain {
    font-size: 11px;
    line-height: 1.45;
    opacity: 0.8;
  }

  .km-punisher--inaccuracy { background: rgba(255, 200,  60, 0.10); border-color: rgba(255, 200,  60, 0.35); }
  .km-punisher--inaccuracy .km-punisher-header { color: #ffc83c; }
  .km-punisher--inaccuracy .km-punisher-move   { color: #ffd96e; }

  .km-punisher--mistake { background: rgba(255, 120,  40, 0.12); border-color: rgba(255, 120,  40, 0.40); }
  .km-punisher--mistake .km-punisher-header { color: #ff7828; }
  .km-punisher--mistake .km-punisher-move   { color: #ff9a60; }

  .km-punisher--blunder { background: rgba(255,  50,  50, 0.13); border-color: rgba(255,  50,  50, 0.45); }
  .km-punisher--blunder .km-punisher-header { color: #ff4444; }
  .km-punisher--blunder .km-punisher-move   { color: #ff7878; }

  /* ─── Alternative engine lines ────────────────────────────────────────── */

  .km-lines {
    margin-bottom: 7px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    overflow: hidden;
  }

  .km-lines-header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666688;
    padding: 5px 9px 3px;
  }

  .km-line-entry {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 9px;
    font-size: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .km-line-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #5555aa;
    flex-shrink: 0;
    width: 28px;
  }

  .km-line-score {
    font-weight: 700;
    font-size: 12px;
    color: #9090b8;
    flex-shrink: 0;
    width: 50px;
  }

  .km-line-moves {
    color: #7878a8;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ─── Controls row ────────────────────────────────────────────────────── */

  .km-controls {
    display: flex;
    gap: 5px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }

  .km-ctrl-btn {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #9090b0;
    font-size: 11px;
    padding: 4px 6px;
    border-radius: 5px;
    cursor: pointer;
    text-align: center;
    white-space: nowrap;
    font-family: inherit;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .km-ctrl-btn:hover { background: rgba(255, 255, 255, 0.1); color: #e0e0e0; }

  .km-ctrl-btn[aria-pressed="true"] {
    background: rgba(74, 158, 255, 0.22);
    border-color: rgba(74, 158, 255, 0.55);
    color: #e0eeff;
    font-weight: 600;
  }

  .km-ctrl-btn:focus-visible { outline: 2px solid #a0c4ff; outline-offset: 2px; }

  /* ─── Source badge ────────────────────────────────────────────────────── */

  .km-source-badge {
    font-size: 12px;
    font-weight: 600;
    padding: 5px 10px;
    border-radius: 6px;
    margin-bottom: 7px;
    text-align: center;
    transition: background 0.2s, color 0.2s;
  }

  .km-source-book      { background: rgba( 74, 158, 255, 0.18); color: #a0c4ff; }
  .km-source-engine    { background: rgba(150, 100, 255, 0.15); color: #c8a8ff; }
  .km-source-outofbook { background: rgba(255, 180,  60, 0.15); color: #ffc87b; }
  .km-source-none      { background: transparent; color: #555577; }
  .km-source-waiting   { background: rgba(  0, 200, 180, 0.13); color: #7be0d4; }

  .km-source-reentered {
    background: rgba(74, 255, 180, 0.20);
    color: #7bffb2;
    font-weight: 700;
    animation: km-reentered-flash 0.6s ease-out;
  }

  @keyframes km-reentered-flash {
    0%   { background: rgba(74, 255, 180, 0.40); }
    100% { background: rgba(74, 255, 180, 0.20); }
  }

  .km-source-deviated { background: rgba(255, 160, 60, 0.18); color: #ffb07b; }

  /* ─── Book name ────────────────────────────────────────────────────────── */

  .km-book-name {
    font-size: 12px;
    padding: 2px 0 7px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .km-book-name--loaded { color: #a0c4ff; }
  .km-book-name--empty  { color: #333355; font-style: italic; }

  /* ─── Section label ────────────────────────────────────────────────────── */

  .km-section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #555577;
    margin: 5px 0 4px;
  }

  .km-section-label.hidden { display: none; }

  /* ─── Side toggle ──────────────────────────────────────────────────────── */

  .km-side-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .km-side-label {
    font-size: 11px;
    color: #666688;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .km-side-toggle {
    display: flex;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .km-side-btn {
    padding: 4px 14px;
    font-size: 12px;
    border: none;
    cursor: pointer;
    font-family: inherit;
    background: transparent;
    color: #444466;
    transition: background 0.12s, color 0.12s;
  }

  .km-side-btn:hover { background: rgba(255, 255, 255, 0.07); color: #aaaacc; }

  .km-side-white[aria-pressed="true"] { background: rgba(240, 238, 210, 0.2); color: #f0eed8; font-weight: 600; }
  .km-side-black[aria-pressed="true"] { background: rgba( 60,  60, 110, 0.7); color: #c8c8ff; font-weight: 600; }

  /* ─── Depth footer ─────────────────────────────────────────────────────── */

  .km-depth {
    color: #555577;
    font-size: 11px;
    text-align: right;
  }

  /* ─── Repertoire book section ──────────────────────────────────────────── */

  .km-repertoire {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    margin-bottom: 7px;
    background: rgba(74, 158, 255, 0.08);
    border-left: 3px solid rgba(74, 158, 255, 0.5);
    border-radius: 5px;
  }

  .km-repertoire.hidden { display: none; }

  .km-rep-line-info {
    font-size: 11px;
    color: #6688cc;
    font-style: italic;
    margin: 2px 0 5px;
  }

  .km-rep-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

  .km-rep-move {
    background: rgba(74, 158, 255, 0.2);
    border: 1px solid rgba(74, 158, 255, 0.45);
    border-radius: 5px;
    padding: 2px 8px;
    font-size: 13px;
    font-family: monospace;
    font-weight: 700;
    color: #c8daff;
    letter-spacing: 0.04em;
  }

  .km-rep-arrow    { color: #555577; font-size: 14px; flex-shrink: 0; }
  .km-rep-opp      { font-family: monospace; font-size: 12px; color: #7878a0; letter-spacing: 0.03em; }
  .km-rep-annotation { font-size: 12px; color: #9090b8; font-style: italic; line-height: 1.45; padding-left: 1px; }

  .km-rep-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 5px;
  }

  .km-rep-header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #555577;
  }

  .km-rep-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: #555577;
    font-size: 10px;
    padding: 0 3px;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .km-rep-toggle:hover { opacity: 1; }

  .km-rep-content--hidden { display: none; }

  .km-rep-entry { display: flex; flex-direction: column; gap: 2px; }

  .km-rep-you,
  .km-rep-then {
    font-size: 11px;
    color: #555577;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .km-rep-response { display: flex; align-items: center; gap: 6px; padding-left: 5px; }

  .km-rep-eco {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.04em;
    color: #7090d0;
    background: rgba(100, 140, 220, 0.14);
    border: 1px solid rgba(100, 140, 220, 0.3);
    border-radius: 4px;
    padding: 1px 6px;
    vertical-align: middle;
    margin-right: 5px;
  }

  .km-rep-ideas {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: 12px;
    color: #9090c0;
    font-style: italic;
    line-height: 1.45;
    padding: 4px 0 2px 6px;
    border-left: 2px solid rgba(160, 120, 255, 0.35);
    margin-top: 4px;
  }

  .km-rep-ideas-label {
    font-size: 10px;
    font-weight: 700;
    font-style: normal;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6060aa;
    flex-shrink: 0;
    padding-top: 1px;
  }

  /* ─── CCT Forcing Moves ───────────────────────────────────────────────── */

  .km-cct {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 10px;
    margin-bottom: 7px;
    background: rgba(255, 180, 50, 0.06);
    border-left: 3px solid rgba(255, 180, 50, 0.45);
    border-radius: 5px;
  }

  .km-cct.hidden { display: none; }

  .km-cct-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1px;
  }

  .km-cct-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #cc9933;
  }

  .km-cct-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: #cc9933;
    font-size: 10px;
    padding: 0 3px;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .km-cct-toggle:hover { opacity: 1; }

  .km-cct-content--hidden { display: none; }

  .km-cct-row { display: flex; align-items: flex-start; gap: 6px; flex-wrap: nowrap; }

  .km-cct-row-label {
    font-size: 11px;
    font-weight: 600;
    color: #8899aa;
    white-space: nowrap;
    flex-shrink: 0;
    padding-top: 3px;
    min-width: 64px;
  }

  .km-cct-moves { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }

  .km-cct-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 12px;
    border: 1px solid;
    cursor: default;
    white-space: nowrap;
  }

  .km-cct-san     { font-family: monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; }
  .km-cct-quality { font-size: 10px; opacity: 0.88; }

  .km-cct-chip--approx { opacity: 0.75; }

  .km-cct-chip--excellent { background: rgba(  0, 230, 118, 0.13); border-color: rgba(  0, 230, 118, 0.45); color: #00e676; }
  .km-cct-chip--good      { background: rgba( 74, 158, 255, 0.13); border-color: rgba( 74, 158, 255, 0.45); color: #5aaeff; }
  .km-cct-chip--playable  { background: rgba(136, 153, 170, 0.10); border-color: rgba(136, 153, 170, 0.35); color: #8899aa; }
  .km-cct-chip--dubious   { background: rgba(255, 152,   0, 0.13); border-color: rgba(255, 152,   0, 0.45); color: #ff9800; }
  .km-cct-chip--bad       { background: rgba(244, 100,  30, 0.13); border-color: rgba(244, 100,  30, 0.45); color: #f46430; }
  .km-cct-chip--losing    { background: rgba(244,  67,  54, 0.13); border-color: rgba(244,  67,  54, 0.45); color: #f44336; }
  .km-cct-chip--mate      { background: rgba(255, 215,   0, 0.18); border-color: rgba(255, 215,   0, 0.65); color: #ffd700; }

  @media (prefers-color-scheme: light) {
    .km-cct { background: rgba(200, 140, 30, 0.06); border-color: rgba(180, 120, 20, 0.4); }
    .km-cct-title  { color: #996600; }
    .km-cct-toggle { color: #996600; }
    .km-cct-row-label { color: #5566aa; }
    .km-cct-chip--excellent { background: rgba(0,180,90,0.12);   border-color: rgba(0,180,90,0.4);   color: #007a40; }
    .km-cct-chip--good      { background: rgba(40,100,200,0.10); border-color: rgba(40,100,200,0.4); color: #1a50b0; }
    .km-cct-chip--playable  { background: rgba(100,110,130,0.08);border-color: rgba(100,110,130,0.3);color: #445566; }
    .km-cct-chip--dubious   { background: rgba(200,100,0,0.10);  border-color: rgba(200,100,0,0.4);  color: #a05000; }
    .km-cct-chip--bad       { background: rgba(180,60,10,0.10);  border-color: rgba(180,60,10,0.4);  color: #883010; }
    .km-cct-chip--losing    { background: rgba(200,40,30,0.10);  border-color: rgba(200,40,30,0.4);  color: #b02020; }
    .km-cct-chip--mate      { background: rgba(180,150,0,0.15);  border-color: rgba(180,150,0,0.5);  color: #806800; }
  }

  /* ─── Re-open FAB ──────────────────────────────────────────────────────── */

  .km-fab {
    position: fixed;
    z-index: 2147483647;
    bottom: 48px;
    right: 18px;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: #1a1a2e;
    border: 1px solid rgba(160, 196, 255, 0.35);
    color: #a0c4ff;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 3px 14px rgba(0, 0, 0, 0.45);
    transition: opacity 0.2s ease, transform 0.15s ease, border-color 0.15s ease;
  }

  .km-fab:hover { transform: scale(1.12); border-color: rgba(160, 196, 255, 0.7); }
  .km-fab:focus-visible { outline: 2px solid #a0c4ff; outline-offset: 2px; }
  .km-fab.hidden { opacity: 0; pointer-events: none; }

  /* ─── Light theme ──────────────────────────────────────────────────────── */

  @media (prefers-color-scheme: light) {
    .km-panel { background: #f4f4fb; color: #1a1a2e; box-shadow: 0 5px 28px rgba(0, 0, 0, 0.18); }

    .km-title { color: #2e5fb5; }
    .km-btn { color: #aaaacc; }
    .km-btn:hover { color: #1a1a2e; background: rgba(0, 0, 0, 0.06); }

    .km-evalbar-wrap { background: rgba(200, 50, 50, 0.12); }
    .km-evalbar-fill { background: #00b35a; }

    .km-eval.neutral  { color: #1a1a2e; }
    .km-eval.positive { color: #007a38; }
    .km-eval.negative { color: #cc2222; }

    .km-theme      { color: #444460; }
    .km-hint-delay { color: #8888aa; }
    .km-depth      { color: #aaaacc; }

    .km-category   { color: #303050; }
    .km-blunder    { background: rgba(160,  20, 200, 0.09); }
    .km-tactical   { background: rgba(200,  60,  60, 0.10); }
    .km-tactic-item:hover { background: rgba(200, 110, 0, 0.14); border-left-color: #cc7700; }
    .km-risk       { background: rgba(200, 130,  20, 0.10); }
    .km-strategic  { background: rgba( 40, 120, 220, 0.10); }
    .km-positional { background: rgba( 20, 160,  80, 0.10); }

    .km-punisher--inaccuracy { background: rgba(200,150, 20, 0.08); border-color: rgba(200,150,20,0.3); }
    .km-punisher--inaccuracy .km-punisher-header { color: #8a6800; }
    .km-punisher--inaccuracy .km-punisher-move   { color: #aa8800; }
    .km-punisher--mistake    { background: rgba(200, 80, 20, 0.09); border-color: rgba(200, 80,20,0.3); }
    .km-punisher--mistake    .km-punisher-header { color: #993300; }
    .km-punisher--mistake    .km-punisher-move   { color: #bb4400; }
    .km-punisher--blunder    { background: rgba(200, 20, 20, 0.09); border-color: rgba(200, 20,20,0.3); }
    .km-punisher--blunder    .km-punisher-header { color: #990000; }
    .km-punisher--blunder    .km-punisher-move   { color: #bb2222; }
    .km-punisher-explain     { color: #404060; }
    .km-punisher-eval        { color: #006633; }

    .km-mq--best       { background: rgba( 46, 95,181, 0.10); border-color: #2e5fb5; color: #2e5fb5; }
    .km-mq--excellent  { background: rgba(  0,140, 70, 0.10); border-color: #008844; color: #006633; }
    .km-mq--good       { background: rgba( 80,160, 20, 0.10); border-color: #50a014; color: #3a7800; }
    .km-mq--inaccuracy { background: rgba(180,130,  0, 0.10); border-color: #b48200; color: #8a6000; }
    .km-mq--mistake    { background: rgba(180, 80,  0, 0.10); border-color: #b45000; color: #8a3800; }
    .km-mq--blunder    { background: rgba(180, 20, 20, 0.10); border-color: #b41414; color: #880000; }

    .km-lines        { border-color: rgba(0,0,0,0.08); }
    .km-lines-header { color: #9999bb; }
    .km-line-entry   { border-top-color: rgba(0,0,0,0.05); }
    .km-line-label   { color: #8888cc; }
    .km-line-score   { color: #555577; }
    .km-line-moves   { color: #777799; }

    .km-ctrl-btn { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.12); color: #555577; }
    .km-ctrl-btn:hover { background: rgba(0,0,0,0.08); color: #1a1a2e; }
    .km-ctrl-btn[aria-pressed="true"] { background: rgba(46,95,181,0.18); border-color: rgba(46,95,181,0.5); color: #1a3a7a; font-weight: 600; }

    .km-source-book      { background: rgba( 46,  95, 181, 0.10); color: #2e5fb5; }
    .km-source-engine    { background: rgba(120,  70, 200, 0.10); color: #6a3ab0; }
    .km-source-outofbook { background: rgba(180, 110,  10, 0.10); color: #8a5a00; }
    .km-source-none      { color: #9090b0; }
    .km-source-waiting   { background: rgba(  0, 160, 140, 0.10); color: #007a70; }
    .km-source-reentered { background: rgba(  0, 180, 100, 0.14); color: #006a3a; font-weight: 700; }
    .km-source-deviated  { background: rgba(180, 100,  10, 0.12); color: #7a4a00; }

    .km-book-name--loaded { color: #2e5fb5; }
    .km-book-name--empty  { color: #aaaacc; }

    .km-section-label { color: #9090b0; }

    .km-side-label  { color: #9090b0; }
    .km-side-toggle { border-color: rgba(0,0,0,0.12); }
    .km-side-btn    { color: #aaaacc; }
    .km-side-white[aria-pressed="true"] { background: rgba(200,200,150,.25); color: #3a3a10; }
    .km-side-black[aria-pressed="true"] { background: rgba( 40, 40, 80, .15); color: #2e3070; }

    .km-repertoire  { background: rgba(46, 95, 181, 0.07); border-color: rgba(46, 95, 181, 0.4); }
    .km-rep-move    { background: rgba(46, 95, 181, 0.15); border-color: rgba(46, 95, 181, 0.35); color: #1a3a7a; }
    .km-rep-opp        { color: #7070a0; }
    .km-rep-annotation { color: #5060a0; }
    .km-rep-eco     { color: #3a5090; background: rgba(60, 90, 180, 0.10); border-color: rgba(60, 90, 180, 0.25); }
    .km-rep-ideas   { color: #505080; border-color: rgba(100, 70, 180, 0.3); }
    .km-rep-ideas-label { color: #4040a0; }
  }
`;
