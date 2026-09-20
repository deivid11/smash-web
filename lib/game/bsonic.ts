import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import { BSONIC_CODE, ITEM_STEP_RISE, LANDING_SPEED, type BSonicSpecialData } from './bsonic-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { beginSpecial, command, rootDelta, selectSpecial, type SpecialRuntime, type SpecialStep, type SpecialWorld } from './specials.ts';

/** Black Sonic's native motion states (PlSc `move_logic`, motions 343-369; the Air variants are
 * their own motions). The ftFunction code has no symbols, so each branch cites the callback it
 * ports (M<motion>_<Anim|IASA|Phys|Coll>, sub_/ptr_ offsets into the block). */
export type BSonicState =
  | 'NStart' | 'N' | 'NLanding' | 'NEnd' | 'NEndFall'
  | 'SStart' | 'AirSStart' | 'S' | 'AirS' | 'SCancel' | 'SEnd' | 'SEndFall'
  | 'Hi'
  | 'LwStart' | 'AirLwStart' | 'LwHold' | 'AirLwHold' | 'LwCancel' | 'AirLwCancel' | 'LwEnd' | 'LwLoop' | 'AirLwLoop';

/** MexTK `state_var` block of the current motion. */
export interface BSonicRuntime {
  state: BSonicState;
  /** NStart: entered through SpecialAirN (motion 344). Hi: SpecialAirHi (motion 348, state_var1 = 1). */
  air: boolean;
  /** Hi state_var2: the spring relaunch re-enters SpecialHi without spawning a spring. */
  springOut: boolean;
  /** Hi: flag1 has launched the rise (the code bumps it from 1 to 2). */
  launched: boolean;
  /** Hi: last animation frame whose throw-flag (script flag 24) events were consumed. */
  flagFrame: number;
  /** N: state_var6/7 homing point, state_var10 target (index into the fighters, −1 none),
   * state_var9 frames left. */
  target: [number, number]; targetSlot: number; homingLeft: number;
  /** S: state_var12, the dash began on the ground (its air version then ends in SpecialSEnd). */
  fromGround: boolean;
  /** S: flag2 (script frame 21) has been answered (the code bumps it to 2). */
  decided: boolean;
  /** Lw: ft_var52 charge level, state_var11 roll frames left, state_var12 the roll is turning. */
  level: number; rollLeft: number; turning: boolean;
  /** Collision bookkeeping the original reads from coll_data. */
  wasGrounded: boolean; lastVy: number; jumps: number;
}
/** Black Sonic's fighter vars: ft_var50/49/51 are the once-per-airtime neutral/side/up latches
 * (cleared by OnLanding, by damage/ledge/capture states and on respawn); ft_var43 marks his
 * grounded spring alive (a grounded SpecialHi clears it, and those springs vanish). */
export interface BSonicFighterVars { neutralUsed: boolean; sideUsed: boolean; upUsed: boolean; spring: boolean }
export const createBSonicVars = (): BSonicFighterVars => ({ neutralUsed: false, sideUsed: false, upUsed: false, spring: false });

const f32 = Math.fround;
const params = (f: MatchFighter): BSonicSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Sc') throw new Error('Missing Black Sonic parameters.'); return p;
};
const ANIMATION: Record<BSonicState, (r: BSonicRuntime) => string> = {
  NStart: (r) => r.air ? 'SpecialAirNStart' : 'SpecialNStart', N: () => 'SpecialN', NLanding: () => 'SpecialNLanding',
  NEnd: () => 'SpecialNEnd', NEndFall: () => 'SpecialNEndSpecialFall',
  SStart: () => 'SpecialSStart', AirSStart: () => 'SpecialAirSStart', S: () => 'SpecialS', AirS: () => 'SpecialAirS',
  SCancel: () => 'SpecialSCancel', SEnd: () => 'SpecialSEnd', SEndFall: () => 'SpecialSEndSpecialFall',
  Hi: (r) => r.air ? 'SpecialAirHi' : 'SpecialHi',
  LwStart: () => 'SpecialLwStart', AirLwStart: () => 'SpecialAirLwStart', LwHold: () => 'SpecialLwHold', AirLwHold: () => 'SpecialAirLwHold',
  LwCancel: () => 'SpecialLwCancel', AirLwCancel: () => 'SpecialAirLwCancel', LwEnd: () => 'SpecialLwEnd',
  LwLoop: () => 'SpecialLwLoop', AirLwLoop: () => 'SpecialAirLwLoop',
};
const PHASE: Record<BSonicState, SpecialRuntime['phase']> = {
  NStart: 'start', N: 'travel', NLanding: 'end', NEnd: 'end', NEndFall: 'end',
  SStart: 'start', AirSStart: 'start', S: 'travel', AirS: 'travel', SCancel: 'end', SEnd: 'end', SEndFall: 'end',
  Hi: 'travel',
  LwStart: 'start', AirLwStart: 'start', LwHold: 'loop', AirLwHold: 'loop', LwCancel: 'end', AirLwCancel: 'end', LwEnd: 'end', LwLoop: 'travel', AirLwLoop: 'travel',
};
const freshRuntime = (f: MatchFighter, state: BSonicState, air: boolean): BSonicRuntime => ({
  state, air, springOut: false, launched: false, flagFrame: 0, target: [0, 0], targetSlot: -1, homingLeft: 0,
  fromGround: false, decided: false, level: 0, rollLeft: 0, turning: false, wasGrounded: f.grounded, lastVy: f.velocity.y, jumps: f.jumpsUsed,
});

