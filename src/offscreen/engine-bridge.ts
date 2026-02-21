import type {
  Engine,
  EngineState,
  AnalysisOptions,
  AnalysisResult,
  RawPvLine,
  RawScore,
} from '../shared/engine/types.js';
import { EngineError } from '../shared/engine/types.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULTS = {
  depth:    18,
  movetime: 1_000,
  multiPv:  1,
  hashMb:   32, // conservative — keeps WASM heap pressure low on low-end hardware
} as const;

// stockfish-18-lite-single: ~7MB WASM, single-threaded, no SharedArrayBuffer.
// Ideal for Chrome MV3 offscreen documents (no COOP/COEP headers required).
const workerUrl = (): string => chrome.runtime.getURL('engine/stockfish.js');

// ─── Internal types ───────────────────────────────────────────────────────────

interface PendingRequest {
  readonly reqId: string;
  readonly fen: string;
  readonly depth: number;
  readonly movetime: number;
  readonly multiPv: number;
  readonly onInfo: ((line: RawPvLine) => void) | undefined;
  readonly signal: AbortSignal | undefined;
  abortHandler: (() => void) | undefined; // set after construction
  startedAt: number;                       // set when dequeued
  readonly resolve: (result: AnalysisResult) => void;
  readonly reject: (err: EngineError) => void;
}

// ─── UCI Parsing ──────────────────────────────────────────────────────────────
// Intentionally inline — keeps this module free of chess-domain imports,
// allowing it to be tested and reused independently.

function parseInfoLine(raw: string): RawPvLine | null {
  const tokens = raw.split(/\s+/);
  if (tokens[0] !== 'info') return null;

  let depth    = 0;
  let multiPv  = 1;
  let score: RawScore = { tag: 'cp', value: 0 };
  let nodes: number | undefined;
  let nps:   number | undefined;
  const pv: string[] = [];
  let hasPv    = false;
  let hasScore = false;

  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    switch (tok) {
      case 'depth':   depth   = parseInt(tokens[++i] ?? '0', 10); break;
      case 'multipv': multiPv = parseInt(tokens[++i] ?? '1', 10); break;
      case 'nodes':   nodes   = parseInt(tokens[++i] ?? '0', 10); break;
      case 'nps':     nps     = parseInt(tokens[++i] ?? '0', 10); break;
      case 'score': {
        const kind = tokens[++i];
        const val  = parseInt(tokens[++i] ?? '0', 10);
        // skip optional lowerbound/upperbound qualifier
        if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') i++;
        score = kind === 'mate'
          ? { tag: 'mate', moves: val }
          : { tag: 'cp',   value: val };
        hasScore = true;
        break;
      }
      case 'pv':
        hasPv = true;
        pv.push(...tokens.slice(i + 1));
        i = tokens.length; // rest of line is the PV move list
        break;
      default:
        break;
    }
    i++;
  }

  if (!hasPv || !hasScore || depth === 0 || pv.length === 0) return null;

  return Object.freeze({
    moves: pv,
    score,
    depth,
    multiPvIndex: multiPv,
    ...(nodes !== undefined && { nodes }),
    ...(nps   !== undefined && { nps }),
  });
}

function parseBestmove(raw: string): { bestMove: string; ponder: string | null } | null {
  if (!raw.startsWith('bestmove')) return null;
  const parts = raw.trim().split(/\s+/);
  const bestMove  = parts[1] ?? '(none)';
  const ponderIdx = parts.indexOf('ponder');
  const ponder    = ponderIdx !== -1 ? (parts[ponderIdx + 1] ?? null) : null;
  return { bestMove, ponder };
}

// ─── PV Accumulator ──────────────────────────────────────────────────────────
// Keeps the latest PV line per multipv slot and the deepest depth seen.
// Replaced on every update (last-depth-wins per slot).

class PvAccumulator {
  private readonly _slots = new Map<number, RawPvLine>();
  private _maxDepth = 0;

  update(line: RawPvLine): void {
    this._slots.set(line.multiPvIndex, line);
    if (line.depth > this._maxDepth) this._maxDepth = line.depth;
  }

  lines(): RawPvLine[] {
    return [...this._slots.values()].sort((a, b) => a.multiPvIndex - b.multiPvIndex);
  }

  get maxDepth(): number { return this._maxDepth; }

  reset(): void {
    this._slots.clear();
    this._maxDepth = 0;
  }
}

// ─── ID generator ─────────────────────────────────────────────────────────────

let _seq = 0;
const nextId = (): string => `sf_${++_seq}`;

// ─── StockfishEngine ──────────────────────────────────────────────────────────

