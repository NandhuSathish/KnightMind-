import type { Color } from '../chess/types.js';
import type { BoardState } from '../coaching/types.js';
import { STARTING_FEN, fenPositionKey, piecePlacementFromMap } from '../chess/fen.js';
import { fenToBoardState } from '../coaching/board.js';
import { applyMove } from './move-applicator.js';
import { sanToUCI } from './san-converter.js';
import type { RepertoireEntry, RepertoireIndex } from './types.js';

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a PGN string (one or more games) and build a flat repertoire index
 * keyed by fenPositionKey. Only records moves for the given playerColor.
 */
export function parsePGN(
  pgn: string,
  playerColor: Color
): { index: RepertoireIndex; errors: string[] } {
  const index: RepertoireIndex = new Map();
  const errors: string[] = [];
  const games = splitGames(pgn);

  for (const { header, moveText } of games) {
    const startFen   = header.get('FEN') ?? STARTING_FEN;
    const startState = fenToBoardState(startFen);
    if (!startState) {
      errors.push(`Skipping game — invalid FEN in header: ${startFen}`);
      continue;
    }
    try {
      const lineName = extractLineName(header);
      const ecoCode  = header.get('ECO') ?? undefined;
      traverseMoves(tokenize(moveText), startState, playerColor, index, errors, lineName, ecoCode);
    } catch (err) {
      errors.push(`Parse error: ${String(err)}`);
    }
  }

  return { index, errors };
}

// ─── Tokenizer ─────────────────────────────────────────────────────────────────

type Token =
  | { type: 'san';        text: string }
  | { type: 'move_num' }
  | { type: 'comment';    text: string }
  | { type: 'nag';        value: number }
  | { type: 'var_start' }
  | { type: 'var_end' }
  | { type: 'result' };

function tokenize(moveText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < moveText.length) {
    const ch = moveText[i]!;

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Comment: { ... }
    if (ch === '{') {
      const end = moveText.indexOf('}', i + 1);
      tokens.push({ type: 'comment', text: moveText.slice(i + 1, end === -1 ? undefined : end).trim() });
      i = end === -1 ? moveText.length : end + 1;
      continue;
    }

    // Line comment: ; to end of line
    if (ch === ';') {
      const end = moveText.indexOf('\n', i);
      i = end === -1 ? moveText.length : end + 1;
      continue;
    }

    // Variation delimiters
    if (ch === '(') { tokens.push({ type: 'var_start' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'var_end' });   i++; continue; }

    // NAG: $N
    if (ch === '$') {
      let j = i + 1;
      while (j < moveText.length && /\d/.test(moveText[j]!)) j++;
      const n = parseInt(moveText.slice(i + 1, j), 10);
      tokens.push({ type: 'nag', value: isNaN(n) ? 0 : n });
      i = j;
      continue;
    }

    // Read a word (up to whitespace or special chars)
    let j = i;
    while (j < moveText.length && !/[\s{();]/.test(moveText[j]!)) j++;
    const word = moveText.slice(i, j);
    i = j;

    if (!word) continue;

    // Result tokens
    if (word === '1-0' || word === '0-1' || word === '1/2-1/2' || word === '*') {
      tokens.push({ type: 'result' }); continue;
    }

    // Move numbers: "1.", "23.", "1...", "23..." — digit(s) followed by dots
    if (/^\d+\.+$/.test(word)) {
      tokens.push({ type: 'move_num' }); continue;
    }

    // Annotation glyphs (!!, !?, ?!, ? — no $)
    if (/^[!?]+$/.test(word)) continue; // skip

    // Anything else is a SAN move
    tokens.push({ type: 'san', text: word });
  }

  return tokens;
}

// ─── Game splitter ─────────────────────────────────────────────────────────────

interface GameRecord {
  header:   Map<string, string>;
  moveText: string;
}

function splitGames(pgn: string): GameRecord[] {
  const games: GameRecord[] = [];
  const lines = pgn.replace(/\r\n/g, '\n').split('\n');

  let headerLines: string[] = [];
  let moveLines:   string[] = [];
  let inHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('[')) {
      // If we were in move text, finish the previous game
      if (!inHeader && moveLines.length > 0) {
        games.push({ header: parseHeaders(headerLines.join('\n')), moveText: moveLines.join(' ') });
        headerLines = [];
        moveLines   = [];
      }
      inHeader = true;
      headerLines.push(trimmed);
    } else if (trimmed === '') {
      if (inHeader) inHeader = false; // blank line after headers → move text starts
    } else {
      inHeader = false;
      moveLines.push(trimmed);
    }
  }

  // Final game
  if (moveLines.length > 0) {
    games.push({ header: parseHeaders(headerLines.join('\n')), moveText: moveLines.join(' ') });
  }

  return games;
}

function parseHeaders(text: string): Map<string, string> {
  const map  = new Map<string, string>();
  const re   = /\[(\w+)\s+"([^"]*)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    map.set(m[1]!, m[2]!);
  }
  return map;
}

/**
 * Extract a human-readable line name from PGN game headers.
 * Priority: [Opening] + [Variation] → [Event] → undefined.
 */
