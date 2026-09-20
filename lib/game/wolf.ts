import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { WolfSpecialData } from './wolf-data.ts';
import type { Floor } from './data.ts';
import type { ReflectorData, SpecialDirection } from './special-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep, type SpecialWorld } from './specials.ts';

/** Wolf's special motion states, named after the motion each one is (PlWf's ftFunction, decoded
 * in lib/game/wolf-data.ts). `SpecialAirHi` plays the SpecialHi figatree; the reflector turns
 * (364/369) play the loop figatrees. */
export type WolfMotion =
  | 'SpecialNStart' | 'SpecialAirNStart'
  | 'SpecialSStart' | 'SpecialAirSStart' | 'SpecialAirS' | 'SpecialAirSEnd'
  | 'SpecialHiHold' | 'SpecialHiHoldAir' | 'SpecialHi' | 'SpecialAirHi' | 'SpecialHiLanding' | 'SpecialHiFall' | 'SpecialHiBound'
  | 'SpecialLwStart' | 'SpecialLwLoop' | 'SpecialLwHit' | 'SpecialLwEnd' | 'SpecialLwTurn'
  | 'SpecialAirLwStart' | 'SpecialAirLwLoop' | 'SpecialAirLwHit' | 'SpecialAirLwEnd' | 'SpecialAirLwTurn';

/** The motion vars (fp+0x2340…) and the fighter fields the callbacks touch. */
export interface WolfRuntime {
  motion: WolfMotion;
  /** Last animation frame whose script events were consumed (the laser's cmd-var-1 edges). */
  flagFrame: number;
  /** state_var1 (side/up hold) or state_var4 (reflector): frames before gravity. */
  gravityDelay: number;
  /** input_stickangle (x6BC) the dash's TransN is turned by. */
  tilt: number;
  /** state_var3 of SpecialAirSEnd: its deal-damage callback fired. */
  hit: boolean;
  /** Firefox: rotateModel, travelFrames, phys frames (x234C) and ground coll frames (x2350). */
  angle: number; travel: number; physFrames: number; groundFrames: number;
  /** Reflector: release lag (state_var1), B released (state_var3), turn frames (state_var2). */
  releaseLag: number; released: boolean; turnFrames: number;
  /** The start motion entered through a platform drop (M360_IASA creates the bubble there). */
  reflecting: boolean;
  /** self_vel.y this frame moved with (the engine's landing zeroes it before the land hook). */
  lastVy: number;
  /** Jumps spent while dashing: the dash touching a floor is not a landing in the original. */
  dashJumps: number;
  /** Down held last step (the pass check wants a fresh tilt). */
  lastDown: boolean;
  /** efSync effects queued by callbacks that run outside the special step. */
  pending: number[];
}

const f32 = Math.fround;
const DEG = Math.PI / 180;
/** PlCo ftCommonData x1FC (0.03, vanilla): ftCommon_8007CF58's slowdown above air_drift_max. */
const AIR_DRIFT_DECEL = 0.03;
/** PlCo ftCommonData x34 (−0.25 on the USA 1.02 disc): ftCo_800C97A8's turn threshold when the
 * engine does not pass its own. */
const TURN_STICK = -0.25;
/** One-shot efSync effects: the muzzle flash (m-ex 5005, EfWfData model 5) on the gun part and
 * the bound's 0x406. The accessory4 models 0x1388-0x138B are held attachments (table life < 1),
 * drawn as Fox's reflector/firefox auras (web/src/render/play-effects.ts); 0x138C does not load. */
const FX = { muzzle: 0x138d, bound: 0x406 } as const;

