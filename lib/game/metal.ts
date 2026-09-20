import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { MetalSonicSpecialData } from './metal-data.ts';
import type { Floor } from './data.ts';
import type { ReflectorData, SpecialDirection } from './special-data.ts';
import { command, rootDelta, type ShotIntent, type SpecialRuntime, type SpecialStep, type SpecialWorld } from './specials.ts';

/** Metal Sonic's special motion states, named after the motion (341 + n) each one is. PlNm's
 * ftFunction has no debug symbols, so the callbacks are named by motion (`M347_IASA`) and by the
 * vanilla ftFx function they fall back to where PlNm keeps Fox's raw DOL pointer (see
 * lib/game/metal-data.ts for the dispatch and which motions are unreachable). */
export type MetalMotion =
  | 'SpecialAirNStart' | 'SpecialAirNLoop' | 'SpecialAirNEnd'
  | 'SpecialSStart' | 'SpecialS' | 'SpecialAirSStart' | 'SpecialAirS' | 'SpecialAirSEnd'
  | 'SpecialHiHold' | 'SpecialHiHoldAir' | 'SpecialHi' | 'SpecialAirHi' | 'SpecialHiLanding' | 'SpecialHiFall' | 'SpecialHiBound'
  | 'SpecialLwStart' | 'SpecialLwLoop' | 'SpecialLwHit' | 'SpecialLwEnd'
  | 'SpecialAirLwStart' | 'SpecialAirLwLoop' | 'SpecialAirLwHit' | 'SpecialAirLwEnd';

/** The motion vars (fp+0x2340…) and the few fighter fields the callbacks touch. */
export interface MetalSonicRuntime {
  motion: MetalMotion;
  /** state_var1 (side: Fox's x24 gravity delay, only 352 counts it down; up: see beginMetalSpecial)
   * or state_var4 (the reflector's xA4 delay). */
  gravityDelay: number;
  /** The accessory4 callback SpecialAirNEnd was entered with: ptr_04ffc (strong) or ptr_053e8 (weak). */
  shot: 'strong' | 'weak';
  /** The shot callback wrote self_vel = gr_vel = −recoil·facing after this frame's physics. */
  recoil: boolean;
  /** The shot queued this frame: a landing in the same frame's Coll drops it (its
   * LandingFallSpecial clears accessory4_cb before the callback runs). */
  shotIntent: ShotIntent | null;
  /** Last animation frame whose script events were consumed (throw_flags b0 edges). */
  flagFrame: number;
  /** Reflector state_var1 (release lag) and state_var3 (B released). */
  releaseLag: number; released: boolean;
  /** gr_vel where PlNm's ground phys never copies it into self_vel (M347/M360) and the
   * firefox ground travel. */
  grVel: number;
  /** Firefox: rotateModel, travelFrames, unk (phys frames) and unk2 (ground coll frames). */
  angle: number; travel: number; physFrames: number; groundFrames: number;
  /** self_vel.y this frame moved with (the engine's landing zeroes it before the Coll hook). */
  lastVy: number;
}

const f32 = Math.fround;
const DEG = Math.PI / 180;
/** PlCo ftCommonData x1FC (0.03, vanilla): ftCommon_8007CF58's slowdown above air_drift_max.
 * The engine's common block does not carry this word, so the vanilla value is pinned here. */
const AIR_DRIFT_DECEL = 0.03;
/** ftFx_SpecialHiFall_Enter starts SpecialHiLanding at this frame. */
const FIREFOX_LANDING_FRAME = 13;
/** ftCo_SM_Fall / ftCo_SM_FallAerial (ftCommon/forward.h): what ftCo_Fall_Enter leaves in
 * state_var1 (mv.co.fall.smid). */
const FALL_SUBMOTION = 20, FALL_AERIAL_SUBMOTION = 23;

