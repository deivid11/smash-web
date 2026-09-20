/** Tournament brackets: pure data shared by the local (localStorage) and the
 * LAN (server, SQLite) tournaments. Single elimination, 1-v-1 sets. The tree is
 * derived from the entrant count alone: the bracket is the next power of two,
 * humans take the top seeds, CPUs (when the fill is on) the bottom ones and
 * whatever is left becomes byes — so byes and CPUs always meet the top seeds
 * first and two byes can never face each other. No DOM, no assets, no clock:
 * every random decision threads through the caller's seed.
 */

export type TournamentMode = 'classic' | 'hill' | 'random';
export const TOURNAMENT_MODES: readonly TournamentMode[] = ['classic', 'hill', 'random'];
export const MODE_LABELS: Readonly<Record<TournamentMode, string>> = { classic: 'CLASSIC', hill: 'KING OF THE HILL', random: 'RANDOM CHAMP' };
export const MODE_NOTES: Readonly<Record<TournamentMode, string>> = {
  classic: 'Pick your fighter every set. Stocks and a clock, last one standing advances.',
  hill: 'Hold the zones for points. Infinite lives: the clock decides who advances.',
  random: 'Nobody picks: a random champion is rolled for both sides every set.',
};

export const MIN_ENTRANTS = 2;
export const MAX_ENTRANTS = 32;
export const MAX_TOURNAMENT_NAME = 32;
export const MAX_ENTRANT_NAME = 24;

export interface TournamentRules {
  mode: TournamentMode;
  /** 1-9. Ignored by King of the Hill (infinite lives). */
  stocks: number;
  /** Match clock, 60-600 s. */
  seconds: number;
  /** King of the Hill zones. */
  hillZones: 1 | 2;
}
export const DEFAULT_RULES: Readonly<TournamentRules> = Object.freeze({ mode: 'classic', stocks: 3, seconds: 180, hillZones: 2 });

/** Random CPUs that pad the bracket to `size`; their level rolls inside [min, max]. */
export interface CpuFill { enabled: boolean; min: number; max: number }
export const DEFAULT_FILL: Readonly<CpuFill> = Object.freeze({ enabled: true, min: 6, max: 9 });

export interface Entrant {
  /** Index into `entrants`; also the seed order (0 = top seed). */
  id: number;
  kind: 'human' | 'cpu';
  name: string;
  /** LAN tournaments: the account behind a human entrant. */
  userId?: number;
  username?: string;
  /** Fighter kind shown as the portrait: a human's profile avatar, a CPU's fighter. */
  avatar?: string;
  /** CPU only: the fighter it plays (classic / hill) and its level. */
  fighter?: string;
  level?: number;
}

export type MatchStatus = 'pending' | 'ready' | 'done' | 'bye';
export interface BracketMatch {
  id: number;
  /** 0 = first round; `rounds - 1` = the final. */
  round: number;
  /** Position inside the round, top to bottom. */
  index: number;
  /** Entrant ids; null = not decided yet (or the empty side of a bye). */
  a: number | null;
  b: number | null;
  winner: number | null;
  status: MatchStatus;
  /** How the set was settled, for the bracket caption. */
  note?: 'played' | 'simulated' | 'walkover';
  /** Draws replayed before someone won. */
  replays?: number;
  finishedAt?: number;
}

export interface TournamentState {
  version: 1;
  id: string;
  name: string;
  rules: TournamentRules;
  fill: CpuFill;
  seed: number;
  entrants: Entrant[];
  /** Bracket size (power of two). */
  size: number;
  rounds: number;
  matches: BracketMatch[];
  status: 'active' | 'complete' | 'cancelled';
  champion: number | null;
  createdAt: number;
  updatedAt: number;
}

// ——— Deterministic randomness ———

/** mulberry32 step: returns [value in 0..1, next state]. */
export function rngStep(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
export class SeededRng {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number { const [value, state] = rngStep(this.state); this.state = state; return value; }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]!; }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
    return out;
  }
}

