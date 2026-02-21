// ─── State ────────────────────────────────────────────────────────────────────

export type EngineState =
  | 'uninitialized' // never started
  | 'initializing'  // UCI handshake in progress
  | 'ready'         // idle, accepts analysis requests
  | 'analyzing'     // go sent, awaiting bestmove
  | 'disposed';     // worker terminated, instance dead

// ─── Errors ───────────────────────────────────────────────────────────────────

export type EngineErrorCode =
  | 'INIT_FAILED'      // UCI handshake failed
  | 'WASM_LOAD_FAILED' // stockfish.wasm could not be fetched
  | 'ANALYSIS_FAILED'  // engine error during go
  | 'CANCELLED'        // stop() called or AbortSignal fired
  | 'DISPOSED'         // engine.dispose() was called
  | 'TIMEOUT';         // reserved for future deadline support

export class EngineError extends Error {
  override readonly name = 'EngineError' as const;

  constructor(
    public readonly code: EngineErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

// ─── Score ────────────────────────────────────────────────────────────────────

/**
 * Centipawns: positive = advantage for the side to move.
 * Mate: positive = engine delivers mate in N, negative = engine gets mated in N.
 */
export type RawScore =
  | { readonly tag: 'cp';   readonly value: number }
  | { readonly tag: 'mate'; readonly moves: number };

// ─── PV Line ─────────────────────────────────────────────────────────────────

export interface RawPvLine {
  /** UCI move strings in order, e.g. ["e2e4", "e7e5"] */
  readonly moves: readonly string[];
  readonly score: RawScore;
  readonly depth: number;
  /** 1-based index into MultiPV list */
  readonly multiPvIndex: number;
  readonly nodes?: number;
  readonly nps?: number;
}

// ─── Analysis Options ─────────────────────────────────────────────────────────

export interface AnalysisOptions {
  /**
   * Search depth limit. Analysis stops when this depth is reached OR
   * movetime elapses — whichever fires first.
   * Default: 18
   */
  depth?: number;

  /**
   * Wall-clock time limit in milliseconds.
   * Default: 1000ms
   */
  movetime?: number;

  /**
   * Number of principal variations to compute (1–3).
   * Default: 1
   */
  multiPv?: number;

  /**
   * Called for each streaming PV update as analysis progresses.
   * Receives the latest line for each multipv slot.
   * Called from the same microtask queue as the Promise resolution.
   */
  onInfo?: (line: RawPvLine) => void;

  /**
   * Cancels this specific analysis request.
   * If aborted before the request starts, it is removed from the queue.
   * If aborted during analysis, the engine is stopped and the Promise rejects.
   */
  signal?: AbortSignal;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface AnalysisResult {
  /** The FEN that was analyzed */
  readonly fen: string;
  /** Best move in UCI notation, e.g. "e2e4". "(none)" when no legal moves. */
  readonly bestMove: string;
  /** Ponder move (opponent's expected reply), null if not provided. */
  readonly ponder: string | null;
  /** Final PV lines sorted by multiPvIndex ascending */
  readonly lines: readonly RawPvLine[];
  /** Maximum depth reached across all PV lines */
  readonly depth: number;
  /** Wall-clock time from go to bestmove, in milliseconds */
  readonly elapsedMs: number;
}

// ─── Engine Interface ─────────────────────────────────────────────────────────

export interface Engine {
  /**
   * Initialize the engine. Spawns the Stockfish Worker and performs the
   * UCI handshake. Safe to call multiple times — subsequent calls return
   * the same Promise. Automatically called by `analyze()` if needed.
   */
  init(): Promise<void>;

  /**
   * Analyze a FEN position. Returns when the analysis is complete.
   *
   * Requests are serialized — if one is already running, this request is
   * queued and starts only after the previous resolves or rejects.
   *
   * Rejects with `EngineError`:
   * - `CANCELLED` if `stop()` is called or `signal` fires
   * - `DISPOSED` if `dispose()` is called while pending
   * - `ANALYSIS_FAILED` on engine error
   * - `INIT_FAILED` if initialization fails
   */
  analyze(fen: string, options?: AnalysisOptions): Promise<AnalysisResult>;

  /**
   * Immediately cancel the active analysis and clear all queued requests.
   * Active `analyze()` Promises reject with `{ code: 'CANCELLED' }`.
   * Safe to call when idle — no-op.
   */
  stop(): void;

  /**
   * Terminate the Stockfish worker. All pending requests reject with
   * `{ code: 'DISPOSED' }`. The instance cannot be reused after dispose().
   */
  dispose(): void;

  readonly state: EngineState;
}