export function bsonicSpecialName(f: MatchFighter, direction: SpecialDirection, _phase: SpecialRuntime['phase']): string {
  const r = f.special?.bsonic;
  if (r) return ANIMATION[r.state](r);
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirNStart' : 'SpecialNStart';
  if (direction === 'side') return air ? 'SpecialAirSStart' : 'SpecialSStart';
  if (direction === 'up') return air ? 'SpecialAirHi' : 'SpecialHi';
  return air ? 'SpecialAirLwStart' : 'SpecialLwStart';
}
/** Fighter_ChangeMotionState. 'fresh' starts at frame 0 with new hitboxes; 'keepFrame' is the
 * air/ground swap (flags 0x0A: frame carried, hitboxes kept); 'keepHits' restarts the figatree
 * but keeps the live hitboxes (flags 0x08, Ft_MF_SkipHit). */
function enter(f: MatchFighter, state: BSonicState, mode: 'fresh' | 'keepFrame' | 'keepHits' = 'fresh'): void {
  const s = f.special!, r = s.bsonic!;
  r.state = state; s.phase = PHASE[state]; s.lastFrame = -1;
  f.animation = ANIMATION[state](r); f.attackName = f.animation;
  if (mode !== 'keepFrame') { f.animationFrame = 0; f.stateFrame = 0; r.flagFrame = 0; }
  if (mode === 'fresh') { f.attackSerial++; f.victims.clear(); }
  f.animationRate = 1; f.animationEpoch++;
}
const clipEnd = (f: MatchFighter) => Math.max(1, f.content.clips.get(f.animation)?.endFrame ?? 1);
/** ftAnim_IsFramesRemaining == 0. */
const animationDone = (f: MatchFighter) => f.animationFrame >= clipEnd(f);
/** SpecialN and both Spin Dash loops loop their figatrees (action flag 0x40000000). */
const wrap = (f: MatchFighter) => { const end = clipEnd(f); if (f.animationFrame >= end) f.animationFrame = f32(f.animationFrame % end); };
/** A raw co_attrs float the named attributes do not carry (x48 jump_h_max_velocity, x68 air mobility B). */
const attr = (f: MatchFighter, offset: number) => {
  const view = new DataView(new ArrayBuffer(4)); view.setUint32(0, f.content.profile.words[offset / 4]!); return view.getFloat32(0);
};
/** ftCommon_8007D5D4 (Fighter_SetAirborne). */
const setAirborne = (f: MatchFighter) => { f.grounded = false; f.floor = null; };
/** Air motions whose Coll ignores the floor slide along it (the collision only snaps them back
 * onto it) until they move upward again. */
const leaveIfRising = (f: MatchFighter) => { if (!f.grounded) return; if (f.velocity.y > 0) setAirborne(f); else f.velocity.y = 0; };
/** HSD pad 0x20000 (left stick down) of the held buttons. */
const stickDown = (input: PlayerInput) => input.down || (input.y ?? 0) < -0.5;
/** The step ended the special: let the engine's own state physics run this frame (the new
 * motion's Phys follows its Enter in the same frame). */
const handover = (out: SpecialStep): SpecialStep => ({ ...out, handled: false });

/** Which specials the latches allow (the exports return without changing motion otherwise). */
export function bsonicSpecialAllowed(f: MatchFighter, direction: SpecialDirection): boolean {
  const v = f.bsonic;
  return direction === 'neutral' ? !v.neutralUsed : direction === 'side' ? !v.sideUsed : direction === 'up' ? !v.upUsed : true;
}

export function beginBSonicSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, a = f.content.profile.attributes, air = !f.grounded, v = f.bsonic;
  if (direction === 'neutral') {
    // SpecialN / SpecialAirN: ft_var50 latch; the grounded one goes airborne (jumps_used = 1) first.
    s.bsonic = freshRuntime(f, 'NStart', air); v.neutralUsed = true;
    if (!air) { setAirborne(f); f.jumpsUsed = 1; s.bsonic.wasGrounded = false; }
    return;
  }
  if (direction === 'side') {
    // SpecialS: ft_var49; SpecialAirS also sets ft_var51 (no Spring Jump after it) and spends every jump.
    s.bsonic = freshRuntime(f, air ? 'AirSStart' : 'SStart', air); v.sideUsed = true;
    if (air) { v.upUsed = true; f.jumpsUsed = a.maxJumps; }
    return;
  }
  if (direction === 'up') {
    // SpecialHi / SpecialAirHi: ft_var51 + ft_var49, every jump spent; the grounded one also clears
    // ft_var43, so his grounded springs vanish before the new one spawns.
    s.bsonic = freshRuntime(f, 'Hi', air); v.upUsed = true; v.sideUsed = true; f.jumpsUsed = a.maxJumps;
    if (!air) v.spring = false;
    return;
  }
  // SpecialLw / SpecialAirLw: ft_var52 (the charge level) back to 0.
  s.bsonic = freshRuntime(f, air ? 'AirLwStart' : 'LwStart', air);
}