// ——— Shape ———

export function bracketSize(entrants: number): number {
  let size = 2;
  while (size < entrants) size *= 2;
  return size;
}
/** Bracket sizes a wizard may offer for `humans` players (the fill pads up to the choice). */
export function sizeChoices(humans: number): number[] {
  const out: number[] = [];
  for (let size = bracketSize(Math.max(MIN_ENTRANTS, humans)); size <= MAX_ENTRANTS; size *= 2) out.push(size);
  return out;
}
/** Standard seeding: slot order of seeds for a power-of-two bracket, e.g. 8 → [0,7,3,4,1,6,2,5]. */
export function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const width = order.length * 2;
    order = order.flatMap(seed => [seed, width - 1 - seed]);
  }
  return order;
}
export function roundName(round: number, rounds: number): string {
  const left = rounds - round;
  if (left <= 1) return 'GRAND FINAL';
  if (left === 2) return 'SEMIFINALS';
  if (left === 3) return 'QUARTERFINALS';
  return `ROUND OF ${2 ** left}`;
}

// ——— Validation ———

export function validRules(value: unknown): value is TournamentRules {
  if (typeof value !== 'object' || value === null) return false;
  const rules = value as Record<string, unknown>;
  return Object.keys(rules).every(key => ['mode', 'stocks', 'seconds', 'hillZones'].includes(key))
    && TOURNAMENT_MODES.includes(rules.mode as TournamentMode)
    && Number.isInteger(rules.stocks) && (rules.stocks as number) >= 1 && (rules.stocks as number) <= 9
    && Number.isInteger(rules.seconds) && (rules.seconds as number) >= 60 && (rules.seconds as number) <= 600
    && (rules.hillZones === 1 || rules.hillZones === 2);
}
export function validFill(value: unknown): value is CpuFill {
  if (typeof value !== 'object' || value === null) return false;
  const fill = value as Record<string, unknown>;
  return Object.keys(fill).every(key => ['enabled', 'min', 'max'].includes(key)) && typeof fill.enabled === 'boolean'
    && Number.isInteger(fill.min) && Number.isInteger(fill.max) && (fill.min as number) >= 1 && (fill.max as number) <= 9 && (fill.min as number) <= (fill.max as number);
}

// ——— Construction ———

export interface HumanSeed { name: string; userId?: number; username?: string; avatar?: string }
export interface CreateOptions {
  id: string;
  name: string;
  rules: TournamentRules;
  fill: CpuFill;
  seed: number;
  humans: readonly HumanSeed[];
  /** Bracket size to pad to when the fill is on; defaults to the next power of two. */
  size?: number;
  /** Fighter kinds the CPUs may roll. */
  fighters: readonly string[];
  now: number;
}

const CPU_NAMES = ['BLAZE', 'NOVA', 'ONYX', 'VOLT', 'ECHO', 'TITAN', 'RAZOR', 'COMET', 'FANG', 'GLITCH', 'HAVOC', 'IRIS', 'JINX', 'KAISER', 'LYNX', 'MIRAGE', 'NITRO', 'OMEGA', 'PIXEL', 'QUAKE', 'RONIN', 'SABLE', 'TALON', 'ULTRA', 'VIPER', 'WRAITH', 'XENON', 'YETI', 'ZENITH', 'ATLAS', 'BOLT', 'CINDER'];

