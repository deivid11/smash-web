import type { MatchFighter, PlayerInput, PoseProvider } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { DiddySpecialData } from './diddy-data.ts';
import { DIDDY_BANANA, DIDDY_FX } from './diddy-data.ts';
import type { Floor } from './data.ts';
import { floorY } from './data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { ActiveHit, HitDefinition } from './moves.ts';
import type { V3 } from '../hsd/model.ts';
import type { SpecialRuntime, SpecialStep, SpecialWorld } from './specials.ts';
import { routeAceSound } from './ace-voices.ts';

/** Diddy's special motions (PlDd's ftFunction, decoded in lib/game/diddy-data.ts), named after
 * their figatrees. The Rocketbarrel charges blend in HiChargeF/B visually (Blend_ChargeAnimation). */
export type DiddyMotion =
  | 'SpecialNStart' | 'SpecialNCharge' | 'SpecialNDanger' | 'SpecialNBlow' | 'SpecialNShoot'
  | 'SpecialAirNStart' | 'SpecialAirNCharge' | 'SpecialAirNDanger' | 'SpecialAirNBlow' | 'SpecialAirNShoot'
  | 'SpecialSStart' | 'SpecialAirSStart' | 'SpecialAirSJump' | 'SpecialAirSKick'
  | 'SpecialSStick' | 'SpecialSStickAttack' | 'SpecialSStickAttack2' | 'SpecialSStickJump' | 'SpecialSStickJump2'
  | 'SpecialHiStart' | 'SpecialHiCharge' | 'SpecialAirHiStart' | 'SpecialAirHiCharge' | 'SpecialAirHiJump' | 'SpecialAirHiDamage'
  | 'SpecialLw' | 'SpecialAirLw';

/** The motion vars (fp+0x2340…) and the fighter fields the callbacks touch. */
export interface DiddyRuntime {
  motion: DiddyMotion;
  /** Last animation frame whose script events were consumed (cmd vars, throw flags, self damage). */
  flagFrame: number;
  /** Popgun: state_var2 (frames B was held while charging), the held gun's item state (-1 none,
   * 0 held, 1 Danger model, 2 Blow) and the frames it has spent in that state. */
  charge: number; gun: -1 | 0 | 1 | 2; gunFrame: number;
  /** Monkey Flip: state_var1 (jumps used when it began) and the jumps to keep while clinging. */
  startJumps: number; clingJumps: number;
  /** Rocketbarrel: state_var2 tilt, state_var1 F/B blend weight, state_var3 charge frames. */
  tilt: number; blend: number; hiCharge: number;
  /** SpecialAirHiJump: the XRotN lean (ftPartGetRotX(2)), the trail cadence (state_var4), the
   * hitboxes gone for good (state_var4+2), the flight hitbox's speed-scaled damage and base, and
   * the cmd2 unwind (state_var5-8). */
  rotX: number; trail: number; hitOff: boolean; flightDamage: number; flightBase: number;
  unwind: { frame: number; length: number; from: number } | null;
  /** The velocity this frame moved with (the engine's ceiling block zeroes it before the next step). */
  lastVx: number; lastVy: number;
  /** Banana Peel: the banana this special put in his hand (state_var1). */
  banana: boolean;
  /** Script cmd var 0, set by the Anim pass and consumed by SpecialHiStart_IASA. */
  flag0: boolean;
}

const f32 = Math.fround;
const TAU = Math.PI * 2;
const lerp = (range: readonly [number, number], t: number) => f32(f32(f32(range[1] - range[0]) * t) + range[0]);
const params = (f: MatchFighter): DiddySpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Dd') throw new Error('Missing Diddy parameters.'); return p;
};
const PHASE: Record<DiddyMotion, SpecialRuntime['phase']> = {
  SpecialNStart: 'start', SpecialAirNStart: 'start', SpecialNCharge: 'loop', SpecialAirNCharge: 'loop', SpecialNDanger: 'loop', SpecialAirNDanger: 'loop',
  SpecialNBlow: 'end', SpecialAirNBlow: 'end', SpecialNShoot: 'travel', SpecialAirNShoot: 'travel',
  SpecialSStart: 'start', SpecialAirSStart: 'start', SpecialAirSJump: 'travel', SpecialAirSKick: 'end',
  SpecialSStick: 'hit', SpecialSStickAttack: 'hit', SpecialSStickAttack2: 'hit', SpecialSStickJump: 'hit', SpecialSStickJump2: 'end',
  SpecialHiStart: 'start', SpecialAirHiStart: 'start', SpecialHiCharge: 'loop', SpecialAirHiCharge: 'loop', SpecialAirHiJump: 'travel', SpecialAirHiDamage: 'end',
  SpecialLw: 'start', SpecialAirLw: 'start',
};
/** Motions whose Coll is a ground check (ft_80082708): leaving the floor is theirs to handle. */
const GROUND = new Set<DiddyMotion>(['SpecialNStart', 'SpecialNCharge', 'SpecialNDanger', 'SpecialNBlow', 'SpecialNShoot', 'SpecialSStart', 'SpecialHiStart', 'SpecialHiCharge', 'SpecialLw']);
/** The motions that sit on the captive (Diddy's model is glued to its XRotN until the throw). */
const CLING = new Set<DiddyMotion>(['SpecialSStick', 'SpecialSStickAttack', 'SpecialSStickAttack2', 'SpecialSStickJump']);
const GUN = new Set<DiddyMotion>(['SpecialNStart', 'SpecialNCharge', 'SpecialNDanger', 'SpecialNBlow', 'SpecialNShoot', 'SpecialAirNStart', 'SpecialAirNCharge', 'SpecialAirNDanger', 'SpecialAirNBlow', 'SpecialAirNShoot']);
type Finish = (helpless?: boolean, lag?: number, mobility?: number) => void;