const params = (f: MatchFighter): MetalSonicSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Nm') throw new Error('Missing Metal Sonic parameters.'); return p;
};
const ANIMATION = (motion: MetalMotion): string => motion === 'SpecialAirHi' ? 'SpecialHi' : motion;
const PHASE: Record<MetalMotion, SpecialRuntime['phase']> = {
  SpecialAirNStart: 'start', SpecialAirNLoop: 'loop', SpecialAirNEnd: 'end',
  SpecialSStart: 'start', SpecialAirSStart: 'start', SpecialS: 'travel', SpecialAirS: 'travel', SpecialAirSEnd: 'end',
  SpecialHiHold: 'start', SpecialHiHoldAir: 'start', SpecialHi: 'travel', SpecialAirHi: 'travel', SpecialHiLanding: 'end', SpecialHiFall: 'end', SpecialHiBound: 'hit',
  SpecialLwStart: 'start', SpecialAirLwStart: 'start', SpecialLwLoop: 'loop', SpecialAirLwLoop: 'loop', SpecialLwHit: 'hit', SpecialAirLwHit: 'hit', SpecialLwEnd: 'end', SpecialAirLwEnd: 'end',
};
/** Motions whose Coll is a ground check (ft_80082708 and friends): leaving the floor is theirs to handle. */
const GROUND = new Set<MetalMotion>(['SpecialSStart', 'SpecialS', 'SpecialHiHold', 'SpecialHi', 'SpecialHiLanding', 'SpecialLwStart', 'SpecialLwLoop', 'SpecialLwHit', 'SpecialLwEnd']);
const LW_AIR: Record<'SpecialLwStart' | 'SpecialLwLoop' | 'SpecialLwHit' | 'SpecialLwEnd', MetalMotion> = {
  SpecialLwStart: 'SpecialAirLwStart', SpecialLwLoop: 'SpecialAirLwLoop', SpecialLwHit: 'SpecialAirLwHit', SpecialLwEnd: 'SpecialAirLwEnd',
};
const LW_GROUND: Partial<Record<MetalMotion, MetalMotion>> = {
  SpecialAirLwStart: 'SpecialLwStart', SpecialAirLwLoop: 'SpecialLwLoop', SpecialAirLwHit: 'SpecialLwHit', SpecialAirLwEnd: 'SpecialLwEnd',
};
type Finish = (helpless?: boolean, lag?: number, mobility?: number) => void;

export function metalSpecialName(f: MatchFighter, direction: SpecialDirection, _phase: SpecialRuntime['phase']): string {
  const r = f.special?.metal;
  if (r) return ANIMATION(r.motion);
  const air = !f.grounded;
  return direction === 'neutral' ? 'SpecialAirNStart' : direction === 'side' ? (air ? 'SpecialAirSStart' : 'SpecialSStart')
    : direction === 'up' ? (air ? 'SpecialHiHoldAir' : 'SpecialHiHold') : (air ? 'SpecialAirLwStart' : 'SpecialLwStart');
}

/** Fighter_ChangeMotionState(start 0, speed 1, blend 0); `keepFrame` is the air/ground swap
 * (anim frame kept, hitboxes kept). */
function enter(f: MatchFighter, motion: MetalMotion, keepFrame = false): void {
  const s = f.special!, r = s.metal!;
  r.motion = motion; s.phase = PHASE[motion];
  f.animation = ANIMATION(motion); f.attackName = f.animation;
  if (!keepFrame) { f.animationFrame = 0; f.stateFrame = 0; f.attackSerial++; f.victims.clear(); r.flagFrame = 0; }
  f.animationRate = 1; f.animationEpoch++;
}
const clipEnd = (f: MatchFighter) => Math.max(1, f.content.clips.get(f.animation)?.endFrame ?? 1);
/** ftAnim_IsFramesRemaining == 0. */
const animationDone = (f: MatchFighter) => f.animationFrame >= clipEnd(f);
const setAirborne = (f: MatchFighter) => { f.grounded = false; f.floor = null; };
/** ftCommon_ApplyFrictionGround applied straight to a speed. */
const groundFriction = (v: number, friction: number) => Math.abs(v) <= friction ? 0 : f32(v - Math.sign(v) * friction);
/** Script events (of `type`) that fired after `from` up to the current frame. */
function scriptEvents(f: MatchFighter, from: number, pick: (e: { type: string; frame: number; flag?: number; value?: number }) => boolean): number {
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
/** lbVector_AngleXY. */
function angleXY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (!lengths) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / lengths)));
}
/** ftCo_80096900: special fall. Called on the ground it goes airborne first (8007D60C) and the
 * FallSpecial Coll lands on the next frame; with x10 set (PlNm's calls) that is always the
 * LandingFallSpecial lag, so a grounded caller lands straight into it. */
function specialFall(f: MatchFighter, finish: Finish, mobility: number, landing: number): void {
  if (f.grounded) { land(f, finish, landing); return; }
  finish(true, landing, mobility);
}
/** ftCo_LandingFallSpecial_Enter. */
function land(f: MatchFighter, finish: Finish, lag: number): void {
  finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
  f.landingFrames = Math.max(1, Math.ceil(lag));
}
/** ftCommon_8007CF58: aerial friction, or the common x1FC slowdown above air_drift_max. */
function airFrictionCapped(f: MatchFighter, vx: number): number {
  const a = f.content.profile.attributes, over = Math.abs(vx) > a.airDriftMax, friction = over ? AIR_DRIFT_DECEL : a.airFriction;
  return Math.abs(vx) <= friction ? 0 : f32(vx - Math.sign(vx) * friction);
}