const params = (f: MatchFighter): WolfSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Wf') throw new Error('Missing Wolf parameters.'); return p;
};
const ANIMATION = (motion: WolfMotion): string => motion === 'SpecialAirHi' ? 'SpecialHi' : motion === 'SpecialLwTurn' ? 'SpecialLwLoop' : motion === 'SpecialAirLwTurn' ? 'SpecialAirLwLoop' : motion;
const PHASE: Record<WolfMotion, SpecialRuntime['phase']> = {
  SpecialNStart: 'start', SpecialAirNStart: 'start',
  SpecialSStart: 'start', SpecialAirSStart: 'start', SpecialAirS: 'travel', SpecialAirSEnd: 'end',
  SpecialHiHold: 'start', SpecialHiHoldAir: 'start', SpecialHi: 'travel', SpecialAirHi: 'travel', SpecialHiLanding: 'end', SpecialHiFall: 'end', SpecialHiBound: 'hit',
  SpecialLwStart: 'start', SpecialAirLwStart: 'start', SpecialLwLoop: 'loop', SpecialAirLwLoop: 'loop', SpecialLwTurn: 'loop', SpecialAirLwTurn: 'loop',
  SpecialLwHit: 'hit', SpecialAirLwHit: 'hit', SpecialLwEnd: 'end', SpecialAirLwEnd: 'end',
};
/** Motions whose Coll is a ground check (ft_80082708): leaving the floor is theirs to handle. */
const GROUND = new Set<WolfMotion>(['SpecialNStart', 'SpecialSStart', 'SpecialHiHold', 'SpecialHi', 'SpecialHiLanding', 'SpecialLwStart', 'SpecialLwLoop', 'SpecialLwHit', 'SpecialLwEnd', 'SpecialLwTurn']);
const LW_AIR: Partial<Record<WolfMotion, WolfMotion>> = {
  SpecialLwStart: 'SpecialAirLwStart', SpecialLwLoop: 'SpecialAirLwLoop', SpecialLwHit: 'SpecialAirLwHit', SpecialLwEnd: 'SpecialAirLwEnd', SpecialLwTurn: 'SpecialAirLwTurn',
};
const LW_GROUND: Partial<Record<WolfMotion, WolfMotion>> = {
  SpecialAirLwStart: 'SpecialLwStart', SpecialAirLwLoop: 'SpecialLwLoop', SpecialAirLwHit: 'SpecialLwHit', SpecialAirLwEnd: 'SpecialLwEnd', SpecialAirLwTurn: 'SpecialLwTurn',
};
/** The motions the xB0 bubble is up in (Fighter_CreateReflect on entry; End clears it). */
const REFLECTING = new Set<WolfMotion>(['SpecialLwLoop', 'SpecialAirLwLoop', 'SpecialLwHit', 'SpecialAirLwHit', 'SpecialLwTurn', 'SpecialAirLwTurn']);
type Finish = (helpless?: boolean, lag?: number, mobility?: number) => void;

export function wolfSpecialName(f: MatchFighter, direction: SpecialDirection, _phase: SpecialRuntime['phase']): string {
  const r = f.special?.wolf;
  if (r) return ANIMATION(r.motion);
  const air = !f.grounded;
  return direction === 'neutral' ? (air ? 'SpecialAirNStart' : 'SpecialNStart') : direction === 'side' ? (air ? 'SpecialAirSStart' : 'SpecialSStart')
    : direction === 'up' ? (air ? 'SpecialHiHoldAir' : 'SpecialHiHold') : (air ? 'SpecialAirLwStart' : 'SpecialLwStart');
}

/** ActionStateChange(start 0, speed 1, blend 0); `keepFrame` is the air/ground swap (anim frame
 * and hitboxes kept). */