export function diddySpecialName(f: MatchFighter, direction: SpecialDirection, _phase: SpecialRuntime['phase']): string {
  const r = f.special?.diddy;
  if (r) return animationFor(r);
  const air = !f.grounded;
  return direction === 'neutral' ? (air ? 'SpecialAirNStart' : 'SpecialNStart') : direction === 'side' ? (air ? 'SpecialAirSStart' : 'SpecialSStart')
    : direction === 'up' ? (air ? 'SpecialAirHiStart' : 'SpecialHiStart') : (air ? 'SpecialAirLw' : 'SpecialLw');
}
/** Blend_ChargeAnimation: the F/B charge blends in by state_var1, which saturates at the tilt cap
 * (x7C); without a blend the F/B figatree shows once it passes a quarter. */
function animationFor(r: DiddyRuntime): string {
  if ((r.motion === 'SpecialHiCharge' || r.motion === 'SpecialAirHiCharge') && r.blend >= 0.25) return `${r.motion}${r.tilt > 0 ? 'F' : 'B'}`;
  return r.motion;
}

/** ActionStateChange(start 0, speed 1, blend 0); `keepFrame` is the air/ground swap (0x4202:
 * frame and hitboxes kept). */
function enter(f: MatchFighter, motion: DiddyMotion, keepFrame = false): void {
  const s = f.special!, r = s.diddy!;
  r.motion = motion; s.phase = PHASE[motion];
  f.animation = animationFor(r); f.attackName = f.animation;
  if (!keepFrame) { f.animationFrame = 0; f.stateFrame = 0; f.attackSerial++; f.victims.clear(); r.flagFrame = -1; }
  f.animationRate = 1; f.animationEpoch++;
}
const clipEnd = (f: MatchFighter, name = f.animation) => Math.max(1, f.content.clips.get(name)?.endFrame ?? 1);
/** FrameTimerCheck == 0. */
const animationDone = (f: MatchFighter) => f.animationFrame >= clipEnd(f);
const setAirborne = (f: MatchFighter) => { f.grounded = false; f.floor = null; };
/** ftCommon_8007D5D4: airborne with one jump spent. */
const airborneOneJump = (f: MatchFighter) => { setAirborne(f); f.jumpsUsed = 1; };
/** Script events that fired after `from` up to the current frame. */
function scriptEvents(f: MatchFighter, from: number, pick: (e: { type: string; frame: number; index?: number; value?: number; flag?: number }) => boolean): Array<{ type: string; frame: number; damage?: number }> {
  const out: Array<{ type: string; frame: number; damage?: number }> = [];
  for (const e of f.content.timelines.get(f.animation)?.events ?? []) {
    if (e.frame > f.animationFrame) break;
    if (e.frame > from && pick(e as { type: string; frame: number })) out.push(e as { type: string; frame: number });
  }
  return out;
}
const command = (f: MatchFighter, r: DiddyRuntime, index: number) => scriptEvents(f, r.flagFrame, (e) => e.type === 'command' && e.index === index && e.value === 1).length > 0;
/** The throw-release flag (script flag 20 = 0, throw_flags 0x10). */
const throwFlag = (f: MatchFighter, r: DiddyRuntime) => scriptEvents(f, r.flagFrame, (e) => e.type === 'flag' && e.flag === 20 && e.value === 0).length > 0;
function throwHit(f: MatchFighter, index: number): HitDefinition | undefined {
  for (const e of f.content.timelines.get(f.animation)?.events ?? []) if (e.type === 'throw-hit' && e.index === index) return e.hit;
  return undefined;
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
/** ftCommon_8007D174: accelerate toward `target` without passing it or air_drift_max. */
function steerDrift(f: MatchFighter, vx: number, accel: number, target: number, friction: number): number {
  const max = f.content.profile.attributes.airDriftMax;
  if (!target) return Math.abs(friction) >= Math.abs(vx) ? 0 : f32(vx + (vx > 0 ? -friction : friction));
  let delta = accel;
  if (!(vx * accel < 0)) {
    if (accel > 0) {
      if (vx + accel > target) { delta = -friction; if (vx + delta < target) delta = f32(target - vx); if (vx + delta > max) delta = f32(max - vx); }
    } else if (vx + accel < target) { delta = friction; if (vx + delta > target) delta = f32(target - vx); if (vx + delta < -max) delta = f32(-max - vx); }
  }
  return f32(vx + delta);
}

export function beginDiddySpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, air = !f.grounded;
  s.diddy = { motion: 'SpecialNStart', flagFrame: -1, charge: 0, gun: -1, gunFrame: 0, startJumps: f.jumpsUsed, clingJumps: f.jumpsUsed, tilt: 0, blend: 0, hiCharge: 0,
    rotX: 0, trail: 0, hitOff: false, flightDamage: 0, flightBase: 0, unwind: null, lastVx: 0, lastVy: 0, banana: false, flag0: false };
  const r = s.diddy;
  if (direction === 'neutral') r.motion = air ? 'SpecialAirNStart' : 'SpecialNStart';
  else if (direction === 'side') {
    // SpecialSStart_Enter zeroes every velocity; SpecialAirSStart_Enter the air one (it hovers).
    f.velocity = { x: 0, y: 0 };
    r.motion = air ? 'SpecialAirSStart' : 'SpecialSStart';
  } else if (direction === 'up') {
    // SpecialHi_Init: tilt, blend, charge and flags cleared, self_vel zeroed.
    f.velocity = { x: 0, y: 0 };
    r.motion = air ? 'SpecialAirHiStart' : 'SpecialHiStart';
  } else r.motion = air ? 'SpecialAirLw' : 'SpecialLw';
  s.phase = PHASE[r.motion];
}