/** Script throw-flag writes (flag 24) of the current motion since the last consumed frame. */
function throwFlag(f: MatchFighter, r: BSonicRuntime): boolean {
  let fired = false;
  for (const e of f.content.timelines.get(f.animation)?.events ?? []) {
    if (e.frame > f.animationFrame) break;
    if (e.type === 'flag' && e.flag === 24 && e.frame > r.flagFrame) fired = true;
  }
  r.flagFrame = Math.max(r.flagFrame, Math.floor(f.animationFrame));
  return fired;
}

/** ptr_03178+0x1B0 (the target check): any other player's fighter (not a teammate) at its part-4
 * joint (ftParts_GetBoneIndex 4, HipN) in world space. The original only needs the entity to
 * exist; the port also skips KO'd fighters, whose engine position is not a real body. */
function targetPoint(f: MatchFighter, other: MatchFighter, world: SpecialWorld | undefined): [number, number] | null {
  if (!world || other === f || other.state === 'ko') return null;
  if (world.teams && world.teamOf(other) === world.teamOf(f)) return null;
  const joint = other.content.profile.boneMap[4];
  if (world.poses && joint !== undefined && joint !== 255) { const p = world.poses.point(other, joint, [0, 0, 0]); return [p[0], p[1]]; }
  return [other.x, other.y];
}
/** M343_Anim at the end of the start pose: SpecialN, then the nearest rival inside x29c8 of
 * fp->pos becomes the homing point; without one it sits 30 ahead and 15 below. The original
 * scans ports 0-3; the port scans every seat of its up-to-8-player match. */
function enterHoming(f: MatchFighter, world: SpecialWorld | undefined): void {
  const r = f.special!.bsonic!, n = BSONIC_CODE.neutral;
  enter(f, 'N');
  r.target = [f32(f.x + f.facing * n.missAhead), f32(f.y - n.missBelow)]; r.targetSlot = -1; r.homingLeft = n.homingFrames;
  let best: number = n.searchRadius;
  (world?.fighters ?? []).forEach((other, index) => {
    const point = targetPoint(f, other, world); if (!point) return;
    const d = f32(Math.hypot(point[0] - f.x, point[1] - f.y));
    if (best > d) { best = d; r.target = point; r.targetSlot = index; }
  });
}
/** M364_Phys: re-acquire a locked rival while it stays within x29c8, then fly at x29a0 toward
 * the point. (With the rival gone the original reads an unset stack vector; the port keeps the
 * last point.) */
function homingPhys(f: MatchFighter, world: SpecialWorld | undefined): void {
  const r = f.special!.bsonic!, n = BSONIC_CODE.neutral;
  const other = r.targetSlot >= 0 ? world?.fighters[r.targetSlot] : undefined;
  const point = other ? targetPoint(f, other, world) : null;
  if (point && Math.hypot(point[0] - f.x, point[1] - f.y) < n.searchRadius) r.target = point;
  const dx = r.target[0] - f.x, dy = r.target[1] - f.y, length = Math.hypot(dx, dy);
  f.velocity = length > 0 ? { x: f32(dx / length * n.homingSpeed), y: f32(dy / length * n.homingSpeed) } : { x: 0, y: 0 };
  leaveIfRising(f);
}
/** ptr_03a14 (SpecialN's deal_dmg_cb): face the homing point and bounce off it into SpecialNEnd. */
export function bsonicHitLanded(f: MatchFighter): void {
  const r = f.special?.bsonic;
  if (f.content.profile.kind !== 'Sc' || r?.state !== 'N') return;
  const n = BSONIC_CODE.neutral;
  f.facing = r.target[0] > f.x ? 1 : -1;
  enter(f, 'NEnd');
  f.velocity = { x: f32(Math.cos(n.bounceAngle) * -n.bounceSpeed * f.facing), y: f32(Math.sin(n.bounceAngle) * n.bounceSpeed) };
  leaveIfRising(f);
}

/** ft_80084F3C / ft_80084FA8 (no root motion): standing friction. */
const groundStill = (f: MatchFighter, physics: MeleePhysics) => { f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; };
/** ft_80084EEC (ftCommon_Fall + ftCommon_ApplyFrictionAir). */
const airStill = (f: MatchFighter, physics: MeleePhysics) => {
  const a = f.content.profile.attributes; f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
};
/** M363_Phys (SpecialSEnd, SpecialSEndSpecialFall): ft_80084EEC, then x3640 of the speed kept. */
const sideEndPhys = (f: MatchFighter, physics: MeleePhysics) => { airStill(f, physics); f.velocity.x = f32(f.velocity.x * BSONIC_CODE.side.endDecay); };
/** M368_Phys: ft_80084EEC; past jump_h_max_velocity (only ever tested on the positive side)
 * the air cancel keeps x3648 of its speed. */