function extractLineName(header: Map<string, string>): string | undefined {
  const opening = header.get('Opening');
  if (opening) {
    const variation = header.get('Variation');
    return variation ? `${opening}: ${variation}` : opening;
  }
  const event = header.get('Event');
  if (event && event !== '?' && event !== '') return event;
  return undefined;
}

// ─── Traversal ─────────────────────────────────────────────────────────────────

function traverseMoves(
  tokens:      Token[],
  startState:  BoardState,
  playerColor: Color,
  index:       RepertoireIndex,
  errors:      string[],
  lineName:    string | undefined,
  ecoCode:     string | undefined,
): void {
  /**
   * Stack-based variation traversal.
   *
   * `current` = board state after the last applied move at this depth.
   * `preMoveState` = board state BEFORE the last applied move.
   *
   * When var_start is encountered: we revert to preMoveState (the position
   * before the move that the variation is an alternative to), and push both
   * states so we can restore them on var_end.
   *
   * Annotation tracking
   * ─────────────────────
   * `lastPlayerEntry` / `lastPlayerUCI` point at the most recently recorded
   * player move. PGN comments `{ ... }` that follow a player SAN are attached
   * to that move as `annotation`. The very next opponent SAN is also captured
   * as `opponentResponse` so the UI can show the expected line continuation.
   * Comments do NOT clear the tracking (a comment can precede the opponent
   * response). `var_start`, `var_end`, and parse errors DO clear it.
   */
  let current      = startState;
  let preMoveState = startState;

  const stack: Array<{ pre: BoardState; cur: BoardState }> = [];

  // Annotation / line-preview tracking
  let lastPlayerEntry: RepertoireEntry | null = null;
  let lastPlayerUCI:   string | null = null;

  for (const tok of tokens) {
    if (tok.type === 'result') break;
    if (tok.type === 'move_num' || tok.type === 'nag') continue;

    if (tok.type === 'comment') {
      // Attach comment to the preceding player move as its explanation.
      // Do NOT clear lastPlayer* — an opponent response may still follow.
      if (lastPlayerEntry && lastPlayerUCI && tok.text) {
        const mv = lastPlayerEntry.moves.find(m => m.uci === lastPlayerUCI);
        if (mv && !mv.annotation) mv.annotation = tok.text;
      }
      continue;
    }

    if (tok.type === 'var_start') {
      stack.push({ pre: preMoveState, cur: current });
      current         = preMoveState;
      lastPlayerEntry = null;
      lastPlayerUCI   = null;
      continue;
    }

    if (tok.type === 'var_end') {
      const frame = stack.pop();
      if (frame) {
        preMoveState = frame.pre;
        current      = frame.cur;
      }
      lastPlayerEntry = null;
      lastPlayerUCI   = null;
      continue;
    }

    // tok.type === 'san'
    const result = sanToUCI(current, tok.text);
    if (!result) {
      errors.push(`Could not parse SAN "${tok.text}" (${current.sideToMove} to move)`);
      lastPlayerEntry = null;
      lastPlayerUCI   = null;
      continue;
    }

    // Clean SAN for display: strip PGN annotation symbols (!?), keep check/mate (+#).
    const displaySan = tok.text.replace(/[!?]+$/, '');

    if (current.sideToMove === playerColor) {
      // Player's move — record it in the index.
      const key = boardStateKey(current);
      let entry  = index.get(key);
      if (!entry) {
        entry = { moves: [] };
        if (lineName !== undefined) entry.lineName = lineName;
        if (ecoCode  !== undefined) entry.ecoCode  = ecoCode;
        index.set(key, entry);
      } else {
        // Transposition: only set on first occurrence (main line wins).
        if (entry.lineName === undefined && lineName !== undefined) entry.lineName = lineName;
        if (entry.ecoCode  === undefined && ecoCode  !== undefined) entry.ecoCode  = ecoCode;
      }
      if (!entry.moves.some(m => m.uci === result.uci)) {
        entry.moves.push({ uci: result.uci, san: displaySan });
      }
      // Track so the following comment / opponent SAN can annotate this move.
      lastPlayerEntry = entry;
      lastPlayerUCI   = result.uci;
    } else {
      // Opponent's move — record as `opponentResponse` on the last player move.
      if (lastPlayerEntry && lastPlayerUCI) {
        const mv = lastPlayerEntry.moves.find(m => m.uci === lastPlayerUCI);
        if (mv) {
          if (!mv.opponentResponse)    mv.opponentResponse    = result.uci;
          if (!mv.opponentResponseSan) mv.opponentResponseSan = displaySan;
        }
      }
      // Clear tracking — we're past the player-move context.
      lastPlayerEntry = null;
      lastPlayerUCI   = null;
    }

    preMoveState = current;
    current      = applyMove(current, result.move);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a BoardState to the first-4-field FEN position key. */
function boardStateKey(state: BoardState): string {
  const pieces   = piecePlacementFromMap(state.board);
  const color    = state.sideToMove === 'white' ? 'w' : 'b';
  const castling = state.castling || '-';
  const ep       = state.enPassant ?? '-';
  // Append dummy clock values; fenPositionKey only reads the first 4 fields
  return fenPositionKey(`${pieces} ${color} ${castling} ${ep} 0 1`);
}
