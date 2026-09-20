import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import { SD_CODE } from './sd-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep, SpecialWorld } from './specials.ts';

/** Skull Kid's native motion states (PlSd `move_logic`, motions 348-376). The ftFunction block has
 * no symbols, so each branch cites the callback it ports (M<motion>_<Anim|IASA|Phys|Coll>,
 * sub_/fn_/ptr_ offsets into the block; see sd-data.ts for the literals). Motions 350/351/354/355
 * (the NEnd pair and second NHold slots) and 365-371/373-376 (the Lw hold/hit/end chain) are never
 * entered by any callback, so they are not modelled. */
export type SkullKidState =
  | 'NStart' | 'AirNStart' | 'NHold' | 'AirNHold'
  | 'S' | 'AirS' | 'HiStart' | 'AirHiStart' | 'SideWarp' | 'UpWarp' | 'HiEnd' | 'AirHiEnd'
  | 'LwStart' | 'AirLwStart';
export interface SkullKidRuntime {
  state: SkullKidState;
  /** Last animation frame whose throw-flag (script flag 24) events were consumed. */
  flagFrame: number;
  /** ft_var48 / ft_var49: intangible teleport frames left. */
  warp: number;
  wasGrounded: boolean;
}
/** Skull Kid's fighter vars (rollback-safe numbers only). */
export interface SkullKidFighterVars {
  /** ft_var51: bombs ready (OnLoad 1). */
  ammo: number;
  /** ft_var45: cooldown frames counted while no bomb is out and the ammo is spent. */
  cooldown: number;
  /** ft_var52: the live bomb (projectile id) and a mirror of its item state (0-6). */
  bomb: number | null; bombState: number;
  /** A detonation requested by the fighter (item state 6 on the bomb's next step). */
  detonate: boolean;
  /** ft_var39: the float was used this airtime. */
  floatUsed: boolean;
  /** ft_var50: aerial side/down specials since landing (their gravity grows with it). */
  airUses: number;
  /** Motion 361 (the float): flag1 frames left, flag2 frames elapsed, flag3 entry mode. */
  float: { timer: number; frames: number; mode: number } | null;
}
export const createSkullKidVars = (): SkullKidFighterVars => ({
  ammo: SD_CODE.neutral.ammo, cooldown: 0, bomb: null, bombState: 0, detonate: false, floatUsed: false, airUses: 0, float: null,
});

const f32 = Math.fround;
const ANIMATION: Record<SkullKidState, string> = {
  NStart: 'SpecialNStart', AirNStart: 'SpecialAirNStart', NHold: 'SpecialNHold', AirNHold: 'SpecialAirNHold',
  S: 'SpecialS', AirS: 'SpecialAirS', HiStart: 'SpecialHiStart', AirHiStart: 'SpecialAirHiStart',
  SideWarp: 'SpecialHiHold', UpWarp: 'SpecialAirHiHold', HiEnd: 'SpecialHiEnd', AirHiEnd: 'SpecialAirHiEnd',
  LwStart: 'SpecialLwStart', AirLwStart: 'SpecialAirLwStart',
};
const PHASE: Record<SkullKidState, SpecialRuntime['phase']> = {
  NStart: 'start', AirNStart: 'start', NHold: 'loop', AirNHold: 'loop', S: 'start', AirS: 'start',
  HiStart: 'start', AirHiStart: 'start', SideWarp: 'travel', UpWarp: 'travel', HiEnd: 'end', AirHiEnd: 'end',
  LwStart: 'start', AirLwStart: 'start',
};
/** Ground ↔ air twins the Coll callbacks swap between (keeping the animation frame). */
const AIR_TWIN: Partial<Record<SkullKidState, SkullKidState>> = { NStart: 'AirNStart', NHold: 'AirNHold', S: 'AirS', HiStart: 'AirHiStart', LwStart: 'AirLwStart' };
const GROUND_TWIN: Partial<Record<SkullKidState, SkullKidState>> = { AirNStart: 'NStart', AirNHold: 'NHold', AirS: 'S', AirHiStart: 'HiStart', AirLwStart: 'LwStart' };