const airCancelPhys = (f: MatchFighter, physics: MeleePhysics) => {
  airStill(f, physics); if (f.velocity.x > attr(f, 0x48)) f.velocity.x = f32(f.velocity.x * BSONIC_CODE.down.cancelDecay);
};
/** M358_Phys: the roll approaches (level·xC + x8)·facing by x29b4 a frame, and by x29b0 while
 * turning; reaching it ends the turn with the roll sound. */
function rollPhys(f: MatchFighter, p: BSonicSpecialData, out: SpecialStep): void {
  const r = f.special!.bsonic!, d = BSONIC_CODE.down, facing = f.facing;
  const target = f32(f32(f32(r.level) * p.down.rollSpeedPerLevel + p.down.rollSpeed) * facing);
  let v = f.velocity.x;
  if (!r.turning) {
    if (facing > 0 && target > v) { const next = f32(v + d.rollAccel); v = target > next ? next : target; }
    else if (facing < 0 && v > target) { const next = f32(v - d.rollAccel); v = target < next ? next : target; }
    else v = target;
  } else if (facing > 0 && v < target) { const next = f32(v + d.turnAccel); v = target <= next ? target : next; }
  else if (facing < 0 && v > target) { const next = f32(v - d.turnAccel); v = target >= next ? target : next; }
  else { v = target; r.turning = false; out.sounds.push(BSONIC_CODE.sounds.roll); }
  f.velocity = { x: v, y: 0 };
}
/** M347_Phys: drift with ftCommon_8007D344 (threshold 0, air mobility B, air_drift_max) the whole
 * flight; flag1 = 1 (script frame 4) sets Sonic airborne at (0, x29ac), after which he falls. */
function hiPhys(f: MatchFighter, input: PlayerInput, physics: MeleePhysics): void {
  const r = f.special!.bsonic!, a = f.content.profile.attributes;
  if (!r.launched && command(f, 1) === 1) {
    // Fighter_SetAirborne also writes jumps_used = 1, but the IASA and the Anim both spend every
    // jump again before any jump could act, so the port keeps them spent throughout.
    r.launched = true; setAirborne(f); f.velocity = { x: 0, y: BSONIC_CODE.up.rise };
  } else if (r.launched) f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
  f.velocity = physics.controlledDrift(f.slot, f.velocity, input.x, attr(f, 0x68), a.airDriftMax);
  if (f.grounded) f.velocity.y = 0;
}
/** M354_Anim's release: SpecialLwLoop at (level·xC + x8)·facing for x3c frames, with the roll sound. */
function release(f: MatchFighter, p: BSonicSpecialData, out: SpecialStep): void {
  const r = f.special!.bsonic!;
  enter(f, 'LwLoop'); r.turning = false; r.rollLeft = BSONIC_CODE.down.rollFrames;
  out.sounds.push(BSONIC_CODE.sounds.roll);
  f.velocity = { x: f32(f32(f32(r.level) * p.down.rollSpeedPerLevel + p.down.rollSpeed) * f.facing), y: 0 };
}
/** M361_Anim / M355_Anim: ChangeMotionState(Run) with gr_vel = self_vel.x. */
function toRun(f: MatchFighter, finish: () => void): void {
  const speed = f.velocity.x; finish();
  f.state = 'run'; f.animation = 'Run'; f.animationFrame = 0; f.stateFrame = 0; f.animationEpoch++; f.velocity = { x: speed, y: 0 };
}

export function stepBSonicSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics,
  finish: (helpless?: boolean, lag?: number, mobility?: number) => void, world?: SpecialWorld): SpecialStep {
  const p = params(f), s = f.special!, r = s.bsonic!;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  if (s.age === 0) enter(f, r.state);
  else if (r.wasGrounded && !f.grounded && walkedOff(f, r, finish)) { s.age++; return handover(out); }
  s.age++;
  if (!input.special) s.released = true;
  const result = run(f, input, pressed, physics, finish, world, p, out);
  if (f.special?.bsonic === r) { r.wasGrounded = f.grounded; r.lastVy = f.velocity.y; r.jumps = f.jumpsUsed; }
  return result;
}