function enter(f: MatchFighter, motion: WolfMotion, keepFrame = false): void {
  const s = f.special!, r = s.wolf!;
  r.motion = motion; s.phase = PHASE[motion];
  f.animation = ANIMATION(motion); f.attackName = f.animation;
  if (!keepFrame) { f.animationFrame = 0; f.stateFrame = 0; f.attackSerial++; f.victims.clear(); r.flagFrame = -1; }
  f.animationRate = 1; f.animationEpoch++;
}
const clipEnd = (f: MatchFighter) => Math.max(1, f.content.clips.get(f.animation)?.endFrame ?? 1);
/** FrameTimerCheck == 0. */
const animationDone = (f: MatchFighter) => f.animationFrame >= clipEnd(f);
const setAirborne = (f: MatchFighter) => { f.grounded = false; f.floor = null; };
/** ftCommon_ApplyFrictionGround / ftCommon_ApplyFrictionAir on a speed. */
const friction = (v: number, amount: number) => Math.abs(v) <= amount ? 0 : f32(v - Math.sign(v) * amount);
/** ftCommon_8007D5D4 (8007D60C spends every jump instead). */
const airborneOneJump = (f: MatchFighter) => { setAirborne(f); f.jumpsUsed = 1; };
const airborneNoJumps = (f: MatchFighter) => { setAirborne(f); f.jumpsUsed = f.content.profile.attributes.maxJumps; };
/** ftCommon_8007D9FC. */
const faceStick = (f: MatchFighter, x: number) => { f.facing = x >= 0 ? 1 : -1; };
/** Script events that fired after `from` up to the current frame. */
function scriptEvents(f: MatchFighter, from: number, pick: (e: { type: string; frame: number; index?: number; value?: number }) => boolean): number {
  let count = 0;
  for (const e of f.content.timelines.get(f.animation)?.events ?? []) {
    if (e.frame > f.animationFrame) break;
    if (e.frame > from && pick(e as { type: string; frame: number })) count++;
  }
  return count;
}
/** Upward floor normal of a segment (flat when unknown). */
function floorNormal(floor: { a: readonly [number, number]; b: readonly [number, number] } | undefined): { x: number; y: number } {
  if (!floor) return { x: 0, y: 1 };
  let x = -(floor.b[1] - floor.a[1]), y = floor.b[0] - floor.a[0];
  if (y < 0) { x = -x; y = -y; }
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}
/** lbVector_AngleXY (Vec2_CalculateAngle). */
function angleXY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (!lengths) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / lengths)));
}
/** ftCo_80096900: special fall; a grounded caller lands straight into LandingFallSpecial. */
function specialFall(f: MatchFighter, finish: Finish, mobility: number, landing: number): void {
  if (f.grounded) { land(f, finish, landing); return; }
  finish(true, landing, mobility);
}
/** ftCo_LandingFallSpecial_Enter / ftCo_Landing_Enter. */
function land(f: MatchFighter, finish: Finish, lag: number): void {
  finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
  f.landingFrames = Math.max(1, Math.ceil(lag));
}
/** ftCommon_8007CF58 (Fighter_PhysAir_LimitXVelocity). */
function airFrictionCapped(f: MatchFighter, vx: number): number {
  const a = f.content.profile.attributes;
  return friction(vx, Math.abs(vx) > a.airDriftMax ? AIR_DRIFT_DECEL : a.airFriction);
}
/** The Fire Wolf model tilt (Fighter_SetBoneRotX(XRotN, 2π − rotateModel)) as a world aim. */
function aim(f: MatchFighter, r: WolfRuntime): void {
  f.special!.aim = Math.atan2(Math.sin(r.angle), Math.cos(r.angle) * f.facing);
}

export function beginWolfSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f), a = f.content.profile.attributes, air = !f.grounded;
  s.wolf = { motion: 'SpecialNStart', flagFrame: -1, gravityDelay: 0, tilt: 0, hit: false, angle: Math.PI / 2, travel: 0, physFrames: 0, groundFrames: 0,
    releaseLag: 0, released: false, turnFrames: 0, reflecting: false, lastVy: 0, dashJumps: 0, lastDown: false, pending: [] };
  const r = s.wolf;
  if (direction === 'neutral') {
    // SpecialN / SpecialAirN → sub_03aac: the gun is held from here to the end (visual only).
    r.motion = air ? 'SpecialAirNStart' : 'SpecialNStart';
  } else if (direction === 'side') {
    // SpecialS / SpecialAirS: every jump spent (on the ground too), speed / x28, state_var1 = x24.
    r.gravityDelay = p.side.gravityDelay; f.jumpsUsed = a.maxJumps;
    f.velocity = { x: f32(f.velocity.x / p.side.divisor), y: air ? 0 : f.velocity.y };
    r.motion = air ? 'SpecialAirSStart' : 'SpecialSStart';
  } else if (direction === 'up') {
    // SpecialHi / SpecialAirHi: speed / x58, state_var1 = x54 (accessory4 ptr_02694: charge flame).
    r.gravityDelay = p.up.gravityDelay;
    f.velocity = { x: f32(f.velocity.x / p.up.divisor), y: air ? 0 : f.velocity.y };
    r.motion = air ? 'SpecialHiHoldAir' : 'SpecialHiHold';
  } else {
    // SpecialLw / SpecialAirLw: release lag x98, gravity delay xA4 (accessory4 ptr_02770).
    r.releaseLag = p.down.releaseLag; r.gravityDelay = p.down.gravityDelay;
    if (air) f.velocity = { x: f32(f.velocity.x / p.down.divisor), y: 0 };
    r.motion = air ? 'SpecialAirLwStart' : 'SpecialLwStart';
  }
  s.phase = PHASE[r.motion];
}

export function wolfReflector(f: MatchFighter): ReflectorData | null {
  const r = f.special?.wolf; if (!r) return null;
  return REFLECTING.has(r.motion) || (r.reflecting && (r.motion === 'SpecialAirLwStart' || r.motion === 'SpecialLwStart')) ? params(f).down.reflect : null;
}
/** ptr_03db0 (the reflect_hit_cb): face where the shot came from (x1A2C), SpecialLwHit /
 * SpecialAirLwHit from frame 0 (accessory4 ptr_03e98, the hit aura). The wind box it also spawns
 * (Wind_FighterCreate) is not ported. */