const clipEnd = (f: MatchFighter) => Math.max(1, f.content.clips.get(f.animation)?.endFrame ?? 1);
/** ftAnim_IsFramesRemaining == 0. */
const animationDone = (f: MatchFighter) => f.animationFrame >= clipEnd(f);
/** A raw co_attrs float the named attributes do not carry (x68 air drift base, x74 fast fall). */
const attr = (f: MatchFighter, offset: number) => {
  const view = new DataView(new ArrayBuffer(4)); view.setUint32(0, f.content.profile.words[offset / 4]!); return view.getFloat32(0);
};
const setAirborne = (f: MatchFighter) => { f.grounded = false; f.floor = null; };
/** The step ended the special: the new motion's Phys runs through the engine this frame. */
const handover = (out: SpecialStep): SpecialStep => ({ ...out, handled: false });
const bombLive = (v: SkullKidFighterVars) => v.bomb !== null && v.bombState >= 2 && v.bombState <= 5;

export function skullkidSpecialName(f: MatchFighter, direction: SpecialDirection, _phase: SpecialRuntime['phase']): string {
  const r = f.special?.skullkid;
  if (r) return ANIMATION[r.state];
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirNStart' : 'SpecialNStart';
  if (direction === 'side') return air ? 'SpecialAirS' : 'SpecialS';
  if (direction === 'up') return air ? 'SpecialAirHiStart' : 'SpecialHiStart';
  return air ? 'SpecialAirLwStart' : 'SpecialLwStart';
}
/** Fighter_ChangeMotionState. 'fresh' starts at frame 0 with new hitboxes; 'keepFrame' is the
 * Coll air/ground swap (flags 0x5000 / the motion frame carried). */
function enter(f: MatchFighter, state: SkullKidState, mode: 'fresh' | 'keepFrame' = 'fresh'): void {
  const s = f.special!, r = s.skullkid!;
  r.state = state; s.phase = PHASE[state]; s.lastFrame = -1;
  f.state = 'special'; f.animation = ANIMATION[state]; f.attackName = f.animation;
  if (mode === 'fresh') { f.animationFrame = 0; f.stateFrame = 0; r.flagFrame = 0; f.attackSerial++; f.victims.clear(); }
  f.animationRate = 1; f.animationEpoch++;
}

/** SpecialN / SpecialAirN: a bomb sitting in item states 2-5 goes to the hold (its script
 * detonates it); otherwise a ready bomb starts the pull. With neither the export only resets
 * the facing, so the special never starts. */
export function skullkidSpecialAllowed(f: MatchFighter, direction: SpecialDirection): boolean {
  if (direction !== 'neutral') return true;
  const v = f.skullkid;
  return v.bomb !== null ? bombLive(v) : v.ammo > 0;
}
export function beginSkullKidSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, air = !f.grounded, v = f.skullkid;
  const start = (state: SkullKidState) => { s.skullkid = { state, flagFrame: 0, warp: 0, wasGrounded: f.grounded }; s.phase = PHASE[state]; };
  v.float = null;
  if (direction === 'neutral') {
    if (bombLive(v)) {
      // SpecialAirN: the hold entry keeps x2FD0 of the fall speed.
      if (air) f.velocity.y = f32(f.velocity.y * SD_CODE.neutral.airHoldVy);
      start(air ? 'AirNHold' : 'NHold');
    } else start(air ? 'AirNStart' : 'NStart');
  } else if (direction === 'side') {
    // SpecialAirS: self_vel.y = 0, self_vel.x · x2FC0.
    if (air) f.velocity = { x: f32(f.velocity.x * SD_CODE.side.airEntryVx), y: 0 };
    start(air ? 'AirS' : 'S');
  } else if (direction === 'up') {
    // SpecialHi goes airborne before its (grounded) start motion; SpecialAirHi keeps x.
    start(air ? 'AirHiStart' : 'HiStart');
  } else {
    // sub_03020: self_vel.x · x2FC0, and the first aerial use since landing stops the fall.
    if (air) { f.velocity.x = f32(f.velocity.x * SD_CODE.side.airEntryVx); if (v.airUses === 0) f.velocity.y = 0; }
    start(air ? 'AirLwStart' : 'LwStart');
  }
  s.phase = PHASE[s.skullkid!.state];
}

