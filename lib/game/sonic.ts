import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SonicSpecialData } from './sonic-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep, SpecialWorld } from './specials.ts';

/** Sonic's native motion states (PlSn `move_logic`, motions 341-371). The ACE code ships with
 * its author's debug symbols, so each branch below is named after the function it ports. */
export type SonicState =
  | 'NStart' | 'NCharge' | 'NAttack' | 'NAttackMiss' | 'NCancel' | 'NLanding' | 'NHit' | 'NRebound'
  | 'Hi'
  | 'SStart' | 'SHold' | 'SAttack' | 'SEnd'
  | 'LwStart' | 'LwCharge' | 'LwEnd' | 'LwRun' | 'LwRunTurn' | 'LwRunJump' | 'LwDive' | 'LwRunBrake' | 'LwStopWall'
  // Knuckles' side special (PlKx motions 0x163/0x164/0x173).
  | 'SGround' | 'Glide' | 'GlideTurn'
  // Shadow's Chaos Control (PlSh motions 350-355: Mewtwo's Teleport).
  | 'HiStart' | 'HiLost' | 'HiEnd';

/** MexTK `state_var` block plus the few latches the callbacks keep in it. */
export interface SonicRuntime {
  state: SonicState;
  /** state_var1: homing charge frames / spin-dash effect cooldown. */
  timer: number;
  /** state_var2: homing frames left / SHold frames held / spin-charge release window. */
  timer2: number;
  /** Homing heading (state_var3) and its fixed target (state_var4/5). */
  angle: number; target: [number, number];
  /** SHold shield latch (state_var4). */
  cancel: boolean;
  /** The spin dash fires from a full stored charge (its own figatree variant, motions 0x166/0x167). */
  full: boolean;
  /** Spin Charge level (-1 until the first-level delay passes), level cooldown and 300-frame cap. */
  level: number; cooldown: number; chargeLeft: number;
  /** Run life (state_var3 lo), dive life (hi), target run speed (state_var4), run-jump aerial-only delay. */
  life: number; diveLife: number; speed: number; jumpDelay: number;
  /** 0x2341: the run-jump left the ground from a run (landing resumes it); 0x2342: an air jump remains. */
  fromRun: boolean; canAirJump: boolean;
  /** Collision bookkeeping the port needs between steps (the original reads coll_data directly). */
  wasGrounded: boolean; lastVel: { x: number; y: number };
  /** SpecialLw_AdjustHitboxDamage: the level-scaled damage written into hitbox 0. */
  hitDamage: number | null;
  /** Frames left on the ECB lock Fighter_SetAirborne starts (no landing while it runs). */
  ecbLock: number;
  /** Chaos Control: travel frames left, frames spent in the aerial zoom (mv unk4) and the saved
   * zoom velocity (air) / ground speed the End multiplies by the momentum-end factor. */
  lostLeft: number; lostFrames: number; lostVel: { x: number; y: number };
  /** Code-spawned effect cooldowns: spin-dash sparkle (state_var1) and Shadow's charge level (state_var8). */
  fxTimer: number;
}

const f32 = Math.fround;
const params = (f: MatchFighter): SonicSpecialData => {
  const p = f.content.specials.parameters;
  // Tails (PlTs) runs only his down special here: Sonic's spin charge over his own `down` block.
  if (p.kind === 'Ts') return p as unknown as SonicSpecialData;
  if (p.kind !== 'Sn' && p.kind !== 'Kx' && p.kind !== 'Sh') throw new Error('Missing Sonic-kit parameters.'); return p;
};
const STATE_ANIMATION: Record<SonicState, (air: boolean, r: SonicRuntime, f: MatchFighter) => string> = {
  // SpecialNStart_Enter picks 0x155/0x156 by where B was pressed, then goes airborne either way.
  NStart: (_air, _r, f) => f.special?.startedAir ? 'SpecialAirNStart' : 'SpecialNStart',
  NCharge: () => 'SpecialNCharge',
  NAttack: () => 'SpecialNAttack',
  NAttackMiss: () => 'SpecialNAttack',
  NCancel: () => 'SpecialNCancel',
  NLanding: () => 'SpecialNLanding',
  NHit: () => 'SpecialNHit',
  NRebound: () => 'SpecialNRebound',
  Hi: () => 'SpecialHi',
  SStart: (air) => air ? 'SpecialAirLwStart' : 'SpecialLwStart',
  SHold: () => 'SpecialSHold',
  SAttack: (air, r) => air ? (r.full ? 'SpecialAirSFull' : 'SpecialAirS') : (r.full ? 'SpecialSFull' : 'SpecialS'),
  SEnd: (air) => air ? 'SpecialAirLwEnd' : 'SpecialLwEnd',
  LwStart: (air) => air ? 'SpecialAirLwStart' : 'SpecialLwStart',
  LwCharge: () => 'SpecialLwCharge',
  LwEnd: (air) => air ? 'SpecialAirLwEnd' : 'SpecialLwEnd',
  LwRun: () => 'SpecialLwRun',
  LwRunTurn: () => 'SpecialLwRunTurn',
  LwRunJump: () => 'SpecialLwRunJump',
  LwDive: () => 'SpecialLwDive',
  LwRunBrake: () => 'RunBrake',
  // SpecialLwStopWall_Enter picks the figatree by facing: -1 → SWallR (0x172), else SWallL.
  LwStopWall: (_air, _r, f) => f.facing < 0 ? 'SpecialLwStopWallR' : 'SpecialLwStopWallL',
  SGround: () => 'SpecialS',
  Glide: () => 'SpecialAirS',
  GlideTurn: () => 'SpecialAirSTurn',
  // Both starts play SpecialHiStart (0x15E/0x161), both zooms SpecialHiLost.
  HiStart: () => 'SpecialHiStart',
  HiLost: () => 'SpecialHiLost',
  HiEnd: (air) => air ? 'SpecialAirHi' : 'SpecialHi',
};
const PHASE: Record<SonicState, SpecialRuntime['phase']> = {
  NStart: 'start', NCharge: 'loop', NAttack: 'travel', NAttackMiss: 'travel', NCancel: 'end', NLanding: 'end', NHit: 'hit', NRebound: 'end',
  Hi: 'travel', SStart: 'start', SHold: 'loop', SAttack: 'travel', SEnd: 'end',
  LwStart: 'start', LwCharge: 'loop', LwEnd: 'end', LwRun: 'travel', LwRunTurn: 'travel', LwRunJump: 'travel', LwDive: 'travel', LwRunBrake: 'end', LwStopWall: 'end',
  SGround: 'travel', Glide: 'travel', GlideTurn: 'travel',
  HiStart: 'start', HiLost: 'travel', HiEnd: 'end',
};