function run(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics,
  finish: (helpless?: boolean, lag?: number, mobility?: number) => void, world: SpecialWorld | undefined, p: BSonicSpecialData, out: SpecialStep): SpecialStep {
  const s = f.special!, r = s.bsonic!, a = f.content.profile.attributes, n = BSONIC_CODE.neutral, d = BSONIC_CODE.down;
  switch (r.state) {
    // ---------------- Homing attack ----------------
    case 'NStart': {
      // M343_Anim: the start pose played out → SpecialN and the target search, then its Phys.
      if (animationDone(f)) { enterHoming(f, world); homingPhys(f, world); return out; }
      // M343_Phys (ft_80085134): self_vel is the figatree's own translation.
      const delta = rootDelta(f);
      f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
      leaveIfRising(f);
      return out;
    }
    case 'N': {
      wrap(f);
      // M364_Anim: within x29bc of the point, or out of frames, the dash ends into special fall.
      const dist = Math.hypot(r.target[0] - f.x, r.target[1] - f.y);
      if (dist < n.arriveDistance || --r.homingLeft <= 0) {
        f.velocity = { x: 0, y: 0 }; enter(f, 'NEndFall');
        if (f.grounded) return landNow(f, finish, out);
        airStill(f, physics); return out;
      }
      // M364_IASA only installs ptr_03a14 as deal_dmg_cb (bsonicHitLanded).
      homingPhys(f, world);
      return out;
    }
    case 'NLanding':
      // ftCo_LandingAir_*: Wait once the landing plays out; ft_80084F3C.
      if (animationDone(f)) { finish(); return handover(out); }
      groundStill(f, physics); return out;
    case 'NEnd':
      // M366_Anim → Fall (not helpless); M366_Phys ft_80084EEC.
      if (f.grounded) return landNow(f, finish, out);
      if (animationDone(f)) { finish(); return handover(out); }
      airStill(f, physics); return out;
    case 'NEndFall':
      // M367_Anim: special fall (mobility x2994, landing x29a8), every jump spent; M367_Phys ft_80084EEC.
      if (f.grounded) return landNow(f, finish, out);
      if (animationDone(f)) { finish(true, BSONIC_CODE.specialLanding, BSONIC_CODE.specialFallMobility); return handover(out); }
      airStill(f, physics); return out;
    // ---------------- Side dash ----------------
    case 'SStart':
      // M345_Anim → SpecialS (state_var12 = 1); M345_Phys ft_80084F3C.
      if (animationDone(f)) {
        enter(f, 'S'); r.fromGround = true; r.decided = false;
        f.velocity = { x: f32(f.facing * BSONIC_CODE.side.dashSpeed), y: 0 }; return out;
      }
      groundStill(f, physics); return out;
    case 'AirSStart':
      // M346_Anim → SpecialAirS (state_var12 = 0); M346_Phys holds him in place.
      if (animationDone(f)) {
        enter(f, 'AirS'); r.fromGround = false;
        f.velocity = { x: f32(f.facing * BSONIC_CODE.side.dashSpeed), y: 0 }; return out;
      }
      f.velocity = { x: 0, y: 0 }; return out;
    case 'S':
      // M361_Anim: at flag2 (script frame 21) only the stick held forward past x3630 carries on;
      // otherwise SpecialSCancel brakes from the dash speed (gr_vel = self_vel.x).
      if (!r.decided && command(f, 2) === 1) {
        if (input.x * f.facing > BSONIC_CODE.side.holdStick) r.decided = true;
        else { enter(f, 'SCancel'); f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 }; return out; }
      }
      // …and a finished dash runs on (Run, gr_vel = self_vel.x).
      if (animationDone(f)) { toRun(f, finish); return handover(out); }
      // M361_Phys.
      f.velocity = { x: f32(f.facing * BSONIC_CODE.side.dashSpeed), y: 0 }; return out;
    case 'AirS':
      // M360_Anim: a grounded start ends in SpecialSEnd, an aerial one in SpecialSEndSpecialFall.
      if (animationDone(f)) {
        enter(f, r.fromGround ? 'SEnd' : 'SEndFall');
        if (f.grounded) return landNow(f, finish, out);
        sideEndPhys(f, physics); return out;
      }
      // M360_Phys: level flight, only self_vel.x is written.
      f.velocity = { x: f32(f.facing * BSONIC_CODE.side.dashSpeed), y: f.grounded ? 0 : f.velocity.y }; return out;
    case 'SCancel':
      // M362_Anim → Wait (M362_IASA opens ftCo_RunBrake_IASA from flag1: bsonicInterruptible).
      // ftCo_RunBrake_Phys: ground friction · run_dash_turn_friction_multiplier (PlCo x60 = 1).
      if (animationDone(f)) { finish(); return handover(out); }
      f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 }; return out;
    case 'SEnd':
    case 'SEndFall':
      // M369_Anim → Fall; M363_Anim → special fall (x2994, x29a8).
      if (f.grounded) return landNow(f, finish, out);
      if (animationDone(f)) {
        if (r.state === 'SEnd') finish(); else finish(true, BSONIC_CODE.specialLanding, BSONIC_CODE.specialFallMobility);
        return handover(out);
      }
      sideEndPhys(f, physics); return out;
    // ---------------- Spring jump ----------------
    case 'Hi': {
      const u = BSONIC_CODE.up;
      // M347_Anim: before frame x29d4 the stick past ±x3630 against the facing turns him.
      if (f.animationFrame < u.turnFrames && input.x * f.facing < -u.turnStick) f.facing = input.x >= 0 ? 1 : -1;
      // …the script's throw flag (frame 4) spawns the spring where he stands (ptr_03678+8, state
      // state_var1) and marks it alive (ft_var43), unless state_var2 says one is already out.
      if (throwFlag(f, r) && !r.springOut) {
        out.shots.push({ player: f.slot, kind: 'bsonic-spring', at: [f.x, f.y], variant: r.air ? 1 : 0 });
        f.bsonic.spring = true;
      }
      // …and the played-out flight falls (not helpless) with every jump spent.
      if (animationDone(f)) { finish(); f.jumpsUsed = a.maxJumps; return handover(out); }
      // M347_IASA from flag2 (frame 24): B runs the special the latches allow (A and the C-stick
      // go through bsonicInterruptible's 'aerial' window).
      if (command(f, 2) === 1 && pressed) {
        const direction = selectSpecial(input);
        if (bsonicSpecialAllowed(f, direction)) {
          finish(); f.jumpsUsed = a.maxJumps; beginSpecial(f, direction, input);
          return f.special?.bsonic ? stepBSonicSpecial(f, input, false, physics, finish, world) : handover(out);
        }
      }
      hiPhys(f, input, physics);
      return out;
    }
    // ---------------- Spin dash ----------------
    case 'LwStart':
      // M349_Anim → SpecialLwHold with the charge sound; ftCo_AttackS4_Phys (ft_80084FA8).
      if (animationDone(f)) { enter(f, 'LwHold'); out.sounds.push(BSONIC_CODE.sounds.charge); }
      groundStill(f, physics); return out;
    case 'AirLwStart':
      // M350_Anim → SpecialAirLwHold with the charge sound; M350_Phys ft_80084EEC.
      if (animationDone(f)) { enter(f, 'AirLwHold'); out.sounds.push(BSONIC_CODE.sounds.charge); }
      airStill(f, physics); return out;
    case 'LwHold':
      // M354_Anim: B after the script's flag1 (frame 8) replays the hold one level up (cap x4)…
      if (command(f, 1) !== 0 && pressed) {
        if (r.level < p.down.maxLevel) r.level++;
        enter(f, 'LwHold'); out.sounds.push(BSONIC_CODE.sounds.charge);
      }
      // …letting go of down rolls; held through the whole hold it gives up (SpecialLwEnd).
      if (!stickDown(input)) { release(f, p, out); rollPhys(f, p, out); return out; }
      if (animationDone(f)) enter(f, 'LwEnd');
      groundStill(f, physics); return out;
    case 'AirLwHold':
      // M356_Anim reads no input: the hold plays out into Fall (landing turns it into the ground
      // hold, sub_038f8). M350_Phys.
      if (animationDone(f)) { finish(); return handover(out); }
      airStill(f, physics); return out;
    case 'LwEnd':
      // M357_Anim → Wait; ftCo_AttackS4_Phys.
      if (animationDone(f)) { finish(); return handover(out); }
      groundStill(f, physics); return out;
    case 'LwLoop': {
      wrap(f);
      // M358_Anim: the stick past ±x3658 against the facing turns the roll around (flags 8)…
      if (!r.turning && input.x * f.facing < -d.turnStick) { f.facing = input.x >= 0 ? 1 : -1; enter(f, 'LwLoop', 'keepHits'); r.turning = true; }
      // …held shield, a B press (not while turning) or the end of state_var11 cancels.
      let cancel = !!input.shield || !!input.grab || (pressed && !r.turning);
      if (--r.rollLeft <= 0) cancel = true;
      if (cancel) { enter(f, 'LwCancel'); f.velocity = { x: f.velocity.x, y: 0 }; return out; }
      // M358_IASA: a jump takes the roll airborne (ECB-locked, jumps_used = 1, self_vel.y = x29bc).
      if (world?.jumpPressed) {
        setAirborne(f); f.jumpsUsed = 1; enter(f, 'AirLwLoop', 'keepHits'); r.turning = false;
        f.velocity = physics.air(f.slot, { x: f.velocity.x, y: d.jumpRise }, input.x, false); return out;
      }
      rollPhys(f, p, out); return out;
    }
    case 'LwCancel':
      // M355_Anim → Run carrying the roll (gr_vel = self_vel); no Phys, so the slide keeps its speed.
      if (animationDone(f)) { toRun(f, finish); return handover(out); }
      f.velocity = { x: f.velocity.x, y: 0 }; return out;
    case 'AirLwLoop': {
      wrap(f);
      // M359_Anim: a shield or B press cancels (SpecialAirLwCancel), as does the end of state_var11.
      let cancel = !!world?.shieldPressed || pressed;
      if (!cancel && --r.rollLeft <= 0) cancel = true;
      if (cancel) { enter(f, 'AirLwCancel'); airCancelPhys(f, physics); return out; }
      // M359_IASA (X/Y air jump, A / C-stick aerials) runs through bsonicInterruptible.
      // M359_Phys: ftCommon_Fall + ftCommon_8007D268 (the normal air drift).
      f.velocity = physics.air(f.slot, f.velocity, input.x, false); return out;
    }
    case 'AirLwCancel':
      // M368_Anim → Fall; M368_Phys.
      if (f.grounded) return landNow(f, finish, out);
      if (animationDone(f)) { finish(); return handover(out); }
      airCancelPhys(f, physics); return out;
  }
}