/** The gun the special holds (render: FtPart 0x1F) and its item state. */
export function diddyGun(f: MatchFighter): { state: 0 | 1 | 2; frame: number } | null {
  const r = f.special?.diddy;
  return r && r.gun >= 0 && GUN.has(r.motion) ? { state: r.gun as 0 | 1 | 2, frame: r.gunFrame } : null;
}
/** Monkey Flip's grab boxes are live (SpecialAirSJump runs ftCommon_InitGrab). */
export function diddyFlipActive(f: MatchFighter): boolean {
  return f.content.profile.kind === 'Dd' && f.state === 'special' && f.special?.diddy?.motion === 'SpecialAirSJump';
}
/** Diddy rides a captive: the captive keeps its place and Diddy's XRotN is glued to its XRotN. */
export function diddyClinging(f: MatchFighter): boolean {
  const motion = f.special?.diddy?.motion;
  return f.content.profile.kind === 'Dd' && f.state === 'special' && !!motion && CLING.has(motion) && f.combat.partner !== null;
}
/** SpecialSStick_OnVictimGrabbed + SpecialSStick_Enter: the captive's grab timer (capped at x48),
 * Diddy on its head with every velocity killed and his double jump back if he still had one. */
export function beginDiddyCling(f: MatchFighter, victim: MatchFighter, grab: { base: number; percentScale: number }): void {
  const p = params(f), r = f.special!.diddy!;
  victim.combat.holdTimer = Math.min(p.side.escapeMax, f32(grab.base + victim.percent * grab.percentScale));
  victim.velocity = { x: 0, y: 0 };
  enter(f, 'SpecialSStick');
  f.velocity = { x: 0, y: 0 }; setAirborne(f);
  const max = f.content.profile.attributes.maxJumps;
  if (r.startJumps < max) f.jumpsUsed = 1; else r.startJumps = max;
  r.clingJumps = f.jumpsUsed;
}
/** ftCliffCommon_80081298 runs in the jump's and the flight's Coll (and the crash's). */
export function diddyCatchesLedge(f: MatchFighter): boolean {
  const motion = f.special?.diddy?.motion;
  return motion === 'SpecialAirSJump' || motion === 'SpecialAirHiJump' || motion === 'SpecialAirHiDamage';
}
/** Special hit rewrites: the flight's speed-scaled box 1 (none at all once it slowed or fell), and
 * the popgun Blow's 8% fire box on the gun's joint 7 for its item state's first two frames. */
export function diddyHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  const r = f.special?.diddy; if (!r) return hits;
  if (r.motion === 'SpecialAirHiJump') {
    if (r.hitOff) return [];
    return hits.map((hit) => hit.id === 1 ? { ...hit, damage: r.flightDamage, base: r.flightBase } : hit);
  }
  const blast = f.content.specials.articles.diddy?.blast;
  if (blast && r.gun === 2 && r.gunFrame < 2 && (r.motion === 'SpecialNBlow' || r.motion === 'SpecialAirNBlow')) {
    const muzzle = f.content.specials.articles.diddy!.muzzle, bone = f.content.profile.partJoints[params(f).neutral.gunPart] ?? f.content.profile.boneMap[49]!;
    return [...hits, { ...blast, bone, group: 7, offset: [f32(muzzle[0] + blast.offset[0]), f32(muzzle[1] + blast.offset[1]), f32(muzzle[2] + blast.offset[2])], activation: 0x7d00 }];
  }
  return hits;
}
/** XRotN lean of the Rocketbarrel flight (SpecialAirHiJump_Phys ftPartSetRotX(2)). */
export function diddyLean(f: MatchFighter): number | null {
  const r = f.special?.diddy;
  return r?.motion === 'SpecialAirHiJump' ? r.rotX : null;
}

export function landDiddySpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, r = s.diddy!, p = params(f), a = f.content.profile.attributes;
  switch (r.motion) {
    case 'SpecialAirNStart': enter(f, 'SpecialNStart', true); return true;
    case 'SpecialAirNCharge': enter(f, 'SpecialNCharge', true); return true;
    case 'SpecialAirNDanger': enter(f, 'SpecialNDanger', true); return true;
    case 'SpecialAirNBlow': enter(f, 'SpecialNBlow', true); return true;
    case 'SpecialAirNShoot': enter(f, 'SpecialNShoot', true); return true;
    case 'SpecialAirSStart': enter(f, 'SpecialSStart', true); return true;
    case 'SpecialAirSJump': case 'SpecialAirSKick': land(f, finish, p.side.landing); return true;
    case 'SpecialSStick': case 'SpecialSStickAttack': case 'SpecialSStickJump':
      // No Coll while clinging: the captive carries him; a floor under him changes nothing.
      setAirborne(f); f.jumpsUsed = r.clingJumps; return true;
    case 'SpecialSStickAttack2':
      if (f.combat.partner !== null) { setAirborne(f); f.jumpsUsed = r.clingJumps; return true; }
      land(f, finish, a.landingLag); return true;
    case 'SpecialSStickJump2': land(f, finish, a.landingLag); return true;
    case 'SpecialAirHiStart': enter(f, 'SpecialHiStart', true); return true;
    case 'SpecialAirHiCharge': enter(f, 'SpecialHiCharge', true); return true;
    case 'SpecialAirHiJump': case 'SpecialAirHiDamage': land(f, finish, p.up.landing); return true;
    case 'SpecialAirLw': enter(f, 'SpecialLw', true); return true;
    default: f.velocity = { x: f.velocity.x, y: 0 }; return true;
  }
}

