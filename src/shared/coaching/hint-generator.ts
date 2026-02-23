import type { RawPvLine, RawScore } from '../engine/types.js';
import type { CoachingHints, DifficultyLevel, RuleResult, TacticItem } from './types.js';
import { fenToBoardState } from './board.js';
import { detectMate, detectMaterialCapture, detectCheck, detectFork } from './rules/tactical.js';
import { detectDevelopment, detectKingSafety } from './rules/strategic.js';
import { detectPawnStructure, detectPieceActivity } from './rules/positional.js';
import { detectHanging, detectOpponentThreat, detectBlunder } from './rules/risk.js';

// ─── Difficulty gates ──────────────────────────────────────────────────────────

type RuleName =
  | 'mate' | 'materialCapture' | 'check' | 'fork'
  | 'development' | 'kingSafety'
  | 'pawnStructure' | 'pieceActivity'
  | 'hanging' | 'opponentThreat'
  | 'blunderAlert';

const RULES_BY_DIFFICULTY: Record<DifficultyLevel, ReadonlySet<RuleName>> = {
  beginner:     new Set<RuleName>(['mate', 'materialCapture', 'hanging', 'blunderAlert']),
  intermediate: new Set<RuleName>(['mate', 'materialCapture', 'fork', 'development', 'hanging', 'opponentThreat', 'blunderAlert']),
  advanced:     new Set<RuleName>(['mate', 'materialCapture', 'check', 'fork', 'development', 'kingSafety', 'pawnStructure', 'pieceActivity', 'hanging', 'opponentThreat', 'blunderAlert']),
};

function pickBest(results: (RuleResult | null)[]): string | null {
  let best: RuleResult | null = null;
  for (const r of results) {
    if (r && (!best || r.urgency > best.urgency)) best = r;
  }
  return best?.text ?? null;
}

// ─── HintGenerator ────────────────────────────────────────────────────────────

export class HintGenerator {
  generate(
    pvLines: readonly RawPvLine[],
    fen: string,
    difficulty: DifficultyLevel
  ): CoachingHints {
    const state = fenToBoardState(fen);
    if (!state) return { tactics: [], strategic: null, positional: null, risk: null, blunder: null };

    const on = RULES_BY_DIFFICULTY[difficulty];

    const allTactics: RuleResult[] = [
      ...(on.has('mate')            ? detectMate(pvLines)                   : []),
      ...(on.has('materialCapture') ? detectMaterialCapture(pvLines, state) : []),
      ...(on.has('check')           ? detectCheck(pvLines, state)           : []),
      ...(on.has('fork')            ? detectFork(pvLines, state)            : []),
    ];
    // Deduplicate by moveUCI — same move may match multiple rules; keep highest urgency
    const tacticMap = new Map<string, RuleResult>();
    for (const t of allTactics) {
      const key = t.moveUCI ?? t.text;
      const existing = tacticMap.get(key);
      if (!existing || t.urgency > existing.urgency) tacticMap.set(key, t);
    }
    const tactics: TacticItem[] = [...tacticMap.values()]
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, 6);

    const strategic = pickBest([
      on.has('kingSafety')  ? detectKingSafety(state)  : null,
      on.has('development') ? detectDevelopment(state) : null,
    ]);

    const positional = pickBest([
      on.has('pawnStructure') ? detectPawnStructure(state) : null,
      on.has('pieceActivity') ? detectPieceActivity(state) : null,
    ]);

    const risk = pickBest([
      on.has('hanging')        ? detectHanging(state)                 : null,
      on.has('opponentThreat') ? detectOpponentThreat(pvLines, state) : null,
    ]);

    const blunder = pickBest([
      on.has('blunderAlert') ? detectBlunder(pvLines, state) : null,
    ]);

    return { tactics, strategic, positional, risk, blunder };
  }
}

export const hintGenerator = new HintGenerator();

// ─── Evaluation category ──────────────────────────────────────────────────────

export interface EvalCategory {
  label: string;
  severity: 'decisive' | 'winning' | 'advantage' | 'equal' | 'worse' | 'losing' | 'lost';
}

export function evalToCategory(score: RawScore): EvalCategory {
  if (score.tag === 'mate') {
    return score.moves > 0
      ? { label: `Mate in ${score.moves}`, severity: 'decisive' }
      : { label: `Mated in ${Math.abs(score.moves)}`, severity: 'lost' };
  }
  const v = score.value;
  if (v >=  500) return { label: 'Decisive advantage',  severity: 'winning' };
  if (v >=  200) return { label: 'Clear advantage',     severity: 'winning' };
  if (v >=   50) return { label: 'Slight edge',         severity: 'advantage' };
  if (v >   -50) return { label: 'Equal position',      severity: 'equal' };
  if (v >= -200) return { label: 'Slight disadvantage', severity: 'worse' };
  if (v >= -500) return { label: 'Clear disadvantage',  severity: 'losing' };
  return { label: 'Lost position', severity: 'lost' };
}