export function reflectWolf(f: MatchFighter, from?: { x: number }): void {
  const r = f.special?.wolf; if (!r || !wolfReflector(f)) return;
  if (from && from.x !== f.x) f.facing = from.x > f.x ? 1 : -1;
  enter(f, f.grounded ? 'SpecialLwHit' : 'SpecialAirLwHit');
}
/** ptr_03bac, SpecialAirSEnd's deal-damage callback: the end slash connected. */
export function wolfHitLanded(f: MatchFighter): void {
  const r = f.special?.wolf;
  if (r?.motion !== 'SpecialAirSEnd') return;
  r.hit = true; f.jumpsUsed = 1;
}
/** M361_IASA's Fighter_IASACheck_JumpF / M366_IASA's JumpAerial: the reflector loop jumps out. */
export function wolfCanJump(f: MatchFighter): boolean {
  const r = f.special?.wolf;
  if (r?.motion === 'SpecialLwLoop') return f.grounded;
  return r?.motion === 'SpecialAirLwLoop' && f.jumpsUsed < f.content.profile.attributes.maxJumps;
}

export function landWolfSpecial(f: MatchFighter, finish: () => void, floor?: Floor): boolean {
  const s = f.special!, r = s.wolf!, p = params(f);
  switch (r.motion) {
    case 'SpecialAirNStart':
      // M344_Coll: the gun is destroyed, plain Landing.
      land(f, finish, f.content.profile.attributes.landingLag); return true;
    case 'SpecialAirSStart':
      // sub_02b8c: the grounded charge at the same frame.
      enter(f, 'SpecialSStart', true); return true;
    case 'SpecialAirS':
      // M351_Coll only checks for a ledge: the dash slides on, still airborne (no landing).
      f.jumpsUsed = r.dashJumps; return true;
    case 'SpecialAirSEnd':
      land(f, finish, p.side.landing); return true;
    case 'SpecialHiHoldAir':
      // sub_0309c: the grounded hold at the same frame.
      enter(f, 'SpecialHiHold', true); return true;
    case 'SpecialAirHi': return firefoxContact(f, p, r, floor);
    case 'SpecialHiFall': case 'SpecialHiBound':
      // sub_03328: SpecialHiLanding from frame 14.
      f.velocity = { x: f.velocity.x, y: 0 }; enter(f, 'SpecialHiLanding'); f.animationFrame = p.up.fallLandFrame; return true;
    case 'SpecialAirLwStart': case 'SpecialAirLwLoop': case 'SpecialAirLwEnd': case 'SpecialAirLwTurn':
      // sub_037d8 / sub_038d0 / sub_039dc / sub_03a40: the ground twin at the same frame.
      enter(f, LW_GROUND[r.motion]!, true); return true;
    case 'SpecialAirLwHit':
      // sub_03950: SpecialLwHit from frame 0.
      enter(f, 'SpecialLwHit'); return true;
    default:
      f.velocity = { x: f.velocity.x, y: 0 }; return true;
  }
}

/** M356_Coll on a floor, while x2350 (ground travel frames) is under x6C: a platform
 * (ftCo_8009A134) passes under; otherwise a hit steeper than 90° + x94 from the floor normal
 * bounces (sub_03228), anything shallower slides on, re-aimed along the velocity. */
function firefoxContact(f: MatchFighter, p: WolfSpecialData, r: WolfRuntime, floor: Floor | undefined): boolean {
  if (r.groundFrames >= p.up.boundFrames) return true;
  if (floor?.oneWay) { setAirborne(f); f.ignoreFloor = floor.id; f.ignoreTicks = 2; return true; }
  const velocity = { x: f.velocity.x, y: r.lastVy };
  if (angleXY(floorNormal(floor), velocity) >= (90 + p.up.boundAngle) * DEG) {
    // sub_03228: self_vel.x · x84, effect 0x406 along the floor; the bound itself is airborne.
    f.velocity = { x: f32(f.velocity.x * p.up.boundSpeed), y: 0 };
    enter(f, 'SpecialHiBound'); setAirborne(f);
    r.pending.push(FX.bound);
    return true;
  }
  f.facing = velocity.x >= 0 ? 1 : -1;
  r.angle = Math.atan2(velocity.y, velocity.x * f.facing); aim(f, r);
  return true;
}

