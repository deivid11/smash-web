import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { FaySpecialData } from './fay-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep } from './specials.ts';

const params = (f: MatchFighter): FaySpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Fy') throw new Error('Missing Fay parameters.'); return p;
};
export interface FayRuntime { fired: boolean }
export function faySpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirNBlaster' : 'SpecialNBlaster';
  if (direction === 'side') {
    if (phase === 'loop') return air ? 'SpecialAirSHoldLoop' : 'SpecialSHoldLoop';
    if (phase === 'end') return air ? 'SpecialAirSHoldEnd' : 'SpecialSHoldEnd';
    if (phase === 'travel') return air ? 'SpecialAirS' : 'SpecialS';
    return air ? 'SpecialAirSHoldStart' : 'SpecialSHoldStart';
  }
  if (direction === 'up') {
    if (phase === 'travel') return 'SpecialHi';
    return air ? 'SpecialHiHoldAir' : 'SpecialHiHold';
  }
  if (phase === 'travel') return air ? 'SpecialAirLwHit' : 'SpecialLwHit';
  if (phase === 'end') return air ? 'SpecialAirLwEnd' : 'SpecialLwEnd';
  if (phase === 'loop') return air ? 'SpecialAirLwLoop' : 'SpecialLwLoop';
  return air ? 'SpecialAirLwStart' : 'SpecialLwStart';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = faySpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginFaySpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.fay = { fired: false };
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
  // Tap-S enters travel (quick SpecialS); held-S enters the Hold charge below.
  if (direction === 'side' && f.special!.phase === 'start' && !f.grounded) { /* air hold stays airborne */ }
}
export function landFaySpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'up' || (s.direction === 'side' && s.phase !== 'start')) {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(s.direction === 'up' ? p.up.landing : p.side.landing)); return true;
  }
  f.animation = faySpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration; shots use the PlFy flag-24 events (fireball
 * convention). N fires the Blaster; S taps the quick shot and held-S fires the
 * 15% Sniper off SHoldStart's flag; Hi rises into helpless; Lw holds the
 * Fox-down-style reflector. NSniper/AirNSniper stay unmapped pending their
 * trigger research. */
export function stepFaySpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  void pressed;
  const p = params(f), s = f.special!, r = s.fay!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [voice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  const flag24 = events.some((e) => e.type === 'flag' && e.flag === 24);
  if (s.direction === 'neutral') {
    if (!r.fired && flag24) { r.fired = true; out.shots.push({ player: f.slot, kind: 'fay-laser' }); }
    if (end) { finish(); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'side') {
    // Tap-S diverts to travel (quick SpecialS, flag-24 at 22f); held-S rides
    // Start→Loop→End with the Sniper leaving on SHoldStart's flag-24 at 34f.
    if (s.phase === 'start') {
      if (s.released) { phase(f, 'travel'); return out; }
      if (end) phase(f, 'loop');
    } else if (s.phase === 'loop') {
      if (s.released) phase(f, 'end');
      else if (end) phase(f, 'loop');
    }
    if (!r.fired && flag24) { r.fired = true; out.shots.push({ player: f.slot, kind: 'fay-sniper' }); }
    if (s.phase === 'travel' || s.phase === 'end') {
      if (end) { finish(); return out; }
    }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (s.released || end) phase(f, 'travel');
      if (f.grounded) f.velocity = { x: 0, y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (f.stateFrame <= 2) { f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; f.velocity = { x: f.velocity.x, y: p.up.riseSpeed }; }
    if (f.stateFrame >= p.up.riseFrames + 20 || end) { finish(true, p.up.landing, p.up.mobility); return out; }
    f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.6, a.terminal, 0);
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
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (end) { finish(); return out; }
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
function voice(p: FaySpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