/** Script throw-flag writes (flag 24) of the current motion since the last consumed frame. */
function throwFlag(f: MatchFighter, r: SkullKidRuntime): boolean {
  let fired = false;
  for (const e of f.content.timelines.get(f.animation)?.events ?? []) {
    if (e.frame > f.animationFrame) break;
    if (e.type === 'flag' && e.flag === 24 && e.frame >= r.flagFrame) fired = true;
  }
  r.flagFrame = Math.floor(f.animationFrame) + 1;
  return fired;
}
/** ptr_02e94 (the N motions' accessory callback on throw flag 24): no bomb, a held one (states
 * 0/1) or one already exploding spawns a new bomb while ammo is left; a bomb in states 2-5
 * detonates (item state 6, x2FDC frames). */
function throwFlagCallback(f: MatchFighter, out: SpecialStep): void {
  const v = f.skullkid;
  if (v.bomb === null || v.bombState <= 1 || v.bombState === 6) {
    if (v.ammo > 0) { v.ammo--; out.shots.push({ player: f.slot, kind: 'skull-bomb' }); }
    return;
  }
  v.detonate = true;
}

/** ft_80084F3C: standing friction. */
const groundStill = (f: MatchFighter, physics: MeleePhysics) => { f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; };
/** ftCommon_CheckFallFast: a fresh stick-down while falling latches the fast fall. */
const checkFallFast = (f: MatchFighter, input: PlayerInput) => { if (!f.grounded && f.velocity.y < 0 && f.downWindow > 0 && input.down) f.fastFall = true; };
/** ft_80084DB0: gravity (fast fall), then the normal air drift. */
const airNormal = (f: MatchFighter, input: PlayerInput, physics: MeleePhysics) => { checkFallFast(f, input); f.velocity = physics.air(f.slot, f.velocity, input.x, f.fastFall); };
/** ftCommon_8007D268 alone: the normal air drift without its gravity. */
const driftOnly = (f: MatchFighter, input: PlayerInput, physics: MeleePhysics) => physics.air(f.slot, { x: f.velocity.x, y: 0 }, input.x, false).x;
/** M357_Phys (SpecialAirS / SpecialAirLwStart): ftCommon_8007D344(0, drift base · x2FC0, drift
 * max · x2FC0), then ftCommon_Fall at x2FA8 of gravity and fast-fall speed, scaled by
 * 10 · ft_var50 + 1 (the aerial uses since landing). */
function lightAir(f: MatchFighter, input: PlayerInput, physics: MeleePhysics): void {
  const a = f.content.profile.attributes, c = SD_CODE.side, k = f32(f32(c.usesGravityStep * f.skullkid.airUses) + 1);
  const drift = physics.controlledDrift(f.slot, f.velocity, input.x, f32(attr(f, 0x68) * c.airDrift), f32(a.airDriftMax * c.airDrift));
  f.velocity = physics.customAir(f.slot, drift, f32(f32(a.gravity * c.airGravity) * k), f32(f32(attr(f, 0x74) * c.airGravity) * k), 0);
}

/** sub_037f4 (the side teleport): the stick picks an angle kept within x2FC8 of the horizontal
 * (neutral and a pure up read as its upper edge, a pure down as its lower one, mirrored by the
 * facing), the stick's side sets the facing and SpecialHiHold flies at x3018 for ft_var48 frames. */