export function createTournament(options: CreateOptions): TournamentState {
  const { humans, fill, rules } = options;
  if (!validRules(rules)) throw new Error('Invalid tournament rules.');
  if (!validFill(fill)) throw new Error('Invalid CPU fill.');
  if (!options.fighters.length) throw new Error('No fighters to roll CPUs from.');
  if (humans.length < 1 || humans.length > MAX_ENTRANTS) throw new Error(`Tournaments take 1 to ${MAX_ENTRANTS} players.`);
  const natural = bracketSize(Math.max(MIN_ENTRANTS, humans.length));
  const size = fill.enabled ? Math.max(natural, options.size ?? natural) : natural;
  if (size > MAX_ENTRANTS || size !== bracketSize(size)) throw new Error('Invalid bracket size.');
  const cpus = fill.enabled ? size - humans.length : 0;
  if (humans.length + cpus < MIN_ENTRANTS) throw new Error('A tournament needs at least two entrants: add players or turn the CPU fill on.');
  const rng = new SeededRng(options.seed);
  const names = rng.shuffle(CPU_NAMES);
  const entrants: Entrant[] = [
    ...rng.shuffle(humans).map(human => ({ kind: 'human' as const, ...human })),
    ...Array.from({ length: cpus }, (_, index) => {
      const fighter = rng.pick(options.fighters);
      return { kind: 'cpu' as const, name: `${names[index % names.length]!}`, fighter, avatar: fighter, level: rng.int(fill.min, fill.max) };
    }),
  ].map((entrant, id) => ({ id, ...entrant }));
  const rounds = Math.log2(size), order = seedOrder(size), matches: BracketMatch[] = [];
  for (let round = 0, id = 0; round < rounds; round++) {
    for (let index = 0; index < size / 2 ** (round + 1); index++, id++) {
      const seat = (slot: number): number | null => (round === 0 && order[slot]! < entrants.length ? order[slot]! : null);
      matches.push({ id, round, index, a: seat(index * 2), b: seat(index * 2 + 1), winner: null, status: 'pending' });
    }
  }
  const state: TournamentState = { version: 1, id: options.id, name: options.name, rules: { ...rules }, fill: { ...fill }, seed: options.seed >>> 0, entrants, size, rounds, matches, status: 'active', champion: null, createdAt: options.now, updatedAt: options.now };
  settle(state, options.now);
  return state;
}

// ——— Progress ———

