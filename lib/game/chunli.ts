import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { ChunLiSpecialData } from './chunli-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

const params = (f: MatchFighter): ChunLiSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Cn') throw new Error('Missing Chun-Li parameters.'); return p;
};
export interface ChunLiRuntime { fired: boolean }
export function chunliSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') {
    // No air loop clip exists; both heights grind the shared 24-hit loop.
    if (phase === 'loop' || phase === 'travel') return 'SpecialS';
    if (phase === 'end') return air ? 'SpecialAirSEnd' : 'SpecialSEnd';
    return air ? 'SpecialAirSStart' : 'SpecialSStart';
  }
  if (direction === 'up') return air ? 'SpecialAirHi' : 'SpecialHi';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = chunliSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginChunLiSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.chunli = { fired: false };
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
  if (direction === 'side' && f.grounded) f.velocity = { x: 0, y: 0 };
}
export function landChunLiSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'up' || s.direction === 'side') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(s.direction === 'up' ? p.up.landing : p.side.landing)); return true;
  }
  f.animation = chunliSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration; hitboxes/shots use the PlCn scripts. Neutral
 * fires one Kikoken on flag-24; Side grinds the 24-hit loop while held;
 * Hi/Down ride their root motion into landing lag (Hi ends helpless mid-air). */
export function stepChunLiSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.chunli!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [voice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  if (s.direction === 'neutral') {
    if (!r.fired && events.some((e) => e.type === 'flag' && e.flag === 24)) {
      r.fired = true;
      out.shots.push({ player: f.slot, kind: 'chunli-kiko' });
    }
    if (end) { finish(); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'side') {
    if (s.phase === 'start') {
      if (end) phase(f, 'loop');
      if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (s.phase === 'loop') {
      if (s.released) phase(f, 'end');
      else if (end) phase(f, 'loop');
      if (f.grounded) f.velocity = { x: 0, y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    if (end) { finish(!f.grounded, p.side.landing, p.side.mobility); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  const delta = rootDelta(f);
  if (events.some((e) => e.type === 'flag' && (e.flag === 101 || e.flag === 102))) { f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; }
  if (s.direction === 'up') {
    f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
    if (f.velocity.y > 0.01) { f.grounded = false; f.floor = null; }
    if (end) { finish(true, p.up.landing, p.up.mobility); return out; }
    return out;
  }
  f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
  if (f.velocity.y > 0.01) { f.grounded = false; f.floor = null; }
  if (end) { finish(!f.grounded, p.down.landing, p.down.mobility); return out; }
  return out;
}
function voice(p: ChunLiSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