export function beginMetalSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f), a = f.content.profile.attributes, air = !f.grounded;
  s.metal = { motion: 'SpecialAirNStart', gravityDelay: 0, shot: 'strong', recoil: false, shotIntent: null, flagFrame: 0, releaseLag: 0, released: false, grVel: 0, angle: Math.PI / 2, travel: 0, physFrames: 0, groundFrames: 0, lastVy: 0 };
  const r = s.metal;
  if (direction === 'neutral') {
    // PlNm SpecialN / SpecialAirN: throw_flags = flag0 = 0, both into 344 (the aerial start).
    r.motion = 'SpecialAirNStart';
    return;
  }
  if (direction === 'side') {
    // ftFx_SpecialSStart_Enter / ftFx_SpecialAirSStart_Enter: state_var1 = x24, speed / x28.
    r.gravityDelay = p.side.gravityDelay;
    if (air) { r.motion = 'SpecialAirSStart'; f.velocity = { x: f32(f.velocity.x / p.side.divisor), y: 0 }; f.jumpsUsed = a.maxJumps; }
    else { r.motion = 'SpecialSStart'; r.grVel = f32(f.velocity.x / p.side.divisor); }
    return;
  }
  if (direction === 'up') {
    // PlNm SpecialHi / SpecialAirHi: ftCommon_Ascend is overwritten by ftCommon_8007E2FC, which
    // zeroes every velocity, then 353/354. Unlike Fox's own entry they never write state_var1,
    // so the aerial hold's gravity delay is whatever the previous motion left there. The port
    // reproduces the common cases — a Fall (ftCo_Fall_Enter stores its submotion id, FallAerial
    // after the double jump) and the ground jump (ftCo_800CB110 leaves KneeBend's short-hop flag)
    // — and reads 0 elsewhere. Fall's F/B submotions (+1/+2 with drift) are not tracked.
    f.velocity = { x: 0, y: 0 }; f.knockback = { x: 0, y: 0 };
    r.motion = air ? 'SpecialHiHoldAir' : 'SpecialHiHold';
    r.gravityDelay = !air ? 0 : f.state === 'fall' ? (f.jumpsUsed >= a.maxJumps ? FALL_AERIAL_SUBMOTION : FALL_SUBMOTION) : f.state === 'jump' && f.shortHop ? 1 : 0;
    return;
  }
  // PlNm SpecialLw (ground) / ftFx_SpecialAirLw_Enter (air): release lag x98, gravity delay xA4.
  r.releaseLag = p.down.releaseLag; r.released = false; r.gravityDelay = p.down.gravityDelay;
  if (air) { r.motion = 'SpecialAirLwStart'; f.velocity = { x: f32(f.velocity.x / p.down.divisor), y: 0 }; }
  else { r.motion = 'SpecialLwStart'; r.grVel = f.velocity.x; }
}

/** The reflect bubble (ftColl_CreateReflectHit with xB0) is up in Loop and Hit. */
export function metalReflector(f: MatchFighter): ReflectorData | null {
  const r = f.special?.metal; if (!r) return null;
  return r.motion === 'SpecialLwLoop' || r.motion === 'SpecialAirLwLoop' || r.motion === 'SpecialLwHit' || r.motion === 'SpecialAirLwHit' ? params(f).down.reflect : null;
}
/** ftFx_SpecialLwHit_Enter (the reflect_hit_cb). The original also turns toward the reflected
 * item (x1A2C); the engine's reflect hook carries no direction, so the facing is kept. */
export function reflectMetal(f: MatchFighter): void {
  const r = f.special?.metal; if (!r || !metalReflector(f)) return;
  enter(f, f.grounded ? 'SpecialLwHit' : 'SpecialAirLwHit');
}

export function landMetalSpecial(f: MatchFighter, finish: () => void, floor?: Floor): boolean {
  const s = f.special!, r = s.metal!, p = params(f), a = f.content.profile.attributes;
  switch (r.motion) {
    case 'SpecialAirNStart': case 'SpecialAirNEnd': case 'SpecialAirNLoop':
      // M344_Coll / M345_Coll (ptr_054a0): LandingFallSpecial, before the frame's shot callback.
      if (r.shotIntent) r.shotIntent.dropped = true;
      land(f, finish, p.neutral.landing); return true;
    case 'SpecialAirSStart':
      // M350_Coll: the grounded charge at the same frame (no 8007D7FC, so gr_vel is still the 0
      // that 8007D60C left).
      r.grVel = 0; f.velocity = { x: 0, y: 0 }; enter(f, 'SpecialSStart', true); return true;
    case 'SpecialAirS':
      // ftFx_SpecialAirS_AirToGround: the grounded dash, frame kept, speed kept.
      f.velocity = { x: f.velocity.x, y: 0 }; enter(f, 'SpecialS', true); return true;
    case 'SpecialAirSEnd':
      land(f, finish, p.side.landing); return true;
    case 'SpecialHiHoldAir':
      // ftFx_SpecialHiHoldAir_AirToGround: 8007D7FC + ftCommon_ClampAirDrift.
      f.velocity = { x: Math.max(-a.airDriftMax, Math.min(a.airDriftMax, f.velocity.x)), y: 0 }; enter(f, 'SpecialHiHold', true); return true;
    case 'SpecialAirHi': return firefoxContact(f, p, r, floor);
    case 'SpecialHiFall':
      // ftFx_SpecialHiFall_Enter: SpecialHiLanding from frame 13.
      f.velocity = { x: f.velocity.x, y: 0 }; enter(f, 'SpecialHiLanding'); f.animationFrame = FIREFOX_LANDING_FRAME; return true;
    case 'SpecialHiBound':
      // ftFx_SpecialHiBound_Coll: 8007D7FC, the bound goes on.
      f.velocity = { x: f.velocity.x, y: 0 }; return true;
    case 'SpecialAirLwStart': case 'SpecialAirLwLoop': case 'SpecialAirLwHit': case 'SpecialAirLwEnd': {
      // Fox's *_AirToGround: 8007D7FC (gr_vel = self_vel.x) + ftCommon_ClampAirDrift (self_vel only).
      r.grVel = f.velocity.x;
      f.velocity = { x: Math.max(-a.airDriftMax, Math.min(a.airDriftMax, f.velocity.x)), y: 0 };
      enter(f, LW_GROUND[r.motion]!, true); return true;
    }
    default:
      // A ground motion that dropped through its own Coll before landing again.
      f.velocity = { x: f.velocity.x, y: 0 }; return true;
  }
}