/** Grounded motions' Coll when the floor runs out (the port learns it one step later). Returns
 * true when the special ended. */
function walkedOff(f: MatchFighter, r: BSonicRuntime, finish: () => void): boolean {
  switch (r.state) {
    case 'SStart': case 'S':
      // sub_0350c: airborne, SpecialAirSStart / SpecialAirS at the same frame (flags 0x0A), ft_var49.
      f.jumpsUsed = Math.max(f.jumpsUsed, 1); f.bsonic.sideUsed = true;
      enter(f, r.state === 'SStart' ? 'AirSStart' : 'AirS', 'keepFrame'); f.velocity.y = 0;
      return false;
    case 'LwLoop':
      // sub_0381c: only a roll still at |self_vel.x| ≥ x29dc goes on in the air (flags 8).
      f.jumpsUsed = 1;
      if (Math.abs(f.velocity.x) >= BSONIC_CODE.down.airborneSpeed) { enter(f, 'AirLwLoop', 'keepHits'); r.turning = false; f.velocity.y = 0; return false; }
      finish(); return true;
    case 'LwStart': case 'LwHold': case 'LwCancel': case 'LwEnd': case 'NLanding': case 'SCancel':
      // sub_0381c / ft_80084104 / ft_80084280: Fall.
      f.jumpsUsed = Math.max(f.jumpsUsed, 1); finish(); return true;
    default:
      // Air motions only brushed the floor (their Coll ignores it): nothing to do.
      return false;
  }
}