/** Ground→air Coll transitions, run for the previous frame's movement before this frame's
 * callbacks. Returns true when the special ended. */
function leftGround(f: MatchFighter, r: DiddyRuntime, finish: Finish): boolean {
  switch (r.motion) {
    case 'SpecialNStart': airborneOneJump(f); enter(f, 'SpecialAirNStart', true); return false;
    case 'SpecialNCharge': airborneOneJump(f); enter(f, 'SpecialAirNCharge', true); return false;
    case 'SpecialNDanger': airborneOneJump(f); enter(f, 'SpecialAirNDanger', true); return false;
    // SpecialNBlow_Coll: Gun_Destroy, then Fall.
    case 'SpecialNBlow': r.gun = -1; airborneOneJump(f); finish(); return true;
    case 'SpecialNShoot': airborneOneJump(f); enter(f, 'SpecialAirNShoot', true); return false;
    case 'SpecialSStart': airborneOneJump(f); enter(f, 'SpecialAirSStart', true); return false;
    case 'SpecialHiStart': airborneOneJump(f); enter(f, 'SpecialAirHiStart', true); return false;
    case 'SpecialHiCharge': airborneOneJump(f); enter(f, 'SpecialAirHiCharge', true); return false;
    case 'SpecialLw': airborneOneJump(f); enter(f, 'SpecialAirLw', true); return false;
    default: return false;
  }
}

export function stepDiddySpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: Finish, world?: SpecialWorld): SpecialStep {
  const p = params(f), s = f.special!, r = s.diddy!;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  // The Enter ran inside the previous state's IASA: this frame only has the new motion's Phys.
  const fresh = s.age === 0;
  s.age++;
  if (!input.special) s.released = true;
  if (!fresh && !f.grounded && GROUND.has(r.motion) && leftGround(f, r, finish)) return out;
  if (!fresh) {
    const crash = crashDiddyRocket(f);
    if (crash) (out.effects ??= []).push(...crash);
    anim(f, input, p, r, finish, out, world);
    if (f.special !== s) return out;
    iasa(f, input, pressed, p, r, out, world);
    if (f.special !== s) return out;
  }
  phys(f, input, physics, p, r, out);
  if (r.gun >= 0) r.gunFrame++;
  r.lastVx = f.velocity.x; r.lastVy = f.velocity.y;
  return out;
}