/** ftFx_SpecialAirHi_Coll on a floor: a platform passes under the firefox until unk2 reaches x6C
 * (ftCo_8009A134); otherwise a hit steeper than 90° + x94 from the floor normal bounces
 * (SpecialHiBound), anything shallower slides on, re-aimed along the velocity. */
function firefoxContact(f: MatchFighter, p: MetalSonicSpecialData, r: MetalSonicRuntime, floor: Floor | undefined): boolean {
  if (floor?.oneWay && r.groundFrames < p.up.boundFrames) {
    f.grounded = false; f.floor = null; f.ignoreFloor = floor.id; f.ignoreTicks = 2;
    return true;
  }
  const velocity = { x: f.velocity.x, y: r.lastVy };
  const steep = angleXY(floorNormal(floor), velocity) >= (90 + p.up.boundAngle) * DEG;
  if (steep) {
    // ftFx_SpecialHiBound_Enter: self_vel.x · x84, cmd_vars[0] = 0.
    f.velocity = { x: f32(f.velocity.x * p.up.boundSpeed), y: 0 };
    enter(f, 'SpecialHiBound');
    return true;
  }
  f.facing = velocity.x >= 0 ? 1 : -1;
  r.angle = Math.atan2(velocity.y, velocity.x * f.facing);
  return true;
}

/** Ground→air Coll transitions, run for the previous frame's movement before this frame's
 * callbacks. Returns true when the special ended. */
function leftGround(f: MatchFighter, p: MetalSonicSpecialData, r: MetalSonicRuntime, finish: Finish): boolean {
  const a = f.content.profile.attributes;
  switch (r.motion) {
    case 'SpecialSStart':
      // M347_Coll: straight into 348 at the charge's frame (no airborne call; 348's own Coll
      // takes it to the air next frame).
      enter(f, 'SpecialS', true); return false;
    case 'SpecialS':
      // ftFx_SpecialS_GroundToAir: 8007D60C, SpecialAirS at the same frame.
      f.jumpsUsed = a.maxJumps; enter(f, 'SpecialAirS', true); return false;
    case 'SpecialHiHold':
      f.jumpsUsed = a.maxJumps; enter(f, 'SpecialHiHoldAir', true); return false;
    case 'SpecialHi':
      // ftFx_SpecialHi_GroundToAir: 8007D60C, SpecialAirHi at the same frame, hitboxes kept.
      f.jumpsUsed = a.maxJumps; enter(f, 'SpecialAirHi', true); return false;
    case 'SpecialHiLanding':
      finish(true, p.up.landing, p.up.mobility); return true;
    case 'SpecialLwStart': case 'SpecialLwLoop': case 'SpecialLwHit': case 'SpecialLwEnd':
      // Fox's *_GroundToAir: 8007D5D4 (jumpsUsed = 1, gr_vel = 0).
      f.jumpsUsed = Math.max(1, f.jumpsUsed); r.grVel = 0; enter(f, LW_AIR[r.motion], true); return false;
    default: return false;
  }
}

