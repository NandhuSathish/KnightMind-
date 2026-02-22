# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Production build (minified, no sourcemaps) → dist/
npm run dev          # Development build (inline sourcemaps)
npm run typecheck    # Type-check only, no emit
```

No test runner exists. No linter config exists.

To load in Chrome: open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `dist/`.

## TypeScript Strictness

Three extra flags are enabled beyond `strict: true`:
- **`noUncheckedIndexedAccess`** — every array/map access returns `T | undefined`; use `?.` or explicit `!` after bounds check
- **`exactOptionalPropertyTypes`** — never assign `undefined` to an optional property; either omit the key or use a nullable union
- **`noImplicitOverride`** — mark overridden methods with `override`

Module resolution is `bundler` (not `node`). All imports inside `src/` use `.js` extensions even for `.ts` source files (esbuild requirement).

## Architecture

KnightMind is a Chrome MV3 extension with four isolated JS contexts that communicate via `chrome.runtime.sendMessage`:

```
Content Script  ──POSITION_CHANGED──►  Service Worker  ──ANALYZE──►  Offscreen Doc
     ▲                                      │                              │
     └──────────COACHING_HINT───────────────┘        Stockfish WASM ◄────┘
```

**Service Worker** (`src/background/`) — the coordinator. Ephemeral (can be unloaded at any time). Maintains an in-memory tab registry (evicted after 30 min idle). On `POSITION_CHANGED`: deduplicates by `fenPositionKey` (first 4 FEN fields), forwards to offscreen for analysis, builds a `CoachingHint` from the result, and broadcasts it back to all matching tabs.

**Offscreen Document** (`src/offscreen/`) — exists solely to host Stockfish WASM in a Web Worker (MV3 forbids workers in content scripts). The `EngineBridge` wraps Stockfish's UCI protocol: `ENGINE_INIT` → `ENGINE_READY`, `ANALYZE` → `ANALYSIS_RESULT`.

**Content Script** (`src/content/`) — resolves a site adapter by hostname, starts a `PositionWatcher` (MutationObserver + 300 ms throttle + DOM recovery interval), sends position changes to the SW, and renders the coaching overlay.

**Popup** (`src/popup/`) — reads/writes `UserSettings` via `chrome.storage.local`.

### Message Protocol

All message types and runtime type guards live in `src/shared/messages/protocol.ts`. The three message directions are `ContentToSW`, `SWToContent`, and `SWToOffscreen`/`OffscreenToSW`. Always use the type guards (`isContentToSW`, `isSWToContent`, `isOffscreenToSW`) when receiving messages.

### Site Adapters

Each adapter (`src/content/adapters/`) implements `IBoardAdapter` and extracts positions via two layers:

1. **Layer 1 (confidence: `'full'`)** — reads the site's own JS state (e.g., `window.lichess.analysis.data.game.fen`, or React props on `wc-chess-board`). Returns a complete 6-field FEN with correct active color and castling.
2. **Layer 2 (confidence: `'partial'`)** — reconstructs the position from DOM piece elements, infers active color from move-list parity, estimates castling from home square occupancy.

To add a new site: create an adapter class, register it in `registry.ts`, add host permissions and `content_scripts.matches` in `manifest.json`, add the site key to `ChessSite` in `src/shared/chess/types.ts`, and add default config to `DEFAULT_STORAGE.siteConfig` in `src/shared/storage/schema.ts`.

### Coaching System

`HintGenerator.generate(pvLines, fen, difficulty)` (in `src/shared/coaching/hint-generator.ts`) produces a `CoachingHints` object with four nullable string fields: `tactical`, `strategic`, `positional`, `risk`. Rules are in `src/shared/coaching/rules/`. Each rule returns `{ text, urgency } | null`; `pickBest` selects the highest-urgency result per category. Rules are gated by `RULES_BY_DIFFICULTY` — not all rules run at every difficulty level.

`PIECE_VALUE` and `URGENCY` constants live in `src/shared/coaching/types.ts`. Attack generation helpers (`pieceAttacks`, `getAttackers`, `isAttackedBy`) are in `src/shared/coaching/attack-gen.ts`. Board parsing (`fenToBoardState`, `coordsToSquare`) is in `src/shared/coaching/board.ts`.

### FEN Utilities

`src/shared/chess/fen.ts` is the source of truth for FEN handling:
- `parseFEN` / `serializeFEN` — full parse/serialize
- `validateFEN` — quick structural check
- `fenPositionKey` — returns first 4 FEN fields (pieces + active color + castling + en passant); used everywhere for deduplication
- `fenActiveColor` — extract just the active color without a full parse
- `piecePlacementFromMap` — build placement field from a `Map<Square, Piece>`

### Build System

`scripts/build.ts` uses esbuild. The content script is bundled as **IIFE** (not ESM) because MV3 content scripts run as classic scripts. The service worker, offscreen doc, and popup are bundled as **ESM**. Stockfish binaries are copied from `node_modules/stockfish/bin/` into `dist/engine/`.
