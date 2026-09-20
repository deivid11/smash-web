import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { BlastoiseSpecialData } from './blastoise-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

const params = (f: MatchFighter): BlastoiseSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Bl') throw new Error('Missing Blastoise parameters.'); return p;
};
export interface BlastoiseRuntime { fired: boolean }
export function blastoiseSpecialName(f: MatchFighter, direction: SpecialDirection, _phase?: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') return air ? 'SpecialAirSStart' : 'SpecialSStart';
  if (direction === 'up') return air ? 'SpecialAirHi' : 'SpecialHi';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
export function beginBlastoiseSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.blastoise = { fired: false };
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
  if (direction === 'side' && f.grounded) f.velocity = { x: 0, y: 0 };
}
export function landBlastoiseSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'up' || (s.direction === 'side')) {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(s.direction === 'up' ? p.up.landing : p.side.landing)); return true;
  }
  if (s.direction === 'down' && (f.animation === 'SpecialLwLanding' || f.animation === 'SpecialAirLw')) {
    finish(); return true;
  }
  f.animation = blastoiseSpecialName(f, s.direction); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration; hitboxes/shots use the PlBl scripts.
 * N/Lw fire on flag-24 (Water Gun/spray); S dashes on root motion; Hi climbs
 * on root motion into helpless; LwLanding carries the slam hit. */
export function stepBlastoiseSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.blastoise!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [voice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  if ((s.direction === 'neutral' || s.direction === 'down') && !r.fired && events.some((e) => e.type === 'flag' && e.flag === 24)) {
    r.fired = true;
    out.shots.push({ player: f.slot, kind: s.direction === 'neutral' ? 'blastoise-water' : 'blastoise-spray' });
  }
  if (s.direction === 'side') {
    const delta = rootDelta(f);
    f.velocity = f.grounded ? physics.motion(f.slot, delta.z, 0, f.facing) : physics.motion(f.slot, delta.z, delta.y, f.facing);
    if (!f.grounded && f.velocity.y > 0.01) { f.grounded = false; f.floor = null; }
    if (end) { finish(!f.grounded, p.side.landing, p.side.mobility); return out; }
    return out;
  }
  if (s.direction === 'up') {
    if (events.some((e) => e.type === 'flag' && (e.flag === 101 || e.flag === 102))) { f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; }
    // Motor rise (root tracks use types 5/7, not the prototype 6/7 Y/Z).
    if (f.stateFrame <= 2) { f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; f.velocity = { x: f.velocity.x, y: p.up.riseSpeed }; }
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.6, a.terminal, 0);
    if (f.stateFrame >= 50 || end) { finish(true, p.up.landing, p.up.mobility); return out; }
    return out;
  }
  if (s.direction === 'down' && f.animation === 'SpecialLw' && end) {
    // Withdraw spray into the landing slam when grounded.
    if (f.grounded) {
      s.phase = 'travel'; s.lastFrame = -1;
      f.animation = 'SpecialLwLanding'; f.animationFrame = 0; f.animationEpoch++;
      f.attackName = f.animation; f.attackSerial++; f.victims.clear();
      return out;
    }
    finish(); return out;
  }
  if (end) { finish(); return out; }
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
function voice(p: BlastoiseSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