export function stepMetalSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: Finish, world?: SpecialWorld): SpecialStep {
  const p = params(f), s = f.special!, r = s.metal!;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  // The Enter ran inside the previous state's IASA: this frame only has the new motion's Phys.
  const fresh = s.age === 0;
  s.age++; r.shotIntent = null;
  if (!input.special) s.released = true;
  if (!fresh && !f.grounded && GROUND.has(r.motion) && leftGround(f, p, r, finish)) return out;
  if (!fresh) {
    anim(f, input, p, r, finish, world);
    if (f.special !== s) return out;
    iasa(f, input, pressed, p, r, finish, world);
    if (f.special !== s) return out;
  }
  phys(f, input, physics, p, r, world);
  // Accessory callbacks run after Phys/Coll: the neutral shot.
  if (r.motion === 'SpecialAirNEnd') shotCallback(f, r, out);
  r.lastVy = f.velocity.y;
  return out;
}

/** The motion's Anim callback. */
function anim(f: MatchFighter, input: PlayerInput, p: MetalSonicSpecialData, r: MetalSonicRuntime, finish: Finish, world?: SpecialWorld): void {
  const n = p.neutral, frame = f.animationFrame;
  switch (r.motion) {
    case 'SpecialAirNStart':
      // M344_Anim: B released in the weak window ends with ptr_053e8, in the strong window with
      // ptr_04ffc; held there, ChangeMotionState(344) re-enters at the same frame (the charge
      // colanim 0x2E), which the port leaves running. Past the window the start plays out.
      if (frame >= n.weakFrom && frame <= n.weakTo && !input.special) enterShot(f, r, 'weak');
      else if (frame >= n.strongFrom && frame <= n.strongTo && !input.special) enterShot(f, r, 'strong');
      if (r.motion === 'SpecialAirNStart' && animationDone(f)) enter(f, 'SpecialAirNLoop');
      return;
    case 'SpecialAirNLoop':
      // M345_Anim: Fighter_TakeDamage(x) on frame 1; the burst ends in special fall.
      if (frame === n.selfDamageFrame) f.percent = Math.max(0, Math.min(999, f32(f.percent + n.selfDamage)));
      if (animationDone(f)) specialFall(f, finish, n.loopMobility, n.loopLanding);
      return;
    case 'SpecialAirNEnd':
      // M346_Anim: plain Fall (the neutral spends no jumps).
      if (animationDone(f)) finish();
      return;
    case 'SpecialSStart':
      // M347_Anim: Wait once the charge figatree ends.
      if (animationDone(f)) finish();
      return;
    case 'SpecialAirSStart':
      if (animationDone(f)) specialFall(f, finish, p.side.airMobility, p.side.airEndLanding);
      return;
    case 'SpecialS':
      // M348_Anim: out of the dash at (1.5·facing, −0.5) into Fox's SpecialAirSEnd.
      if (animationDone(f)) dashEnd(f, p, r, finish, true);
      return;
    case 'SpecialAirS':
      if (animationDone(f)) dashEnd(f, p, r, finish, false);
      return;
    case 'SpecialAirSEnd':
      if (animationDone(f)) specialFall(f, finish, p.side.mobility, p.side.landing);
      return;
    case 'SpecialHiHold': case 'SpecialHiHoldAir':
      // ftFx_SpecialHiHold(Air)_Anim.
      if (animationDone(f)) { if (f.grounded) launchGround(f, input, p, r, world); else launchAir(f, input, p, r); }
      return;
    case 'SpecialHi':
      // M355_Anim (PlNm): the ground travel ends in special fall with the animation (Fox counted
      // travelFrames here instead).
      if (animationDone(f)) specialFall(f, finish, p.up.groundMobility, p.up.groundLanding);
      return;
    case 'SpecialAirHi':
      // ftFx_SpecialAirHi_Anim. A firefox sliding along a floor is still airborne in the
      // original, so it falls and lands (SpecialHiLanding from frame 13) a frame later.
      if (--r.travel <= 0) {
        if (f.grounded) { enter(f, 'SpecialHiLanding'); f.animationFrame = FIREFOX_LANDING_FRAME; }
        else enter(f, 'SpecialHiFall');
      }
      return;
    case 'SpecialHiLanding':
      if (animationDone(f)) finish();
      return;
    case 'SpecialHiFall':
      if (animationDone(f)) finish(true, p.up.landing, p.up.mobility);
      return;
    case 'SpecialHiBound': {
      // ftFx_SpecialHiBound_Anim (cmd_vars[0] is only written past the figatree's end).
      const air = !f.grounded;
      if ((command(f, 0) !== 0 && air) || animationDone(f)) {
        if (air) finish(true, p.up.landing, p.up.mobility); else finish();
      }
      return;
    }
    case 'SpecialLwStart': case 'SpecialAirLwStart':
      if (!input.special) r.released = true;
      if (animationDone(f)) enter(f, f.grounded ? 'SpecialLwLoop' : 'SpecialAirLwLoop');
      return;
    case 'SpecialLwLoop': case 'SpecialAirLwLoop':
      if (!input.special) r.released = true;
      if (r.releaseLag > 0) r.releaseLag--;
      if (r.releaseLag <= 0 && r.released) { enter(f, f.grounded ? 'SpecialLwEnd' : 'SpecialAirLwEnd'); return; }
      // The loop figatree (action flag 0x40000000) restarts, and its script with it.
      if (animationDone(f)) { f.animationFrame = f32(f.animationFrame % clipEnd(f)); f.attackSerial++; f.victims.clear(); r.flagFrame = 0; }
      return;
    case 'SpecialLwHit': case 'SpecialAirLwHit':
      if (!input.special) r.released = true;
      if (r.releaseLag > 0) r.releaseLag--;
      // ftFx_SpecialLwHit_Check.
      if (animationDone(f)) {
        if (r.releaseLag <= 0 && r.released) enter(f, f.grounded ? 'SpecialLwEnd' : 'SpecialAirLwEnd');
        else enter(f, f.grounded ? 'SpecialLwLoop' : 'SpecialAirLwLoop');
      }
      return;
    case 'SpecialLwEnd': case 'SpecialAirLwEnd':
      // 8007D92C: Wait or Fall.
      if (animationDone(f)) finish();
      return;
  }
}

