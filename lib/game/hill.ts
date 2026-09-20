/** King of the Hill: prototype zone-control rules for local matches.
 * Two floor zones (A and B, or a single zone) spawn at random ground spots.
 * Capture progress is PER FIGHTER: everyone standing in a zone fills their own
 * meter at once (and loses it again once they leave), the first meter to fill
 * takes the zone, and a captured zone pays its owner a point per second even
 * while nobody stands on it. Defending is done by knocking rivals out of the
 * circle, not by standing in it: the owner's side no longer fills. Knocked out
 * fighters always respawn, so lives are infinite and the clock decides.
 * Team play (RED vs BLUE) is a match-level rule shared with stock battles;
 * callers pass it alongside. Pure data + integer math: no assets, no DOM,
 * fully snapshot-owned by LocalMatch (see lib/game/match.ts), so rollback
 * and hashes stay exact. */
export interface HillSetup { zones: 1 | 2 }
export interface HillZone { id: 'A' | 'B'; x: number; y: number; halfWidth: number }
export interface HillState {
  zones: HillZone[];
  /** Hill points per dense fighter slot (both modes: FFA score and team top-scorer). */
  points: number[];
  /** Zone-seconds held per team (index 0 = RED, 1 = BLUE); only scored in team mode. */
  teamPoints: [number, number];
  /** Per zone: the owning slot (free-for-all) or team (teams) — whoever captured it
   * last, null until someone does. Owners keep scoring after they step away. */
  holders: (number | null)[];
  /** Per zone, per dense fighter slot: frames of capture progress. Everyone inside
   * builds their own at the same time; anyone outside loses theirs just as fast. */
  capture: number[][];
  /** Frames since the last point tick. */
  tick: number;
  /** Frames until the zones relocate to new random spots. */
  relocateIn: number;
  /** mulberry32 state (uint32): every placement decision threads through here. */
  rng: number;
  relocations: number;
}
/** One hill point per second, paid to whoever owns the zone. */
export const HILL_POINT_EVERY = 60;
/** Frames of standing in a zone before it flips to you (1.5 s). Every fighter
 * fills their own meter, so a crowded zone is a race, not a lockout. */
export const HILL_CAPTURE_FRAMES = 90;
/** Zones respawn at new random spots every 20 seconds. */
export const HILL_RELOCATE_EVERY = 1200;
/** Zone half-width bounds in stage units (derived from the blast width). */
export const HILL_HALF_WIDTH_MIN = 14;
export const HILL_HALF_WIDTH_MAX = 30;
/** Vertical capture tolerance in stage units: the holder must stand on the hill ground. */
export const HILL_CAPTURE_DY = 14;
export const HILL_TEAM_NAMES = ['RED', 'BLUE'] as const;
export const HILL_TEAM_COLORS = ['#ff5b5b', '#4da3ff'] as const;
/** Renderer zone colors (hex numbers for THREE materials): A amber, B sky. */
export const HILL_ZONE_COLORS = [0xffc94d, 0x59c2ff] as const;

export function hillTeamOfSlot(slot: number): 0 | 1 {
  if (!Number.isInteger(slot) || slot < 0) throw new Error('Invalid hill team slot.');
  return slot % 2 === 0 ? 0 : 1;
}
export function validHillSetup(value: unknown): value is HillSetup {
  if (typeof value !== 'object' || value === null) return false;
  const setup = value as Record<string, unknown>;
  return (setup.zones === 1 || setup.zones === 2) && Object.keys(setup).length === 1;
}
/** Zone half-width from the stage blast width: wide arenas (Hyrule Temple)
 * get roomy hills, small ones stay contestable. */