export function sonicSpecialName(f: MatchFighter, direction: SpecialDirection, _phase: SpecialRuntime['phase']): string {
  const r = f.special?.sonic;
  if (r) return STATE_ANIMATION[r.state](!f.grounded, r, f);
  // Before the runtime exists (the engine names the start pose first).
  if (direction === 'neutral') return f.grounded ? 'SpecialNStart' : 'SpecialAirNStart';
  if (direction === 'up') return f.content.specials.parameters.kind === 'Sh' ? 'SpecialHiStart' : 'SpecialHi';
  return f.grounded ? 'SpecialLwStart' : 'SpecialAirLwStart';
}
/** Fighter_ChangeMotionState(start 0, speed, blend 0): a fresh native state. `keepFrame` is the
 * air/ground swap flag set (0x0C4C5088) that carries the animation frame across. */
function enter(f: MatchFighter, state: SonicState, speed = 1, keepFrame = false): void {
  const s = f.special!, r = s.sonic!;
  r.state = state; s.phase = PHASE[state]; s.lastFrame = -1;
  f.animation = STATE_ANIMATION[state](!f.grounded, r, f); f.attackName = f.animation;
  if (!keepFrame) { f.animationFrame = 0; f.stateFrame = 0; f.attackSerial++; f.victims.clear(); }
  f.animationRate = speed; f.animationEpoch++;
}
/** ftCommon_8007D5D4 (MexTK Fighter_SetAirborne): airborne, with the ECB locked for 10 frames so a
 * fighter left at floor height does not land back on the frame it took off. */
const ECB_LOCK = 10;
const setAirborne = (f: MatchFighter) => {
  if (f.grounded && f.special?.sonic) f.special.sonic.ecbLock = ECB_LOCK;
  f.grounded = false; f.floor = null;
};
const clipEnd = (f: MatchFighter) => Math.max(1, f.content.clips.get(f.animation)?.endFrame ?? 1);
/** ftAnim_IsFramesRemaining == 0: the native animation has played out at its own speed. */
const animationDone = (f: MatchFighter) => f.animationFrame >= clipEnd(f);
/** Looping spin figatrees (NCharge/NAttack at 50-60x, Run/Dive/RunJump) wrap instead of freezing on their last frame. */
const wrap = (f: MatchFighter) => { const end = clipEnd(f); if (f.animationFrame >= end) f.animationFrame = f32(f.animationFrame % end); };
/** ftCommon_ApplyFrictionGround: slow toward rest by a flat amount per frame. */
const groundFriction = (v: number, friction: number) => Math.abs(v) <= friction ? 0 : f32(v - Math.sign(v) * friction);
/** ftCommon_8007C98C: accelerate the ground speed toward `target`; above it, bleed by the fighter's own friction. */
function approach(v: number, accel: number, target: number, friction: number): number {
  if (target === 0) return groundFriction(v, friction);
  if (target > 0 ? v < target : v > target) { const next = f32(v + accel); return target > 0 ? Math.min(next, target) : Math.max(next, target); }
  const next = groundFriction(v, friction);
  return target > 0 ? Math.max(next, target) : Math.min(next, target);
}

export function beginSonicSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f), a = f.content.profile.attributes;
  s.sonic = { state: 'NStart', timer: 0, timer2: 0, angle: 0, target: [0, 0], cancel: false, full: false, level: -1, cooldown: 0, chargeLeft: 0,
    life: 0, diveLife: 0, speed: 0, jumpDelay: 0, fromRun: false, canAirJump: f.jumpsUsed < a.maxJumps, wasGrounded: f.grounded, lastVel: { x: 0, y: 0 }, hitDamage: null, ecbLock: 0,
    lostLeft: 0, lostFrames: 0, lostVel: { x: 0, y: 0 }, fxTimer: 0 };
  const r = s.sonic;
  if (direction === 'neutral') {
    // SpecialNStart_Enter: a grounded start goes airborne on the spot; both hang with no speed.
    setAirborne(f); f.velocity = { x: 0, y: 0 };
    r.state = 'NStart'; s.phase = 'start';
    f.animation = s.startedAir ? 'SpecialAirNStart' : 'SpecialNStart';
    r.wasGrounded = false;
    return;
  }
  // Every direction starts in the engine's 'start' phase (that is what marks the fighter as in a
  // special); the deferred entries below swap in the native state on the first step.
  if (direction === 'up' && p.chaos) {
    // ftMt_SpecialHiStart_Enter zeroes every speed; the aerial one divides them by x40/x44.
    r.state = 'HiStart';
    f.velocity = f.grounded ? { x: 0, y: 0 } : { x: f32(f.velocity.x / p.chaos.velDivX), y: f32(f.velocity.y / p.chaos.velDivY) };
    return;
  }
  if (direction === 'up') { r.state = 'Hi'; return; }
  if (direction === 'side' && p.glide) {
    // PlKx SpecialS_EnterAirOrGround: SpecialSStart_Enter dashes on the ground at x98,
    // SpecialAirSStart_Enter glides at 0.85 and spends the airtime's one glide.
    if (f.grounded) { r.state = 'SGround'; return; }
    r.state = 'Glide'; f.glideUsed = true; return;
  }
  if (direction === 'side') {
    // SpecialS_EnterAirOrGround: a stored full charge fires at once; otherwise the start pose.
    if (f.sonicCharge >= p.side.maxCharge) { r.state = 'SAttack'; return; }
    r.state = 'SStart'; s.phase = 'start';
    if (!f.grounded) f.velocity.y = 0;
    return;
  }
  // SpecialLw_EnterAirOrGround.
  r.state = 'LwStart'; s.phase = 'start'; r.fromRun = false; r.life = p.down.runLife;
}