function sideWarp(f: MatchFighter, input: PlayerInput): void {
  const c = SD_CODE.side, x = input.x, y = input.y || (input.down ? -1 : 0), ax = Math.abs(x);
  const edge = (up: boolean) => f.facing > 0 ? (up ? c.minAngle : -c.minAngle) : (up ? c.maxAngle : -c.maxAngle);
  let angle: number;
  if (ax >= c.deadX) angle = Math.atan2(y, x);
  else if (y < 0) angle = y > -c.deadX ? edge(true) : ax < c.pureX && y < -c.pureY ? edge(false) : Math.atan2(y, x);
  else angle = y < c.deadX ? edge(true) : ax < c.pureX && y > c.pureY ? edge(true) : Math.atan2(y, x);
  angle = f32(angle);
  if (angle > 0) angle = angle <= 1.5708 ? Math.min(angle, c.minAngle) : Math.max(angle, c.maxAngle);
  else angle = angle >= -1.5708 ? Math.max(angle, -c.minAngle) : Math.min(angle, -c.maxAngle);
  if (x > 0) f.facing = 1; else if (x < 0) f.facing = -1;
  setAirborne(f);
  f.velocity = { x: f32(f32(Math.cos(angle)) * c.speed), y: f32(f32(Math.sin(angle)) * c.speed) };
  enter(f, 'SideWarp'); f.special!.skullkid!.warp = c.intangible;
}
/** M358_Anim / M362_Anim → fn_03b74 (the up teleport): fp->pos snaps to the TransN joint, then
 * the stick angle is held inside [x2FFC, x3004] (x3000/x3008 below the horizontal; a neutral
 * stick reads as the upward cone's edge), the stick's side sets the facing and
 * SpecialAirHiHold flies at x2FB0 for ft_var49 frames. */
function upWarp(f: MatchFighter, input: PlayerInput, world: SpecialWorld | undefined): void {
  const c = SD_CODE.up, x = input.x, y = input.y || (input.down ? -1 : 0);
  const joint = f.content.profile.boneMap[1];
  if (world?.poses && joint !== undefined && joint !== 255) { const p = world.poses.point(f, joint, [0, 0, 0]); f.x = f32(p[0]); f.y = f32(p[1]); }
  let angle = f32(Math.atan2(y, x));
  if (angle >= 0) angle = angle < c.coneLow ? c.coneLow : Math.min(angle, c.coneHigh);
  else angle = angle < -c.coneHigh ? -c.coneHigh : Math.min(angle, -c.coneLow);
  if (x > 0) f.facing = 1; else if (x < 0) f.facing = -1;
  setAirborne(f);
  f.velocity = { x: f32(f32(Math.cos(angle)) * c.speed), y: f32(f32(Math.sin(angle)) * c.speed) };
  enter(f, 'UpWarp'); f.special!.skullkid!.warp = c.intangible;
}

export function stepSkullKidSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics,
  finish: (helpless?: boolean, lag?: number, mobility?: number) => void, world?: SpecialWorld): SpecialStep {
  const s = f.special!, r = s.skullkid!;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  if (s.age === 0) enter(f, r.state);
  else if (r.wasGrounded && !f.grounded && walkedOff(f, r, finish)) { s.age++; return handover(out); }
  s.age++;
  if (!input.special) s.released = true;
  const result = run(f, input, physics, finish, world, out);
  if (f.special?.skullkid === r) r.wasGrounded = f.grounded;
  return result;
}

