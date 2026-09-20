import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import type { ZeldaSpecialData } from './zelda-data.ts';
import { type SpecialRuntime, type SpecialStep } from './specials.ts';
import type { FighterKind } from './data.ts';

/** ftZd motion vars used by the prototype (Transform completes at Lw2 end). */
export interface ZeldaRuntime { reflect: boolean; fired: boolean; poseA: number; poseB: number; aimX: number; aimY: number; travelAge: number }
const f32 = Math.fround;
const params = (f: MatchFighter): ZeldaSpecialData => {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Zd') throw new Error('Missing Zelda parameters.');
  return p;
};
/** Part 89 joint (Din's muzzle) with a safe fallback chain. */
export function zeldaMuzzle(f: MatchFighter): number {
  for (const part of [89, 21]) {
    const joint = f.content.profile.partJoints[part];
    if (joint !== undefined && joint >= 0) return joint;
  }
  return f.content.profile.shieldBone;
}
export function zeldaSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') {
    if (phase === 'start') return air ? 'SpecialAirSStart' : 'SpecialSStart';
    if (phase === 'loop') return air ? 'SpecialAirSLoop' : 'SpecialSLoop';
    return air ? 'SpecialAirSEnd' : 'SpecialSEnd';
  }
  if (direction === 'up') {
    if (phase === 'start') return air || f.special?.startedAir ? 'SpecialAirHiStart' : 'SpecialHiStart';
    return air || f.special?.startedAir ? 'SpecialAirHi' : 'SpecialHi';
  }
  if (phase === 'end') return air ? 'SpecialAirLw2' : 'SpecialLw2';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = zeldaSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1;
  f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginZeldaSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f);
  s.zelda = { reflect: false, fired: false, poseA: p.side.poseMin, poseB: p.side.poseMax, aimX: 0, aimY: 0, travelAge: 0 };
  if (direction === 'neutral' && !f.grounded) f.velocity.x = f32(f.velocity.x / p.neutral.airDivisor);
  if (direction === 'side' && !f.grounded) f.velocity.y = 0;
  if (direction === 'up') {
    f.velocity = { x: 0, y: 0 };
    f.jumpsUsed = f.content.profile.attributes.maxJumps;
  }
  if (direction === 'down') {
    f.velocity.x = f32(f.velocity.x / p.down.divX);
    f.velocity.y = f32(f.velocity.y / p.down.divY);
  }
}
/** Nayru's reflector state lives in the Zelda runtime (latched, not script-polled). */
export function stepZeldaSpecial(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, r = s.zelda!, p = params(f), a = f.content.profile.attributes;
  const result: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const ordinary = (gravity = a.gravity, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, a.terminal, friction);
  };
  const gather = () => { const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame; return events; };
  if (s.direction === 'neutral') {
    if (ended()) { finish(false, 0, 1); return result; }
    // Nayru's Love: cmd0==1 latches the reflector for the rest of the spin.
    if (gather().some((e) => e.type === 'command' && e.index === 0 && e.value === 1)) r.reflect = true;
    ordinary(f.grounded ? 0 : p.neutral.airGravity);
    if (f.grounded) f.velocity.y = 0;
  } else if (s.direction === 'side') {
    if (s.phase === 'start') {
      if (gather().some((e) => e.type === 'command' && e.index === 0 && e.value === 1) && !r.fired) {
        r.fired = true;
        result.shots.push({ player: f.slot, kind: 'dins-fire' });
      }
      if (ended()) phase(f, 'loop');
      ordinary();
    } else if (s.phase === 'loop') {
      if (r.poseA > 0) r.poseA--;
      if (r.poseB > 0) r.poseB--;
      // Release ends Zelda's pose; the fire continues unguided. Minimum pose
      // timers (x10/x14) only matter once the fire is gone (tracked by stepper).
      if (!input.special) { phase(f, 'end'); return result; }
      if (ended()) phase(f, 'loop');
      ordinary();
    } else if (ended()) { finish(false, 0, 1); return result; }
    else ordinary();
  } else if (s.direction === 'up') {
    if (s.phase === 'start' && ended()) {
      // Farore's aim: stick beyond the threshold picks the teleport vector.
      const mag = Math.min(1, Math.hypot(input.x, input.y ?? 0));
      if (mag >= p.up.stickThreshold && (Math.abs(input.x) > 0.001 || Math.abs(input.y ?? 0) > 0.001)) {
        const angle = Math.atan2(input.y ?? 0, input.x * f.facing);
        const dist = f32(p.up.distSlope * mag + p.up.distBase);
        r.aimX = f32(Math.cos(angle) * dist); r.aimY = f32(Math.sin(angle) * dist);
        if (Math.abs(input.x) > 0.001) f.facing = input.x > 0 ? 1 : -1;
      } else {
        r.aimX = 0; r.aimY = f32(p.up.distSlope + p.up.distBase);
      }
      phase(f, 'travel');
      f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps;
    } else if (s.phase === 'travel') {
      r.travelAge++;
      // Invisible teleport ride at the aimed velocity for the vanish frames.
      f.velocity = { x: f32(r.aimX / Math.max(1, p.up.travelFrames)), y: f32(r.aimY / Math.max(1, p.up.travelFrames)) };
      if (ended()) f.animationRate = 0;
      if (r.travelAge >= p.up.travelFrames) { f.animationRate = 1; finish(true, p.up.landing, p.up.mobility); return result; }
    }
    result.handled = true;
  } else {
    // Transform: Lw spins down divisors, Lw2 completes the swap at clip end.
    if (s.phase === 'start' && ended()) phase(f, 'end');
    else if (s.phase === 'end' && ended()) {
      const target: FighterKind = f.content.profile.kind === 'Zd' ? 'Sk' : 'Zd';
      return { handled: true, shots: [], sounds: [], transform: target };
    }
    ordinary();
  }
  return result;
}
export function landZeldaSpecial(f: MatchFighter, finish: (helpless: boolean, lag: number, mobility: number) => void): boolean {
  const s = f.special; if (!s) return false;
  const p = params(f);
  if (s.direction === 'up') {
    finish(false, 0, 1); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.ceil(p.up.landing);
    return true;
  }
  f.animation = zeldaSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
