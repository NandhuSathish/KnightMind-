/**
 * All overlay styles as CSS template literals.
 * Injected into Shadow DOM — zero pollution of host page styles.
 */
export const PANEL_STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  .km-panel {
    position: fixed;
    z-index: 2147483647;
    bottom: 80px;
    right: 16px;
    width: 220px;
    background: #1a1a2e;
    color: #e0e0e0;
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    font-size: 13px;
    line-height: 1.5;
    contain: layout;
    transition: opacity 0.2s ease;
  }

  .km-panel.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .km-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    color: #a0c4ff;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .km-logo {
    font-size: 16px;
  }

  .km-eval {
    font-size: 22px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 4px;
  }

  .km-eval.negative { color: #ff7b7b; }
  .km-eval.positive { color: #7bffb2; }
  .km-eval.neutral  { color: #ffffff; }

  .km-theme {
    color: #b0b0cc;
    font-size: 12px;
    margin-bottom: 8px;
    min-height: 16px;
  }

  .km-depth {
    color: #555577;
    font-size: 10px;
    text-align: right;
  }

  .km-hint-delay {
    color: #666688;
    font-size: 11px;
    font-style: italic;
  }

  .km-close {
    position: absolute;
    top: 8px;
    right: 10px;
    background: none;
    border: none;
    color: #555577;
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    line-height: 1;
  }

  .km-close:hover { color: #e0e0e0; }
`;