/**
 * Wraps the Stockfish Web Worker (stockfish-18-lite-single) with a typed,
 * Promise-based Engine interface.
 *
 * Lifecycle:
 *   uninitialized → init() → initializing → (uciok + readyok) → ready
 *                                         → analyze() → analyzing → ready (loop)
 *                         → dispose() → disposed (terminal)
 *
 * Concurrency model: serial queue — one analysis runs at a time.
 * stop() cancels active + drains queue; new analyze() calls re-queue.
 */
export class StockfishEngine implements Engine {
  private _worker:      Worker | null = null;
  private _state:       EngineState   = 'uninitialized';
  private _initPromise: Promise<void> | null = null;
  private _initResolve: (() => void)         | null = null;
  private _initReject:  ((e: EngineError) => void) | null = null;
  private _active:      PendingRequest | null = null;
  private readonly _queue: PendingRequest[] = [];
  private readonly _pv = new PvAccumulator();

  // ─── Engine interface ─────────────────────────────────────────────────────

  get state(): EngineState { return this._state; }

  init(): Promise<void> {
    if (this._state === 'disposed') {
      return Promise.reject(new EngineError('DISPOSED', 'Engine has been disposed'));
    }
    if (this._state !== 'uninitialized') {
      // Idempotent — return the same promise for concurrent callers
      return this._initPromise!;
    }

    this._state = 'initializing';
    this._initPromise = new Promise<void>((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject  = reject;
    });

    this._spawnWorker();
    return this._initPromise;
  }

  async analyze(fen: string, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    if (this._state === 'disposed') {
      throw new EngineError('DISPOSED', 'Engine has been disposed');
    }

    // Lazy init — transparent to the caller
    if (this._state === 'uninitialized') {
      await this.init();
    } else if (this._state === 'initializing') {
      await this._initPromise!;
    }

    const {
      depth    = DEFAULTS.depth,
      movetime = DEFAULTS.movetime,
      multiPv  = DEFAULTS.multiPv,
      onInfo,
      signal,
    } = options;

    // Pre-flight: reject immediately if already cancelled
    if (signal?.aborted === true) {
      throw new EngineError('CANCELLED', 'AbortSignal was already aborted');
    }

    return new Promise<AnalysisResult>((resolve, reject) => {
      const req: PendingRequest = {
        reqId: nextId(),
        fen,
        depth,
        movetime,
        multiPv,
        onInfo,
        signal,
        abortHandler: undefined,
        startedAt: 0,
        resolve,
        reject,
      };

      if (signal) {
        const handler = (): void =>
          this._cancelById(req.reqId, 'CANCELLED', 'Aborted via signal');
        req.abortHandler = handler;
        signal.addEventListener('abort', handler, { once: true });
      }

      this._queue.push(req);
      this._drainQueue();
    });
  }

  stop(): void {
    if (this._state === 'disposed') return;

    // Cancel all queued (not yet started) requests
    const drained = this._queue.splice(0);
    for (const req of drained) {
      this._detachSignal(req);
      req.reject(new EngineError('CANCELLED', 'Stopped by caller'));
    }

    if (!this._active) return;

    const active = this._active;
    this._active = null;
    this._detachSignal(active);
    active.reject(new EngineError('CANCELLED', 'Stopped by caller'));

    if (this._state === 'analyzing') {
      // Critical: keep state as 'analyzing' until the worker acknowledges
      // with 'bestmove'. This prevents _drainQueue from starting a new
      // request before the engine is truly idle. The bestmove handler will
      // then transition state → 'ready' and call _drainQueue().
      this._send('stop');
    }
  }

  dispose(): void {
    if (this._state === 'disposed') return;

    if (this._state === 'initializing') {
      this._initReject?.(new EngineError('DISPOSED', 'Engine disposed during init'));
      this._initResolve = null;
      this._initReject  = null;
    }

    const drained = this._queue.splice(0);
    for (const req of drained) {
      this._detachSignal(req);
      req.reject(new EngineError('DISPOSED', 'Engine disposed'));
    }

    if (this._active) {
      this._detachSignal(this._active);
      this._active.reject(new EngineError('DISPOSED', 'Engine disposed'));
      this._active = null;
    }

    this._state = 'disposed';
    this._send('quit');

    if (this._worker) {
      this._worker.removeEventListener('message', this._onMessage);
      this._worker.removeEventListener('error',   this._onError);
      this._worker.terminate();
      this._worker = null;
    }
  }

  // ─── Private: worker lifecycle ────────────────────────────────────────────

  private _spawnWorker(): void {
    const w = new Worker(workerUrl());
    w.addEventListener('message', this._onMessage);
    w.addEventListener('error',   this._onError);
    this._worker = w;
    // Begin UCI handshake — 'uci' → 'uciok' → setoptions → 'isready' → 'readyok'
    this._send('uci');
  }

  // ─── Private: worker message handler ─────────────────────────────────────