/** Ground→air Coll transitions, run for the previous frame's movement before this frame's
 * callbacks. Returns true when the special ended. */
function leftGround(f: MatchFighter, p: WolfSpecialData, r: WolfRuntime, finish: Finish): boolean {
  switch (r.motion) {
    case 'SpecialNStart':
      // M341_Coll → sub_029e4: the gun is destroyed, Fall.
      finish(); return true;
    case 'SpecialSStart':
      // sub_02b3c: SetAirborne, the aerial charge at the same frame.
      f.jumpsUsed = 1; enter(f, 'SpecialAirSStart', true); return false;
    case 'SpecialHiHold':
      // sub_02ea4.
      f.jumpsUsed = f.content.profile.attributes.maxJumps; enter(f, 'SpecialHiHoldAir', true); return false;
    case 'SpecialHi':
      // sub_03168: the aerial travel at the same frame.
      f.jumpsUsed = f.content.profile.attributes.maxJumps; enter(f, 'SpecialAirHi', true); return false;
    case 'SpecialHiLanding':
      // M357_Coll.
      finish(true, p.up.landing, p.up.mobility); return true;
    case 'SpecialLwHit':
      // sub_03610: SpecialAirLwHit from frame 0.
      f.jumpsUsed = 1; enter(f, 'SpecialAirLwHit'); return false;
    case 'SpecialLwStart': case 'SpecialLwLoop': case 'SpecialLwEnd': case 'SpecialLwTurn':
      f.jumpsUsed = 1; enter(f, LW_AIR[r.motion]!, true); return false;
    default: return false;
  }
}

export function stepWolfSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: Finish, world?: SpecialWorld): SpecialStep {
  const p = params(f), s = f.special!, r = s.wolf!;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  // The Enter ran inside the previous state's IASA: this frame only has the new motion's Phys.
  const fresh = s.age === 0;
  s.age++;
  if (!input.special) s.released = true;
  const flush = () => { for (const effect of r.pending.splice(0)) (out.effects ??= []).push({ effect, part: 0 }); };
  if (!fresh && !f.grounded && GROUND.has(r.motion) && leftGround(f, p, r, finish)) { flush(); return out; }
  if (!fresh) {
    anim(f, input, p, r, finish, out, world);
    if (f.special !== s) { flush(); return out; }
    iasa(f, input, pressed, p, r, world);
  }
  phys(f, input, physics, p, r, world);
  // A motion entered on the floor whose Coll lands it the same frame (the dash ends on the ground,
  // the Fire Wolf travel runs out while sliding).
  if (f.grounded && (r.motion === 'SpecialAirSEnd' || r.motion === 'SpecialHiFall')) landWolfSpecial(f, () => finish(), undefined);
  if (f.special === s) { r.lastVy = f.velocity.y; r.dashJumps = f.jumpsUsed; }
  r.lastDown = !!input.down;
  flush();
  return out;
}

