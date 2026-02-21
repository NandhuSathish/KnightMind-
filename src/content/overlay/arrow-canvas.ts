import type { Move, Color } from '../../shared/chess/types.js';

interface ArrowStyle {
  color: string;
  lineWidth: number;
  opacity: number;
}

const BEST_MOVE_STYLE: ArrowStyle = { color: '#00d26a', lineWidth: 3.5, opacity: 0.85 };

/**
 * Renders move arrows as an absolutely-positioned canvas overlay.
 * pointer-events: none — never blocks user interaction.
 *
 * Must be re-anchored when the board element moves or resizes (SPA navigation).
 */
export class ArrowCanvas {
  private readonly _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D | null;
  private _boardEl: Element | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _currentMoves: Move[] = [];
  private _orientation: Color = 'white';

  constructor() {
    this._canvas = document.createElement('canvas');
    this._canvas.setAttribute('data-knightmind', 'arrows');
    Object.assign(this._canvas.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '100',
    });
    this._ctx = this._canvas.getContext('2d');
  }

  /** Attach the canvas over a specific board element */
  attachTo(boardEl: Element, orientation: Color): void {
    if (this._boardEl === boardEl) return;

    this.detach();
    this._boardEl = boardEl;
    this._orientation = orientation;

    // Board must be position:relative or position:absolute for absolute child
    const pos = getComputedStyle(boardEl as HTMLElement).position;
    if (pos === 'static') {
      (boardEl as HTMLElement).style.position = 'relative';
    }

    boardEl.appendChild(this._canvas);
    this._syncSize();

    this._resizeObserver = new ResizeObserver(() => {
      this._syncSize();
      this._redraw();
    });
    this._resizeObserver.observe(boardEl);
  }

  detach(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._canvas.remove();
    this._boardEl = null;
    this._currentMoves = [];
  }

  drawMoves(moves: Move[], orientation: Color): void {
    this._orientation = orientation;
    this._currentMoves = moves;
    this._redraw();
  }

  clear(): void {
    this._currentMoves = [];
    const { width, height } = this._canvas;
    this._ctx?.clearRect(0, 0, width, height);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _syncSize(): void {
    if (!this._boardEl) return;
    const rect = (this._boardEl as HTMLElement).getBoundingClientRect();
    this._canvas.width = rect.width;
    this._canvas.height = rect.height;
  }

  private _redraw(): void {
    const ctx = this._ctx;
    if (!ctx) return;

    const { width, height } = this._canvas;
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < this._currentMoves.length; i++) {
      const move = this._currentMoves[i];
      if (!move) continue;
      const style: ArrowStyle = {
        ...BEST_MOVE_STYLE,
        opacity: i === 0 ? BEST_MOVE_STYLE.opacity : BEST_MOVE_STYLE.opacity * 0.5,
        lineWidth: i === 0 ? BEST_MOVE_STYLE.lineWidth : BEST_MOVE_STYLE.lineWidth * 0.7,
      };
      this._drawArrow(ctx, move, width, height, style);
    }
  }

  private _drawArrow(
    ctx: CanvasRenderingContext2D,
    move: Move,
    w: number,
    h: number,
    style: ArrowStyle
  ): void {
    const squareW = w / 8;
    const squareH = h / 8;

    const fromCoords = this._squareToCoords(move.from, squareW, squareH);
    const toCoords = this._squareToCoords(move.to, squareW, squareH);

    const dx = toCoords.x - fromCoords.x;
    const dy = toCoords.y - fromCoords.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const headLen = Math.min(squareW * 0.45, 18);
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.globalAlpha = style.opacity;
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = 'round';

    // Shorten line to leave room for arrowhead
    const endX = toCoords.x - Math.cos(angle) * headLen * 0.5;
    const endY = toCoords.y - Math.sin(angle) * headLen * 0.5;

    ctx.beginPath();
    ctx.moveTo(fromCoords.x, fromCoords.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(toCoords.x, toCoords.y);
    ctx.lineTo(
      toCoords.x - headLen * Math.cos(angle - Math.PI / 6),
      toCoords.y - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toCoords.x - headLen * Math.cos(angle + Math.PI / 6),
      toCoords.y - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private _squareToCoords(
    square: string,
    squareW: number,
    squareH: number
  ): { x: number; y: number } {
    const fileIdx = square.charCodeAt(0) - 97; // 'a'=0 … 'h'=7
    const rankIdx = parseInt(square[1] ?? '1', 10) - 1; // '1'=0 … '8'=7

    const col = this._orientation === 'white' ? fileIdx : 7 - fileIdx;
    const row = this._orientation === 'white' ? 7 - rankIdx : rankIdx;

    return {
      x: col * squareW + squareW / 2,
      y: row * squareH + squareH / 2,
    };
  }
}
