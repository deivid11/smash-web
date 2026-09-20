import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { TailsSpecialData } from './tails-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep, SpecialWorld } from './specials.ts';
import { beginSonicSpecial, landSonicSpecial, sonicSpecialName, stepSonicSpecial } from './sonic.ts';

/** PlTs motion states 341–373 for the three specials that are Tails' own (the down special is
 * Sonic's spin charge on lib/game/sonic.ts). Each branch is named after the callback it ports;
 * SpecialHi_Cancel (347) is never entered by the compiled code. */
export type TailsState = 'N' | 'SStart' | 'SLoop' | 'SEnd' | 'HiStart' | 'HiLoop' | 'HiExhaust';
/** state_var block: spin tier (state_var1) and loop count (state_var3), the shot latch (flag0),
 * helicopter boost frames (state_var3). */
export interface TailsRuntime { state: TailsState; tier: number; loops: number; shot: boolean; boost: number }

const f32 = Math.fround;
const params = (f: MatchFighter): TailsSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Ts') throw new Error('Missing Tails parameters.'); return p;
};
const PHASE: Record<TailsState, SpecialRuntime['phase']> = { N: 'start', SStart: 'start', SLoop: 'loop', SEnd: 'end', HiStart: 'start', HiLoop: 'travel', HiExhaust: 'end' };
function stateAnimation(state: TailsState, air: boolean, r: TailsRuntime): string {
  switch (state) {
    case 'N': return air ? 'SpecialAirN' : 'SpecialN';
    case 'SStart': return air ? 'SpecialAirSStart' : 'SpecialSStart';
    case 'SLoop': return `${air ? 'SpecialAirSLoop' : 'SpecialSLoop'}${r.tier + 1}`;
    case 'SEnd': return air ? 'SpecialAirSEnd' : 'SpecialSEnd';
    case 'HiStart': return air ? 'SpecialAirHiEnter' : 'SpecialHiEnter';
    case 'HiLoop': return 'SpecialHiLoop';
    case 'HiExhaust': return 'SpecialHiExhaust';
  }
}
export function tailsSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  if (direction === 'down') return sonicSpecialName(f, direction, phase);
  const r = f.special?.tails;
  if (r) return stateAnimation(r.state, !f.grounded, r);
  if (direction === 'neutral') return f.grounded ? 'SpecialN' : 'SpecialAirN';
  if (direction === 'side') return f.grounded ? 'SpecialSStart' : 'SpecialAirSStart';
  return f.grounded ? 'SpecialHiEnter' : 'SpecialAirHiEnter';
}
/** ActionStateChange into a fresh state (frame 0) or, for the air/ground swaps, the same frame. */
function enter(f: MatchFighter, state: TailsState, frame = 0, rate = 1): void {
  const s = f.special!, r = s.tails!;
  r.state = state; s.phase = PHASE[state]; s.lastFrame = frame - 1;
  f.animation = stateAnimation(state, !f.grounded, r); f.attackName = f.animation;
  f.animationFrame = frame; f.stateFrame = 0; f.animationRate = rate; f.animationEpoch++;
  f.attackSerial++; f.victims.clear();
}
const setAirborne = (f: MatchFighter) => { f.grounded = false; f.floor = null; };
const clipEnd = (f: MatchFighter) => Math.max(1, f.content.clips.get(f.animation)?.endFrame ?? 1);
/** ftCommon_ApplyFrictionGround: slow toward rest by a flat amount per frame. */
const groundFriction = (v: number, friction: number) => Math.abs(v) <= friction ? 0 : f32(v - Math.sign(v) * friction);
/** ftCommon_8007C98C: accelerate the ground speed toward `target`; past it, bleed by `friction`. */
function approach(v: number, accel: number, target: number, friction: number): number {
  if (target === 0) return groundFriction(v, friction);
  if (v * accel < 0) return f32(v + accel);
  if (accel > 0 ? v + accel <= target : v + accel >= target) return f32(v + accel);
  // Past the target: brake by the fighter's friction, never below it.
  return accel > 0 ? f32(Math.max(target, v - friction)) : f32(Math.min(target, v + friction));
}
/** Fuel left on the helicopter meter (ft_var32): the fighter stores what has been burnt since landing. */
export const tailsFuel = (f: MatchFighter): number => params(f).up.landFuel - f.tailsFuelUsed;
/** OnLanding / ResetAttributes: every landing refills the helicopter to x3C. */
export function tailsOnLanding(f: MatchFighter): void { if (f.content.profile.kind === 'Ts') f.tailsFuelUsed = 0; }
/** SpecialHi_OnHit (take_dmg_cb/death2_cb during the helicopter): a hit leaves exactly x44 fuel. */
export function tailsOnInterrupted(f: MatchFighter): void {
  const r = f.special?.tails;
  if (f.content.profile.kind === 'Ts' && r && (r.state === 'HiStart' || r.state === 'HiLoop' || r.state === 'HiExhaust')) {
    const up = params(f).up; f.tailsFuelUsed = up.landFuel - up.hitFuel;
  }
}
export function beginTailsSpecial(f: MatchFighter, direction: SpecialDirection): void {
  if (direction === 'down') { beginSonicSpecial(f, direction); return; }
  const s = f.special!, p = params(f);
  s.tails = { state: 'N', tier: 0, loops: 0, shot: false, boost: 0 };
  if (direction === 'neutral') {
    // SpecialN_OnEnter: flag0 cleared, vertical speed scaled by x10 (both SpecialN_Enter paths).
    f.velocity.y = f32(f.velocity.y * p.neutral.entryRise);
    s.tails.state = 'N';
  } else if (direction === 'side') {
    // SpecialS_EnterAirOrGround: 0x168 / 0x16F with no speed change; loop count and tier reset.
    s.tails.state = 'SStart';
  } else {
    // SpecialHi_EnterAirOrGround: 0x157 / 0x158, Fighter_KillAllVelocity.
    s.tails.state = 'HiStart'; f.velocity = { x: 0, y: 0 };
  }
  s.phase = PHASE[s.tails.state];
}
export function landTailsSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!;
  if (s.direction === 'down') return landSonicSpecial(f, finish);
  const r = s.tails!, p = params(f);
  // SpecialHi_Loop_Coll / SpecialHi_Exhaust_Coll: Fighter_EnterSpecialLanding(x2C).
  if (r.state === 'HiLoop' || r.state === 'HiExhaust') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, p.up.landing); return true;
  }
  // Every other aerial state lands into its ground twin keeping the frame (the *_Trans helpers).
  f.velocity.y = 0;
  f.animation = stateAnimation(r.state, false, r); f.attackName = f.animation; return true;
}
/** Tails' neutral (tail swipe + shot), rolling spin and fuel helicopter, ported from PlTs; the down
 * special delegates to Sonic's spin charge on Tails' own attribute block. */
