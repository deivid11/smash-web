/** Local tournaments live on this device (localStorage), so a bracket can be
 * paused at any set and picked up days later; several run side by side. The
 * bracket rules are lib/game/tournament/bracket.ts — this file only persists.
 */
import { createTournament, type CpuFill, type TournamentRules, type TournamentState } from '../../../../lib/game/tournament/bracket.ts';
import { MENU_FIGHTER_ORDER } from '../../../../lib/game/roster.ts';

const KEY = 'smash-tournaments';
/** Finished brackets beyond this are dropped, oldest first; running ones are never dropped. */
const MAX_FINISHED = 12;

function valid(value: unknown): value is TournamentState {
  const state = value as TournamentState | null;
  return !!state && state.version === 1 && typeof state.id === 'string' && Array.isArray(state.entrants) && Array.isArray(state.matches) && typeof state.rules === 'object';
}
export function loadLocalTournaments(): TournamentState[] {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(valid).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch { return []; }
}
function write(list: TournamentState[]): void {
  const running = list.filter(state => state.status === 'active');
  const finished = list.filter(state => state.status !== 'active').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_FINISHED);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify([...running, ...finished])); } catch { /* private mode / quota: the bracket lasts for the session */ }
}
export function saveLocalTournament(state: TournamentState): void {
  write([state, ...loadLocalTournaments().filter(entry => entry.id !== state.id)]);
}
export function deleteLocalTournament(id: string): void {
  write(loadLocalTournaments().filter(entry => entry.id !== id));
}
export function newLocalTournament(input: { name: string; rules: TournamentRules; fill: CpuFill; size?: number; players: readonly string[] }): TournamentState {
  const seed = (Math.random() * 0x100000000) >>> 0;
  const state = createTournament({
    id: `L${Date.now().toString(36)}${seed.toString(36).slice(0, 3)}`.toUpperCase(), name: input.name, rules: input.rules, fill: input.fill, size: input.size, seed,
    humans: input.players.map(name => ({ name })), fighters: MENU_FIGHTER_ORDER, now: Date.now(),
  });
  saveLocalTournament(state);
  return state;
}
