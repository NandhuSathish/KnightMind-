import type { IBoardAdapter } from './adapter.interface.js';
import { LichessAdapter } from './lichess.adapter.js';
import { ChessComAdapter } from './chess-com.adapter.js';

type AdapterFactory = () => IBoardAdapter;

/**
 * Maps hostnames to adapter factories.
 * Add new sites here without touching any other module.
 */
const ADAPTER_REGISTRY = new Map<string, AdapterFactory>([
  ['lichess.org', () => new LichessAdapter()],
  ['www.chess.com', () => new ChessComAdapter()],
]);

/**
 * Resolves the correct adapter for the current page.
 * Returns null if the site is not supported.
 */
export function resolveAdapter(hostname: string): IBoardAdapter | null {
  const factory = ADAPTER_REGISTRY.get(hostname);
  return factory?.() ?? null;
}

export function getSupportedHostnames(): readonly string[] {
  return [...ADAPTER_REGISTRY.keys()];
}