export function stepTailsSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics,
  finish: (helpless?: boolean, lag?: number, mobility?: number) => void, world?: SpecialWorld): SpecialStep {
  const s = f.special!;
  if (s.direction === 'down') return stepSonicSpecial(f, input, pressed, physics, finish, world);
  const p = params(f), r = s.tails!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  // SpecialN_Enter / SpecialAirN_Enter do nothing while the previous shot lives (ft_var1).
  if (s.age === 0 && r.state === 'N' && world?.tailsShotOut) { finish(); return out; }
  if (s.age === 0) out.sounds.push(s.direction === 'neutral' ? p.neutral.voice : s.direction === 'side' ? p.side.voice : p.up.voice);
  s.age++;
  const done = f.animationFrame >= clipEnd(f);
  const commands = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.type === 'command' && e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  switch (r.state) {
    case 'N':
      // SpecialN_Accessory: script command 0 spawns the shot; airborne, it also pops him up by xC.
      if (!r.shot && commands.some((e) => e.type === 'command' && e.index === 0 && e.value === 1)) {
        r.shot = true; out.shots.push({ player: f.slot, kind: 'tails-shot' });
        if (!f.grounded) f.velocity.y = p.neutral.shotRise;
      }
      if (done) { finish(); return out; }
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      // SpecialAirN_Phys: DecayXVelocity(x0), ApplyGravity(x4, x8).
      else f.velocity = physics.customAir(f.slot, f.velocity, p.neutral.gravity, p.neutral.terminal, p.neutral.airFriction);
      return out;
    case 'SStart':
      if (done) {
        // SpecialS_Start_Anim: loop at x start speed; the aerial start keeps x·xD0 and rises by xDC.
        const air = !f.grounded;
        r.tier = 0; r.loops = 0; enter(f, 'SLoop', 0, p.side.loopRate);
        f.velocity = air ? { x: f32(f.velocity.x * p.side.airStartMul), y: p.side.airStartRise } : { x: f32(p.side.startSpeed * f.facing), y: 0 };
        return out;
      }
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    case 'SLoop':
      if (done) {
        // SpecialS_Loop_Anim: count the loop; past x90 end, else the next tier from fmod(frame, x94).
        r.loops++;
        if (r.loops >= p.side.loops) { enter(f, 'SEnd'); return out; }
        r.tier = (r.tier + 1) % 5;
        enter(f, 'SLoop', f32(f.animationFrame % p.side.loopWrap), p.side.loopRate);
      }
      // SpecialS_Loop_IASA: letting go of B ends the spin.
      if (!input.special) { enter(f, 'SEnd'); return out; }
      if (f.grounded) {
        // SpecialS_Loop_Phys: a held stick accelerates toward its side, otherwise xC8 friction.
        const x = input.x;
        if (Math.abs(x) >= 0.1) {
          const dir = x > 0 ? 1 : -1;
          f.velocity = { x: approach(f.velocity.x, f32(dir * p.side.accel + x * p.side.stickAccel), f32(dir * p.side.maxSpeed), a.friction), y: 0 };
        } else f.velocity = { x: groundFriction(f.velocity.x, p.side.idleFriction), y: 0 };
      } else {
        // SpecialAirS_Loop_Phys: gravity xE0 capped at xE4, then the custom drift xD4/xD8.
        f.velocity = physics.customAir(f.slot, f.velocity, p.side.loopGravity, p.side.loopTerminal, 0);
        f.velocity = physics.controlledDrift(f.slot, f.velocity, input.x, p.side.airDriftAccel, p.side.airDriftMax);
      }
      return out;
    case 'SEnd':
      if (f.grounded) {
        if (done) { finish(); return out; }
        f.velocity = { x: groundFriction(f.velocity.x, p.side.endFriction), y: 0 };
      } else {
        // SpecialAirS_End_Anim: special fall (xFC drift, x100 landing).
        if (done) { finish(true, p.side.fallLanding, p.side.fallMobility); return out; }
        f.velocity = physics.customAir(f.slot, f.velocity, p.side.endGravity, a.terminal, 0);
        f.velocity = physics.controlledDrift(f.slot, f.velocity, input.x, p.side.endDriftAccel, p.side.endDriftMax);
      }
      return out;
    case 'HiStart':
      if (done) {
        // SpecialHi_Loop_Enter: airborne and still, fuel topped up to x38, x30 boost frames.
        setAirborne(f); r.boost = p.up.boostFrames;
        f.tailsFuelUsed = Math.min(f.tailsFuelUsed, p.up.landFuel - p.up.minFuel);
        enter(f, 'HiLoop'); f.velocity = { x: 0, y: 0 };
        // SpecialHi_Loop_Phys runs on this very frame: the first boost lifts him before the
        // collision pass could land a grounded start straight back.
        return stepTailsSpecialLoop(f, input, pressed, physics, p, r, out);
      }
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      // SpecialAirHi_Start_Phys: aerial friction, gravity 0.02.
      else f.velocity = physics.customAir(f.slot, f.velocity, 0.02, a.terminal, a.airFriction);
      return out;
    case 'HiLoop':
      if (done) { f.animationFrame = 0; s.lastFrame = -1; f.attackSerial++; f.victims.clear(); }
      return stepTailsSpecialLoop(f, input, pressed, physics, p, r, out);
    case 'HiExhaust':
      if (done) f.animationFrame = f32(f.animationFrame % clipEnd(f));
      // SpecialHi_Exhaust_Phys: x74 gravity capped at x78, drift x7C/x80.
      f.velocity = physics.customAir(f.slot, f.velocity, p.up.exhaustGravity, p.up.exhaustTerminal, 0);
      f.velocity = physics.controlledDrift(f.slot, f.velocity, input.x, p.up.exhaustDriftAccel, p.up.exhaustDriftMax);
      turn(f, input);
      return out;
  }
}
/** SpecialHi_Loop_Phys: holding B burns x40 fuel a frame to climb (x50, x58 while boosted); a fresh
 * press adds x5C, x30 boost frames and costs x60; vy caps at x54. Released, he glides on x64/x68. */