/** The motion's Anim callback. */
function anim(f: MatchFighter, input: PlayerInput, p: DiddySpecialData, r: DiddyRuntime, finish: Finish, out: SpecialStep, world?: SpecialWorld): void {
  const flag0 = command(f, r, 0), flag1 = command(f, r, 1), flag2 = command(f, r, 2), release = throwFlag(f, r);
  const selfDamage = scriptEvents(f, r.flagFrame, (e) => e.type === 'self-damage').reduce((sum, e) => sum + (e.damage ?? 0), 0);
  r.flagFrame = f.animationFrame;
  if (flag0) r.flag0 = true;
  if (selfDamage) f.percent = f32(Math.max(0, Math.min(999, f.percent + selfDamage)));
  const done = animationDone(f);
  switch (r.motion) {
    case 'SpecialNStart': case 'SpecialAirNStart':
      // Gun_Spawn on the start script's cmd0 (item 0 held on FtPart 0x1F, state 0).
      if (r.gun < 0 && flag0) { r.gun = 0; r.gunFrame = 0; }
      if (done) enter(f, f.grounded ? 'SpecialNCharge' : 'SpecialAirNCharge');
      return;
    case 'SpecialNCharge': case 'SpecialAirNCharge':
      // SpecialN(Air)Danger_Enter: Gun_ChangeModel(1).
      if (done) { enter(f, f.grounded ? 'SpecialNDanger' : 'SpecialAirNDanger'); setGun(r, 1); }
      return;
    case 'SpecialNDanger':
      if (done) { enter(f, 'SpecialNBlow'); setGun(r, 2); }
      return;
    case 'SpecialAirNDanger':
      // SpecialAirNBlow_Enter adds Fighter_TakeDamage(5) to the script's own 5%.
      if (done) { enter(f, 'SpecialAirNBlow'); setGun(r, 2); f.percent = f32(Math.min(999, f.percent + p.neutral.airBlowDamage)); }
      return;
    case 'SpecialNBlow': case 'SpecialAirNBlow': case 'SpecialNShoot': case 'SpecialAirNShoot':
      // cmd1 destroys the gun; the end waits (ground) or falls.
      if (flag1) r.gun = -1;
      if (done) { r.gun = -1; finish(); }
      return;
    case 'SpecialSStart':
      // SpecialAirSJump_Enter, then SetAirborne.
      if (done) { flipJump(f, p, r); setAirborne(f); }
      return;
    case 'SpecialAirSStart':
      if (done) flipJump(f, p, r);
      return;
    case 'SpecialAirSJump':
      if (done) { f.jumpsUsed = f.content.profile.attributes.maxJumps; specialFall(f, finish, 1, p.side.landing); }
      return;
    case 'SpecialAirSKick':
      if (done) specialFall(f, finish, 1, p.side.landing);
      return;
    case 'SpecialSStick':
      // The cling loops until an input, the captive's escape or a hit ends it.
      if (f.combat.partner === null) { finish(); return; }
      if (done) { f.animationFrame = f32(f.animationFrame % clipEnd(f)); f.attackSerial++; f.victims.clear(); r.flagFrame = -1; }
      return;
    case 'SpecialSStickAttack':
      if (f.combat.partner === null) { finish(); return; }
      if (done) enter(f, 'SpecialSStickAttack2');
      return;
    case 'SpecialSStickAttack2':
      // SpecialS_ThrowDetach with throw box 0, then the backflip off the captive.
      if (release && f.combat.partner !== null) { detach(f, out, world); f.velocity = { x: f32(p.side.kickOff[0] * f.facing), y: p.side.kickOff[1] }; }
      if (done) { if (f.combat.partner !== null) unlink(f, world); finish(); f.velocity = { x: f.velocity.x, y: p.side.kickFallSpeed }; }
      return;
    case 'SpecialSStickJump':
      if (release && f.combat.partner !== null) detach(f, out, world);
      if (done) {
        if (f.combat.partner !== null) unlink(f, world);
        enter(f, 'SpecialSStickJump2');
        f.velocity = { x: f32(p.side.jumpOff[0] * f.facing), y: p.side.jumpOff[1] };
      }
      return;
    case 'SpecialSStickJump2':
      if (done) finish();
      return;
    case 'SpecialHiStart':
      if (done) enter(f, 'SpecialHiCharge');
      return;
    case 'SpecialAirHiStart':
      if (done) enter(f, 'SpecialAirHiCharge');
      return;
    case 'SpecialHiCharge': case 'SpecialAirHiCharge':
      if (done) { airborneOneJump(f); launch(f, p, r); return; }
      blend(f, input, p, r);
      return;
    case 'SpecialAirHiJump':
      // cmd2 starts the lean's unwind over the frames left (state_var5-8).
      if (flag2) r.unwind = { frame: 0, length: f32(clipEnd(f) - f.animationFrame), from: r.rotX };
      if (done) specialFall(f, finish, p.up.mobility, p.up.landing);
      return;
    case 'SpecialAirHiDamage':
      if (done) specialFall(f, finish, p.up.mobility, p.up.landing);
      return;
    case 'SpecialLw': case 'SpecialAirLw':
      // Banana_Spawn (cmd0, one live banana, empty hands) and Banana_Release (cmd1).
      if (flag0 && f.heldItem === null && !(world?.bananaOut ?? false)) {
        r.banana = true;
        out.shots.push({ player: f.slot, kind: 'diddy-banana', variant: 0 });
        out.sounds.push(routeAceSound(f.content.specials.soundBank, p.down.voice));
      }
      if (flag1 && r.banana) { out.shots.push({ player: f.slot, kind: 'diddy-banana', variant: 1 }); r.banana = false; }
      if (done) finish();
      return;
  }
}
function setGun(r: DiddyRuntime, state: 0 | 1 | 2): void {
  if (r.gun < 0) return;
  r.gun = state; r.gunFrame = 0;
}

/** The motion's IASA callback. */
function iasa(f: MatchFighter, input: PlayerInput, pressed: boolean, p: DiddySpecialData, r: DiddyRuntime, out: SpecialStep, world?: SpecialWorld): void {
  const held = !!input.special, attack = pressed || !!world?.attackPressed;
  switch (r.motion) {
    case 'SpecialNCharge': case 'SpecialNDanger': case 'SpecialAirNCharge': case 'SpecialAirNDanger':
      // B held counts the charge; releasing it shoots (SpecialN(Air)Shoot_Enter → Gun_Shoot).
      if (held) { r.charge++; return; }
      enter(f, f.grounded ? 'SpecialNShoot' : 'SpecialAirNShoot');
      shoot(f, p, r, out);
      return;
    case 'SpecialAirSJump':
      // A or B pressed: the kick instead of the grab.
      if (attack) enter(f, 'SpecialAirSKick');
      return;
    case 'SpecialSStick':
      // A or B kicks off the captive; a jump leaps off it.
      if (attack) enter(f, 'SpecialSStickAttack');
      else if (world?.jumpPressed) enter(f, 'SpecialSStickJump');
      return;
    case 'SpecialHiStart': case 'SpecialAirHiStart':
      // The start script's cmd0: ftCommon_UpdateFacing once |stick x| reaches x64.
      if (r.flag0) { r.flag0 = false; if (Math.abs(input.x) >= p.up.turnStick) f.facing = input.x >= 0 ? 1 : -1; }
      return;
    case 'SpecialHiCharge': case 'SpecialAirHiCharge':
      // Charge while under x68, or under x6C with B held; otherwise launch (SetAirborne first).
      if (r.hiCharge < p.up.chargeMin || (held && r.hiCharge < p.up.chargeMax)) { r.hiCharge++; return; }
      airborneOneJump(f); launch(f, p, r);
      return;
    default: return;
  }
}