function run(f: MatchFighter, input: PlayerInput, physics: MeleePhysics,
  finish: (helpless?: boolean, lag?: number, mobility?: number) => void, world: SpecialWorld | undefined, out: SpecialStep): SpecialStep {
  const r = f.special!.skullkid!, a = f.content.profile.attributes;
  switch (r.state) {
    case 'NStart': case 'NHold':
      // M348/M349_Anim → Wait; ptr_02e94 on the throw flag; ft_80084F3C.
      if (throwFlag(f, r)) throwFlagCallback(f, out);
      if (animationDone(f)) { finish(); return handover(out); }
      groundStill(f, physics); return out;
    case 'AirNStart':
      // M352_Anim → Fall; M352_Phys ft_80084DB0.
      if (throwFlag(f, r)) throwFlagCallback(f, out);
      if (animationDone(f)) { finish(); return handover(out); }
      airNormal(f, input, physics); return out;
    case 'AirNHold': {
      // M353_Anim → Fall; M353_Phys: the normal drift, then ftCommon_Fall at x2FA8 of gravity and fast fall.
      if (throwFlag(f, r)) throwFlagCallback(f, out);
      if (animationDone(f)) { finish(); return handover(out); }
      const x = driftOnly(f, input, physics), k = SD_CODE.neutral.holdGravity;
      f.velocity = physics.customAir(f.slot, { x, y: f.velocity.y }, f32(a.gravity * k), f32(attr(f, 0x74) * k), 0);
      return out;
    }
    case 'S':
      // M356_Anim: airborne, then the teleport; M356_Phys ft_80084F3C. The three 5% hits are the script's.
      if (animationDone(f)) { sideWarp(f, input); return out; }
      groundStill(f, physics); return out;
    case 'AirS':
      // M357_Anim: ft_var50++ then the teleport.
      if (animationDone(f)) { f.skullkid.airUses++; sideWarp(f, input); return out; }
      lightAir(f, input, physics); return out;
    case 'HiStart':
      // M358_Anim: TransN snap, airborne, fn_03b74; M358_Phys ft_80084F3C.
      if (animationDone(f)) { upWarp(f, input, world); return out; }
      groundStill(f, physics); return out;
    case 'AirHiStart':
      // M362_Anim: TransN snap, fn_03b74; M362_Phys holds self_vel.y at 0 (x untouched).
      if (animationDone(f)) { upWarp(f, input, world); return out; }
      f.velocity = { x: f.velocity.x, y: 0 }; return out;
    case 'SideWarp': case 'UpWarp': {
      // M359_Anim / M363_Anim: Fighter_ApplyIntang(1) while the counter runs; then the air end
      // (the side one keeps x2FC8 of its x speed) or the grounded SpecialHiEnd. No Phys: the
      // flight keeps its velocity (grounded, gr_vel = self_vel.x keeps sliding).
      if (r.warp > 0) { f.invulnerable = Math.max(f.invulnerable, 1); r.warp--; if (f.grounded) f.velocity.y = 0; return out; }
      if (!f.grounded) {
        if (r.state === 'SideWarp') f.velocity.x = f32(f.velocity.x * SD_CODE.warp.sideEndVx);
        enter(f, 'AirHiEnd'); airNormal(f, input, physics); return out;
      }
      enter(f, 'HiEnd'); groundStill(f, physics); return out;
    }
    case 'HiEnd':
      // M360_Anim → Wait; ft_80084F3C.
      if (animationDone(f)) { finish(); return handover(out); }
      groundStill(f, physics); return out;
    case 'AirHiEnd':
      // M364_Anim: special fall (air_drift_max as the drift multiplier, x2FB8 landing frames).
      if (animationDone(f)) { finish(true, SD_CODE.warp.landing, a.airDriftMax); return handover(out); }
      airNormal(f, input, physics); return out;
    case 'LwStart':
      // M367_Anim → Wait (it mirrors cmd flag 0 into ft_var47, which nothing reads); ft_80084F3C.
      if (animationDone(f)) { finish(); return handover(out); }
      groundStill(f, physics); return out;
    case 'AirLwStart':
      // M372_Anim: ft_var50++, then Fall; M372_Phys is M357_Phys.
      if (animationDone(f)) { f.skullkid.airUses++; finish(); return handover(out); }
      lightAir(f, input, physics); return out;
  }
}

/** Grounded Coll callbacks when the floor runs out (the port learns it one step later). Returns
 * true when the special ended. */