function stepTailsSpecialLoop(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, p: TailsSpecialData, r: TailsRuntime, out: SpecialStep): SpecialStep {
  if (!input.special && r.boost <= 0) {
    f.velocity = physics.customAir(f.slot, f.velocity, p.up.glideGravity, p.up.glideTerminal, 0);
    f.animationRate = 1;
  } else {
    f.tailsFuelUsed += p.up.burn;
    let vy = f32(f.velocity.y + (r.boost > 0 ? p.up.boostRise : p.up.rise));
    if (input.special && pressed) { vy = f32(vy + p.up.tapBoost); r.boost = p.up.boostFrames; f.tailsFuelUsed += p.up.tapCost; }
    f.velocity.y = Math.min(vy, p.up.maxRise);
    if (r.boost > 0) r.boost--;
    f.animationRate = p.up.heldRate;
  }
  if (tailsFuel(f) > 0) {
    f.velocity = physics.controlledDrift(f.slot, f.velocity, input.x, p.up.driftAccel, p.up.driftMax);
    turn(f, input);
  } else enter(f, 'HiExhaust');
  return out;
}
/** SpecialHi_RotateToFacingDirection: a stick past ±0.5 against the facing turns him around. */
function turn(f: MatchFighter, input: PlayerInput): void {
  if (f.facing === 1 && input.x < -0.5) f.facing = -1;
  else if (f.facing === -1 && input.x > 0.5) f.facing = 1;
}