/** The motion's Phys callback. */
function phys(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, p: DiddySpecialData, r: DiddyRuntime, out: SpecialStep): void {
  const a = f.content.profile.attributes;
  switch (r.motion) {
    case 'SpecialNStart': case 'SpecialNCharge': case 'SpecialNDanger': case 'SpecialNBlow': case 'SpecialNShoot':
    case 'SpecialHiStart': case 'SpecialHiCharge': case 'SpecialLw':
      // ft_80084F3C.
      f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      return;
    case 'SpecialAirNStart': case 'SpecialAirNCharge': case 'SpecialAirNDanger': case 'SpecialAirNBlow': case 'SpecialAirNShoot':
    case 'SpecialAirSJump': case 'SpecialAirSKick': case 'SpecialAirHiDamage': case 'SpecialAirLw':
      // ft_80084EEC: ftCommon_Fall and the aerial friction, no drift.
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return;
    case 'SpecialSStart':
      // No Phys: the zeroed speed stands.
      f.velocity = { x: f.velocity.x, y: 0 };
      return;
    case 'SpecialAirSStart': case 'SpecialSStick': case 'SpecialSStickAttack': case 'SpecialSStickJump': case 'SpecialSStickAttack2':
      // No Phys: hovering, glued to the captive, or keeping the kick-off speed.
      return;
    case 'SpecialSStickJump2':
      // ftCommon_Fall and the normal aerial drift.
      f.velocity = physics.air(f.slot, f.velocity, input.x, false);
      return;
    case 'SpecialAirHiStart': case 'SpecialAirHiCharge':
      // ftCommon_Fall(x70, x74).
      f.velocity = physics.customAir(f.slot, f.velocity, p.up.gravity, p.up.terminal, 0);
      return;
    case 'SpecialAirHiJump':
      flight(f, input, physics, p, r, out);
      return;
  }
}

/** SpecialAirSJump_Enter: the fixed flip (x54 · facing, x58), grab boxes armed, every jump spent. */
function flipJump(f: MatchFighter, p: DiddySpecialData, r: DiddyRuntime): void {
  enter(f, 'SpecialAirSJump');
  f.velocity = { x: f32(p.side.jump[0] * f.facing), y: p.side.jump[1] };
  f.jumpsUsed = f.content.profile.attributes.maxJumps;
  r.clingJumps = f.jumpsUsed;
}

/** Gun_Shoot: the peanut (item 1) from the gun's joint 7 at speed/angle/damage by charge, and the
 * recoil (ground: set; air: added). The angle and recoil charge divides by ft_var1 · x0 and caps
 * at 1; the rest divides by ft_var1 (NCharge + NDanger lengths) alone. */
function shoot(f: MatchFighter, p: DiddySpecialData, r: DiddyRuntime, out: SpecialStep): void {
  const n = p.neutral, total = f32(clipEnd(f, 'SpecialNCharge') + clipEnd(f, 'SpecialNDanger'));
  const charge = f32(r.charge / total), capped = Math.min(1, f32(r.charge / f32(total * n.chargeFraction)));
  out.shots.push({ player: f.slot, kind: 'diddy-peanut', charge, rawCharge: capped });
  const recoil = f32(lerp(n.recoil, capped) * -f.facing);
  f.velocity = f.grounded ? { x: recoil, y: 0 } : { x: f32(f.velocity.x + recoil), y: f.velocity.y };
}

/** Blend_ChargeAnimation: the tilt chases the stick by x78 (±x7C), the blend weight halves toward
 * |tilt| each frame; the F/B charge figatree shows through once the weight passes half. */
function blend(f: MatchFighter, input: PlayerInput, p: DiddySpecialData, r: DiddyRuntime): void {
  const u = p.up, stick = input.x;
  if (r.tilt < stick) r.tilt = f32(r.tilt + u.tiltStep);
  if (r.tilt > stick) r.tilt = f32(r.tilt - u.tiltStep);
  r.tilt = Math.max(-u.tiltMax, Math.min(u.tiltMax, r.tilt));
  r.blend = f32(f32(Math.abs(r.tilt) + r.blend) * 0.5);
  const next = animationFor(r);
  if (next !== f.animation) { f.animation = next; f.attackName = next; f.animationEpoch++; }
}

/** SpecialAirHiJump_Enter: speed x90..x94 by charge / x6C, angle 90° − (90° − xC0) · tilt (in
 * world space, not by facing), every jump spent. */
function launch(f: MatchFighter, p: DiddySpecialData, r: DiddyRuntime): void {
  const u = p.up;
  enter(f, 'SpecialAirHiJump');
  r.trail = 0; r.hitOff = false; r.unwind = null;
  const t = Math.max(0, Math.min(1, f32(r.hiCharge / u.chargeMax)));
  const speed = lerp(u.speed, t), angle = f32(f32(90 - f32(f32(90 - u.angleSpan) * r.tilt)) * (Math.PI / 180));
  f.velocity = { x: f32(Math.cos(angle) * speed), y: f32(Math.sin(angle) * speed) };
  f.jumpsUsed = f.content.profile.attributes.maxJumps;
  r.flightDamage = Math.trunc(lerp(u.flightDamage, 1)); r.flightBase = Math.trunc(lerp(u.flightBase, 1));
}

/** SpecialAirHiJump_Phys: ftCommon_Fall, the x84/x88/x8C stick drift, the XRotN lean toward the
 * velocity (by xC8 a frame), the trail and the speed-scaled flight hitbox. */