/** The motion's IASA callback (PlNm nulls it for the reflector and most of the neutral). */
function iasa(f: MatchFighter, input: PlayerInput, pressed: boolean, p: MetalSonicSpecialData, r: MetalSonicRuntime, finish: Finish, world?: SpecialWorld): void {
  const shield = !!world?.shieldPressed;
  switch (r.motion) {
    case 'SpecialAirNStart': {
      // M341_IASA: the stick snaps self_vel.x to ±0.2 past ±0.25.
      const n = p.neutral;
      if (input.x >= n.driftStick) f.velocity = { x: n.drift, y: f.velocity.y };
      else if (input.x <= -n.driftStick) f.velocity = { x: -n.drift, y: f.velocity.y };
      return;
    }
    case 'SpecialSStart': case 'SpecialAirSStart': {
      // M347_IASA / M350_IASA: hold B to charge (the figatree freezes at x frames), release to
      // dash at the rung's speed, L/R/Z to cancel (Wait on the ground, special fall in the air).
      const sd = p.side, air = r.motion === 'SpecialAirSStart', frame = f.animationFrame;
      if (input.special) {
        if (frame >= sd.freezeFrame) f.animationRate = 0;
        if (shield) { if (air) specialFall(f, finish, sd.airMobility, sd.airCancelLanding); else finish(); }
        return;
      }
      const rung = sd.frames.findIndex((threshold) => frame >= threshold);
      if (rung < 0) return;
      f.velocity = { x: f32(f.facing * sd.speeds[rung]!), y: f.velocity.y };
      enter(f, air ? 'SpecialAirS' : 'SpecialS');
      return;
    }
    case 'SpecialS': case 'SpecialAirS':
      // M348_IASA / M351_IASA: B, L, R or Z from frame 2 cuts the dash.
      if (f.animationFrame >= p.side.cancelFrame && (pressed || shield)) dashEnd(f, p, r, finish, r.motion === 'SpecialS');
      return;
    default: return;
  }
}