/** Deferred entries that need the whole begin (animation keys, spring shot) to have run. */
function begin(f: MatchFighter, out: SpecialStep, p: SonicSpecialData): void {
  const r = f.special!.sonic!;
  if (r.state === 'Hi') enterHi(f, out, p);
  else if (r.state === 'HiStart') enter(f, 'HiStart');
  else if (r.state === 'SAttack' && f.special!.age === 0) enterSAttack(f, p);
  else if (r.state === 'SGround') { enter(f, 'SGround'); f.velocity = { x: f32(p.glide!.dashSpeed * f.facing), y: 0 }; }
  else if (r.state === 'Glide') { enter(f, 'Glide'); f.velocity = { x: f32(p.glide!.startSpeed * f.facing), y: 0 }; }
}

/** SpecialHi_Enter + Spawn_Spring. */
function enterHi(f: MatchFighter, out: SpecialStep, p: SonicSpecialData): void {
  const a = f.content.profile.attributes;
  // Spawn_Spring drops the spring at cur_pos, grounded (Idle) or not (Fall), before the launch.
  out.shots.push({ player: f.slot, kind: 'sonic-spring', at: [f.x, f.y], variant: f.grounded ? 0 : 1 });
  // A grounded Spring Jump stands Sonic on top of his fresh spring (cur_pos.y += 3.3).
  if (f.grounded) f.y = f32(f.y + 3.3);
  setAirborne(f);
  enter(f, 'Hi');
  f.jumpsUsed = a.maxJumps;
  f.velocity = { x: 0, y: p.up!.riseSpeed };
}
/** SpecialSAttack_EnterAirOrGround: the stored charge sets the launch speed, then empties. */
function enterSAttack(f: MatchFighter, p: SonicSpecialData): void {
  const r = f.special!.sonic!, ratio = Math.min(1, f.sonicCharge / p.side.maxCharge);
  r.full = f.sonicCharge >= p.side.maxCharge;
  enter(f, 'SAttack');
  f.velocity = { x: f32((p.side.minSpeed + (p.side.maxSpeed - p.side.minSpeed) * ratio) * f.facing), y: 0 };
  f.sonicCharge = 0;
}

export function landSonicSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, r = s.sonic!, p = params(f);
  // A locked ECB never reaches the floor: stay airborne where the landing put us.
  if (r.ecbLock > 0) { f.grounded = false; f.floor = null; return true; }
  switch (r.state) {
    // ft_80081D0C / ft_800824A0 on the homing dash: the floor counts as a surface and bounces.
    case 'NAttack': case 'NAttackMiss':
      setAirborne(f); f.y = f32(f.y + 0.1); rebound(f, p, 'floor'); return true;
    case 'NCancel': case 'NHit': case 'NRebound': case 'NStart': case 'NCharge':
      // SpecialNLanding_Enter.
      f.velocity = { x: f.velocity.x, y: 0 }; enter(f, 'NLanding'); return true;
    case 'Hi':
      finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
      f.landingFrames = Math.max(1, Math.ceil(p.up!.landing)); return true;
    case 'SStart': case 'SEnd': case 'LwStart': case 'LwEnd':
      // The *_Trans air→ground swaps keep the animation frame.
      enter(f, r.state, f.animationRate, true); return true;
    case 'SHold': case 'LwCharge': return true;
    case 'SAttack':
      enter(f, 'SAttack', 1, true); return true;
    case 'LwRunJump':
      // SpecialLwRunJump_Coll: a run that left the ground resumes on landing; a jump out of the
      // charge lands as a special fall landing when x134 is set.
      if (r.fromRun) { enter(f, 'LwRun', 1, true); return true; }
      if (p.down.jumpLanding > 0) {
        finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
        f.landingFrames = Math.max(1, Math.ceil(p.down.jumpLanding)); return true;
      }
      finish(); return true;
    case 'LwDive':
      // SpecialLwDive_Coll → SpecialLwRun_Enter.
      enterRun(f, p); return true;
    case 'HiStart':
      // ftMt_SpecialAirHiStart_AirToGround: the grounded start, frame kept.
      f.velocity = { x: f.velocity.x, y: 0 }; enter(f, 'HiStart', 1, true); return true;
    case 'HiLost':
      // ftMt_SpecialAirHi_AirToGround (x54 frames in, or unless dropping through): the zoom
      // carries on along the floor at its horizontal speed.
      r.lostVel = { x: r.lostVel.x, y: 0 }; f.velocity = { ...r.lostVel }; enter(f, 'HiLost', 0, true); return true;
    case 'HiEnd':
      // SpecialAirHi_Coll: LandingFallSpecial at x74.
      finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
      f.landingFrames = Math.max(1, Math.ceil(p.chaos!.landing)); return true;
    case 'Glide': case 'GlideTurn':
      // PlKx SpecialAirS_Coll / SpecialAirSTurn_Coll → SpecialS_Trans: the ground dash, frame kept.
      enter(f, 'SGround', 1, true); f.velocity.y = 0; return true;
    default:
      f.animation = STATE_ANIMATION[r.state](false, r, f); f.attackName = f.animation; return true;
  }
}

/** SpecialNRebound_Enter: bounce off a wall/ceiling (x reverses at 0.6) or the floor (x keeps 0.6). */
function rebound(f: MatchFighter, p: SonicSpecialData, surface: 'wall' | 'floor' | 'none'): void {
  const r = f.special!.sonic!, v = { ...r.lastVel };
  enter(f, 'NRebound');
  if (surface === 'wall') v.x = f32(v.x * -p.neutral.reboundMulX);
  else if (surface === 'floor') v.x = f32(v.x * p.neutral.reboundMulX);
  v.x = Math.max(-p.neutral.bounceMaxX, Math.min(p.neutral.bounceMaxX, v.x));
  v.y = Math.min(p.neutral.bounceMaxY, f32(-v.y));
  f.velocity = v;
}
/** SpecialNHit_Enter: a connected homing hit pops Sonic up (at least 2, at most 3). */
function homingHit(f: MatchFighter, p: SonicSpecialData): void {
  const r = f.special!.sonic!;
  let vy = Math.abs(r.lastVel.y); vy = Math.max(vy, 2);
  enter(f, 'NHit');
  f.velocity = { x: Math.max(-p.neutral.bounceMaxX, Math.min(p.neutral.bounceMaxX, r.lastVel.x)), y: Math.min(p.neutral.bounceMaxY, vy) };
}
function sameTeam(world: SpecialWorld, a: MatchFighter, b: MatchFighter): boolean {
  return world.teams && world.teamOf(a) === world.teamOf(b);
}
/** SpecialN_SearchTarget_EnterAttack: the nearest rival fighter inside the search radius (its
 * centre raised by x34), else the nearest spring; either way nudged by the stick (x40/x44). */
