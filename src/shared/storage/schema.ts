import type { ChessSite, ChessVariant } from '../chess/types.js';
import type { DifficultyLevel } from '../coaching/types.js';

export type { DifficultyLevel };

export interface StorageSchema {
  readonly version: 1;
  settings: UserSettings;
  siteConfig: Record<ChessSite, SiteConfig>;
}

export interface UserSettings {
  /** Master on/off switch */
  enabled: boolean;
  /**
   * Milliseconds to wait before revealing the best move hint.
   * 0 = immediate. Prevents trivial cheating feel.
   */
  hintDelayMs: number;
  /** Engine search depth (1–24). Default 18. */
  maxDepth: number;
  /** Number of principal variation lines (1–3). Default 2. */
  multiPv: number;
  /** Render best-move arrows on the board canvas */
  showArrows: boolean;
  /** Render evaluation bar */
  showEvalBar: boolean;
  /** Coaching hint difficulty level */
  difficulty: DifficultyLevel;
  /** 'book' = use repertoire when available; 'engine' = always use Stockfish */
  repertoireMode: 'book' | 'engine';
  /** The color the user is playing — book moves only appear on this side's turns */
  playerSide: 'white' | 'black';
  /**
   * Time control for adaptive engine settings.
   * 'blitz'  → MultiPV 10, Depth 16  (faster, suitable for games under ~5 min)
   * 'rapid'  → MultiPV 13, Depth 20  (deeper, suitable for games ~10 min+)
   */
  timeControl: 'blitz' | 'rapid';
}

export interface SiteConfig {
  enabled: boolean;
  lastDetectedVariant: ChessVariant | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  hintDelayMs: 0,
  maxDepth: 18,
  multiPv: 2,
  showArrows: true,
  showEvalBar: false,
  difficulty: 'intermediate',
  repertoireMode: 'book',
  playerSide: 'white',
  timeControl: 'rapid',
};

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  enabled: true,
  lastDetectedVariant: null,
};

export const DEFAULT_STORAGE: StorageSchema = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  siteConfig: {
    lichess: { ...DEFAULT_SITE_CONFIG },
    'chess-com': { ...DEFAULT_SITE_CONFIG },
  },
};