export function matchAt(state: TournamentState, round: number, index: number): BracketMatch | undefined {
  return state.matches.find(match => match.round === round && match.index === index);
}
export function nextMatch(state: TournamentState, match: BracketMatch): BracketMatch | undefined {
  return matchAt(state, match.round + 1, Math.floor(match.index / 2));
}
function advance(state: TournamentState, match: BracketMatch): void {
  const next = nextMatch(state, match);
  if (!next) { state.champion = match.winner; state.status = 'complete'; return; }
  if (match.index % 2 === 0) next.a = match.winner; else next.b = match.winner;
}
/** Re-derives byes and `ready` flags after any change. Idempotent. */
export function settle(state: TournamentState, now: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of state.matches) {
      if (match.status === 'done' || match.status === 'bye') continue;
      if (match.round === 0 && (match.a === null) !== (match.b === null)) {
        match.winner = match.a ?? match.b; match.status = 'bye'; match.finishedAt = now;
        advance(state, match); changed = true;
      } else {
        const status: MatchStatus = match.a !== null && match.b !== null ? 'ready' : 'pending';
        if (status !== match.status) { match.status = status; changed = true; }
      }
    }
  }
  state.updatedAt = now;
}
export function reportWinner(state: TournamentState, matchId: number, winner: number, now: number, note: BracketMatch['note'] = 'played'): void {
  if (state.status !== 'active') throw new Error('This tournament is not running.');
  const match = state.matches.find(entry => entry.id === matchId);
  if (!match || match.status !== 'ready') throw new Error('That set is not ready to be played.');
  if (winner !== match.a && winner !== match.b) throw new Error('The winner must be one of the two entrants.');
  match.winner = winner; match.status = 'done'; match.note = note; match.finishedAt = now;
  advance(state, match);
  settle(state, now);
}
export function countReplay(state: TournamentState, matchId: number, now: number): void {
  const match = state.matches.find(entry => entry.id === matchId);
  if (!match || match.status !== 'ready') return;
  match.replays = (match.replays ?? 0) + 1; state.updatedAt = now;
}
/** Reopens a finished set, as long as nothing was played on top of it. */
export function reopenMatch(state: TournamentState, matchId: number, now: number): void {
  const match = state.matches.find(entry => entry.id === matchId);
  if (!match || match.status !== 'done') throw new Error('Only a finished set can be reopened.');
  const next = nextMatch(state, match);
  if (next && next.status === 'done') throw new Error('The next set was already played on top of this result.');
  if (next) { if (match.index % 2 === 0) next.a = null; else next.b = null; }
  match.winner = null; match.status = 'ready'; delete match.note; delete match.finishedAt;
  state.champion = null; if (state.status === 'complete') state.status = 'active';
  settle(state, now);
}
/** Settles every ready CPU-vs-CPU set: the higher level wins more often (weight = level²). */
export function simulateCpuMatches(state: TournamentState, now: number): number {
  let settled = 0;
  for (let guard = 0; guard < state.matches.length; guard++) {
    const match = state.matches.find(entry => entry.status === 'ready' && state.entrants[entry.a!]?.kind === 'cpu' && state.entrants[entry.b!]?.kind === 'cpu');
    if (!match || state.status !== 'active') break;
    simulateMatch(state, match.id, now); settled++;
  }
  return settled;
}
export function simulateMatch(state: TournamentState, matchId: number, now: number): number {
  const match = state.matches.find(entry => entry.id === matchId);
  if (!match || match.status !== 'ready') throw new Error('That set is not ready to be played.');
  const a = state.entrants[match.a!]!, b = state.entrants[match.b!]!;
  const weight = (entrant: Entrant): number => (entrant.level ?? 5) ** 2;
  const [roll] = rngStep((state.seed ^ Math.imul(match.id + 1, 0x9e3779b1)) >>> 0);
  const winner = roll * (weight(a) + weight(b)) < weight(a) ? a.id : b.id;
  reportWinner(state, matchId, winner, now, 'simulated');
  return winner;
}

// ——— Queries ———

export function playableMatches(state: TournamentState): BracketMatch[] {
  return state.status === 'active' ? state.matches.filter(match => match.status === 'ready') : [];
}
export function matchesOf(state: TournamentState, entrant: number): BracketMatch[] {
  return state.matches.filter(match => match.a === entrant || match.b === entrant);
}
export function isEliminated(state: TournamentState, entrant: number): boolean {
  return state.matches.some(match => (match.status === 'done' || match.status === 'bye') && (match.a === entrant || match.b === entrant) && match.winner !== entrant);
}
export function progress(state: TournamentState): { played: number; total: number } {
  const real = state.matches.filter(match => match.status !== 'bye');
  return { played: real.filter(match => match.status === 'done').length, total: real.length };
}
/** Final standing label for an entrant: CHAMPION, FINALIST, or the round they fell in. */
export function placement(state: TournamentState, entrant: number): string {
  if (state.champion === entrant) return 'CHAMPION';
  const lost = state.matches.find(match => match.status === 'done' && (match.a === entrant || match.b === entrant) && match.winner !== entrant);
  if (!lost) return 'IN THE RUNNING';
  return lost.round === state.rounds - 1 ? 'FINALIST' : `OUT · ${roundName(lost.round, state.rounds)}`;
}
export function rulesSummary(rules: TournamentRules): string {
  const clock = `${Math.floor(rules.seconds / 60)}:${String(rules.seconds % 60).padStart(2, '0')}`;
  return rules.mode === 'hill' ? `KOTH ${rules.hillZones > 1 ? 'A+B' : 'A ONLY'} · ${clock}` : `${MODE_LABELS[rules.mode]} · ${rules.stocks} STOCK${rules.stocks === 1 ? '' : 'S'} · ${clock}`;
}
