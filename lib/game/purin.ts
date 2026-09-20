import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { PurinSpecialData } from './purin-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { ActiveHit } from './moves.ts';
import { command, rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** ftPurin_MotionVars.specialn, snapshot-owned. `roll` is the visual x14 roll angle,
 * `dir` the x34.x roll direction, `timer` the x0 release counter, `charge` x2C,
 * `speed` the x18 |velocity| memory and `turnRef` the x10 turn reference velocity. */
export interface PurinRuntime {
  charge: number; timer: number; roll: number; lastRoll: number; dir: number;
  speed: number; turnRef: number; slopeSeed: number; full: boolean; turning: boolean; pendingFacing: number;
}
const f32 = Math.fround;
const params = (f: MatchFighter): PurinSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Pr') throw new Error('Missing Jigglypuff parameters.'); return p;
};
export function purinSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir', r = f.special?.purin;
  const side = (dir: number) => (dir < 0 ? 'L' : 'R');
  if (direction === 'neutral') {
    if (phase === 'start') return `${prefix}NStart${side(f.facing)}`;
    if (phase === 'loop') return `${prefix}N${r?.full ? 'Full' : 'Loop'}`;
    if (phase === 'travel') return r?.turning ? `${prefix}NTurn` : `${prefix}NRelease`;
    if (phase === 'hit') return 'SpecialNHit';
    return `${prefix}NEnd${side(r?.dir ?? f.facing)}`;
  }
  if (direction === 'side') return f.grounded ? 'SpecialS' : 'SpecialAirS';
  if (direction === 'up') return `${prefix}Hi${side(f.facing)}`;
  return `${prefix}Lw${side(f.facing)}`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase'], keepFrame = false, rate = 1): void {
  const s = f.special!, frame = f.animationFrame; s.phase = next; s.lastFrame = -1;
  f.animation = purinSpecialName(f, s.direction, next); f.animationFrame = keepFrame ? frame : 0;
  f.animationRate = rate; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
/** The charge/release/turn states all share the SpecialN figatree; swapping the ground/air
 * key keeps the frozen frame so ledge walk-offs and landings never restart the roll. */
function rename(f: MatchFighter): void {
  const s = f.special!, frame = f.animationFrame, rate = f.animationRate;
  f.animation = purinSpecialName(f, s.direction, s.phase); f.animationFrame = frame; f.animationRate = rate; f.animationEpoch++;
  f.attackName = f.animation;
}
export function beginPurinSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), s = f.special!;
  s.purin = { charge: p.rollout.chargeInitial, timer: p.rollout.releaseFrames, roll: 0, lastRoll: 0, dir: f.facing, speed: 0, turnRef: 0, slopeSeed: f.grounded ? p.rollout.groundSeed : p.rollout.airSeed, full: false, turning: false, pendingFacing: 0 };
  if (direction === 'neutral') { f.velocity = { x: f.grounded ? 0 : f.velocity.x, y: 0 }; }
}
/** ftPr_SpecialS_8013D8E4: the roll hit only exists above a speed floor and its damage is
 * recomputed from the current speed every frame. The turn and post-hit states deal nothing. */
