/**
 * Engine usage examples — not bundled into the extension.
 * These illustrate the full public API of StockfishEngine.
 */
import { StockfishEngine } from './engine-bridge.js';
import { EngineError } from '../shared/engine/types.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

// ─── Example 1: Basic analysis ────────────────────────────────────────────────
// init() is optional — analyze() calls it automatically (lazy init).
// The result is a fully resolved AnalysisResult with bestMove and all PV lines.

async function basicExample(): Promise<void> {
  const engine = new StockfishEngine();

  try {
    const result = await engine.analyze(STARTING_FEN, {
      depth:    15,
      movetime: 500,
    });

    console.log('Best move:', result.bestMove);             // e.g. "e2e4"
    console.log('Ponder:   ', result.ponder);              // e.g. "e7e5"
    console.log('Eval:     ', result.lines[0]?.score);    // { tag: 'cp', value: 18 }
    console.log('Depth:    ', result.depth);               // 15
    console.log('Time:     ', result.elapsedMs, 'ms');
  } finally {
    engine.dispose();
  }
}

// ─── Example 2: Streaming PV updates ─────────────────────────────────────────
// onInfo is called for every PV update as analysis deepens.
// Useful for showing a live eval bar or progressive best-move hints.

async function streamingExample(): Promise<void> {
  const engine = new StockfishEngine();

  try {
    const result = await engine.analyze(AFTER_E4_FEN, {
      depth:   20,
      multiPv: 3,
      onInfo: (line) => {
        const score = line.score.tag === 'cp'
          ? `${(line.score.value / 100).toFixed(2)}`
          : `M${line.score.moves}`;
        console.log(
          `[depth ${line.depth}] PV${line.multiPvIndex}: ${score} ${line.moves.slice(0, 3).join(' ')}`
        );
      },
    });

    console.log('\nFinal lines:');
    for (const line of result.lines) {
      console.log(`  PV${line.multiPvIndex}:`, line.moves[0], line.score);
    }
  } finally {
    engine.dispose();
  }
}

// ─── Example 3: AbortSignal cancellation ──────────────────────────────────────
// Each analyze() call accepts an independent AbortSignal.
// On abort: the Promise rejects with EngineError { code: 'CANCELLED' }.
// The engine keeps running for subsequent requests.

async function cancellationExample(): Promise<void> {
  const engine = new StockfishEngine();

  const ac = new AbortController();
  // Cancel after 300ms regardless of depth
  const timer = setTimeout(() => ac.abort(), 300);

  try {
    const result = await engine.analyze(STARTING_FEN, {
      depth:    24,
      movetime: 10_000,
      signal:   ac.signal,
    });
    console.log('Completed at depth', result.depth); // may complete before timeout
  } catch (err) {
    if (err instanceof EngineError && err.code === 'CANCELLED') {
      console.log('Analysis cancelled as expected');
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
    engine.dispose();
  }
}

// ─── Example 4: Serial queue — concurrent analyze() calls ────────────────────
// Requests queue automatically. Both promises resolve in order.
// Use stop() to cancel all pending + active requests at once.

async function queueExample(): Promise<void> {
  const engine = new StockfishEngine();
  await engine.init(); // explicit init — avoids double-init on concurrent analyze()

  const ac1 = new AbortController();
  const ac2 = new AbortController();

  // Both requests are submitted immediately — second queues behind first
  const p1 = engine.analyze(STARTING_FEN, { depth: 10, signal: ac1.signal });
  const p2 = engine.analyze(AFTER_E4_FEN, { depth: 10, signal: ac2.signal });

  const [r1, r2] = await Promise.allSettled([p1, p2]);

  if (r1.status === 'fulfilled') console.log('Position 1 best:', r1.value.bestMove);
  if (r2.status === 'fulfilled') console.log('Position 2 best:', r2.value.bestMove);

  engine.dispose();
}

// ─── Example 5: stop() — cancel active + clear entire queue ──────────────────

async function stopExample(): Promise<void> {
  const engine = new StockfishEngine();
  await engine.init();

  // Queue three analyses
  const p1 = engine.analyze(STARTING_FEN, { depth: 20 });
  const p2 = engine.analyze(AFTER_E4_FEN, { depth: 20 });
  const p3 = engine.analyze(STARTING_FEN, { depth: 20 });

  // Cancel all of them 100ms later
  setTimeout(() => engine.stop(), 100);

  const results = await Promise.allSettled([p1, p2, p3]);
  for (const r of results) {
    if (r.status === 'rejected' && r.reason instanceof EngineError) {
      console.log('Rejected:', r.reason.code); // 'CANCELLED'
    }
  }

  engine.dispose();
}

// ─── Run examples ─────────────────────────────────────────────────────────────

void basicExample();
void streamingExample();
void cancellationExample();
void queueExample();
void stopExample();
