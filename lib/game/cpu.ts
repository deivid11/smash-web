/** Prototype CPU player with a nine-level ladder modeled on the original game's
 * CPU level tables (per-level hesitation, defense duty cycle, shield hold, walk
 * clamp, special cooldown, ledge and grab-escape odds, human-preference
 * targeting, level-gated jump chasing and shield grabs). The decision logic
 * itself is prototype code: it reads this port's fighter records, not the
 * original AI state machine, attack tables or command scripts. See docs/CPU_AI.md.
 * PROTOTYPE FFA tweak: the original attack-target search (ftCo_800A53DC)
 * picks the human pool outright while its flag is set; here the human is
 * only preferred while close to the nearest foe (see HUMAN_CHASE_BAND),
 * so free-for-all CPUs also fight nearby CPUs. */
import type { FighterKind } from './data.ts';
import type { GameContent } from './load.ts';
import type { MatchFighter, PlayerInput } from './match.ts';
import type { PlayerControllerMode } from './setup.ts';
import { blocked, ceilingAbove, floorUnder, floorYAt, islandAt, navGraph, nearestIsland, nextLink, type NavLink } from './cpu-nav.ts';
import { hillTeamOfSlot } from './hill.ts';
import { rogueAllied } from './roguelike/sim.ts';

export type CpuLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const CPU_LEVELS: readonly CpuLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const DEFAULT_CPU_LEVEL: CpuLevel = 5;
export const CPU_LEVEL_NAMES: Readonly<Record<CpuLevel, string>> = Object.freeze({ 1: 'Rookie', 2: 'Novice', 3: 'Casual', 4: 'Steady', 5: 'Skilled', 6: 'Sharp', 7: 'Expert', 8: 'Master', 9: 'Elite' });
export function isCpuLevel(value: unknown): value is CpuLevel { return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 9; }
export function clampCpuLevel(value: unknown): CpuLevel { return isCpuLevel(value) ? value : DEFAULT_CPU_LEVEL; }

/** Level-indexed tables (index 0 unused) from the original CPU; see docs/CPU_AI.md for the sources. */
const L = <T,>(...rows: T[]): readonly T[] => Object.freeze([rows[0]!, ...rows]);
/** Random neutral frames inserted before every attack (ftCo_800B63D8). */
const PRE_ATTACK_WAIT = L<readonly [number, number]>([5, 39], [5, 34], [5, 29], [0, 24], [0, 19], [0, 14], [0, 9], [0, 4], [0, 0]);
/** Decision ticks on which attacks are suppressed (ftCo_800B885C); null never blocks. */
const ATTACK_BLOCK = L<readonly [number, number] | null>([300, 180], [300, 120], [240, 120], [240, 60], null, null, null, null, null);
/** Frames of the 120-frame cycle during which incoming attacks are answered (ftCo_800A5ACC); -1 never. */
const DODGE_WINDOW = L(-1, 100, 80, 60, 40, 30, 20, 10, 0);
/** Extra shield frames = (9 - level) x 4..7 (ftCo_800B9F90). */
const SHIELD_MULTIPLIER = L(8, 7, 6, 5, 4, 3, 2, 1, 0);
/** Movement stick clamp (ftCo_800AA320, /127); below the dash threshold the CPU only walks. */
const STICK_CLAMP = L(0.57, 0.61, 0.65, 0.69, 0.73, 0.76, 0.84, 0.92, 1);
/** Off-stage drift magnitude 4.7 x (level + 1) + 80 (ftCo_800A9904, /127). */
const RECOVERY_STICK = L(0.7, 0.74, 0.78, 0.82, 0.85, 0.89, 0.93, 0.96, 1);
/** Frames waited before dropping through a platform (ftCo_800A08F0). */
const DROP_WAIT = L(30, 30, 15, 15, 10, 10, 5, 5, 1);
/** Projectile lookahead frames [min, max] (ftCo_800BB220): sloppy early reactions at the bottom. */
const PROJECTILE_LOOKAHEAD = L<readonly [number, number]>([10, 29], [10, 29], [5, 14], [5, 14], [5, 14], [3, 7], [3, 7], [3, 7], [1, 1]);
const JUMP_CHASE_LEVEL = 4, SHIELD_GRAB_LEVEL = 6, CHARGE_LEVEL = 5;
/** Special-move cooldown (ftCo_800B9704). */
const specialCooldown = (level: CpuLevel, r: number): number => (10 - level) * (r * 15 + 15) + 10;
/** Hit-zone scale (ftCo_CpuUpdateRecoveryScale + halfRange): low levels must stand closer. */
const zoneScale = (level: CpuLevel, r: number): number => 0.5 * (0.05 * (level + 1) + 0.05 * r) + 0.5;

/** Read-only view of one level's tuning, for tests, docs and debug overlays. */
export function cpuLevelTuning(level: CpuLevel) {
  return Object.freeze({
    level, name: CPU_LEVEL_NAMES[level], preAttackWait: PRE_ATTACK_WAIT[level]!, attackBlock: ATTACK_BLOCK[level]!, dodgeWindow: DODGE_WINDOW[level]!,
    shieldMultiplier: SHIELD_MULTIPLIER[level]!, stickClamp: STICK_CLAMP[level]!, recoveryStick: RECOVERY_STICK[level]!, dropWait: DROP_WAIT[level]!,
    projectileLookahead: PROJECTILE_LOOKAHEAD[level]!, specialCooldown: [specialCooldown(level, 0), specialCooldown(level, 1)] as const,
    jumpChase: level >= JUMP_CHASE_LEVEL, shieldGrab: level >= SHIELD_GRAB_LEVEL, chargesSmashes: level >= CHARGE_LEVEL,
  });
}