function flight(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, p: DiddySpecialData, r: DiddyRuntime, out: SpecialStep): void {
  const u = p.up, a = f.content.profile.attributes;
  const fallen = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
  f.velocity = { x: steerDrift(f, fallen.x, f32(input.x * u.driftAccel), f32(input.x * u.driftMax), u.driftFriction), y: fallen.y };
  if (r.unwind) {
    const w = r.unwind; w.frame = f32(w.frame + 1);
    let span = TAU;
    if (w.from < 0 && w.from > -Math.PI) span = -span;
    const start = f32(w.from - span);
    r.rotX = f32(start - f32(f32(w.frame / w.length) * start));
    return;
  }
  let target = f32(f.facing * Math.atan2(f.velocity.x, f.velocity.y));
  if (target < 0) { if (-target < 0.001) target = 0; else while (target < 0) target = f32(target + TAU); }
  else if (target < 0.001) target = 0;
  const current = r.rotX;
  if (current + Math.PI < target) target = -target;
  const turn = Math.max(-u.turnRate, Math.min(u.turnRate, f32(target - current)));
  let lean = f32(turn + current);
  while (lean >= TAU) lean = f32(lean - TAU);
  while (lean < 0) lean = f32(lean + TAU);
  r.rotX = lean;
  const speed = f32(Math.hypot(f.velocity.x, f.velocity.y)), floor = f32(u.speed[0] * u.flightFloor);
  if (speed > floor && !r.hitOff && f.velocity.y >= 0) {
    if (++r.trail % u.trailPeriod === 0) {
      r.trail = 0;
      for (const offset of u.trailOffsets) (out.effects ??= []).push({ effect: u.trailEffect, part: 0, bone: u.trailBone, offset });
    }
    const ratio = f32(f32(speed - floor) / f32(u.speed[1] - floor));
    r.flightDamage = Math.trunc(lerp(u.flightDamage, ratio)); r.flightBase = Math.trunc(lerp(u.flightBase, ratio));
  } else r.hitOff = true;
}

/** SpecialAirHiJump_Coll's ceiling branch, run on the step after the engine blocked the climb:
 * lbVector_Mirror against the ceiling, ×0.8, efAsync 0x406 / efSync 0xEA, 5% to Diddy, and
 * SpecialAirHiDamage (airborne, one jump spent). */
export function crashDiddyRocket(f: MatchFighter): SpecialStep['effects'] {
  const r = f.special?.diddy, p = params(f);
  if (r?.motion !== 'SpecialAirHiJump' || !f.envContact?.ceiling || f.grounded) return undefined;
  const vx = r.lastVx, vy = r.lastVy;
  f.velocity = { x: f32(vx * p.up.crashDamping), y: f32(-Math.abs(vy) * p.up.crashDamping) };
  f.percent = f32(Math.min(999, f.percent + p.up.crashDamage));
  enter(f, 'SpecialAirHiDamage');
  airborneOneJump(f);
  return [{ effect: DIDDY_FX.crash, part: 0 }, { effect: DIDDY_FX.crashSpark, part: 0 }];
}

/** SpecialS_ThrowDetach: throw box 0 on the captive (launched the way Diddy faces), the captive's
 * double jump back, Diddy's glue undone at the captive's XRotN. */
function detach(f: MatchFighter, out: SpecialStep, world?: SpecialWorld): void {
  const victim = world?.fighters[f.combat.partner!];
  const hit = throwHit(f, 0);
  unlink(f, world);
  if (!victim || !hit) return;
  const joint = victim.content.profile.partJoints[2] ?? victim.content.profile.motionRoot;
  const point: V3 = world?.poses ? world.poses.point(victim, joint, [0, 0, 0]) : [victim.x, victim.y, 0];
  f.x = point[0]; f.y = point[1]; setAirborne(f);
  victim.jumpsUsed = 1;
  (out.strikes ??= []).push({ victim: victim.slot, hit, direction: f.facing, point });
}
/** Unlink Diddy and his captive (the captive is released or struck by the caller). */
function unlink(f: MatchFighter, world?: SpecialWorld): void {
  const victim = f.combat.partner === null ? undefined : world?.fighters[f.combat.partner];
  f.combat.partner = null;
  if (victim && victim.combat.partner === f.slot) victim.combat.partner = null;
}

/** The captive's side of the cling (SpecialS(Air)SStick{Wait,Attack,Jump}Taro, run on the rival
 * by Fighter_TaroStateChange). Grounded and waiting it counts the grab timer down by 1 plus the
 * mash (ftCommon_GrabMash x3A8) and breaks out at 0; airborne it falls by x4C/x50 (no escape) until
 * it lands. The rival's own capture poses stand in for Diddy's *Capture figatrees, which are
 * authored on a single skeleton. Returns false when it broke out (both were launched). */