export function hillHalfWidth(blastLeft: number, blastRight: number): number {
  if (!Number.isFinite(blastLeft) || !Number.isFinite(blastRight) || blastRight <= blastLeft) throw new Error('Invalid hill blast span.');
  return Math.max(HILL_HALF_WIDTH_MIN, Math.min(HILL_HALF_WIDTH_MAX, (blastRight - blastLeft) / 14));
}
/** One mulberry32 step, threaded as [roll in [0,1), next state]. */
export function hillRandomNext(rng: number): [number, number] {
  let state = ((rng >>> 0) + 0x6d2b79f5) >>> 0;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return [((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296, state];
}
function pickZoneAnchors(rng: number, anchors: readonly { x: number; y: number }[], count: number): [{ x: number; y: number }[], number] {
  if (!anchors.length) throw new Error('King of the Hill needs at least one ground anchor.');
  const total = Math.max(1, Math.min(count, anchors.length, 2));
  const picked: { x: number; y: number }[] = [];
  let state = rng >>> 0;
  if (anchors.length === 1 || total === 1) {
    const [roll, next] = hillRandomNext(state);
    state = next;
    const anchor = anchors[Math.floor(roll * anchors.length)]!;
    picked.push({ x: anchor.x, y: anchor.y });
    if (total === 2) {
      const [second, nextState] = hillRandomNext(state);
      state = nextState;
      let other = Math.floor(second * (anchors.length - 1));
      const first = anchors.indexOf(anchor);
      if (other >= first) other++;
      const companion = anchors[other]!;
      picked.push({ x: companion.x, y: companion.y });
    }
    return [picked, state];
  }
  const [first, afterFirst] = hillRandomNext(state);
  state = afterFirst;
  const firstIndex = Math.floor(first * anchors.length);
  picked.push({ x: anchors[firstIndex]!.x, y: anchors[firstIndex]!.y });
  if (total === 2) {
    const [second, afterSecond] = hillRandomNext(state);
    state = afterSecond;
    let other = Math.floor(second * (anchors.length - 1));
    if (other >= firstIndex) other++;
    picked.push({ x: anchors[other]!.x, y: anchors[other]!.y });
  }
  return [picked, state];
}
export function makeHillState(seed: number, anchors: readonly { x: number; y: number }[], zones: 1 | 2, halfWidth: number): HillState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid hill seed.');
  if (!Number.isFinite(halfWidth) || halfWidth <= 0) throw new Error('Invalid hill half-width.');
  const [picked, rng] = pickZoneAnchors(seed >>> 0, anchors, zones);
  return {
    zones: picked.map((anchor, index) => ({ id: index === 0 ? 'A' : 'B', x: anchor.x, y: anchor.y, halfWidth })),
    points: [],
    teamPoints: [0, 0],
    holders: picked.map(() => null),
    capture: picked.map(() => []),
    tick: 0,
    relocateIn: HILL_RELOCATE_EVERY,
    rng,
    relocations: 0,
  };
}
/** Move every zone to new random ground (avoids repeating the exact layout
 * when alternatives exist); ownership and capture progress start over. */
export function relocateHillZones(state: HillState, anchors: readonly { x: number; y: number }[]): void {
  const before = state.zones.map(zone => `${zone.x},${zone.y}`).join('|');
  const [picked, rng] = pickZoneAnchors(state.rng, anchors, state.zones.length as 1 | 2);
  state.rng = rng;
  let zones: HillZone[] = picked.map((anchor, index) => ({ id: index === 0 ? 'A' : 'B', x: anchor.x, y: anchor.y, halfWidth: state.zones[index]?.halfWidth ?? state.zones[0]!.halfWidth }));
  if (anchors.length > state.zones.length && zones.map(zone => `${zone.x},${zone.y}`).join('|') === before) {
    const spare = anchors.find(anchor => !zones.some(zone => zone.x === anchor.x && zone.y === anchor.y));
    if (spare) zones = [{ ...zones[0]!, x: spare.x, y: spare.y }, ...zones.slice(1)];
  }
  state.zones = zones;
  state.holders = zones.map(() => null);
  state.capture = zones.map(() => []);
  state.tick = 0;
  state.relocateIn = HILL_RELOCATE_EVERY;
  state.relocations++;
}
/** One frame of capture progress, per fighter. occupants[zone] lists the dense
 * slots standing in it: each of them gains a frame on their own meter and everyone
 * else loses one, so a contested zone is a race that the fighters settle by
 * knocking each other out of it. The first meter to fill hands the zone over (the
 * owning side never fills, it already holds it) and clears the whole zone's
 * progress, so the next steal starts from scratch. Ties go to the lowest slot,
 * which keeps the step deterministic for rollback.
 * `teamOf` resolves a dense slot to its team (default seat parity); callers with
 * gapped seats pass a seatId-aware resolver so RED/BLUE stays aligned. */
export function stepHillCapture(state: HillState, teams: boolean, occupants: readonly (readonly number[])[], fighters: number, teamOf: (slot: number) => 0 | 1 = hillTeamOfSlot): void {
  const count = Math.max(0, Math.floor(fighters));
  state.zones.forEach((index0, index) => {
    void index0;
    const inside = occupants[index] ?? [];
    const holder = state.holders[index] ?? null;
    const row = state.capture[index] ?? [];
    let winner = -1;
    for (let slot = 0; slot < count; slot++) {
      const owns = holder !== null && (teams ? teamOf(slot) === holder : slot === holder);
      const progress = row[slot] ?? 0;
      if (owns) { row[slot] = 0; continue; }
      const next = Math.max(0, Math.min(HILL_CAPTURE_FRAMES, inside.includes(slot) ? progress + 1 : progress - 1));
      row[slot] = next;
      if (winner < 0 && next >= HILL_CAPTURE_FRAMES) winner = slot;
    }
    if (winner >= 0) {
      state.holders[index] = teams ? teamOf(winner) : winner;
      for (let slot = 0; slot < count; slot++) row[slot] = 0;
    }
    state.capture[index] = row;
  });
}
/** Fighters with capture progress in a zone, strongest first (ties by slot).
 * Drives the in-world meters and the HUD line; pure, so the HUD never guesses. */
export function hillClaims(state: Pick<HillState, 'capture'>, zone: number): { slot: number; progress: number }[] {
  const row = state.capture[zone] ?? [];
  const claims: { slot: number; progress: number }[] = [];
  for (let slot = 0; slot < row.length; slot++) {
    const progress = row[slot] ?? 0;
    if (progress > 0) claims.push({ slot, progress });
  }
  return claims.sort((a, b) => b.progress - a.progress || a.slot - b.slot);
}
/** Score one point tick: every captured zone pays its owner, whether or not anyone
 * is standing on it. In team mode the zone-second goes to the team and individual
 * credit goes to that team's fighters present, so the MVP ranking still tracks who
 * did the holding. */
export function scoreHillTick(state: HillState, teams: boolean, occupants: readonly (readonly number[])[], _teamOf: (slot: number) => 0 | 1 = hillTeamOfSlot): void {
  state.zones.forEach((_, index) => {
    const holder = state.holders[index];
    if (holder === null || holder === undefined) return;
    if (!teams) {
      state.points[holder] = (state.points[holder] ?? 0) + 1;
      return;
    }
    state.teamPoints[holder as 0 | 1]++;
    for (const slot of occupants[index] ?? []) if (_teamOf(slot) === holder) state.points[slot] = (state.points[slot] ?? 0) + 1;
  });
}
/** Leading team by zone-seconds (null on a tie); free-for-all ignores teams. */
export function hillWinningTeam(state: Pick<HillState, 'teamPoints'>): 0 | 1 | null {
  if (state.teamPoints[0] === state.teamPoints[1]) return null;
  return state.teamPoints[0] > state.teamPoints[1] ? 0 : 1;
}
/** Winning dense slot: top hill points, then lowest damage, then lowest slot.
 * Team mode restricts the ranking to the winning team's fighters.
 * `teamOf` resolves a dense slot to its team (default seat parity); callers
 * with gapped seats pass a seatId-aware resolver. */
export function hillLeader(state: Pick<HillState, 'points' | 'teamPoints'>, teams: boolean, slots: readonly number[], percents: readonly number[], teamOf: (slot: number) => 0 | 1 = hillTeamOfSlot): number | null {
  if (!slots.length) return null;
  const team = teams ? hillWinningTeam(state) : null;
  if (teams && team === null) return null;
  const contenders = (teams ? slots.filter(slot => teamOf(slot) === team) : [...slots])
    .sort((a, b) => (state.points[b] ?? 0) - (state.points[a] ?? 0) || (percents[a] ?? 0) - (percents[b] ?? 0) || a - b);
  const best = contenders[0]!;
  const second = contenders[1];
  if (second !== undefined && (state.points[best] ?? 0) === (state.points[second] ?? 0) && (percents[best] ?? 0) === (percents[second] ?? 0)) return null;
  return best;
}
