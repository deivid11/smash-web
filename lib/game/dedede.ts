import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { DededeSpecialData } from './dedede-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

const params = (f: MatchFighter): DededeSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'De') throw new Error('Missing Dedede parameters.'); return p;
};
export interface DededeRuntime { charge: number }
export function dededeSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') {
    if (phase === 'travel') return air ? 'SpecialAirNLoop' : 'SpecialNLoop';
    if (phase === 'end') return air ? 'SpecialAirNEnd' : 'SpecialNEnd';
    return air ? 'SpecialAirNStart' : 'SpecialNStart';
  }
  if (direction === 'side') return air ? 'SpecialAirSStart' : 'SpecialSStart';
  if (direction === 'up') {
    if (phase === 'travel') return 'SpecialHiJump';
    if (phase === 'end') return 'SpecialHiLandingL';
    if (phase === 'hit') return 'SpecialHiLoop';
    return f.facing > 0 ? 'SpecialHiStartR' : 'SpecialHiStartL';
  }
  if (phase === 'travel') return air ? 'SpecialAirLw' : 'SpecialLw';
  if (phase === 'loop') return 'SpecialLwHold';
  if (phase === 'end') return 'SpecialLwEnd';
  return air ? 'SpecialAirLwStart' : 'SpecialLwStart';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = dededeSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginDededeSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.dedede = { charge: 0 };
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
  if (direction === 'side' && f.grounded) f.velocity.x = 0;
  if (direction === 'up') { f.velocity = { x: f.velocity.x, y: 0 }; }
}
export function landDededeSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'up') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.up.landing)); return true;
  }
  f.animation = dededeSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration; hitboxes/projectiles use the PlDe scripts.
 * N inhales in a holdable loop, S tosses one Gordo, Hi rises then slams,
 * Lw charges the hammer while held. */
export function stepDededeSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.dedede!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [voice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  if (s.direction === 'neutral') {
    if (s.phase === 'start') {
      if (end) phase(f, 'travel');
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (s.phase === 'travel') {
      if (s.released) phase(f, 'end');
      else if (end) phase(f, 'travel');
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (end) { finish(); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'side') {
    if (s.age === 10) out.shots.push({ player: f.slot, kind: 'dedede-gordo' });
    if (end) { finish(); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (end) {
        phase(f, 'travel');
        f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps;
        f.velocity = { x: f.velocity.x, y: p.up.riseSpeed };
      } else if (f.grounded) f.velocity = { x: 0, y: 0 };
      return out;
    }
    if (s.phase === 'travel') {
      if (f.velocity.y < 0.5) phase(f, 'hit');
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.7, a.terminal, 0);
      return out;
    }
    if (s.phase === 'hit') {
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 1.4, a.terminal, 0);
      if (f.grounded) { phase(f, 'end'); return out; }
      return out;
    }
    if (end) { finish(); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  // Jet Hammer: charge while held, release into the swing.
  if (s.phase === 'start') {
    if (end) phase(f, 'loop');
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.phase === 'loop') {
    r.charge = Math.min(p.down.chargeFrames, r.charge + 1);
    if (s.released) phase(f, 'travel');
    else if (end) phase(f, 'loop');
    if (f.grounded) f.velocity = { x: 0, y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.phase === 'travel') {
    const delta = rootDelta(f);
    if (Math.abs(delta.z) + Math.abs(delta.y) > 0.001) f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
    if (end) phase(f, 'end');
    return out;
  }
  if (end) { finish(false, p.down.landing); return out; }
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
function voice(p: DededeSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