function searchTarget(f: MatchFighter, p: SonicSpecialData, world: SpecialWorld | undefined, input: PlayerInput): [number, number] | null {
  if (!world) return null;
  const radius2 = p.neutral.searchRadius ** 2;
  let best = Number.MAX_VALUE, target: [number, number] | null = null;
  for (const other of world.fighters) {
    if (other === f || sameTeam(world, f, other) || other.state === 'ko' || other.state === 'respawn') continue;
    const d = (other.x - f.x) ** 2 + (other.y - f.y) ** 2;
    if (d < best && d < radius2) { best = d; target = [other.x, f32(p.neutral.targetRaise + other.y)]; }
  }
  if (!target) for (const spring of world.springs) {
    const d = (spring.x - f.x) ** 2 + (spring.y - f.y) ** 2;
    if (d < best && d < radius2) { best = d; target = [spring.x, spring.y]; }
  }
  if (!target) return null;
  return [f32(p.neutral.aimX * input.x + target[0]), f32(p.neutral.aimY * (input.y ?? 0) + target[1])];
}

/** SpecialLw_EnterRun: an uncharged release just ends; otherwise run on the ground, dive in the air. */
function enterRun(f: MatchFighter, p: SonicSpecialData): void {
  const r = f.special!.sonic!;
  if (r.level < 0) { enter(f, 'LwEnd'); return; }
  if (!f.grounded) { enterDive(f, p); return; }
  enter(f, 'LwRun');
  r.speed = p.down.runSpeed[Math.min(2, r.level)]!;
  r.hitDamage = levelDamage(r.level, p.down.maxLevel, p.down.runDamage);
}
/** SpecialLw_AdjustHitboxDamage: hitbox 0 scales from x138 to x13C (x140..x144 airborne) by level. */
const levelDamage = (level: number, max: number, [low, high]: readonly [number, number]) => f32(low + (Math.max(0, level) / max) * (high - low));
function enterDive(f: MatchFighter, p: SonicSpecialData): void {
  const r = f.special!.sonic!;
  enter(f, 'LwDive');
  f.velocity = { x: f32(p.down.diveSpeed * f.facing), y: f.velocity.y };
  r.diveLife = p.down.diveLife;
}
/** SpecialLwRunJump_Trans: `fromRun` marks a run that simply left the ground. */
function enterRunJump(f: MatchFighter, p: SonicSpecialData, fromRun: boolean, rise: boolean): void {
  const r = f.special!.sonic!;
  setAirborne(f);
  enter(f, 'LwRunJump');
  f.velocity = { x: Math.max(-p.down.jumpMaxX, Math.min(p.down.jumpMaxX, f.velocity.x)), y: rise ? p.down.jumpRise : f.velocity.y };
  r.jumpDelay = 3; r.fromRun = fromRun;
  r.hitDamage = levelDamage(r.level, p.down.maxLevel, p.down.jumpDamage);
}
const decrementLife = (r: SonicRuntime) => { if (r.life > 0) r.life--; if (r.diveLife > 0) r.diveLife--; };

/** The IASA windows the original opens (Fall/Wait IASA after the script's flag 0, aerials out
 * of the run-jump): 'full' lets any action through, 'aerial' only attacks. */
export function sonicInterruptible(f: MatchFighter): 'full' | 'aerial' | null {
  const r = f.special?.sonic; if (!r) return null;
  if (r.state === 'NCancel' || r.state === 'NHit' || r.state === 'NRebound' || r.state === 'NLanding') return iasaFlag(f) ? 'full' : null;
  if (r.state === 'LwRunJump') return r.jumpDelay > 0 ? 'aerial' : 'full';
  // PlKx SpecialAirS_IASA / SpecialAirSTurn_IASA both fall through to ftCo_Fall_IASA_Inner.
  if (r.state === 'Glide' || r.state === 'GlideTurn') return 'full';
  return null;
}
/** ftCommon cmd_vars flag0, raised by the state's own subaction script. */
const iasaFlag = (f: MatchFighter): boolean => command(f, 0) === 1;
/** Grounded Coll callbacks built on ft_800827A0 stop at the ledge instead of walking off it. */
export function sonicStopsAtLedge(f: MatchFighter): boolean {
  const r = f.special?.sonic;
  return !!r && (r.state === 'NLanding' || r.state === 'LwRunBrake');
}
/** Hitbox-0 damage the spin charge writes for its run/jump states. */
export function sonicHitDamage(f: MatchFighter): number | null {
  const r = f.special?.sonic;
  return r && (r.state === 'LwRun' || r.state === 'LwRunTurn' || r.state === 'LwDive' || r.state === 'LwRunJump') ? r.hitDamage : null;
}

export function stepSonicSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics,
  finish: (helpless?: boolean, lag?: number, mobility?: number) => void, world?: SpecialWorld): SpecialStep {
  const p = params(f), s = f.special!, r = s.sonic!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  if (s.age === 0) { out.sounds.push(voice(p, s.direction)); begin(f, out, p); }
  s.age++;
  if (r.ecbLock > 0) r.ecbLock--;
  if (!input.special) s.released = true;
  // The collision callbacks' ground→air swaps (the port learns about a walked-off ledge one step later).
  const leftGround = r.wasGrounded && !f.grounded;
  const wall = f.envContact?.wall ?? 0;
  const result = run(f, input, pressed, physics, finish, world, p, a, out, leftGround, wall);
  if (f.special?.sonic) { r.wasGrounded = f.grounded; r.lastVel = { ...f.velocity }; }
  return result;
}