export interface DiddyCaptiveHost {
  floors: readonly Floor[]; poses: PoseProvider; mash: number;
  strike(a: MatchFighter, v: MatchFighter, hit: HitDefinition, point: V3, direction: number): void;
}
export function stepDiddyCaptive(v: MatchFighter, owner: MatchFighter, mashed: boolean, host: DiddyCaptiveHost): boolean {
  const r = owner.special!.diddy!, p = params(owner);
  const pose = r.motion === 'SpecialSStick' ? 'CaptureWaitHi' : 'CaptureDamageHi';
  if (v.animation !== pose && v.content.clips.has(pose)) { v.animation = pose; v.animationFrame = 0; v.animationRate = 1; v.animationEpoch++; }
  else if (v.animationFrame >= clipEnd(v)) v.animationFrame = f32(v.animationFrame % clipEnd(v));
  if (v.grounded) {
    v.velocity = { x: 0, y: 0 };
    if (r.motion !== 'SpecialSStick') return true;
    v.combat.holdTimer = f32(v.combat.holdTimer - 1 - (mashed ? host.mash : 0));
    if (v.combat.holdTimer > 0) return true;
    breakOut(owner, v, host);
    return false;
  }
  // SpecialAirSStick*Taro_Phys: ftCommon_Fall(x4C, x50) and the aerial friction; Coll lands it.
  const friction = v.content.profile.attributes.airFriction;
  const vy = Math.max(-p.side.captiveTerminal, f32(v.velocity.y - p.side.captiveGravity));
  const vx = Math.abs(v.velocity.x) <= friction ? 0 : f32(v.velocity.x - Math.sign(v.velocity.x) * friction);
  const oldY = v.y, x = f32(v.x + vx), y = f32(v.y + vy);
  const floor = vy <= 0 ? host.floors.filter((candidate) => x >= Math.min(candidate.a[0], candidate.b[0]) && x <= Math.max(candidate.a[0], candidate.b[0]) && oldY >= floorY(candidate, x) - 0.01 && y <= floorY(candidate, x)).sort((a, b) => floorY(b, x) - floorY(a, x))[0] : undefined;
  v.x = x;
  if (floor) { v.y = floorY(floor, x); v.grounded = true; v.floor = floor.id; v.velocity = { x: 0, y: 0 }; }
  else { v.y = y; v.velocity = { x: vx, y: vy }; }
  return true;
}
/** SpecialS_BreakDetach: both take SpecialSStick's throw box 1 — Diddy knocked back off the way he
 * faces, the captive the other way — and Diddy leaves the captive's XRotN. */
function breakOut(owner: MatchFighter, v: MatchFighter, host: DiddyCaptiveHost): void {
  let hit: HitDefinition | undefined;
  for (const e of owner.content.timelines.get('SpecialSStick')?.events ?? []) if (e.type === 'throw-hit' && e.index === 1) hit = e.hit;
  owner.combat.partner = null; v.combat.partner = null;
  const joint = v.content.profile.partJoints[2] ?? v.content.profile.motionRoot;
  const point = host.poses.point(v, joint, [0, 0, 0]);
  owner.x = point[0]; owner.y = point[1]; owner.grounded = false; owner.floor = null;
  if (!hit) return;
  host.strike(v, owner, hit, point, -owner.facing);
  host.strike(owner, v, hit, point, owner.facing);
  owner.hitlag = 0; v.hitlag = 0;
}
/** Diddy's XRotN glued to the captive's (SpecialS_ThrowInit's lb_8000C1C0): the whole model moves
 * so the two joints coincide. */
export function glueDiddy(owner: MatchFighter, captive: MatchFighter, poses: PoseProvider): void {
  const theirs = poses.point(captive, captive.content.profile.partJoints[2] ?? captive.content.profile.motionRoot, [0, 0, 0]);
  const mine = poses.point(owner, owner.content.profile.partJoints[2] ?? owner.content.profile.motionRoot, [0, 0, 0]);
  owner.x = f32(owner.x + theirs[0] - mine[0]); owner.y = f32(owner.y + theirs[1] - mine[1]);
}

/** OnFrame: the ftDataDiddy xFC table retimes a few normals (the last entry the motion state has
 * reached wins). State ids are the common motion states those entries name. */
const RATE_STATES: Readonly<Record<number, string>> = {
  57: 'AttackLw3', 60: 'AttackS4S', 67: 'AttackAirB', 108: 'LightThrowF4', 109: 'LightThrowB4', 110: 'LightThrowHi4',
  112: 'LightThrowAirF4', 113: 'LightThrowAirB4', 114: 'LightThrowAirHi4', 219: 'ThrowF',
};
export function diddyAnimRate(f: MatchFighter): void {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Dd' || f.smash?.phase === 'charging') return;
  let rate: number | undefined;
  for (const entry of p.animRates) if (RATE_STATES[entry.state] === f.animation && f.animationFrame >= entry.frame) rate = entry.rate;
  if (rate !== undefined) f.animationRate = rate;
}

/** Trip_Enter / Trip_Anim on a rival who stepped on a grounded banana: MissFoot (the common trip
 * animation) from frame 3 with 0.4 of its speed, DownBoundU from frame 14. The knockdown's
 * DownWait/getup options are not ported: the fighter stands up (DownStandU) on its own. */
export interface TripState { phase: 'slip' | 'bound' | 'stand' }
export function tripFrames(v: MatchFighter): number {
  const clip = (name: string) => v.content.clips.get(name)?.endFrame ?? 0;
  return Math.max(1, Math.ceil(DIDDY_BANANA.tripBound - DIDDY_BANANA.tripStart + clip('DownBoundU') + clip('DownStandU')));
}
export function stepTrip(v: MatchFighter): void {
  const trip = v.trip; if (!trip) return;
  const next = (phase: TripState['phase'], animation: string) => { trip.phase = phase; v.animation = animation; v.animationFrame = 0; v.animationRate = 1; v.animationEpoch++; };
  if (trip.phase === 'slip' && v.animationFrame >= DIDDY_BANANA.tripBound) {
    if (v.content.clips.has('DownBoundU')) next('bound', 'DownBoundU'); else next('stand', 'DownWaitU');
  } else if (trip.phase === 'bound' && v.animationFrame >= clipEnd(v)) {
    if (v.content.clips.has('DownStandU')) next('stand', 'DownStandU');
  }
}