export function purinHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  if (f.content.profile.kind !== 'Pr' || f.special?.direction !== 'neutral') return hits;
  const s = f.special, r = s.purin;
  if (!r || s.phase !== 'travel' || r.turning) return s?.phase === 'hit' ? [] : hits;
  const speed = Math.abs(f.velocity.x);
  if (speed < params(f).rollout.minHitVel) return [];
  const damage = Math.max(1, Math.trunc(params(f).rollout.damageMul * (params(f).rollout.damageBase + speed)));
  return hits.map(hit => ({ ...hit, damage }));
}
/** ftPr_SpecialS_8013D764: a landed roll hit recoils into SpecialNHit and eats release time. */
export function purinHitLanded(f: MatchFighter): void {
  if (f.content.profile.kind !== 'Pr' || f.special?.direction !== 'neutral' || f.special.phase !== 'travel' || f.special.purin?.turning) return;
  const p = params(f), s = f.special, r = s.purin!;
  r.timer -= p.rollout.hitDecrement;
  if (f.grounded) f.velocity = { x: f32(f.velocity.x * p.rollout.recoil.x), y: p.rollout.recoil.y };
  else f.velocity = { x: f32(f.velocity.x * p.rollout.recoil.x), y: p.rollout.recoil.y };
  f.grounded = false; f.floor = null;
  phase(f, 'hit', true);
}
function releaseVelocity(f: MatchFighter, p: PurinSpecialData): number {
  const r = f.special!.purin!;
  let vel = f32(r.dir * (p.rollout.velPerCharge * (r.charge - p.rollout.chargeMin)));
  vel = Math.sign(vel) * Math.min(Math.abs(vel), p.rollout.maxVel, p.rollout.maxVelHard);
  return f32(vel);
}
function beginEnd(f: MatchFighter, p: PurinSpecialData): void {
  const r = f.special!.purin!;
  r.turning = false;
  if (r.pendingFacing) { f.facing = r.pendingFacing; r.pendingFacing = 0; } else f.facing = r.dir;
  if (f.grounded) { f.velocity = { x: f32(f.velocity.x * p.rollout.endGroundMul), y: 0 }; }
  else f.velocity = { x: f32(f.velocity.x * p.rollout.endGroundMul), y: f32(f.velocity.y * p.rollout.endAirYMul) };
  phase(f, 'end');
}
export function landPurinSpecial(f: MatchFighter, finish: () => void): boolean {
  const p = params(f), s = f.special!, r = s.purin!;
  if (s.direction === 'neutral') {
    if (s.phase === 'travel' && !r.turning) {
      // ftPr_SpecialAirNChargeRelease_Coll: bounce until the damped fall is small enough.
      const bounced = f32(Math.abs(f.velocity.y * p.rollout.bounceMul));
      if (bounced >= p.rollout.bounceThreshold) { f.velocity.y = bounced; f.grounded = false; f.floor = null; return true; }
      f.velocity = { x: f32(r.speed * r.dir), y: 0 }; r.slopeSeed = p.rollout.groundSeed;
      rename(f); return true;
    }
    if (s.phase === 'hit') {
      finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
      f.landingFrames = Math.max(1, Math.ceil(p.rollout.landingLag)); return true;
    }
    rename(f); return true;
  }
  rename(f); return true;
}
/** Original ftPr orchestration over the prototype floor solver. The native JObj scale pop
 * and the alternating capsule parity of the release states are visual details left unported. */
