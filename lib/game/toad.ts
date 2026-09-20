import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { ToadSpecialData } from './toad-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

const params = (f: MatchFighter): ToadSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Td') throw new Error('Missing Toad parameters.'); return p;
};
/** Toad's ACE table is single-state per special; note the side air suffix order (SpecialSAir). */
export function toadSpecialName(f: MatchFighter, direction: SpecialDirection, _phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') return air ? 'SpecialSAir' : 'SpecialS';
  if (direction === 'up') return air ? 'SpecialAirHi' : 'SpecialHi';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
export function beginToadSpecial(f: MatchFighter, direction: SpecialDirection): void {
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
  if (direction === 'up' && !f.grounded) { f.velocity = { x: Math.fround(f.velocity.x * 0.6), y: 0 }; f.jumpsUsed = f.content.profile.attributes.maxJumps; }
}
export function landToadSpecial(f: MatchFighter, finish: () => void): boolean {
  const p = params(f), s = f.special!;
  if (s.direction === 'up') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.up.landing)); return true;
  }
  f.animation = toadSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration; hitboxes/shot timing come from the PlTd scripts
 * (the Ice Ball leaves on the script's flag-24 event, Mario fireball convention). */
export function stepToadSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [toadVoice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  const stationary = () => { if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction); };
  if (s.direction === 'up') {
    if (end) {
      if (f.grounded) { finish(); return out; }
      finish(true, p.up.landing, p.up.mobility); return out;
    }
    // SpecialHi carries real root motion (~30 up / 19 forward); flag 102 detaches from ground.
    if (events.some((e) => e.type === 'flag' && (e.flag === 101 || e.flag === 102))) { f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; }
    const delta = rootDelta(f);
    f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
    if (f.velocity.y > 0.01) { f.grounded = false; f.floor = null; }
    return out;
  }
  if (s.direction === 'neutral' && events.some((e) => e.type === 'flag' && e.flag === 24)) {
    out.shots.push({ player: f.slot, kind: 'iceball' });
  }
  if (end) { finish(); return out; }
  stationary(); return out;
}
function toadVoice(p: ToadSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