/** The motion's Anim callback. */
function anim(f: MatchFighter, input: PlayerInput, p: WolfSpecialData, r: WolfRuntime, finish: Finish, out: SpecialStep, world?: SpecialWorld): void {
  const held = !!input.special;
  switch (r.motion) {
    case 'SpecialNStart': case 'SpecialAirNStart': {
      // M341_Anim / M344_Anim: each script cmd-var-1 = 1 fires fn_0281c (the laser from the
      // gun's joint 5, facing-aimed, efSync 0x138D at the muzzle) and clears the var.
      const fired = scriptEvents(f, r.flagFrame, (e) => e.type === 'command' && e.index === 1 && e.value === 1);
      r.flagFrame = f.animationFrame;
      for (let i = 0; i < fired; i++) { out.shots.push({ player: f.slot, kind: 'wolf-laser' }); (out.effects ??= []).push({ effect: FX.muzzle, part: p.neutral.gunPart }); }
      // The end destroys the gun: Wait, or Fall (sub_029e4).
      if (animationDone(f)) finish();
      return;
    }
    case 'SpecialSStart':
      // M347_Anim: sub_02a34 then SetAirborne (every jump but one back).
      if (animationDone(f)) { dash(f, input, p, r); airborneOneJump(f); }
      return;
    case 'SpecialAirSStart':
      if (animationDone(f)) dash(f, input, p, r);
      return;
    case 'SpecialAirS':
      if (animationDone(f)) slashEnd(f, p, r);
      return;
    case 'SpecialAirSEnd':
      // M352_Anim: a connected slash falls normally, a missed one falls special.
      if (animationDone(f)) { if (r.hit) finish(); else specialFall(f, finish, p.side.mobility, p.side.landing); }
      return;
    case 'SpecialHiHold':
      if (animationDone(f)) launchGround(f, input, p, r, world);
      return;
    case 'SpecialHiHoldAir':
      if (animationDone(f)) launchAir(f, input, p, r);
      return;
    case 'SpecialHi':
      // M355_Anim → sub_030ec: SpecialHiLanding from frame 13.
      if (--r.travel <= 0) { enter(f, 'SpecialHiLanding'); f.animationFrame = p.up.groundEndFrame; }
      return;
    case 'SpecialAirHi':
      // M356_Anim → sub_031c8.
      if (--r.travel <= 0) enter(f, 'SpecialHiFall');
      return;
    case 'SpecialHiLanding':
      if (animationDone(f)) finish();
      return;
    case 'SpecialHiFall': case 'SpecialHiBound':
      // M358_Anim (M359_Anim calls it).
      if (animationDone(f)) finish(true, p.up.landing, p.up.mobility);
      return;
    case 'SpecialLwStart': case 'SpecialAirLwStart':
      // M360_Anim: into the loop by ground_or_air, with the bubble and accessory4 ptr_03d0c.
      if (!held) r.released = true;
      if (animationDone(f)) loop(f);
      return;
    case 'SpecialLwLoop': case 'SpecialAirLwLoop':
      // M361_Anim / M366_Anim.
      if (!held) r.released = true;
      if (--r.releaseLag <= 0 && r.released) { enter(f, f.grounded ? 'SpecialLwEnd' : 'SpecialAirLwEnd'); return; }
      restartLoop(f, r);
      return;
    case 'SpecialLwHit': case 'SpecialAirLwHit':
      // M362_Anim / M367_Anim: always back to the loop (the loop decides the release).
      if (!held) r.released = true;
      if (animationDone(f)) loop(f);
      return;
    case 'SpecialLwTurn': case 'SpecialAirLwTurn':
      // M364_Anim / M369_Anim: sub_036fc turns the model while x2344 counts down.
      if (!held) r.released = true;
      r.releaseLag--; r.turnFrames--;
      if (r.turnFrames <= 0) loop(f); else restartLoop(f, r);
      return;
    case 'SpecialLwEnd': case 'SpecialAirLwEnd':
      if (animationDone(f)) finish();
      return;
  }
}

/** The motion's IASA callback. */
function iasa(f: MatchFighter, input: PlayerInput, pressed: boolean, p: WolfSpecialData, r: WolfRuntime, world?: SpecialWorld): void {
  // ftCo_80099F1C: a fresh down tilt on a platform (the engine's drop-through reading).
  const pass = () => !!input.down && !r.lastDown && !!world?.floor?.oneWay && f.grounded;
  switch (r.motion) {
    case 'SpecialAirS':
      // M351_IASA: B cuts the dash.
      if (pressed) slashEnd(f, p, r);
      return;
    case 'SpecialLwStart':
      // M360_IASA: the platform drop keeps the frame and puts the bubble up.
      if (pass()) { dropThrough(f); r.reflecting = true; enter(f, 'SpecialAirLwStart', true); }
      return;
    case 'SpecialLwLoop':
      // M361_IASA: turn, else jump (the engine's jump cancel, wolfCanJump), else the drop.
      if (input.x * f.facing <= (world?.turnStick ?? TURN_STICK)) turn(f, p, r, 'SpecialLwTurn');
      else if (pass()) { dropThrough(f); enter(f, 'SpecialAirLwLoop', true); }
      return;
    case 'SpecialAirLwLoop':
      if (input.x * f.facing <= (world?.turnStick ?? TURN_STICK)) turn(f, p, r, 'SpecialAirLwTurn');
      return;
    default: return;
  }
}

