import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { NintenSpecialData } from './ninten-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep } from './specials.ts';

const params = (f: MatchFighter): NintenSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Nt') throw new Error('Missing Ninten parameters.'); return p;
};
export interface NintenRuntime { charge: number }
export function nintenSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') {
    if (phase === 'travel') return air ? 'SpecialAirNEnd' : 'SpecialNEnd';
    if (phase === 'loop') return air ? 'SpecialAirNHold' : 'SpecialNHold';
    return air ? 'SpecialAirNStart' : 'SpecialNStart';
  }
  if (direction === 'side') return air ? 'SpecialAirS' : 'SpecialS';
  if (direction === 'up') {
    if (phase === 'travel') return 'SpecialHi';
    if (phase === 'end') return air ? 'SpecialAirHiEnd' : 'SpecialHiEnd';
    return air ? 'SpecialAirHiStart' : 'SpecialHiStart';
  }
  if (phase === 'travel') return air ? 'SpecialAirLwHit' : 'SpecialLwHit';
  if (phase === 'end') return air ? 'SpecialAirLwEnd' : 'SpecialLwEnd';
  if (phase === 'loop') return air ? 'SpecialAirLwHold' : 'SpecialLwHold';
  return air ? 'SpecialAirLwStart' : 'SpecialLwStart';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = nintenSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginNintenSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.ninten = { charge: 0 };
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
}
export function landNintenSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'up') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.up.landing)); return true;
  }
  f.animation = nintenSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration (Ness-shared kit). Hypnosis holds with no direct
 * damage (sleep pending); Slingshot fires on flag-24; Thunder rockets into
 * helpless (guided ball pending); Magnet holds the absorb bubble. */
export function stepNintenSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [voice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  if (s.direction === 'neutral') {
    if (s.phase === 'start') {
      if (end) phase(f, 'loop');
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (s.phase === 'loop') {
      if (s.released) phase(f, 'travel');
      else if (end) phase(f, 'loop');
      if (f.grounded) f.velocity = { x: 0, y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (end) { finish(); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'side') {
    if (events.some((e) => e.type === 'flag' && e.flag === 24)) out.shots.push({ player: f.slot, kind: 'ninten-pellet' });
    if (end) { finish(); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (end) phase(f, 'travel');
      if (f.grounded) f.velocity = { x: 0, y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (s.phase === 'travel') {
      if (f.stateFrame <= 2) { f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; f.velocity = { x: f.velocity.x, y: p.up.riseSpeed }; }
      if (f.stateFrame >= 45 || end) { finish(true, p.up.landing, p.up.mobility); return out; }
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.6, a.terminal, 0);
      return out;
    }
    if (end) { finish(true, p.up.landing, p.up.mobility); return out; }
    f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.phase === 'start') {
    if (end) phase(f, 'loop');
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.phase === 'loop') {
    if (s.released) phase(f, 'end');
    else if (end) phase(f, 'loop');
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.5, a.terminal, a.airFriction);
    return out;
  }
  if (end) { finish(); return out; }
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
function voice(p: NintenSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