/** The motion's Phys callback. */
function phys(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, p: MetalSonicSpecialData, r: MetalSonicRuntime, world?: SpecialWorld): void {
  const a = f.content.profile.attributes, frame = f.animationFrame;
  switch (r.motion) {
    case 'SpecialAirNStart': {
      // M344_Phys: 8007D5D4 (airborne, one jump spent), air friction, then the rise bands.
      const n = p.neutral, rise = n.rise;
      airborneOneJump(f);
      let v = physics.customAir(f.slot, f.velocity, 0, 1e6, n.friction);
      if (frame <= rise.aLast) v = physics.customAir(f.slot, v, rise.gravity, rise.a, 0);
      if (frame >= rise.from) {
        if (frame <= rise.bLast) v = physics.customAir(f.slot, v, rise.gravity, rise.b, 0);
        if (frame <= rise.cLast) v = physics.customAir(f.slot, v, rise.gravity, rise.c, 0);
        if (frame >= rise.dFrom) v = physics.customAir(f.slot, v, rise.gravity, rise.d, 0);
      }
      f.velocity = v;
      return;
    }
    case 'SpecialAirNLoop': case 'SpecialAirNEnd': {
      // M342_Phys: 8007D5D4, ftCommon_Fall(0.17, 2.4), air friction.
      const n = p.neutral;
      airborneOneJump(f);
      if (r.recoil) { r.recoil = false; f.velocity = { x: f32(-n.recoil * f.facing), y: f.velocity.y }; }
      f.velocity = physics.customAir(f.slot, f.velocity, n.fallGravity, n.fallTerminal, n.friction);
      return;
    }
    case 'SpecialSStart': {
      // M347_Phys: ft_80084F3C, then self_vel.x = 0 through frame 1 (the friction step still lands).
      const next = physics.stationaryGround(f.slot, r.grVel), step = f32(next - r.grVel);
      r.grVel = next;
      f.velocity = { x: frame <= p.side.stillFrames ? step : next, y: 0 };
      return;
    }
    case 'SpecialAirSStart': {
      // M350_Phys: 8007D60C, ftCommon_Fall(0.02, 2.4), self_vel.x = 0 through frame 1.
      f.jumpsUsed = a.maxJumps;
      const v = physics.customAir(f.slot, f.velocity, p.side.airGravity, p.side.airTerminal, 0);
      f.velocity = { x: frame <= p.side.stillFrames ? 0 : v.x, y: v.y };
      return;
    }
    case 'SpecialS':
      // 348 has no Phys: the dash keeps the speed the charge released it at.
      if (f.grounded) f.velocity = { x: f.velocity.x, y: 0 };
      return;
    case 'SpecialAirS':
      // M351_Phys: self_vel.y = 0.
      f.velocity = { x: f.velocity.x, y: 0 };
      return;
    case 'SpecialAirSEnd': {
      // ftFx_SpecialAirSEnd_Phys: state_var1 delays the x48 fall, x40 air friction.
      const sd = p.side, delayed = r.gravityDelay !== 0;
      if (delayed) r.gravityDelay--;
      f.velocity = physics.customAir(f.slot, f.velocity, delayed ? 0 : sd.endGravity, delayed ? 1e6 : a.terminal, sd.endFriction);
      return;
    }
    case 'SpecialHiHold':
      f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      return;
    case 'SpecialHiHoldAir': {
      const delayed = r.gravityDelay !== 0;
      if (delayed) r.gravityDelay--;
      f.velocity = physics.customAir(f.slot, f.velocity, delayed ? 0 : p.up.holdGravity, delayed ? 1e6 : a.terminal, p.up.holdFriction);
      return;
    }
    case 'SpecialHi': {
      // ftFx_SpecialHi_Phys / _Coll: ground friction x78 after x70 frames; unk2 counts the frames
      // on the floor and rotateModel follows its normal.
      if (++r.physFrames >= p.up.decelAfter) r.grVel = groundFriction(r.grVel, p.up.decel);
      r.groundFrames++;
      const normal = floorNormal(world?.floor);
      r.angle = Math.atan2(-normal.x * f.facing, normal.y);
      f.velocity = { x: r.grVel, y: 0 };
      return;
    }
    case 'SpecialAirHi':
      // ftFx_SpecialAirHi_Phys: after x70 frames, x78 comes off along rotateModel.
      if (++r.physFrames >= p.up.decelAfter) {
        f.velocity = { x: f32(f.velocity.x - f.facing * p.up.decel * Math.cos(r.angle)), y: f32(f.velocity.y - p.up.decel * Math.sin(r.angle)) };
      }
      return;
    case 'SpecialHiLanding':
      // ftFx_SpecialHiLanding_Phys: x7C ground friction.
      f.velocity = { x: groundFriction(f.velocity.x, p.up.landingFriction), y: 0 };
      return;
    case 'SpecialHiFall':
      // ft_80084DB0: normal air control.
      f.velocity = physics.air(f.slot, f.velocity, input.x, f.fastFall);
      return;
    case 'SpecialHiBound': {
      // Script frame 4 (opcode 25 = 1, 8007D5D4) takes the bound airborne; in the air self_vel.y is
      // the figatree's translation and 8007CF58 slows x, on the ground ft_80084F3C.
      if (scriptEvents(f, r.flagFrame, (e) => e.type === 'flag' && e.flag === 101)) { setAirborne(f); f.jumpsUsed = 1; }
      r.flagFrame = f.animationFrame;
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = { x: airFrictionCapped(f, f.velocity.x), y: rootDelta(f).y };
      return;
    }
    case 'SpecialLwStart': case 'SpecialLwLoop': case 'SpecialLwHit':
      // M360_Phys: ApplyFrictionGround(0.02) on gr_vel with no ApplyGroundMovement, so self_vel
      // (the speed the reflector started with) carries the whole loop.
      r.grVel = groundFriction(r.grVel, p.down.groundFriction);
      f.velocity = { x: f.velocity.x, y: 0 };
      return;
    case 'SpecialLwEnd':
      // M363_Phys = ft_80084F3C: gr_vel (worn down by the loop) is the speed again.
      r.grVel = physics.stationaryGround(f.slot, r.grVel);
      f.velocity = { x: r.grVel, y: 0 };
      return;
    case 'SpecialAirLwStart': case 'SpecialAirLwLoop': case 'SpecialAirLwHit': case 'SpecialAirLwEnd': {
      // Fox's aerial reflector phys: xA4 frames without gravity, then xAC; ftCommon_8007CF58.
      const delayed = r.gravityDelay !== 0;
      if (delayed) r.gravityDelay--;
      const v = delayed ? f.velocity : physics.customAir(f.slot, f.velocity, p.down.gravity, a.terminal, 0);
      f.velocity = { x: airFrictionCapped(f, v.x), y: v.y };
      return;
    }
  }
}