function walkedOff(f: MatchFighter, r: SkullKidRuntime, finish: () => void): boolean {
  const twin = AIR_TWIN[r.state];
  // M348/M349/M356/M358/M367_Coll: airborne, the air motion at the same frame.
  if (twin) { enter(f, twin, 'keepFrame'); f.velocity.y = 0; return false; }
  // M360_Coll: SpecialHiEnd walking off falls (not helpless).
  if (r.state === 'HiEnd') { finish(); return true; }
  return false;
}

/** The *_Coll landings. The engine has already grounded the fighter and zeroed its fall. */
export function landSkullKidSpecial(f: MatchFighter, _finish: () => void): boolean {
  const s = f.special!, r = s.skullkid!;
  f.skullkid.floatUsed = false; f.skullkid.airUses = 0;
  const twin = GROUND_TWIN[r.state];
  // M352/M353/M357/M362/M372_Coll: the ground motion at the same frame.
  if (twin) { enter(f, twin, 'keepFrame'); f.velocity.y = 0; return true; }
  // M364_Coll: SpecialAirHiEnd lands into SpecialHiEnd from frame 0.
  if (r.state === 'AirHiEnd') { enter(f, 'HiEnd'); f.velocity.y = 0; return true; }
  // M359_Coll (both teleports): grounded, the flight slides on until its counter ends.
  if (r.state === 'SideWarp' || r.state === 'UpWarp') { f.velocity.y = 0; return true; }
  return true;
}
/** M359_Coll / M364_Coll catch ledges (while falling); every other aerial Skull Kid motion
 * collides through ft_80081D0C, which never does. */
export function skullkidCatchesLedge(f: MatchFighter): boolean {
  const state = f.special?.skullkid?.state;
  return (state === 'SideWarp' || state === 'UpWarp' || state === 'AirHiEnd') && f.velocity.y < 0;
}

/** OnLanding (export 34): the float and the aerial-special gravity scaler reset. */
export function skullkidOnLanding(f: MatchFighter): void {
  if (f.content.profile.kind !== 'Sd') return;
  f.skullkid.floatUsed = false; f.skullkid.airUses = 0; f.skullkid.float = null;
}

/** OnFrame (export 23). With a bomb out: a fresh B with the stick neutral (±x2FC0) during an
 * attack/landing or light-throw motion detonates a bomb in states 2-5 through the hold motion.
 * With none: the spent ammo refills after the cooldown. Returns true when it took the fighter
 * into the hold. */
export function skullkidOnFrame(f: MatchFighter, input: PlayerInput, specialPressed: boolean, bombExists: boolean): boolean {
  if (f.content.profile.kind !== 'Sd') return false;
  const v = f.skullkid, c = SD_CODE.neutral;
  if (v.bomb !== null && !bombExists) { v.bomb = null; v.bombState = 0; v.detonate = false; }
  if (v.bomb !== null) {
    const y = input.y || (input.down ? -1 : 0);
    if (specialPressed && Math.abs(input.x) < c.detonateStick && Math.abs(y) < c.detonateStick
      && ['attack', 'landing', 'item-throw'].includes(f.state) && bombLive(v)) {
      const air = !f.grounded;
      f.special = { direction: 'neutral', phase: 'loop', age: 0, delay: 0, releaseLag: 0, released: false, queued: false, startedAir: air,
        aim: Math.PI / 2, driftLimit: 0, lastFrame: -1, serial: ++f.specialSerial };
      f.special.skullkid = { state: air ? 'AirNHold' : 'NHold', flagFrame: 0, warp: 0, wasGrounded: f.grounded };
      f.smash = null; f.jab = null; f.fastFall = false;
      if (air) f.velocity.y = f32(f.velocity.y * c.airHoldVy);
      enter(f, f.special.skullkid.state);
      v.detonate = true;
      return true;
    }
    return false;
  }
  if (v.ammo <= 0) {
    if (v.cooldown < c.cooldown) v.cooldown++;
    else { v.cooldown = 0; v.ammo = c.ammo; }
  }
  return false;
}