  private readonly _onMessage = (event: MessageEvent<string>): void => {
    const line = (typeof event.data === 'string' ? event.data : '').trim();
    if (!line) return;

    switch (this._state) {
      // ── Handshake ──────────────────────────────────────────────────────────
      case 'initializing':
        if (line === 'uciok') {
          this._send(`setoption name Hash value ${DEFAULTS.hashMb}`);
          this._send('setoption name Threads value 1');
          this._send('setoption name UCI_ShowWDL value false');
          this._send('isready');
        } else if (line === 'readyok') {
          this._state = 'ready';
          this._initResolve?.();
          this._initResolve = null;
          this._initReject  = null;
          this._drainQueue();
        }
        // id / option lines during handshake — ignored
        break;

      // ── Analysis output ────────────────────────────────────────────────────
      case 'analyzing': {
        if (line.startsWith('info')) {
          const pv = parseInfoLine(line);
          if (pv) {
            this._pv.update(pv);
            // _active may be null if stop() was called — skip onInfo in that case
            this._active?.onInfo?.(pv);
          }
          break;
        }

        if (line.startsWith('bestmove')) {
          const bm     = parseBestmove(line);
          const active = this._active; // may be null if stop() was already called
          this._active = null;
          this._state  = 'ready';

          if (active && bm) {
            // Normal completion — resolve the promise
            active.resolve({
              fen:       active.fen,
              bestMove:  bm.bestMove,
              ponder:    bm.ponder,
              lines:     this._pv.lines(),
              depth:     this._pv.maxDepth,
              elapsedMs: Date.now() - active.startedAt,
            });
          }
          // If active was null (stop-then-bestmove race): just drain next request
          this._pv.reset();
          this._drainQueue();
          break;
        }
        break;
      }

      // ── Other states: ignore engine output ─────────────────────────────────
      default:
        break;
    }
  };

  private readonly _onError = (event: ErrorEvent): void => {
    const code    = this._state === 'initializing' ? 'INIT_FAILED' : 'ANALYSIS_FAILED';
    const message = event.message ?? 'Worker error';
    const err     = new EngineError(code, message);

    if (this._state === 'initializing') {
      this._initReject?.(err);
      this._initResolve = null;
      this._initReject  = null;
      // Allow retry — reset to uninitialized so init() can be called again
      this._state = 'uninitialized';
      return;
    }

    // Propagate to active request then clear queue
    if (this._active) {
      this._detachSignal(this._active);
      this._active.reject(err);
      this._active = null;
    }
    const drained = this._queue.splice(0);
    for (const req of drained) {
      this._detachSignal(req);
      req.reject(err);
    }
    this._pv.reset();
    this._state = 'ready'; // worker may still be alive; let caller retry
  };

  // ─── Private: queue management ────────────────────────────────────────────

  private _drainQueue(): void {
    if (this._state !== 'ready' || this._active !== null || this._queue.length === 0) return;

    const next = this._queue.shift()!;

    // Skip already-aborted requests without touching the worker
    if (next.signal?.aborted === true) {
      this._detachSignal(next);
      next.reject(new EngineError('CANCELLED', 'Aborted before analysis started'));
      this._drainQueue(); // recurse to try the next in queue
      return;
    }

    this._active = next;
    this._active.startedAt = Date.now();
    this._state = 'analyzing';
    this._pv.reset();

    // Note: 'ucinewgame' is omitted intentionally — it clears the hash table,
    // hurting performance in rapid position sequences (e.g. move-by-move coaching).
    // The engine handles new positions correctly without it.
    this._send(`setoption name MultiPV value ${next.multiPv}`);
    this._send(`position fen ${next.fen}`);
    this._send(`go depth ${next.depth} movetime ${next.movetime}`);
  }

  private _cancelById(reqId: string, code: EngineError['code'], message: string): void {
    // Check queue first (not yet dequeued)
    const idx = this._queue.findIndex(r => r.reqId === reqId);
    if (idx !== -1) {
      const [cancelled] = this._queue.splice(idx, 1);
      if (cancelled) {
        this._detachSignal(cancelled);
        cancelled.reject(new EngineError(code, message));
      }
      return;
    }

    // Check active
    if (this._active?.reqId === reqId) {
      const active = this._active;
      this._active = null;
      this._detachSignal(active);
      active.reject(new EngineError(code, message));
      if (this._state === 'analyzing') {
        // State stays 'analyzing' — _drainQueue fires after worker sends 'bestmove'
        this._send('stop');
      }
    }
  }

  /** Remove the abort listener to prevent memory leaks. */
  private _detachSignal(req: PendingRequest): void {
    if (req.abortHandler && req.signal) {
      req.signal.removeEventListener('abort', req.abortHandler);
    }
  }

  private _send(command: string): void {
    this._worker?.postMessage(command);
  }
}