/** ft_80082B1C: a fast touchdown plays the normal Landing, a slow one goes straight to Wait. */
function normalLanding(f: MatchFighter, vy: number, finish: () => void): void {
  finish();
  if (vy > -LANDING_SPEED) return;
  f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
  f.landingFrames = Math.max(1, Math.ceil(f.content.profile.attributes.landingLag));
}
/** ftCo_LandingFallSpecial_Enter at x29a8. */
function specialLanding(f: MatchFighter, finish: () => void): void {
  finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
  f.landingFrames = BSONIC_CODE.specialLanding;
}
/** A motion entered while its fighter already stands on the floor lands on the spot. */
function landNow(f: MatchFighter, finish: () => void, out: SpecialStep): SpecialStep {
  landBSonicSpecial(f, finish);
  return f.special ? out : handover(out);
}

/** The *_Coll landings. The engine has already grounded the fighter and zeroed its fall. */
export function landBSonicSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, r = s.bsonic!;
  const ignore = () => { f.jumpsUsed = r.jumps; };
  switch (r.state) {
    case 'NStart': case 'AirSStart': case 'AirS':
      // M343_Coll discards ft_80081D0C's result; M346_Coll returns early for 0x15A/0x168.
      ignore(); return true;
    case 'N':
      // M364_Coll: only after frame x29c4 does the dash land (SpecialNLanding, still GA_Air, so
      // its ground speed is the zeroed gr_vel).
      if (f.animationFrame > BSONIC_CODE.neutral.landAfter) { enter(f, 'NLanding'); f.velocity = { x: 0, y: 0 }; return true; }
      ignore(); return true;
    case 'NEnd': case 'SEnd': case 'SEndFall':
      // M366_Coll / M346_Coll: special landing at x29a8.
      specialLanding(f, finish); return true;
    case 'NEndFall': case 'Hi': case 'AirLwCancel':
      // M367_Coll (ft_800831CC → ft_80082B1C), M347_Coll, M368_Coll.
      normalLanding(f, r.lastVy, finish); return true;
    case 'AirLwStart': case 'AirLwHold': {
      // sub_038f8: grounded, the stick past ±x3658 sets the facing, the ground motion keeps the frame.
      const stick = f.previous.x;
      if (Math.abs(stick) > BSONIC_CODE.down.landStick) f.facing = stick >= 0 ? 1 : -1;
      enter(f, r.state === 'AirLwStart' ? 'LwStart' : 'LwHold', 'keepFrame'); f.velocity.y = 0; return true;
    }
    case 'AirLwLoop':
      // sub_038f8: the air roll lands into SpecialLwLoop (flags 8, frame 0), state_var11 kept.
      enter(f, 'LwLoop', 'keepHits'); r.turning = false; f.velocity.y = 0; return true;
    default:
      return true;
  }
}

/** OnLanding (export 34): the latches clear on any landing except in motion 0x15B (the grounded
 * or relaunched SpecialHi). Collisions that ignore the floor never land. */
