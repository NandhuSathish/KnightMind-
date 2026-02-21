import { cp, mate, type PvLine, type Score } from './types.js';
import { uciToMove } from './types.js';

// ─── UCI Commands (host → engine) ────────────────────────────────────────────

export type UCICommand =
  | 'uci'
  | 'isready'
  | 'ucinewgame'
  | `position fen ${string}`
  | `go depth ${number}`
  | `go movetime ${number}`
  | `go depth ${number} movetime ${number}`
  | `setoption name ${string} value ${string}`
  | 'stop'
  | 'quit';

export function cmdPosition(fen: string): UCICommand {
  return `position fen ${fen}`;
}

export function cmdGoDepth(depth: number): UCICommand {
  return `go depth ${depth}`;
}

export function cmdGoMovetime(ms: number): UCICommand {
  return `go movetime ${ms}`;
}

export function cmdGoDepthMovetime(depth: number, ms: number): UCICommand {
  return `go depth ${depth} movetime ${ms}`;
}

export function cmdSetOption(name: string, value: string): UCICommand {
  return `setoption name ${name} value ${value}`;
}

// ─── UCI Responses (engine → host) ───────────────────────────────────────────

export type UCIResponse =
  | { tag: 'uciok' }
  | { tag: 'readyok' }
  | { tag: 'bestmove'; move: string; ponder: string | null }
  | { tag: 'info'; depth: number; score: Score; pv: string[]; multiPv: number }
  | { tag: 'unknown'; raw: string };

/** Parses a single line of UCI engine output. */
export function parseUCILine(line: string): UCIResponse {
  const trimmed = line.trim();

  if (trimmed === 'uciok') return { tag: 'uciok' };
  if (trimmed === 'readyok') return { tag: 'readyok' };

  if (trimmed.startsWith('bestmove')) {
    const parts = trimmed.split(/\s+/);
    const move = parts[1] ?? '';
    const ponderIdx = parts.indexOf('ponder');
    const ponder = ponderIdx !== -1 ? (parts[ponderIdx + 1] ?? null) : null;
    return { tag: 'bestmove', move, ponder };
  }

  if (trimmed.startsWith('info')) {
    return parseInfoLine(trimmed);
  }

  return { tag: 'unknown', raw: trimmed };
}

function parseInfoLine(line: string): UCIResponse {
  const tokens = line.split(/\s+/);
  let depth = 0;
  let score: Score = cp(0);
  let multiPv = 1;
  const pv: string[] = [];

  let i = 1; // skip 'info'
  while (i < tokens.length) {
    const token = tokens[i];
    switch (token) {
      case 'depth':
        depth = parseInt(tokens[++i] ?? '0', 10);
        break;
      case 'multipv':
        multiPv = parseInt(tokens[++i] ?? '1', 10);
        break;
      case 'score': {
        const kind = tokens[++i];
        const val = parseInt(tokens[++i] ?? '0', 10);
        score = kind === 'mate' ? mate(val) : cp(val);
        break;
      }
      case 'pv':
        // rest of tokens are moves
        pv.push(...tokens.slice(i + 1));
        i = tokens.length;
        break;
      default:
        break;
    }
    i++;
  }

  return { tag: 'info', depth, score, pv, multiPv };
}

/** Aggregates streaming UCI info lines into complete PvLines, keyed by multipv index. */
export class PvAggregator {
  private readonly lines = new Map<number, PvLine>();

  update(response: UCIResponse & { tag: 'info' }): void {
    const moves = response.pv
      .map(uciToMove)
      .filter((m): m is NonNullable<typeof m> => m !== null);

    this.lines.set(response.multiPv, {
      moves,
      score: response.score,
      depth: response.depth,
      multiPvIndex: response.multiPv,
    });
  }

  getLines(): PvLine[] {
    return [...this.lines.values()].sort((a, b) => a.multiPvIndex - b.multiPvIndex);
  }

  clear(): void {
    this.lines.clear();
  }
}