export type CpuMove = 'jab' | 'sideTilt' | 'upTilt' | 'downTilt' | 'dash' | 'strong' | 'upSmash' | 'downSmash' | 'grab' | 'neutralAir' | 'forwardAir' | 'backAir' | 'upAir' | 'downAir' | 'inhale';
interface Zone { move: CpuMove; x: readonly [number, number]; y: readonly [number, number]; weight: number; air: boolean; kill?: number }
/** Forward-relative hit zones in stage units, authored against this port's roster; scaled per level. */
const ZONES: readonly Zone[] = Object.freeze([
  { move: 'jab', x: [1, 13], y: [-6, 10], weight: 1, air: false },
  { move: 'sideTilt', x: [4, 19], y: [-6, 10], weight: 0.8, air: false },
  { move: 'upTilt', x: [-9, 9], y: [2, 20], weight: 0.7, air: false },
  { move: 'downTilt', x: [2, 17], y: [-9, 6], weight: 0.7, air: false },
  { move: 'dash', x: [8, 34], y: [-6, 10], weight: 0.6, air: false },
  { move: 'strong', x: [4, 22], y: [-6, 12], weight: 0.4, air: false, kill: 0.6 },
  { move: 'upSmash', x: [-10, 10], y: [3, 24], weight: 0.35, air: false, kill: 0.5 },
  { move: 'downSmash', x: [-14, 14], y: [-8, 8], weight: 0.35, air: false, kill: 0.3 },
  { move: 'grab', x: [3, 11], y: [-6, 8], weight: 0.5, air: false },
  { move: 'inhale', x: [2, 12], y: [-8, 8], weight: 0.5, air: false },
  { move: 'neutralAir', x: [-10, 12], y: [-10, 10], weight: 1, air: true },
  { move: 'forwardAir', x: [3, 20], y: [-8, 10], weight: 1, air: true },
  { move: 'backAir', x: [-20, -3], y: [-8, 10], weight: 1, air: true },
  { move: 'upAir', x: [-8, 8], y: [3, 22], weight: 0.9, air: true },
  { move: 'downAir', x: [-8, 8], y: [-24, -3], weight: 0.8, air: true },
]);
/** Ranged specials worth firing at distance, and reflectors answering projectiles. */
const RANGED: Partial<Record<FighterKind, 'neutral' | 'side'>> = { Fx: 'neutral', Mr: 'neutral', Ss: 'side', Pk: 'neutral', Lk: 'side', Cl: 'side', Fc: 'neutral', Dr: 'neutral', Pc: 'neutral', Lg: 'neutral', Pp: 'neutral', Zd: 'side', Sk: 'neutral', Gw: 'neutral', Ys: 'side' };
const REFLECT: Partial<Record<FighterKind, 'down' | 'side' | 'neutral'>> = { Fx: 'down', Mr: 'side', Mt: 'side', Fc: 'down', Dr: 'side', Zd: 'neutral' };
const KILL_PERCENT = 80, EDGE_MARGIN = 6, LEDGE_CAMP = 30, HOLD_FRAMES = 40;
/** PROTOTYPE FFA tweak: a preferred human farther than this past the nearest
 * foe loses priority, so CPUs engage a nearby CPU instead of running across
 * the stage. Original ftCo_800A53DC takes the human pool outright. */
const HUMAN_CHASE_BAND = 40;

export interface CpuStep { frames: number; input: Partial<PlayerInput> }
/** Snapshot-owned brain: plain data only, cloned into match state and restored by rollback. */
export interface CpuBrain {
  level: CpuLevel; ticks: number; script: CpuStep[]; cursor: number; held: number;
  targetSlot: number | null; targetLock: number; preferHuman: boolean; zone: number; standoff: number;
  specialCooldown: number; dropWait: number; ledgeChoice: string | null; pummels: number; recovering: boolean;
  /** Landing point of the island link being flown, cleared on touchdown. */
  navTarget: { x: number; y: number; island: number } | null;
  /** Consecutive grounded frames spent pushing the stick without moving (wall contact). */
  stuck: number; lastX: number;
}
export function createCpuBrain(level: CpuLevel): CpuBrain {
  return { level, ticks: 0, script: [], cursor: 0, held: 0, targetSlot: null, targetLock: 0, preferHuman: false, zone: zoneScale(level, 0.5), standoff: 2, specialCooldown: 0, dropWait: 0, ledgeChoice: null, pummels: 0, recovering: false, navTarget: null, stuck: 0, lastX: 0 };
}