export function bsonicOnLanding(f: MatchFighter): void {
  if (f.content.profile.kind !== 'Sc') return;
  const r = f.special?.bsonic;
  if (r && (r.state === 'NStart' || r.state === 'AirSStart' || r.state === 'AirS' || (r.state === 'N' && f.animationFrame <= BSONIC_CODE.neutral.landAfter))) return;
  if (r?.state === 'Hi' && !r.air) return;
  f.bsonic.neutralUsed = false; f.bsonic.sideUsed = false; f.bsonic.upUsed = false;
}
/** OnActionStateChange: entering a damage (0x4B-0x59), CliffCatch (0xFC) or capture state
 * (0xDF-0xE8, 0x113-0x124) clears the latches; ResetAttributes does the same on respawn. */
export function bsonicStateChange(f: MatchFighter, state: string): void {
  if (f.content.profile.kind !== 'Sc' || (state !== 'hitstun' && state !== 'ledge' && state !== 'captured' && state !== 'ko')) return;
  f.bsonic.neutralUsed = false; f.bsonic.sideUsed = false; f.bsonic.upUsed = false;
}
/** ptr_02f08 (Fall/FallAerial IASA): after a Spring Jump or air dash (ft_var51) the fall only
 * acts on A, B or the C-stick — no air dodge, no jump on their own. */
export function bsonicFallLocked(f: MatchFighter, acting: boolean): boolean {
  return f.content.profile.kind === 'Sc' && f.state === 'fall' && f.bsonic.upUsed && !acting;
}
/** The native IASA windows: SpecialHi from flag2 and the air roll take aerials (and the air
 * roll an air jump); SpecialSCancel from flag1 is ftCo_RunBrake_IASA. */
export function bsonicInterruptible(f: MatchFighter): 'full' | 'aerial' | 'aerial-jump' | null {
  const r = f.special?.bsonic; if (!r) return null;
  if (r.state === 'Hi') return command(f, 2) === 1 ? 'aerial' : null;
  if (r.state === 'SCancel') return command(f, 1) === 1 ? 'full' : null;
  if (r.state === 'AirLwLoop') return f.jumpsUsed < f.content.profile.attributes.maxJumps ? 'aerial-jump' : 'aerial';
  return null;
}
/** Only SpecialNEndSpecialFall's Coll (ft_800831CC) catches ledges; every other aerial state
 * collides through ft_80081D0C, which never does. */
export function bsonicCatchesLedge(f: MatchFighter): boolean {
  return f.special?.bsonic?.state === 'NEndFall';
}
/** Grounded Coll callbacks on ft_800827A0 / ft_80084280 stop at the ledge. */
export function bsonicStopsAtLedge(f: MatchFighter): boolean {
  const r = f.special?.bsonic; if (!r) return false;
  if (r.state === 'NLanding' || r.state === 'SCancel') return true;
  return r.turning && (r.state === 'LwStart' || r.state === 'LwHold' || r.state === 'LwCancel' || r.state === 'LwLoop');
}
/** ftColl_8007ABD0 on hitbox 0: the ground roll hits for x10 + level·x14 (M358_Anim), the air
 * roll 6/8/9/11 at levels 1-4 and the script's own damage otherwise (M359_Anim). */
export function bsonicHitDamage(f: MatchFighter): number | null {
  const r = f.special?.bsonic; if (!r) return null;
  if (r.state === 'LwLoop') { const p = params(f); return p.down.damage + r.level * p.down.damagePerLevel; }
  if (r.state === 'AirLwLoop') return BSONIC_CODE.down.airDamage[r.level] ?? null;
  return null;
}

/** ptr_03bf4 for a Black Sonic landing on any Black Sonic spring. The air Spin Dash bounces into
 * a fresh SpecialAirLwLoop (self_vel.y += x29c4, 60 frames, spring sound); anything else
 * relaunches SpecialHi (motion 0x15B) with ft_var51/49 set, every jump spent and no new spring.
 * Returns the sound it plays. The relaunch's rise starts at the item-step blend's x6D0. */
export function bsonicSpringTouch(f: MatchFighter): number | null {
  const r = f.special?.bsonic, a = f.content.profile.attributes;
  if (r && (r.state === 'AirLwHold' || r.state === 'AirLwLoop')) {
    enter(f, 'AirLwLoop'); r.turning = false; r.rollLeft = BSONIC_CODE.down.rollFrames;
    f.velocity = { x: f.velocity.x, y: f32(f.velocity.y + BSONIC_CODE.spring.rollBounce) };
    return BSONIC_CODE.sounds.spring;
  }
  // The item runs after the fighter's own frame: the relaunch is already one step old.
  f.special = { direction: 'up', phase: 'travel', age: 1, delay: 0, releaseLag: 0, released: true, queued: false, startedAir: true,
    aim: Math.PI / 2, driftLimit: 0, lastFrame: -1, serial: ++f.specialSerial };
  f.special.bsonic = { ...freshRuntime(f, 'Hi', false), springOut: true, wasGrounded: false };
  f.state = 'special'; f.smash = null; f.jab = null; f.fastFall = false;
  f.bsonic.upUsed = true; f.bsonic.sideUsed = true; f.jumpsUsed = a.maxJumps;
  enter(f, 'Hi');
  f.velocity = { x: f.velocity.x, y: ITEM_STEP_RISE };
  return null;
}