function run(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics,
  finish: (helpless?: boolean, lag?: number, mobility?: number) => void, world: SpecialWorld | undefined,
  p: SonicSpecialData, a: MatchFighter['content']['profile']['attributes'], out: SpecialStep, leftGround: boolean, wall: number): SpecialStep {
  const s = f.special!, r = s.sonic!;
  // The engine has already folded this frame's input into `previous`; the edges come from the match.
  const shieldPressed = !!world?.shieldPressed, jumpPressed = !!world?.jumpPressed;
  switch (r.state) {
    // ---------------- Homing Attack ----------------
    case 'NStart':
      // SpecialNStart_Phys is empty: Sonic hangs where he pressed B.
      f.velocity = { x: 0, y: 0 };
      if (animationDone(f)) { enter(f, 'NCharge', p.neutral.chargeAnimSpeed); f.velocity = { x: 0, y: p.neutral.chargeRise }; r.timer = 0; }
      return out;
    case 'NCharge': {
      wrap(f);
      // SpecialNCharge_Enter sets the slow rise once and Phys never touches it again; the Coll
      // zeroes it against a ceiling (the engine's surface block already clamps it too).
      f.velocity = { x: 0, y: f.envContact?.ceiling ? 0 : f.velocity.y };
      if (r.timer >= p.neutral.chargeMaxFrames || (r.timer >= p.neutral.chargeMinFrames && pressed)) {
        const target = searchTarget(f, p, world, input);
        if (target) {
          // SpecialNAttack_Enter: a straight line at x38 toward the fixed target point.
          r.target = target; r.timer2 = p.neutral.homingFrames;
          r.angle = Math.atan2(target[1] - f.y, target[0] - f.x);
          enter(f, 'NAttack', p.neutral.attackAnimSpeed);
          f.velocity = { x: f32(p.neutral.homingSpeed * Math.cos(r.angle)), y: f32(p.neutral.homingSpeed * Math.sin(r.angle)) };
        } else {
          // SpecialNAttackMiss_Enter: nothing in range, dive 45° forward-down.
          r.timer2 = p.neutral.homingFrames;
          enter(f, 'NAttackMiss', p.neutral.attackAnimSpeed);
          f.velocity = { x: f32(p.neutral.missSpeed * f.facing), y: f32(-p.neutral.missSpeed) };
        }
        return out;
      }
      r.timer++;
      return out;
    }
    case 'NAttack':
    case 'NAttackMiss': {
      wrap(f);
      // deal_dmg_cb: SpecialNHit_Enter on the homing dash, SpecialNRebound_OnEnter on the miss.
      if (f.victims.size > 0) { if (r.state === 'NAttack') homingHit(f, p); else rebound(f, p, 'none'); return out; }
      // SpecialNAttack_Coll / SpecialNAttackMiss_Coll: any wall or ceiling contact rebounds.
      if (wall !== 0) { rebound(f, p, 'wall'); return out; }
      if (f.envContact?.ceiling) { rebound(f, p, 'wall'); return out; }
      if (r.state === 'NAttack') {
        f.velocity = { x: f32(p.neutral.homingSpeed * Math.cos(r.angle)), y: f32(p.neutral.homingSpeed * Math.sin(r.angle)) };
        if (r.timer2 <= 0) { cancel(f); return out; }
        r.timer2--;
        if ((f.x - r.target[0]) ** 2 + (f.y - r.target[1]) ** 2 <= p.neutral.homingSpeed ** 2) cancel(f);
        return out;
      }
      if (r.timer2 > 0) r.timer2--; else cancel(f);
      return out;
    }
    case 'NCancel':
      // SpecialNCancel_Phys: normal gravity with a heavy x48 air friction; ends into a normal Fall.
      if (animationDone(f)) { finish(); return out; }
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, p.neutral.cancelAirFriction);
      return out;
    case 'NHit':
    case 'NRebound':
      // SpecialNRebound_Phys: x58 air friction, x50 gravity capped at x54; ends into Fall.
      if (animationDone(f)) { finish(); return out; }
      f.velocity = physics.customAir(f.slot, f.velocity, p.neutral.reboundGravity, p.neutral.reboundTerminal, p.neutral.reboundAirFriction);
      return out;
    case 'NLanding':
      // SpecialNLanding_Phys: x64 ground friction.
      if (animationDone(f)) { finish(); return out; }
      f.velocity = { x: groundFriction(f.velocity.x, p.neutral.landingFriction), y: 0 };
      return out;

    // ---------------- Spring Jump ----------------
    case 'Hi':
      // SpecialHi_IASA: on its first frame a stick past x88 turns Sonic around.
      if (s.age === 1 && Math.abs(input.x) > p.up!.turnThreshold) f.facing = input.x > 0 ? 1 : -1;
      if (animationDone(f)) {
        // SpecialHi_Anim: special fall with x6C drift and x68 landing lag (no fast fall).
        if (p.up!.landing > 0) finish(true, p.up!.landing, p.up!.fallMobility); else finish();
        return out;
      }
      // SpecialHi_Phys: ftCommon_8007D344 drift, then x80 gravity capped at x84.
      f.velocity = physics.controlledDrift(f.slot, f.velocity, input.x, p.up!.driftAccel, p.up!.driftMax);
      f.velocity = physics.customAir(f.slot, f.velocity, p.up!.gravity, p.up!.terminal, 0);
      return out;

    // ---------------- Chaos Control (PlSh 350-355 = ftMt_SpecialHi*) ----------------
    case 'HiStart': {
      const c = p.chaos!;
      // ftMt_SpecialHiStart_GroundToAir: ftCommon_8007D60C spends every jump, frame kept.
      if (leftGround) { f.jumpsUsed = a.maxJumps; enter(f, 'HiStart', 1, true); }
      // PlSh SpecialHiStart_Anim: before frame xA0 a stick past xA4 against the facing turns around.
      if (f.animationFrame < c.turnFrames && f.facing * input.x < -c.turnStick) f.facing = input.x > 0 ? 1 : -1;
      if (animationDone(f)) { enterLost(f, p, input, a, world); return out; }
      // Ground: ft_80084F3C; air: ftCommon_Fall at x48/x4C, then the aerial friction (8007CEF4).
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, c.gravity, c.terminal, a.airFriction);
      return out;
    }
    case 'HiLost': {
      const c = p.chaos!;
      // SpecialHiLost_Coll off a ledge: a wall ends the zoom in the air, otherwise it flies on.
      if (leftGround) {
        f.jumpsUsed = a.maxJumps;
        if (wall !== 0) { endLost(f, p); return out; }
        enter(f, 'HiLost', 0, true); r.lostVel = { x: r.lostVel.x, y: 0 };
      }
      // SpecialHiLost_Anim: the travel timer (x50).
      if (--r.lostLeft <= 0) { endLost(f, p); return out; }
      if (f.grounded) {
        // SpecialHiLost_Coll: a grounded zoom stops at a wall.
        if (wall !== 0) { endLost(f, p); return out; }
      } else {
        r.lostFrames++;
        // ftCommon_HandleTeleportCollisions: a wall or ceiling met within 90°-x68 of head-on ends it.
        const normal = wall !== 0 ? { x: -wall, y: 0 } : f.envContact?.ceiling ? { x: 0, y: -1 } : null;
        const speed = Math.hypot(r.lostVel.x, r.lostVel.y);
        if (normal && speed > 0 && Math.acos(Math.max(-1, Math.min(1, (normal.x * r.lostVel.x + normal.y * r.lostVel.y) / speed))) > (c.angleClamp + 90) * Math.PI / 180) { endLost(f, p); return out; }
      }
      // Lost_Phys: the zoom keeps its launch speed (ground movement / no air physics at all).
      f.velocity = { ...r.lostVel };
      return out;
    }
    case 'HiEnd': {
      const c = p.chaos!;
      if (leftGround) { f.jumpsUsed = a.maxJumps; enter(f, 'HiEnd', 1, true); }
      // SpecialHi_Anim → Wait; SpecialAirHi_Anim → special fall (x70 mobility, x74 landing).
      if (animationDone(f)) { if (f.grounded) finish(); else finish(true, c.landing, c.mobility); return out; }
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else if (command(f, 0) !== 0) {
        // SpecialAirHi_Phys after flag0: FallBasic, the speed clamped to x64 × aerial drift max.
        const v = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0), cap = f32(c.drift * a.airDriftMax);
        f.velocity = { x: Math.max(-cap, Math.min(cap, v.x)), y: v.y };
      } else {
        // ...before it the rise bleeds a tenth per frame and the drift the aerial friction.
        f.velocity = { x: physics.customAir(f.slot, { x: f.velocity.x, y: 0 }, 0, a.terminal, a.airFriction).x, y: f32(f.velocity.y - f.velocity.y / 10) };
      }
      return out;
    }

    // ---------------- Spin Dash ----------------
    case 'SStart':
      if (leftGround) enter(f, 'SStart', 1, true);
      if (animationDone(f)) { enterHold(f); return out; }
      airOrGround(f, physics, a);
      return out;
    case 'SHold': {
      wrap(f);
      // SpecialSHold_Anim first: a full charge is banked (SpecialS_OnFinishCharge) and the move ends.
      if (f.sonicCharge >= p.side.maxCharge) { f.sonicCharge = p.side.maxCharge; enter(f, 'SEnd', p.side.endAnimSpeed); holdPhysics(f, physics, p); return out; }
      // SpecialS_SpawnChargeEffect: efSync 0x138B (model 5003) on part 0 every x94 frames.
      if (r.fxTimer > 0) r.fxTimer--; else { (out.effects ??= []).push({ effect: 0x138b, part: 0 }); r.fxTimer = p.side.effectInterval; }
      f.sonicCharge++;
      // SpecialSHold_IASA: shield latches a cancel; after x8C frames B fires, and the latch cancels
      // (dropping the partial charge).
      if (shieldPressed && !p.side.cancelOnPress) r.cancel = true;
      if (r.timer2 >= p.side.holdMinFrames) {
        // PlSh SpecialSHold_IASA: only a shield press on a frame past the window cancels.
        if (p.side.cancelOnPress && shieldPressed) r.cancel = true;
        if (r.cancel) { r.cancel = false; f.sonicCharge = 0; enter(f, 'SEnd', p.side.endAnimSpeed); holdPhysics(f, physics, p); return out; }
        if (pressed) { enterSAttack(f, p); return out; }
      }
      r.timer2++;
      holdPhysics(f, physics, p);
      return out;
    }
    case 'SAttack':
      if (leftGround) enter(f, 'SAttack', 1, true);
      if (animationDone(f)) {
        // SpecialS_Anim → Wait; SpecialAirS_Anim → special fall (xB8 drift, xBC landing).
        if (f.grounded) { f.velocity.x = 0; finish(); }
        else if (p.side.fallLanding !== 0) finish(true, p.side.fallLanding, p.side.fallMobility);
        else finish();
        return out;
      }
      // SpecialS_ApplyFriction: x(1 - xA8) per frame, dead below 0.5.
      f.velocity.x = f32((1 - p.side.friction) * f.velocity.x);
      if (Math.abs(f.velocity.x) < 0.5) f.velocity.x = 0;
      if (f.grounded) f.velocity.y = 0;
      else f.velocity = physics.customAir(f.slot, f.velocity, p.side.airGravity, p.side.airTerminal, 0);
      return out;
    case 'SEnd':
      if (leftGround) enter(f, 'SEnd', f.animationRate, true);
      if (animationDone(f)) { finish(); return out; }
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, p.side.holdGravity, p.side.holdTerminal, p.side.holdAirFriction);
      return out;

    // ---------------- Spin Charge ----------------
    case 'LwStart':
      if (leftGround) enter(f, 'LwStart', 1, true);
      if (animationDone(f)) { enterCharge(f, p, out); return out; }
      airOrGround(f, physics, a);
      return out;
    case 'LwCharge': {
      wrap(f);
      // SpecialLwCharge_Anim: the xE4 cap releases the run; an idle xC4 window ends the move.
      if (p.down.maxChargeFrames > 0) {
        if (r.chargeLeft <= 0) { enterRun(f, p); return out; }
        r.chargeLeft--;
      } else if (p.down.spinSound) {
        // PlSh SpecialLwCharge_Anim: state_var9 only paces the 0x13E9 spin loop (30, then xFC).
        if (r.chargeLeft > 0) r.chargeLeft--;
        else { out.sounds.push(0x13e9); r.chargeLeft = p.down.spinSound.every; }
      }
      // ...and once a level is reached, efSync 0x1774 + level on part 2 every xEC frames.
      if (p.down.levelEffectInterval !== undefined) {
        if (r.fxTimer > 0) r.fxTimer--;
        else if (r.level >= 0 && r.level <= 2) { (out.effects ??= []).push({ effect: 0x1774 + r.level, part: 2 }); r.fxTimer = p.down.levelEffectInterval; }
      }
      if (r.timer2 <= 0) { enter(f, 'LwEnd'); return out; }
      r.timer2--;
      // SpecialLwCharge_IASA: a grounded jump leaves the charge, letting go of down releases the
      // run, and each B press (outside the level cooldown) adds a level.
      if (f.grounded && jumpPressed) { enterRunJump(f, p, false, true); r.hitDamage = null; out.sounds.push(0x1389); return out; }
      if ((input.y ?? 0) > -0.5 && !input.down) { enterRun(f, p); return out; }
      if (pressed) {
        r.timer2 = p.down.releaseWindow;
        if (r.cooldown === 0) { if (r.level < p.down.maxLevel) r.level++; r.cooldown = p.down.levelCooldown; }
        if (!p.down.spinSound) out.sounds.push(0x138f);
      }
      if (r.cooldown > 0) r.cooldown--;
      // PlSh's first level arrives without restarting the cooldown (Sonic's restarts it).
      else if (r.level === -1) { r.level = 0; if (!p.down.spinSound) r.cooldown = p.down.levelCooldown; }
      // SpecialLwCharge_Phys.
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, p.down.airGravity, p.down.airTerminal, p.down.airFriction);
      return out;
    }
    case 'LwEnd':
      if (leftGround) enter(f, 'LwEnd', 1, true);
      if (animationDone(f)) { finish(); return out; }
      airOrGround(f, physics, a);
      return out;
    case 'LwRun': {
      wrap(f);
      if (leftGround) { enterRunJump(f, p, true, false); return out; }
      // SpecialLwRun_IASA: a jump (tap or held X/Y) leaves the run.
      if (jumpPressed) { enterRunJump(f, p, false, true); out.sounds.push(0x1389); return out; }
      // SpecialLwRun_Coll → SpecialLwInterrupt_StopWall: into a wall faster than walk speed.
      if (wall !== 0 && Math.sign(wall) === f.facing && Math.abs(r.lastVel.x) > a.walkSpeed) { enterStopWall(f, p); return out; }
      // SpecialLwRun_Anim.
      if (r.life <= 0) { enter(f, 'LwRunBrake'); return out; }
      decrementLife(r);
      // SpecialLwRun_Phys: ftCommon_8007C98C toward the level's speed, then turn on a reversed stick.
      f.velocity = { x: approach(f.velocity.x, f32(p.down.runAccel * f.facing), f32(r.speed * f.facing), a.friction), y: 0 };
      if (f.facing * input.x < -0.5) { f.facing = -f.facing; enter(f, 'LwRunTurn'); }
      return out;
    }
    case 'LwRunTurn':
      wrap(f);
      if (leftGround) { enterRunJump(f, p, true, false); return out; }
      decrementLife(r);
      // SpecialLwRunTurn_Phys: push toward the new facing by xFC; Coll hands back to the run past x100.
      f.velocity = { x: f32(f.velocity.x + p.down.turnAccel * f.facing), y: 0 };
      if (f.facing * f.velocity.x > p.down.turnExitSpeed) enter(f, 'LwRun', 1, true);
      return out;
    case 'LwRunJump':
      wrap(f);
      if (r.jumpDelay > 0) r.jumpDelay--;
      // SpecialLwRunJump_Anim: life only drains on the way down; empty → normal Fall.
      if (r.life <= 0) { finish(); return out; }
      if (f.velocity.y < 0) decrementLife(r);
      // SpecialLwRunJump_Phys: x118 gravity capped at x11C, x110 stick drift clamped to ±x114.
      f.velocity = physics.customAir(f.slot, f.velocity, p.down.jumpGravity, p.down.jumpTerminal, 0);
      f.velocity.x = Math.max(-p.down.jumpMaxX, Math.min(p.down.jumpMaxX, f32(f.velocity.x + p.down.jumpDrift * input.x)));
      return out;
    case 'LwDive':
      wrap(f);
      // SpecialLwDive_Anim: once its x12C life runs out, special fall (x110 drift, x134 landing).
      if (r.diveLife <= 0) { finish(true, p.down.jumpLanding, p.down.jumpDrift); return out; }
      decrementLife(r);
      f.velocity = physics.customAir(f.slot, f.velocity, p.down.jumpGravity, p.down.jumpTerminal, 0);
      return out;
    case 'LwRunBrake':
      if (animationDone(f)) { finish(); return out; }
      f.velocity = { x: groundFriction(f.velocity.x, p.down.brakeFriction), y: 0 };
      return out;
    case 'LwStopWall':
      if (animationDone(f)) { finish(); return out; }
      f.velocity = { x: 0, y: 0 };
      return out;

    // ---------------- Knuckles' glide (PlKx) ----------------
    case 'SGround': {
      const g = p.glide!;
      // SpecialS_Coll: running off the floor hands over to the glide with the frame kept.
      if (leftGround) { enter(f, 'Glide', 1, true); f.glideUsed = true; return out; }
      // SpecialS_Anim: a finished dash stops dead and frees the glide again.
      if (animationDone(f)) { f.velocity.x = 0; f.glideUsed = false; finish(); return out; }
      // SpecialS_ApplyFriction (PlKx has no dead zone): x(1 - xA8).
      f.velocity = { x: f32((1 - g.friction) * f.velocity.x), y: 0 };
      return out;
    }
    case 'Glide': {
      const g = p.glide!, frame = f.animationFrame;
      // SpecialAirS_Anim: the glide ends into Fall; inside the turn window a reversed stick turns.
      if (animationDone(f)) { finish(); return out; }
      if (frame < g.turnWindow && f.facing * input.x < -g.turnStick) {
        enter(f, 'GlideTurn'); f.velocity = { x: f32(g.startSpeed * f.facing), y: f.velocity.y }; return out;
      }
      // SpecialAirS_IASA: between the early gate and the window a forward flick re-launches at 1.6.
      if (frame > g.earlyFrames && frame < g.turnWindow && f.facing * input.x > g.boostStick && Math.abs(f.previous.x) <= g.boostStick) {
        enter(f, 'Glide'); f.velocity = { x: f32(g.boostSpeed * f.facing), y: f.velocity.y }; return out;
      }
      // SpecialAirS_Phys: xA0 gravity capped at xA4, pushed at 1.2 early, bled by xA8 late.
      let v = physics.customAir(f.slot, f.velocity, g.gravity, g.terminal, 0);
      if (frame >= g.frictionFrom) v = { x: f32((1 - g.friction) * v.x), y: v.y };
      if (frame < g.pushFrames) v = { x: f32(g.pushSpeed * f.facing), y: v.y };
      if (frame >= g.turnWindow) v = physics.customAir(f.slot, v, 0, g.terminal, g.lateAirFriction);
      f.velocity = v;
      return out;
    }
    case 'GlideTurn': {
      const g = p.glide!;
      // SpecialAirSTurn_Phys: a fixed sink; the script's flag 3 flips the facing mid-turn.
      if (command(f, 3) === 1 && !r.cancel) { r.cancel = true; f.facing = -f.facing; }
      // SpecialAirSTurn_Anim: back into the glide with the frame carried over.
      if (animationDone(f)) { r.cancel = false; enter(f, 'Glide', 1, true); return out; }
      f.velocity = physics.customAir(f.slot, { x: f32(g.startSpeed * f.facing), y: g.turnFall }, 0, 99, g.turnFriction);
      f.velocity.y = g.turnFall;
      return out;
    }
  }
}
/** ftCommon cmd_vars flag `index`, raised by the current state's subaction script. */
function command(f: MatchFighter, index: number): number {
  let value = 0;
  for (const event of f.content.timelines.get(f.animation)?.events ?? []) { if (event.frame > f.animationFrame) break; if (event.type === 'command' && event.index === index) value = event.value; }
  return value;
}
function voice(p: SonicSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? (p.chaos?.voice ?? p.up!.voice) : p.down.voice;
}
/** ftMt_SpecialHi_Enter / ftMt_SpecialAirHi_Enter (PlSh sub_04314 / sub_046a0). A firm stick along
 * or into the floor zooms along the ground; anything else takes the aerial zoom (a weak stick goes
 * straight up). Speed x5C·|stick| + x60 along the stick; SetVars then hides Shadow, makes him
 * intangible and spends every jump for x50 frames. The zoom holds SpecialHiLost frame 3. */