/** ftCommon_8007D5D4 as M344_Phys/M342_Phys call it every frame: airborne, jumpsUsed = 1 (which
 * hands a spent double jump back). */
function airborneOneJump(f: MatchFighter): void {
  if (f.grounded) setAirborne(f);
  f.jumpsUsed = 1;
}

/** M344_Anim's End entries: throw_flags = flag0 = 0, 346, and the accessory4 shot callback. */
function enterShot(f: MatchFighter, r: MetalSonicRuntime, shot: 'strong' | 'weak'): void {
  enter(f, 'SpecialAirNEnd'); r.shot = shot; r.flagFrame = -1;
}
/** ptr_04ffc / ptr_053e8: on the script's opcode 24 (throw_flags b0, End frame 4) spawn item 0
 * from fp->parts[22] and kick self_vel = gr_vel = −0.5·facing (applied from the next Phys). */
function shotCallback(f: MatchFighter, r: MetalSonicRuntime, out: SpecialStep): void {
  const fired = scriptEvents(f, r.flagFrame, (e) => e.type === 'flag' && e.flag === 24);
  r.flagFrame = f.animationFrame;
  if (!fired) return;
  r.shotIntent = { player: f.slot, kind: 'metal-shot', variant: r.shot === 'weak' ? 1 : 0 };
  out.shots.push(r.shotIntent);
  r.recoil = true;
}

/** M348/M351 Anim and IASA: out of the dash into Fox's SpecialAirSEnd (352). From the ground the
 * (1.5·facing, −0.5) exit meets the floor at once, so 352's Coll lands it into LandingFallSpecial. */
function dashEnd(f: MatchFighter, p: MetalSonicSpecialData, r: MetalSonicRuntime, finish: Finish, ground: boolean): void {
  const sd = p.side;
  if (ground) {
    f.velocity = { x: f32(sd.groundEndX * f.facing), y: sd.groundEndY };
    enter(f, 'SpecialAirSEnd');
    if (f.grounded) {
      // 352's Phys runs once before its Coll lands it (friction x40, gravity still delayed).
      if (r.gravityDelay !== 0) r.gravityDelay--;
      const vx = Math.abs(f.velocity.x) <= sd.endFriction ? 0 : f32(f.velocity.x - Math.sign(f.velocity.x) * sd.endFriction);
      land(f, finish, sd.landing);
      f.velocity = { x: vx, y: 0 };
    }
    return;
  }
  f.velocity = { x: f32(sd.airEndX * f.facing), y: f.velocity.y };
  enter(f, 'SpecialAirSEnd');
}

/** ftFx_SpecialAirHi_Enter: aim by the stick past x64 (turning past x88), or straight up. */
function launchAir(f: MatchFighter, input: PlayerInput, p: MetalSonicSpecialData, r: MetalSonicRuntime): void {
  const u = p.up, x = input.x, y = input.y ?? 0;
  if (Math.abs(x) + Math.abs(y) >= u.stickMin) {
    if (Math.abs(x) > u.facingStick) f.facing = x >= 0 ? 1 : -1;
    r.angle = Math.atan2(y, x * f.facing);
  } else r.angle = Math.PI / 2;
  enter(f, 'SpecialAirHi');
  r.travel = u.travel; r.physFrames = 0; r.groundFrames = 0;
  f.velocity = { x: f32(f.facing * u.speed * Math.cos(r.angle)), y: f32(u.speed * Math.sin(r.angle)) };
  f.jumpsUsed = f.content.profile.attributes.maxJumps;
}
/** ftFx_SpecialAirHi_AirToGround: a stick past x64 that does not point above the floor travels
 * along it (unless the floor is a platform, which ftCo_8009A134 drops through); anything else
 * takes off (8007D60C + the aerial launch). */
function launchGround(f: MatchFighter, input: PlayerInput, p: MetalSonicSpecialData, r: MetalSonicRuntime, world?: SpecialWorld): void {
  const u = p.up, x = input.x, y = input.y ?? 0, normal = floorNormal(world?.floor);
  if (Math.abs(x) + Math.abs(y) >= u.stickMin && angleXY(normal, { x, y }) >= Math.PI / 2) {
    if (world?.floor?.oneWay) {
      if (f.floor !== null) { f.ignoreFloor = f.floor; f.ignoreTicks = 12; }
    } else {
      f.facing = x >= 0 ? 1 : -1;
      enter(f, 'SpecialHi');
      r.travel = u.travel; r.physFrames = 0; r.groundFrames = 0; r.grVel = f32(u.speed * f.facing);
      r.angle = Math.atan2(-normal.x * f.facing, normal.y);
      return;
    }
  }
  setAirborne(f);
  launchAir(f, input, p, r);
}