/** The motion's Phys callback. */
function phys(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, p: WolfSpecialData, r: WolfRuntime, world?: SpecialWorld): void {
  const a = f.content.profile.attributes;
  switch (r.motion) {
    case 'SpecialNStart': case 'SpecialLwStart': case 'SpecialLwLoop': case 'SpecialLwHit': case 'SpecialLwEnd': case 'SpecialLwTurn': case 'SpecialHiHold':
      // ft_80084F3C.
      f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      return;
    case 'SpecialAirNStart': case 'SpecialHiFall':
      // ft_80084DB0: gravity/fast fall and the normal drift.
      f.velocity = physics.air(f.slot, f.velocity, input.x, f.fastFall);
      return;
    case 'SpecialSStart':
      // M347_Phys: state_var1 counts down; ft_80084F3C.
      if (r.gravityDelay > 0) r.gravityDelay--;
      f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      return;
    case 'SpecialAirSStart': {
      // M350_Phys: x24 frames of x2C friction only, then ftCommon_Fall(x30, x60).
      const sd = p.side;
      if (r.gravityDelay > 0) { r.gravityDelay--; f.velocity = { x: friction(f.velocity.x, sd.startFriction), y: f.velocity.y }; return; }
      const v = physics.customAir(f.slot, f.velocity, sd.startGravity, sd.startTerminal, 0);
      f.velocity = { x: friction(v.x, sd.startFriction), y: v.y };
      return;
    }
    case 'SpecialAirS': {
      // ft_80085154: the TransN step (forward·facing, up) turned by input_stickangle.
      const d = rootDelta(f), z = f32(d.z * f.facing), c = Math.cos(r.tilt), sn = Math.sin(r.tilt);
      const v = { x: f32(z * c - d.y * sn), y: f32(z * sn + d.y * c) };
      if (f.grounded && v.y > 0) setAirborne(f);
      f.velocity = { x: v.x, y: f.grounded ? 0 : v.y };
      return;
    }
    case 'SpecialAirSEnd': {
      // M352_Phys: x44 frames of x40 friction, then ftCommon_Fall(x48, terminal) with it.
      const sd = p.side;
      if (r.gravityDelay > 0) { r.gravityDelay--; f.velocity = { x: friction(f.velocity.x, sd.endFriction), y: f.velocity.y }; return; }
      const v = physics.customAir(f.slot, f.velocity, sd.endGravity, a.terminal, 0);
      f.velocity = { x: friction(v.x, sd.endFriction), y: v.y };
      return;
    }
    case 'SpecialHiHoldAir': {
      // M354_Phys: x54 frames of x5C friction, then ftCommon_Fall(x60, terminal) with it.
      const u = p.up;
      if (r.gravityDelay > 0) { r.gravityDelay--; f.velocity = { x: friction(f.velocity.x, u.holdFriction), y: f.velocity.y }; return; }
      const v = physics.customAir(f.slot, f.velocity, u.holdGravity, a.terminal, 0);
      f.velocity = { x: friction(v.x, u.holdFriction), y: v.y };
      return;
    }
    case 'SpecialHi': {
      // M355_Phys: x78 ground friction from x70 frames on. M355_Coll: x2350 counts the floor
      // frames and rotateModel follows the floor normal.
      const u = p.up;
      const speed = ++r.physFrames >= u.decelAfter ? friction(f.velocity.x, u.decel) : f.velocity.x;
      r.groundFrames++;
      const normal = floorNormal(world?.floor);
      r.angle = Math.atan2(-normal.x * f.facing, normal.y); aim(f, r);
      f.velocity = { x: speed, y: 0 };
      return;
    }
    case 'SpecialAirHi':
      // M356_Phys: after x70 frames, x78 comes off along rotateModel.
      if (++r.physFrames >= p.up.decelAfter) {
        f.velocity = { x: f32(f.velocity.x - f.facing * p.up.decel * Math.cos(r.angle)), y: f32(f.velocity.y - p.up.decel * Math.sin(r.angle)) };
      }
      return;
    case 'SpecialHiLanding':
      // M357_Phys: x7C ground friction.
      f.velocity = { x: friction(f.velocity.x, p.up.landingFriction), y: 0 };
      return;
    case 'SpecialHiBound':
      // M359_Phys: self_vel.y from the figatree, ftCommon_8007CF58.
      f.velocity = { x: airFrictionCapped(f, f.velocity.x), y: rootDelta(f).y };
      return;
    case 'SpecialAirLwStart': case 'SpecialAirLwLoop': case 'SpecialAirLwHit': case 'SpecialAirLwEnd': case 'SpecialAirLwTurn': {
      // M365_Phys / M366_Phys: xA4 frames without gravity, then ftCommon_Fall(xAC, terminal).
      if (r.gravityDelay !== 0) { r.gravityDelay--; f.velocity = { x: airFrictionCapped(f, f.velocity.x), y: f.velocity.y }; return; }
      const v = physics.customAir(f.slot, f.velocity, p.down.gravity, a.terminal, 0);
      f.velocity = { x: airFrictionCapped(f, v.x), y: v.y };
      return;
    }
  }
}