export function stepPurinSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.purin!, a = f.content.profile.attributes, ro = p.rollout;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter(e => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  const fall = (gravity = ro.gravity, terminal = ro.terminal) => { if (!f.grounded) f.velocity = physics.customAir(f.slot, f.velocity, gravity, terminal, 0); };
  const spin = (delta: number) => {
    r.lastRoll = r.roll; r.roll += delta;
    while (r.roll < 0) r.roll += Math.PI * 2;
    while (r.roll > Math.PI * 2) r.roll -= Math.PI * 2;
  };
  if (s.direction === 'neutral') {
    if (s.phase === 'start') {
      if (end) { phase(f, 'loop', false, 0); f.velocity.x = f32(f.facing * 0.0001); }
      else if (f.grounded) f.velocity = { x: 0, y: 0 };
      else fall();
      return out;
    }
    if (s.phase === 'loop') {
      r.charge = f32(r.charge + ro.chargeRate);
      if (r.charge >= ro.chargeMax) {
        r.charge = ro.chargeMax;
        if (!r.full) { r.full = true; f.animation = purinSpecialName(f, 'neutral', 'loop'); f.attackName = f.animation; out.sounds.push(250068); }
      }
      spin(r.dir * r.charge * (Math.PI / 180) * ro.rollDegRate);
      if (f.grounded) f.velocity = { x: f32(f.facing * 0.0001), y: 0 }; else fall();
      if (s.released) {
        r.dir = f.facing;
        phase(f, 'travel');
        f.velocity.x = f32(r.dir * ro.velPerCharge * (r.charge - ro.chargeInitial));
        r.speed = Math.abs(f.velocity.x);
        r.slopeSeed = f.grounded ? ro.groundSeed : ro.airSeed;
        out.sounds.push(250073);
      }
      return out;
    }
    if (s.phase === 'travel') {
      if (r.turning) {
        // ftPr_SpecialNTurn_Phys: a constant xC4-scaled brake (x1C = -0.05·turn velocity)
        // reverses gr_vel; the turn ends once it crosses the x10·xD0 reference ratio.
        spin(0.2 * ro.turnRollRate * -r.dir * (f.grounded ? 1 : ro.airRateMul));
        r.timer -= 1;
        if (r.timer <= 0) { r.dir = -r.dir; beginEnd(f, p); return out; }
        if (f.grounded) {
          f.velocity.x = f32(f.velocity.x + f32(ro.turnTraction * r.slopeSeed));
          if (Math.sign(f.velocity.x) === -Math.sign(r.turnRef) && Math.abs(f.velocity.x) >= Math.abs(r.turnRef * ro.turnEndRatio)) {
            r.turning = false;
            if (r.pendingFacing) { r.dir = r.pendingFacing; f.facing = r.pendingFacing; r.pendingFacing = 0; }
            rename(f);
          }
        } else { f.velocity.x = f32(f.velocity.x - Math.sign(f.velocity.x) * ro.airDecel); fall(); }
        return out;
      }
      // ftPr_SpecialNRelease_IASA: a hard opposite stick starts the braking turn.
      if (Math.abs(input.x) > ro.turnStick) {
        const dir = Math.sign(input.x);
        if (dir !== r.dir) {
          r.turning = true; r.pendingFacing = dir; r.turnRef = f.velocity.x; r.slopeSeed = f32(-0.05 * f.velocity.x); r.timer = Math.max(r.timer, 1);
          rename(f); out.sounds.push(250073);
          return out;
        }
      }
      // Native wall rebound (xD4) is unported: the shared surface blocker already stops the roll.
      if (f.grounded) {
        f.velocity = { x: releaseVelocity(f, p), y: 0 };
        r.speed = Math.abs(f.velocity.x);
        spin((r.charge * Math.PI / 180) * (0.2 * ro.releaseRollRate) * r.dir);
        if (Math.abs(r.roll - r.lastRoll) > Math.PI) out.sounds.push(250064); // One roll SFX per full rotation wrap.
      } else {
        f.velocity.x = f32(releaseVelocity(f, p) - Math.sign(r.dir) * ro.airDecel);
        if (Math.abs(f.velocity.x) < ro.airMinSpeed) f.velocity.x = f32(Math.sign(f.velocity.x || r.dir) * ro.airMinSpeed);
        r.speed = Math.abs(f.velocity.x);
        fall();
        spin((0.2 * ro.releaseRollRate * r.dir) * (Math.PI / 180) * r.charge * ro.airRateMul);
      }
      r.charge = f32(r.charge - ro.chargeDecay);
      r.timer -= 1;
      if (r.charge < ro.chargeMin) { beginEnd(f, p); return out; }
      if (r.timer <= 0) {
        // Native: the roll only stops once the angle crosses the upright π boundary.
        const crossed = (r.roll > Math.PI) !== (r.lastRoll > Math.PI) && r.roll > Math.PI / 2 && r.roll < Math.PI * 1.5;
        if (crossed) { beginEnd(f, p); return out; }
      }
      return out;
    }
    if (s.phase === 'hit') {
      spin((0.2 * ro.turnRollRate * -r.dir) * ro.airRateMul);
      fall();
      if (end && f.grounded) { finish(); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.max(1, Math.ceil(ro.landingLag)); }
      return out;
    }
    // End.
    if (end) {
      if (f.grounded) { finish(); return out; }
      finish(true, ro.landingLag, 1); return out;
    }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; else fall();
    return out;
  }
  if (s.direction === 'side') {
    if (end) { finish(); return out; }
    if (f.grounded) { const delta = rootDelta(f); f.velocity = { x: physics.motion(f.slot, delta.z, 0, f.facing).x, y: 0 }; return out; }
    // ftPr_SpecialAirS_Phys: cmd 0 boosts along the clamped stick angle; cmd 1 selects decay.
    if (events.some(e => e.type === 'command' && e.index === 0 && e.value >= 1)) {
      const y = input.y ?? (input.down ? -1 : 0);
      let tilt = Math.min(Math.abs(y), p.pound.stickMax) - p.pound.stickMin;
      if (tilt < 0) tilt = 0;
      if (y < 0) tilt = -tilt;
      const angle = (Math.PI / 180) * (tilt * p.pound.angle / (p.pound.stickMax - p.pound.stickMin));
      f.velocity = { x: f32(p.pound.boost * f.facing * Math.cos(angle)), y: f32(p.pound.boost * Math.sin(angle)) };
    }
    const mode = command(f, 1);
    if (mode === 1) f.velocity = { x: f32(f.velocity.x * p.pound.decay), y: f32(f.velocity.y * p.pound.decay) };
    else if (mode === 2) f.velocity = physics.air(f.slot, f.velocity, input.x, false);
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
    return out;
  }
  // Sing and Rest: script-owned hits (Sing carries the sleep element); no motion beyond
  // ground friction and ordinary falls. Rest's invulnerability comes from its own script.
  if (end) { finish(); return out; }
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
