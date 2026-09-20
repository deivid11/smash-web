/** Save & quit for Rift Descent: the in-progress run is written after every
 * run step, so closing the tab (or leaving to the home screen) keeps the
 * descent. Like Slay the Spire, a run saved mid-fight resumes at that floor's
 * intro with the state it had when the fight began. The map itself is not
 * stored: `generateRun` rebuilds it from the seed label and run settings.
 */
import type { FighterKind } from '../data.ts';
import { DIFFICULTIES, generateRun, isHeat, RUN_LENGTHS, type GeneratedRun, type RogueRunLength } from './generator.ts';
import { notifyRogueSaved } from './meta.ts';
import type { RogueRun, RunPhase } from './run-state.ts';

export const SUSPENDED_RUN_KEY = 'smash-roguelike-run';
const RESUMABLE: readonly RunPhase[] = ['blessing', 'map', 'intro', 'fight', 'reward', 'spoils', 'shop', 'event', 'rest'];

export interface SuspendedRun {
  format: 1;
  savedAt: number;
  run: RogueRun;
}

/** Only live runs are kept; a fight in progress is stored as its intro. */
export function suspendableRun(run: RogueRun): RogueRun | null {
  if (!RESUMABLE.includes(run.phase)) return null;
  return run.phase === 'fight' ? { ...run, phase: 'intro' } : run;
}

export function parseSuspendedRun(value: unknown): SuspendedRun | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<SuspendedRun>;
  const run = entry.run as Partial<RogueRun> | undefined;
  if (entry.format !== 1 || !run || typeof run !== 'object') return null;
  if (typeof run.seedLabel !== 'string' || typeof run.playerFighter !== 'string' || !RESUMABLE.includes(run.phase as RunPhase)) return null;
  if (!RUN_LENGTHS.includes(run.length as RogueRunLength) || !DIFFICULTIES.includes(run.difficulty!) || !isHeat(run.heat)) return null;
  if (!Number.isInteger(run.row) || run.row! < 0 || run.row! > run.length! || !Number.isFinite(run.lives) || run.lives! <= 0) return null;
  if (!Array.isArray(run.boons) || !Array.isArray(run.path) || !Array.isArray(run.consumables)) return null;
  const phase: RunPhase = run.phase === 'fight' ? 'intro' : run.phase as RunPhase;
  return { format: 1, savedAt: Number.isFinite(entry.savedAt) ? entry.savedAt! : 0, run: { ...(run as RogueRun), phase } };
}

/** The map for a saved run, or null when its settings no longer generate one. */
export function planForRun(run: RogueRun): GeneratedRun | null {
  try {
    const plan = generateRun(run.seedLabel, { length: run.length as RogueRunLength, difficulty: run.difficulty, playerFighter: run.playerFighter as FighterKind, heat: run.heat });
    return plan.seed === run.planSeed && run.row <= plan.length ? plan : null;
  } catch {
    return null;
  }
}

export function loadSuspendedRun(): SuspendedRun | null {
  try {
    const raw = globalThis.localStorage?.getItem(SUSPENDED_RUN_KEY);
    const saved = raw ? parseSuspendedRun(JSON.parse(raw)) : null;
    return saved && planForRun(saved.run) ? saved : null;
  } catch {
    return null;
  }
}

export function saveSuspendedRun(run: RogueRun): void {
  const live = suspendableRun(run);
  if (!live) { clearSuspendedRun(); return; }
  try {
    globalThis.localStorage?.setItem(SUSPENDED_RUN_KEY, JSON.stringify({ format: 1, savedAt: Date.now(), run: live } satisfies SuspendedRun));
  } catch {
    /* private mode: the run lives only in this tab */
  }
  notifyRogueSaved();
}

export function clearSuspendedRun(): void {
  try {
    if (globalThis.localStorage?.getItem(SUSPENDED_RUN_KEY) === null) return;
    globalThis.localStorage?.removeItem(SUSPENDED_RUN_KEY);
  } catch {
    return;
  }
  notifyRogueSaved();
}