/** The bounded match view the CPU reads; LocalMatch satisfies it structurally. */
export interface CpuHost {
  readonly frame: number; readonly fighters: readonly MatchFighter[]; readonly controllerKinds: readonly PlayerControllerMode[];
  readonly content: Pick<GameContent, 'stage' | 'common' | 'physics'>;
  readonly projectiles: { items: readonly { x: number; y: number; vx: number; vy: number; owner: number }[] };
  /** Team battle flag (LocalMatch options); absent hosts always fight free-for-all. */
  readonly teams?: boolean;
  /** PROTOTYPE (zombies) side flag (LocalMatch options); absent hosts ignore infection. */
  readonly zombies?: boolean;
}
const neutral = (): PlayerInput => ({ x: 0, y: 0, jump: false, attack: false, strong: false, down: false, special: false });
const step = (frames: number, input: Partial<PlayerInput>): CpuStep => ({ frames, input });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function floorBelow(host: CpuHost, x: number, y: number): number | null {
  const floor = floorUnder(host.content.stage, x, y);
  return floor ? floorYAt(floor, x) : null;
}
/** Airborne over the void: nothing to land on, so only recovery matters. */
function offStage(host: CpuHost, f: MatchFighter): boolean {
  return !f.grounded && floorBelow(host, f.x, f.y) === null;
}
/** Jump like ftCo_800A0148: release, stick toward the goal when it is far, press and hold Y ten frames. */
function jumpScript(bot: MatchFighter, goalX: number, drift: number): CpuStep[] {
  const far = Math.abs(goalX - bot.x) > 30, x = far ? Math.sign(goalX - bot.x) * Math.max(0.6, drift) : 0;
  return [step(1, { x }), step(10, { jump: true, x }), step(2, { x: Math.sign(goalX - bot.x) * drift })];
}
function nearestLedge(host: CpuHost, x: number): { x: number; y: number; facing: number } | null {
  let best: { x: number; y: number; facing: number } | null = null;
  for (const ledge of host.content.stage.ledges) if (!best || Math.abs(ledge.x - x) < Math.abs(best.x - x)) best = ledge;
  return best;
}
/** Active or imminent hit reach of an opponent's current move, or 0 when it cannot hit soon. */
function threatReach(attacker: MatchFighter, lookahead: number): number {
  if (attacker.state !== 'attack' && attacker.state !== 'special') return 0;
  const name = attacker.attackName ?? attacker.animation;
  const attack = attacker.content.attacks.get(name) ?? attacker.content.timelines.get(name);
  if (!attack) return attacker.state === 'special' ? 16 : 0;
  const frame = attacker.animationFrame;
  let reach = 0;
  const alive = new Map<number, number>();
  for (const event of attack.events) {
    if (event.frame > frame + lookahead) break;
    if (event.type === 'create') alive.set(event.hit.id, Math.hypot(event.hit.offset[0], event.hit.offset[1], event.hit.offset[2]) + event.hit.radius);
    else if (event.type === 'clear' && event.frame <= frame) { if (event.id === null) alive.clear(); else alive.delete(event.id); }
  }
  for (const r of alive.values()) reach = Math.max(reach, r);
  return reach > 0 ? reach * attacker.content.profile.attributes.modelScale + 8 : 0;
}
function chooseTarget(host: CpuHost, bot: MatchFighter, brain: CpuBrain): MatchFighter | null {
  // Team battles: CPUs hunt the other side, never their own teammate.
  // Teams are seat parity (RED = even seats, BLUE = odd seats), so compare
  // seatId — dense slots shift when seats are off and would misalign teams.
  const teamOf = (f: MatchFighter): 0 | 1 => hillTeamOfSlot(f.seatId ?? f.slot);
  const alive = host.fighters.filter(f => f !== bot && f.stocks > 0 && (!host.teams || teamOf(f) !== teamOf(bot)) && !rogueAllied(f, bot));
  if (alive.length === 0) return null;
  // PROTOTYPE (zombies): hunt the other side of the infection (a mid-lock
  // infection flips the target); with nobody infected yet the living fight
  // free-for-all.
  let side = alive;
  if (host.zombies) {
    const enemies = alive.filter(f => f.infected !== bot.infected);
    if (enemies.length > 0) side = enemies;
  }
  const locked = brain.targetSlot === null ? undefined : side.find(f => f.slot === brain.targetSlot);
  if (locked && brain.targetLock > 0) return locked;
  // Nearest by 2D distance like the original ftCo_800A1AB4 (not |x| only),
  // so a CPU on a nearby platform beats a human across the stage.
  const dist = (f: MatchFighter): number => Math.hypot(f.x - bot.x, f.y - bot.y);
  const nearest = [...side].sort((a, b) => dist(a) - dist(b) || a.slot - b.slot)[0]!;
  let target = nearest;
  // Human preference (rerolled every 300 frames from the level table) only
  // wins while the nearest human is inside the chase band past the nearest
  // foe; otherwise the CPU engages the nearby CPU. This keeps the original
  // ladder odds but stops free-for-all ganging.
  if (brain.preferHuman) {
    const humans = side.filter(f => host.controllerKinds[f.slot] === 'human');
    if (humans.length > 0) {
      const nearestHuman = [...humans].sort((a, b) => dist(a) - dist(b) || a.slot - b.slot)[0]!;
      if (nearestHuman.slot === nearest.slot || dist(nearestHuman) - dist(nearest) <= HUMAN_CHASE_BAND) target = nearestHuman;
    }
  }
  if (target.slot !== brain.targetSlot) { brain.targetSlot = target.slot; brain.targetLock = Math.floor(30 * host.content.physics.random()); }
  return target;
}
function moveInput(move: CpuMove, facing: number, kind: FighterKind, grounded: boolean): Partial<PlayerInput> {
  switch (move) {
    case 'jab': return { attack: true };
    case 'sideTilt': return { attack: true, x: 0.5 * facing, walk: true };
    case 'upTilt': return { attack: true, y: 1 };
    case 'downTilt': return { attack: true, y: -1 };
    case 'dash': return { attack: true, x: facing };
    case 'strong': return { strong: true };
    case 'upSmash': return { strong: true, y: 1 };
    case 'downSmash': return { strong: true, y: -1 };
    case 'grab': return { grab: true };
    case 'inhale': return { special: true, specialDirection: 'neutral' };
    case 'neutralAir': return { attack: true };
    case 'forwardAir': return { strong: true };
    case 'backAir': return { attack: true, x: -facing };
    case 'upAir': return { attack: true, y: 1 };
    case 'downAir': return { attack: true, y: -1 };
  }
  void kind; void grounded; return {};
}
function available(bot: MatchFighter, move: CpuMove): boolean {
  const moves = bot.content.moves;
  switch (move) {
    case 'grab': return bot.content.canGrab !== false && !bot.content.inhale;
    case 'inhale': return !!bot.content.inhale;
    case 'sideTilt': return !!moves.sideTilt; case 'upTilt': return !!moves.upTilt; case 'upSmash': return !!moves.upSmash;
    case 'backAir': return !!moves.backAir; case 'upAir': return !!moves.upAir;
    default: return true;
  }
}
/** Distance from the bot to the edge of its island (or the stage) in the given direction. */
function edgeRoom(host: CpuHost, bot: MatchFighter, direction: number): number {
  const stage = host.content.stage, graph = navGraph(stage), island = bot.grounded ? islandAt(graph, stage, bot.x, bot.y, bot.floor) : null;
  const left = island === null ? stage.mainLeft : graph.islands[island]!.minX, right = island === null ? stage.mainRight : graph.islands[island]!.maxX;
  return direction < 0 ? bot.x - left : right - bot.x;
}
const LUNGING: ReadonlySet<CpuMove> = new Set(['strong', 'dash']);
function attackScript(host: CpuHost, bot: MatchFighter, brain: CpuBrain, target: MatchFighter, lead = 6): CpuStep[] | null {
  const level = brain.level, dir = Math.sign(target.x - bot.x) || bot.facing;
  // Airborne with momentum carrying past the edge: no aerial — recovering beats a whiffed swing into the void.
  if (!bot.grounded) { const stage = host.content.stage, ahead = bot.x + bot.velocity.x * 24; if (ahead < stage.mainLeft + 2 || ahead > stage.mainRight - 2) return null; }
  const px = target.x + target.velocity.x * lead - bot.x, py = target.y + target.velocity.y * lead - bot.y;
  const rel = px * bot.facing, scale = brain.zone / 0.775, shielding = target.state === 'shield', killing = target.percent >= KILL_PERCENT;
  const candidates: { zone: Zone; weight: number; turn: boolean }[] = [];
  for (const zone of ZONES) {
    if (zone.air !== !bot.grounded || !available(bot, zone.move)) continue;
    if (zone.move === 'dash' && bot.state !== 'run') continue;
    if ((zone.move === 'grab' || zone.move === 'inhale') && (!target.grounded || target.invulnerable > 0)) continue;
    const near = zone.x[0] >= 0 ? zone.x[0] : zone.x[0] * scale, far = zone.x[1] >= 0 ? zone.x[1] * scale : zone.x[1];
    const symmetric = zone.x[0] < 0 && zone.x[1] > 0;
    const facingHit = rel >= near && rel <= far && py >= zone.y[0] && py <= zone.y[1] * scale;
    const turnedHit = !symmetric && bot.grounded && zone.move !== 'dash' && -rel >= near && -rel <= far && py >= zone.y[0] && py <= zone.y[1] * scale;
    if (!facingHit && !turnedHit) continue;
    // Lunging moves carry root motion toward the edge; keep them for when there is floor ahead (ftCo_800A28D0-style edge check).
    if (LUNGING.has(zone.move) && edgeRoom(host, bot, facingHit ? bot.facing : -bot.facing) < 18) continue;
    let weight = zone.weight + (zone.kill && killing ? zone.kill : 0);
    if (shielding) weight = zone.move === 'grab' ? (level >= SHIELD_GRAB_LEVEL ? 3 : 0.5) : zone.kill ? 0.1 : weight * 0.5;
    candidates.push({ zone, weight, turn: !facingHit });
  }
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return null;
  let roll = host.content.physics.random() * total, pick = candidates[candidates.length - 1]!;
  for (const candidate of candidates) { roll -= candidate.weight; if (roll <= 0) { pick = candidate; break; } }
  const facing = pick.turn ? -bot.facing : bot.facing;
  const [waitMin, waitMax] = PRE_ATTACK_WAIT[level]!;
  const wait = waitMin + Math.floor(host.content.physics.random() * (waitMax - waitMin + 1));
  const script: CpuStep[] = [];
  if (wait > 0) script.push(step(wait, {}));
  if (pick.turn) script.push(step(1, { x: 0.5 * dir, walk: true }));
  const press = moveInput(pick.zone.move, facing, bot.content.profile.kind, bot.grounded);
  if (pick.zone.move === 'inhale') script.push(step(HOLD_FRAMES, press));
  else if ((pick.zone.move === 'strong' || pick.zone.move === 'upSmash' || pick.zone.move === 'downSmash') && level >= CHARGE_LEVEL && killing && host.content.physics.random() < 0.35) script.push(step(12 + Math.floor(host.content.physics.random() * 20), press));
  else script.push(step(2, press));
  script.push(step(4, {}));
  return script;
}
function defenseScript(host: CpuHost, bot: MatchFighter, brain: CpuBrain, source: MatchFighter | null, projectile: boolean): CpuStep[] {
  const level = brain.level, r = host.content.physics.random();
  if (!bot.grounded) {
    // ftCo_800BA9A0: an airborne threat is answered with a plain air dodge, no direction — a
    // directional dodge next to the edge would throw the fighter into the void.
    return [step(1, { shield: true }), step(6, {})];
  }
  const kind = bot.content.profile.kind, reflect = REFLECT[kind];
  if (projectile && reflect && bot.state !== 'special' && r < 0.7) {
    const toward = source ? Math.sign(source.x - bot.x) || bot.facing : bot.facing;
    return [step(2, { special: true, specialDirection: reflect, x: reflect === 'side' ? toward : 0, y: reflect === 'down' ? -1 : 0 }), step(8, {})];
  }
  const hold = SHIELD_MULTIPLIER[level]! * (4 + Math.floor(host.content.physics.random() * 4)) + 8;
  if (!projectile && source && r < 0.45) {
    // The original rolls through a close attacker and away from a far one.
    const gap = Math.abs(source.x - bot.x), through = gap <= LEDGE_CAMP;
    const direction = (through ? Math.sign(source.x - bot.x) : Math.sign(bot.x - source.x)) || bot.facing;
    return [step(1, { shield: true, x: direction }), step(6, {})];
  }
  const script: CpuStep[] = [step(hold, { shield: true })];
  if (source && level >= SHIELD_GRAB_LEVEL && Math.abs(source.x - bot.x) < 12 && bot.content.canGrab !== false && host.content.physics.random() < 0.6) script.push(step(1, { shield: true, grab: true }));
  script.push(step(3, {}));
  return script;
}
function ledgeScript(host: CpuHost, bot: MatchFighter, brain: CpuBrain, target: MatchFighter | null): CpuStep[] {
  const level = brain.level, r = host.content.physics.random();
  const camped = !!target && Math.abs(target.x - bot.x) < LEDGE_CAMP && Math.abs(target.y - bot.y) < 25;
  let choice: string;
  if (camped) choice = r < 0.1 * level ? 'roll' : 'attack';
  else choice = r < 0.6 ? 'climb' : r < 0.8 ? 'roll' : r < 0.9 ? 'attack' : 'jump';
  const inward = -bot.facing || 1;
  const action: Partial<PlayerInput> = choice === 'climb' ? { y: 1 } : choice === 'roll' ? { shield: true } : choice === 'attack' ? { attack: true } : { jump: true };
  brain.ledgeChoice = choice;
  return [step(2, {}), step(2, action), step(6, { x: choice === 'jump' ? inward * 0.7 : 0 })];
}
function holdingScript(host: CpuHost, bot: MatchFighter, brain: CpuBrain, target: MatchFighter): CpuStep[] {
  const level = brain.level, r = host.content.physics.random();
  if (bot.content.inhale) return [step(2, { attack: true }), step(4, {})];
  // ftCo_800B683C: throw now with rand x (1 + pummels) < 0.5, otherwise pummel again.
  if (r * (1 + brain.pummels) >= 0.5 && target.percent < 60) { brain.pummels++; return [step(2, { attack: true }), step(20, {})]; }
  brain.pummels = 0;
  const stage = host.content.stage, toLeft = bot.x - stage.mainLeft, toRight = stage.mainRight - bot.x;
  const edgeSide = toLeft < toRight ? -1 : 1, nearEdge = Math.min(toLeft, toRight) < 35;
  let action: Partial<PlayerInput>;
  if (level < 5 || host.content.physics.random() > 0.2 + 0.8 * (level / 9)) {
    const pick = Math.floor(host.content.physics.random() * 4);
    action = pick === 0 ? { x: bot.facing } : pick === 1 ? { x: -bot.facing } : pick === 2 ? { y: 1 } : { y: -1 };
  } else if (nearEdge || target.percent >= KILL_PERCENT) action = { x: edgeSide };
  else action = target.percent < 50 ? { y: 1 } : { x: Math.sign((stage.mainLeft + stage.mainRight) / 2 - bot.x) || bot.facing };
  return [step(2, action), step(6, {})];
}
const AIRBORNE_ACTABLE: readonly string[] = ['idle', 'walk', 'run', 'fall', 'jump', 'airjump'];
function recoveryInput(host: CpuHost, bot: MatchFighter, brain: CpuBrain, input: PlayerInput): PlayerInput {
  const level = brain.level, stage = host.content.stage, ledge = nearestLedge(host, bot.x);
  const destY = ledge ? ledge.y : 0;
  // Under the stage lip the only way home is outward past the ledge; otherwise aim inward of it.
  const underLip = ledge !== null && bot.y < destY - 1 && bot.x > stage.mainLeft - 1 && bot.x < stage.mainRight + 1;
  const destX = ledge ? ledge.x + ledge.facing * (underLip ? -8 : 4) : (stage.mainLeft + stage.mainRight) / 2;
  const dx = Math.abs(destX - bot.x), toward = dx < 1.5 ? 0 : Math.sign(destX - bot.x), maxJumps = bot.content.profile.attributes.maxJumps;
  const drift = (toward || (ledge ? ledge.facing : 1)) * RECOVERY_STICK[level]!;
  if (bot.state === 'helpless' || bot.special) { input.x = drift; return input; }
  const falling = bot.velocity.y < 0, below = bot.y < destY + 6;
  if (falling && below && bot.jumpsUsed < maxJumps && AIRBORNE_ACTABLE.includes(bot.state)) {
    // One press then a held button: the sim needs the edge, and holding keeps the full arc.
    // Under the lip the jump rides the slanted underside outward toward the ledge.
    brain.script = [step(1, { jump: true, x: drift }), step(6, { jump: true, x: drift }), step(2, { x: drift })]; brain.cursor = 0; brain.held = 0;
    return runScript(brain, input);
  }
  if (falling && bot.jumpsUsed >= maxJumps && bot.y < destY - 2 && AIRBORNE_ACTABLE.includes(bot.state)) {
    // Up special aimed like ftCo_CpuRecoverDiagonally: diagonal (0x58/127) when far, straight up when close.
    // Aim like ftCo_CpuRecoverDiagonally: diagonal when far, straight up when close; under the lip go outward-up around it.
    const inward = ledge ? ledge.facing : 1, diagonal = dx > 20 || (level < 4 && host.content.physics.random() < 0.3);
    const aimX = underLip ? -0.69 * inward : diagonal ? 0.69 * inward : 0, aimY = underLip || diagonal ? 0.69 : 1;
    brain.script = [step(2, { special: true, specialDirection: 'up', x: aimX, y: aimY }), step(24, { x: aimX, y: aimY })]; brain.cursor = 0; brain.held = 0;
    return runScript(brain, input);
  }
  input.x = drift;
  return input;
}
function runScript(brain: CpuBrain, input: PlayerInput): PlayerInput {
  const current = brain.script[brain.cursor];
  if (!current) { brain.script = []; brain.cursor = 0; brain.held = 0; return input; }
  Object.assign(input, current.input);
  if (++brain.held >= current.frames) { brain.held = 0; brain.cursor++; if (brain.cursor >= brain.script.length) { brain.script = []; brain.cursor = 0; } }
  return input;
}
const canAct = (f: MatchFighter): boolean => ['idle', 'walk', 'run', 'crouch', 'jump', 'airjump', 'fall'].includes(f.state);