/** sub_02a34: SpecialAirS, input_stickangle from the stick's y past x2684 (up to x3BA0 degrees). */
function dash(f: MatchFighter, input: PlayerInput, p: WolfSpecialData, r: WolfRuntime): void {
  const y = input.y ?? 0, sign = y < 0 ? -1 : 1, magnitude = Math.abs(y);
  enter(f, 'SpecialAirS');
  r.tilt = magnitude >= p.side.tiltStick ? f32(2 * (magnitude - p.side.tiltStick) * sign * p.side.tiltMax * f.facing) : 0;
}
/** sub_02bdc: SpecialAirSEnd at (x3C·facing, 0), x44 frames before gravity, the hit latch reset. */
function slashEnd(f: MatchFighter, p: WolfSpecialData, r: WolfRuntime): void {
  enter(f, 'SpecialAirSEnd');
  f.velocity = { x: f32(f.facing * p.side.endSpeed), y: 0 };
  r.gravityDelay = p.side.endDelay; r.hit = false;
}
/** sub_02f04: aim by the stick past ptr_02690 (turning past x88), or straight up. */
function launchAir(f: MatchFighter, input: PlayerInput, p: WolfSpecialData, r: WolfRuntime): void {
  const u = p.up, x = input.x, y = input.y ?? 0;
  if (Math.abs(x) + Math.abs(y) > u.stickMin) {
    if (Math.abs(x) > u.facingStick) faceStick(f, x);
    r.angle = Math.atan2(y, x * f.facing);
  } else r.angle = Math.PI / 2;
  enter(f, 'SpecialAirHi');
  r.travel = u.travel; r.physFrames = 0; r.groundFrames = 0;
  f.velocity = { x: f32(Math.cos(r.angle) * u.speed * f.facing), y: f32(u.speed * Math.sin(r.angle)) };
  f.jumpsUsed = f.content.profile.attributes.maxJumps;
  aim(f, r);
}
/** sub_02c8c: a stick past ptr_02690 that does not point above the floor travels along it
 * (unless the floor is a platform, which it drops through); anything else takes off. */
function launchGround(f: MatchFighter, input: PlayerInput, p: WolfSpecialData, r: WolfRuntime, world?: SpecialWorld): void {
  const u = p.up, x = input.x, y = input.y ?? 0, normal = floorNormal(world?.floor);
  if (Math.abs(x) + Math.abs(y) > u.stickMin && angleXY(normal, { x, y }) >= Math.PI / 2) {
    if (world?.floor?.oneWay) dropThrough(f);
    else {
      faceStick(f, x);
      enter(f, 'SpecialHi');
      r.travel = u.travel; r.physFrames = 0; r.groundFrames = 0;
      f.velocity = { x: f32(u.speed * f.facing), y: 0 };
      r.angle = Math.atan2(-normal.x * f.facing, normal.y); aim(f, r);
      return;
    }
  }
  airborneNoJumps(f);
  launchAir(f, input, p, r);
}
/** sub_03400 / sub_0337c: the loop by ground_or_air, Fighter_CreateReflect (accessory4 ptr_03d0c,
 * the loop aura). */
function loop(f: MatchFighter): void {
  enter(f, f.grounded ? 'SpecialLwLoop' : 'SpecialAirLwLoop');
}
/** sub_034ec / sub_0382c: the turn from frame 0 with the bubble, facing flipped, x9C frames
 * (the first sub_036fc step runs at once). */
function turn(f: MatchFighter, p: WolfSpecialData, r: WolfRuntime, motion: 'SpecialLwTurn' | 'SpecialAirLwTurn'): void {
  enter(f, motion);
  f.facing = f.facing === 1 ? -1 : 1;
  r.turnFrames = p.down.turnFrames - 1;
}
/** The loop figatrees (action flag 0x40000000) restart, and their scripts with them. */
function restartLoop(f: MatchFighter, r: WolfRuntime): void {
  if (!animationDone(f)) return;
  f.animationFrame = f32(f.animationFrame % clipEnd(f)); f.attackSerial++; f.victims.clear(); r.flagFrame = -1;
}
/** ftCo_8009A184 / ftCo_8009A134: SetAirborne and skip the platform underfoot. */
function dropThrough(f: MatchFighter): void {
  if (f.floor !== null) { f.ignoreFloor = f.floor; f.ignoreTicks = 12; }
  airborneOneJump(f);
}