function enterLost(f: MatchFighter, p: SonicSpecialData, input: PlayerInput, a: MatchFighter['content']['profile']['attributes'], world: SpecialWorld | undefined): void {
  const c = p.chaos!, r = f.special!.sonic!;
  const x = input.x, y = input.y || (input.down ? -1 : 0);
  let magnitude = Math.min(1, Math.hypot(x, y)), angle = Math.PI / 2;
  const floor = f.grounded ? world?.floor : undefined;
  const normal = floor ? (() => { const dx = floor.b[0] - floor.a[0], dy = floor.b[1] - floor.a[1], l = Math.hypot(dx, dy) || 1, side = dx < 0 ? -1 : 1; return { x: -dy / l * side, y: dx / l * side }; })() : { x: 0, y: 1 };
  // lbVector_AngleXY(floor normal, stick) >= π/2, unless ftCo_8009A134 drops through the platform.
  const dropThrough = !!floor?.oneWay && y < -0.6625;
  if (f.grounded && magnitude >= c.stickMin && normal.x * x + normal.y * y <= 0 && !dropThrough) {
    if (x !== 0) f.facing = x > 0 ? 1 : -1;
    angle = Math.atan2(y, x * f.facing);
    r.lostVel = { x: f32(f.facing * (c.momentum * magnitude + c.momentumAdd) * Math.cos(angle)), y: 0 };
  } else {
    if (magnitude > c.stickMin) {
      if (Math.abs(x) > 0.001) f.facing = x > 0 ? 1 : -1;
      angle = Math.atan2(y, x * f.facing);
    } else {
      // ftCommon_8007DA24: the facing only follows a stick past the dead zone; the zoom goes up.
      if (Math.abs(x) > 0.2875) f.facing = x > 0 ? 1 : -1;
      magnitude = 1;
    }
    const speed = c.momentum * magnitude + c.momentumAdd;
    r.lostVel = { x: f32(f.facing * speed * Math.cos(angle)), y: f32(speed * Math.sin(angle)) };
    if (f.grounded) { f.grounded = false; f.floor = null; r.ecbLock = 5; }
  }
  enter(f, 'HiLost', 0);
  f.animationFrame = Math.min(c.lostFrame, clipEnd(f));
  f.velocity = { ...r.lostVel };
  r.lostLeft = c.duration; r.lostFrames = 0; f.jumpsUsed = a.maxJumps;
  // ftColl_8007B62C(gobj, 2): intangible for the zoom (the End's ChangeMotionState restores it).
  f.invulnerable = Math.max(f.invulnerable, c.duration + 1);
}
/** ftMt_SpecialHiLost_Enter / ftMt_SpecialAirHiLost_Enter: visible again at x6C of the zoom speed. */
function endLost(f: MatchFighter, p: SonicSpecialData): void {
  const c = p.chaos!, r = f.special!.sonic!;
  if (r.lostLeft > 0) f.invulnerable = Math.max(0, f.invulnerable - r.lostLeft);
  enter(f, 'HiEnd');
  f.velocity = f.grounded ? { x: f32(r.lostVel.x * c.endMul), y: 0 } : { x: f32(r.lostVel.x * c.endMul), y: f32(r.lostVel.y * c.endMul) };
}
/** SpecialNCancel_Enter. */
function cancel(f: MatchFighter): void { enter(f, 'NCancel'); f.velocity = { x: f.velocity.x, y: 0 }; }
/** SpecialSHold_Enter. */
function enterHold(f: MatchFighter): void { const r = f.special!.sonic!; enter(f, 'SHold'); r.timer2 = 0; r.cancel = false; r.fxTimer = 0; }
/** SpecialLwCharge_Enter. */
function enterCharge(f: MatchFighter, p: SonicSpecialData, out: SpecialStep): void {
  const r = f.special!.sonic!;
  enter(f, 'LwCharge');
  r.fxTimer = 0;
  out.sounds.push(0x138f);
  r.chargeLeft = p.down.maxChargeFrames || p.down.spinSound?.first || 0; r.timer2 = p.down.releaseWindow; r.level = -1; r.cooldown = p.down.firstLevelDelay;
}
/** SpecialLwStopWall_Enter: stop against the wall, animated at x130. */
function enterStopWall(f: MatchFighter, p: SonicSpecialData): void {
  enter(f, 'LwStopWall', p.down.wallAnimSpeed);
  f.velocity = { x: 0, y: 0 };
}
/** SpecialSHold_Phys: grounded stationary friction, airborne xAC gravity/xB4 cap/xB0 friction. */
function holdPhysics(f: MatchFighter, physics: MeleePhysics, p: SonicSpecialData): void {
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, p.side.holdGravity, p.side.holdTerminal, p.side.holdAirFriction);
}
/** ft_80084F3C on the ground, ft_80084EEC (plain gravity, no drift) in the air. */
function airOrGround(f: MatchFighter, physics: MeleePhysics, a: MatchFighter['content']['profile']['attributes']): void {
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
}