/** enterfloat (export 31) through m-ex's hooks on ftPe_8011BA54 / ftPe_8011BAD8 (codes.gct): from
 * Fall/Jump/JumpAerial, stick down past PlCo x88 with X/Y held, or — once no longer rising — the
 * stick up (tap-jump threshold) or X/Y held, enters motion 361 once per airtime. M361_Anim then
 * ends it after x3C frames or once X/Y (or stick-up) is let go. */
export function stepSkullKidFloat(f: MatchFighter, input: PlayerInput): void {
  if (f.content.profile.kind !== 'Sd') return;
  const v = f.skullkid, y = input.y || (input.down ? -1 : 0);
  if (!v.float) return;
  if (f.state !== 'fall' || f.animation !== 'SpecialHi' || f.grounded) { v.float = null; return; }
  // M361_Anim: flag1 counts down; X/Y (0xC00) or stick up (0x10000) keeps it.
  if (--v.float.timer <= 0 || !(input.jump || y >= 0.5)) {
    v.float = null; f.animation = 'Fall'; f.animationFrame = 0; f.animationEpoch++;
  }
}
/** The float entry sits late in Fall/Jump/JumpAerial IASA (after specials, attacks, item throws
 * and the air jump), so it runs once this frame's input found nothing else to do. */
export function enterSkullKidFloat(f: MatchFighter, input: PlayerInput, fastFallThreshold: number, acted: boolean): void {
  if (f.content.profile.kind !== 'Sd') return;
  const v = f.skullkid, c = SD_CODE.float, y = input.y || (input.down ? -1 : 0);
  if (acted || v.float || v.floatUsed || f.grounded || !['fall', 'jump', 'airjump'].includes(f.state)) return;
  const enterDown = y <= -fastFallThreshold && input.jump;
  const enterHold = f.velocity.y <= 0 && (y >= 0.66 || input.jump);
  if (!enterDown && !enterHold) return;
  // enterfloat: ChangeMotionState(361), flag2 = 0, ft_var39 = 1, flag1 = 0x3C, the mode from self_vel.y.
  const vy = f.velocity.y;
  v.floatUsed = true;
  v.float = { timer: c.duration, frames: 0, mode: vy < c.fallMode ? 2 : vy > c.riseMode ? 1 : 0 };
  f.state = 'fall'; f.animation = 'SpecialHi'; f.animationFrame = 0; f.animationRate = 1; f.animationEpoch++; f.fastFall = false;
}
/** M361_Phys: the entry mode steers self_vel.y (mode 1 brakes a rise at 3× gravity, mode 2 climbs
 * a fall back to 0, mode 0 falls x0C frames then climbs back), then x adds stick · x3E50 and past
 * air_drift_max pins to it on the side of the old speed. Returns null when not floating. */
export function skullkidFloatVelocity(f: MatchFighter, input: PlayerInput, physics: MeleePhysics): { x: number; y: number } | null {
  const float = f.content.profile.kind === 'Sd' ? f.skullkid.float : null;
  if (!float || f.state !== 'fall' || f.animation !== 'SpecialHi') return null;
  const a = f.content.profile.attributes, c = SD_CODE.float;
  const fall = (gravity: number) => physics.customAir(f.slot, f.velocity, gravity, a.terminal, 0).y;
  let vy = f.velocity.y;
  if (float.mode === 1) vy = vy > 0 ? fall(f32(a.gravity * c.riseBrake)) : 0;
  else if (float.mode === 2) vy = vy < 0 ? fall(f32(-a.gravity)) : 0;
  else if (float.mode === 0) vy = float.frames <= c.fallFrames ? fall(a.gravity) : vy > 0 ? 0 : fall(f32(-a.gravity));
  float.frames++;
  const old = f.velocity.x, next = f32(f32(input.x * c.drift) + old);
  const max = a.airDriftMax;
  const vx = Math.abs(next) >= max ? (old > 0 ? max : -max) : next;
  return { x: vx, y: vy };
}