/** One frame of controller input for a CPU seat; deterministic from host state and brain. */
export function cpuInput(host: CpuHost, slot: number): PlayerInput {
  const bot = host.fighters[slot]!, brain = (host as unknown as { bots: CpuBrain[] }).bots[slot]!, input = neutral(), level = brain.level, random = () => host.content.physics.random();
  const frame = host.frame;
  if (frame % 300 === 0) brain.preferHuman = random() < 0.04 * level + 0.3;
  if (frame % 30 === 0) brain.zone = zoneScale(level, random());
  if (frame % 600 === 0) { const r = random(); brain.standoff = 4 * (1 - r * r * r); }
  if (brain.targetLock > 0) brain.targetLock--;
  if (brain.specialCooldown > 0) brain.specialCooldown--;
  const target = chooseTarget(host, bot, brain);
  if (bot.state === 'ko' || bot.state === 'respawn') { brain.script = []; brain.cursor = 0; brain.held = 0; return input; }
  // Reflexes: the original priority chain answers these before any script.
  if (bot.state === 'hitstun') { brain.script = []; brain.cursor = 0; brain.held = 0; return input; }
  if (bot.state === 'captured' || bot.state === 'dizzy' || bot.state === 'shield-break') {
    // ftCo_800AC30C: every three frames, flip the stick with 0.1 x level odds.
    if (frame % 3 === 0 && random() < 0.1 * level) input.x = bot.previous.x >= 0 ? -1 : 1; else input.x = bot.previous.x;
    return input;
  }
  if (bot.state === 'ledge') {
    if (bot.animation !== 'CliffWait') { brain.ledgeChoice = null; brain.script = []; brain.cursor = 0; return input; }
    if (brain.script.length === 0 && brain.ledgeChoice === null) { brain.script = ledgeScript(host, bot, brain, target); brain.cursor = 0; brain.held = 0; }
    return runScript(brain, input);
  }
  if (bot.state === 'ledge-action' || bot.state === 'ledge-jump') { brain.ledgeChoice = null; return input; }
  brain.ledgeChoice = null;
  if (bot.state === 'holding') {
    if (brain.script.length === 0) { brain.script = target ? holdingScript(host, bot, brain, target) : [step(2, { x: bot.facing })]; brain.cursor = 0; brain.held = 0; }
    return runScript(brain, input);
  }
  brain.pummels = 0;
  if (offStage(host, bot)) {
    // Entering the void drops whatever was queued; recovery scripts then run to completion.
    if (!brain.recovering) { brain.recovering = true; brain.script = []; brain.cursor = 0; brain.held = 0; }
    if (brain.script.length) return runScript(brain, input);
    return recoveryInput(host, bot, brain, input);
  }
  if (brain.recovering) { brain.recovering = false; brain.script = []; brain.cursor = 0; brain.held = 0; }
  if (!target) return input;

  // Danger: the original only reacts inside its per-level duty-cycle window.
  const defending = bot.state === 'shield' || bot.state === 'dodge' || bot.state === 'air-dodge';
  const window = DODGE_WINDOW[level]!;
  if (!defending && canAct(bot) && window >= 0 && (window === 0 || frame % 120 > window)) {
    let source: MatchFighter | null = null, projectile = false;
    for (const other of host.fighters) {
      if (other === bot || other.stocks <= 0) continue;
      // Teammate melee never connects (see lib/game/match.ts), so only
      // projectiles/items from their side are worth answering.
      if (host.teams && hillTeamOfSlot(other.seatId ?? other.slot) === hillTeamOfSlot(bot.seatId ?? bot.slot)) continue;
      if (rogueAllied(other, bot)) continue;
      const reach = threatReach(other, 3);
      if (reach > 0 && Math.abs(other.x - bot.x) < reach && Math.abs(other.y - bot.y) < 18) { source = other; break; }
    }
    if (!source) {
      const [lo, hi] = PROJECTILE_LOOKAHEAD[level]!, look = lo + Math.floor(random() * (hi - lo + 1));
      for (const p of host.projectiles.items) {
        if (p.owner === slot || rogueAllied(host.fighters[p.owner], bot) || (bot.x - p.x) * p.vx <= 0 || Math.abs(p.y + p.vy * look - bot.y) > 16) continue;
        if (Math.abs(p.x + p.vx * look - bot.x) < 12 + Math.abs(p.vx) * 2) { source = host.fighters[p.owner] ?? null; projectile = true; break; }
      }
    }
    if (source || projectile) { brain.script = defenseScript(host, bot, brain, source, projectile); brain.cursor = 0; brain.held = 0; brain.ticks++; return runScript(brain, input); }
  }
  if (brain.script.length > 0) return runScript(brain, input);
  if (!canAct(bot) && bot.state !== 'shield') return input;
  if (bot.state === 'shield') return input; // GuardOff resolves once the script released the button.
  brain.ticks++;

  const dx = target.x - bot.x, dy = target.y - bot.y, toward = Math.sign(dx) || bot.facing, stage = host.content.stage;
  const attackBlocked = ATTACK_BLOCK[level] ? brain.ticks % ATTACK_BLOCK[level]![0] <= ATTACK_BLOCK[level]![1] : false;
  const targetOff = !target.grounded && floorBelow(host, target.x, target.y) === null && target.state !== 'ko' && target.state !== 'respawn';
  // Attack when a zone contains the (led) target and the level's rate gate allows it.
  if (!attackBlocked && target.invulnerable === 0 && target.state !== 'ko' && target.state !== 'respawn' && (bot.grounded || level >= JUMP_CHASE_LEVEL)) {
    const script = attackScript(host, bot, brain, target);
    if (script) { brain.script = script; brain.cursor = 0; brain.held = 0; return runScript(brain, input); }
  }
  // Ranged specials: cooldown, 25% rejection, minimum distance, facing and near-level angle (ftCo_800B9CBC).
  const ranged = RANGED[bot.content.profile.kind];
  if (ranged && bot.grounded && brain.specialCooldown === 0 && !attackBlocked) {
    brain.specialCooldown = Math.round(specialCooldown(level, random()));
    const distance = Math.hypot(dx, dy);
    if (random() <= 0.75 && distance >= 30 && Math.sign(dx) === bot.facing && Math.abs(dy) < 8 + 0.09 * distance) {
      brain.script = [step(2, { special: true, specialDirection: ranged, x: ranged === 'side' ? bot.facing : 0 }), step(10, {})]; brain.cursor = 0; brain.held = 0;
      return runScript(brain, input);
    }
  }
  // Navigation (ftCo_800AB224 family): walk on the target's island, otherwise follow the
  // island graph link by link — jump, drop through, or walk off — with wall-contact jumps.
  const graph = navGraph(stage), clampMagnitude = STICK_CLAMP[level]!;
  const myIsland = bot.grounded ? islandAt(graph, stage, bot.x, bot.y, bot.floor) : null;
  const targetFloor = target.grounded ? null : floorUnder(stage, target.x, target.y);
  const targetIsland = targetOff ? null : target.grounded ? islandAt(graph, stage, target.x, target.y, target.floor) : targetFloor ? graph.islandByFloor.get(targetFloor.id) ?? null : nearestIsland(graph, target.x, target.y);
  let destX = target.x, destY = target.y, link: NavLink | null = null;
  if (targetOff) { const ledge = nearestLedge(host, target.x); destX = ledge ? ledge.x + ledge.facing * EDGE_MARGIN : clamp(target.x, stage.mainLeft + EDGE_MARGIN, stage.mainRight - EDGE_MARGIN); destY = ledge ? ledge.y : bot.y; }
  else if (myIsland !== null && targetIsland !== null && myIsland !== targetIsland) {
    link = nextLink(graph, myIsland, targetIsland);
    if (link) { destX = link.x; destY = link.y; }
    else if (bot.grounded && dy > 10 && Math.abs(dx) < 40 && bot.state !== 'squat' && !ceilingAbove(stage, bot.x, bot.y, 28) && random() < 0.1) {
      // No known route: do what the original does and simply jump toward a higher target (ftCo_800AB224).
      brain.script = jumpScript(bot, target.x, clampMagnitude); brain.navTarget = { x: target.x, y: target.y, island: targetIsland }; brain.cursor = 0; brain.held = 0; return runScript(brain, input);
    }
  }
  if (bot.grounded) {
    brain.navTarget = null;
    // Wall contact (Collide_WallMask in the original): pushing without moving means jump, unless a ceiling forbids it.
    const pushing = Math.abs(bot.previous.x) > 0.3 && (bot.state === 'walk' || bot.state === 'run' || bot.state === 'idle');
    brain.stuck = pushing && Math.abs(bot.x - brain.lastX) < 0.05 ? brain.stuck + 1 : 0;
    brain.lastX = bot.x;
    if (brain.stuck >= 3) {
      brain.stuck = 0;
      if (!ceilingAbove(stage, bot.x, bot.y, 28)) { brain.script = jumpScript(bot, destX, clampMagnitude); brain.navTarget = { x: destX, y: destY, island: targetIsland ?? -1 }; brain.cursor = 0; brain.held = 0; return runScript(brain, input); }
      brain.script = [step(16, { x: -Math.sign(bot.previous.x) * clampMagnitude })]; brain.cursor = 0; brain.held = 0; return runScript(brain, input);
    }
    if (link && Math.abs(bot.x - link.x) < 4) {
      brain.navTarget = { x: link.targetX, y: link.targetY, island: link.to };
      if (link.kind === 'jump') {
        if (ceilingAbove(stage, bot.x, bot.y, 20)) { brain.script = [step(12, { x: Math.sign(link.targetX - bot.x || 1) * clampMagnitude })]; }
        else brain.script = jumpScript(bot, link.targetX, clampMagnitude);
        brain.cursor = 0; brain.held = 0; return runScript(brain, input);
      }
      if (link.kind === 'drop') {
        if (brain.dropWait === 0) brain.dropWait = DROP_WAIT[level]!;
        else if (--brain.dropWait === 0) { brain.script = [step(2, { down: true, y: -1 })]; brain.cursor = 0; brain.held = 0; return runScript(brain, input); }
        return input;
      }
      // Walk off the island edge toward the landing point.
      input.x = Math.sign(link.targetX - bot.x || 1) * Math.max(0.5, clampMagnitude); return input;
    }
    brain.dropWait = 0;
    // Walk controller (ftCo_800AA42C): dash when far, clamp near, stop inside the stand-off, stay on the island.
    const island = myIsland === null ? null : graph.islands[myIsland]!;
    const safeX = island && !link ? clamp(destX, island.minX + 2, island.maxX - 2) : destX;
    const gap = safeX - bot.x, standoff = link ? 2 : brain.standoff + 5;
    if (Math.abs(gap) > standoff) input.x = Math.sign(gap) * (Math.abs(gap) > 25 ? clampMagnitude : Math.min(clampMagnitude, 0.5));
    else if (!link && Math.sign(dx) !== bot.facing && Math.abs(dx) > 1) input.x = 0.4 * toward;
    if (level >= JUMP_CHASE_LEVEL && !targetOff && !target.grounded && dy > 18 && Math.abs(dx) < 30 && bot.state !== 'squat' && random() < 0.25) {
      // Jump chase (ftCo_800B732C): only level 4 and up leaves the ground after an airborne target.
      brain.script = [step(6, { jump: true, x: input.x }), step(8, { x: 0.6 * toward })]; brain.cursor = 0; brain.held = 0; return runScript(brain, input);
    }
    return input;
  }
  // Airborne over ground: fly the current link to its landing point, air-jumping when short (ftCo_800A9CB4).
  const goal = brain.navTarget ?? { x: clamp(destX, stage.mainLeft + 4, stage.mainRight - 4), y: destY, island: -1 };
  const gapX = goal.x - bot.x;
  // Pushing into a wall face mid-air pins the fighter against it; rise straight until the lip is cleared.
  const wallBetween = Math.abs(gapX) >= 1 && blocked(stage, bot.x, bot.y + 3, bot.x + Math.sign(gapX) * Math.min(Math.abs(gapX), 12), bot.y + 3);
  brain.stuck = Math.abs(bot.x - brain.lastX) < 0.02 && Math.abs(bot.velocity.y) < 0.05 ? brain.stuck + 1 : 0; brain.lastX = bot.x;
  if (brain.stuck >= 3) { brain.script = []; brain.cursor = 0; brain.held = 0; input.x = 0; return input; }
  input.x = wallBetween || Math.abs(gapX) < 1 ? 0 : Math.sign(gapX) * Math.min(1, Math.max(0.5, clampMagnitude));
  // Spend an air jump only for a landing that is actually within reach; otherwise land and re-plan (no endless floating).
  if (bot.velocity.y < 0 && bot.y < goal.y - 4 && goal.y - bot.y < 70 && Math.abs(gapX) < 45 && bot.jumpsUsed < bot.content.profile.attributes.maxJumps && AIRBORNE_ACTABLE.includes(bot.state) && !ceilingAbove(stage, bot.x, bot.y, 24)) {
    brain.script = [step(1, { jump: true, x: input.x }), step(6, { jump: true, x: input.x }), step(2, { x: input.x })]; brain.cursor = 0; brain.held = 0; return runScript(brain, input);
  }
  if (bot.velocity.y < 0 && goal.y < bot.y - 6 && Math.abs(gapX) < 12 && level >= CHARGE_LEVEL && !bot.fastFall && random() < 0.2) input.down = true;
  return input;
}
