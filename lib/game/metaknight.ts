import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { MetaKnightSpecialData } from './metaknight-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** Meta Knight motion vars (engine-authored; ACE logic is compiled m-ex code).
 * `loops` counts Mach Tornado spin cycles, `capeDirection` the Dimensional Cape slide. */
export interface MetaKnightRuntime { loops: number; capeDirection: 'neutral' | 'forward' | 'back' }
const f32 = Math.fround;
const params = (f: MatchFighter): MetaKnightSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Mk') throw new Error('Missing Meta Knight parameters.'); return p;
};
export function metaKnightSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase'], runtime?: MetaKnightRuntime): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  // The Spin/Drill/Hi loop figatrees are shared between ground and air.
  if (direction === 'neutral') return phase === 'start' ? `${prefix}NStart` : phase === 'loop' ? 'SpecialNSpin' : `${prefix}NEnd`;
  if (direction === 'side') return phase === 'start' ? `${prefix}SStart` : phase === 'travel' ? 'SpecialSDrill' : `${prefix}SEnd`;
  if (direction === 'up') return phase === 'start' ? `${prefix}HiStart` : phase === 'end' ? 'SpecialHiEnd' : 'SpecialHi';
  const cape = runtime?.capeDirection === 'forward' ? 'F' : runtime?.capeDirection === 'back' ? 'B' : '';
  return phase === 'start' ? `${prefix}LwStart` : phase === 'end' ? `${prefix}LwEnd` : `${prefix}Lw${cape}`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = metaKnightSpecialName(f, s.direction, next, s.mk); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginMetaKnightSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.mk = { loops: 0, capeDirection: 'neutral' };
  if (direction === 'neutral') { if (f.grounded) f.velocity.x = 0; else f.velocity = { x: f32(f.velocity.x * 0.6), y: 0 }; }
  if (direction === 'up' && !f.grounded) { f.velocity = { x: f32(f.velocity.x * 0.5), y: 0 }; f.jumpsUsed = f.content.profile.attributes.maxJumps; }
  if (direction === 'side' && !f.grounded) f.velocity = { x: 0, y: 0 };
}
export function landMetaKnightSpecial(f: MatchFighter, finish: () => void): boolean {
  const p = params(f), s = f.special!;
  if (s.direction === 'up' || (s.direction === 'side' && s.phase !== 'start')) {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(s.direction === 'up' ? p.up.landing : p.side.landing)); return true;
  }
  f.animation = metaKnightSpecialName(f, s.direction, s.phase, s.mk); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration: every hitbox and the Drill/Loop/Cape movement come
 * straight from the PlMk scripts and root-motion tracks; only pacing is authored. */
export function stepMetaKnightSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.mk!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [metaKnightVoice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const follow = (scaleY = 1) => {
    const delta = rootDelta(f);
    f.velocity = physics.motion(f.slot, delta.z, delta.y * scaleY, f.facing);
    if (f.velocity.y > 0.01) { f.grounded = false; f.floor = null; }
  };
  if (s.direction === 'neutral') {
    if (s.phase === 'start') { if (end) phase(f, 'loop'); }
    else if (s.phase === 'loop') {
      // Drift on the stick; holding B sustains the spin up to the loop cap with a slight rise.
      f.velocity = { x: f32(Math.max(-p.neutral.driftMax, Math.min(p.neutral.driftMax, f.velocity.x + input.x * p.neutral.driftAccel))), y: f.grounded ? 0 : (s.released ? physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0).y : p.neutral.riseSpeed * (r.loops < 2 ? 1 : 0.3)) };
      if (!f.grounded && f.velocity.y > 0) { f.grounded = false; f.floor = null; }
      if (end) { r.loops++; if (s.released || r.loops >= p.neutral.maxLoops) phase(f, 'end'); else phase(f, 'loop'); }
      return out;
    } else if (end) { finish(!f.grounded, p.neutral.landing, 1); return out; }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.5, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'side') {
    if (s.phase === 'start') { if (end) phase(f, 'travel'); f.velocity = f.grounded ? { x: 0, y: 0 } : physics.customAir(f.slot, f.velocity, a.gravity * 0.3, a.terminal, a.airFriction); return out; }
    if (s.phase === 'travel') { if (end) { phase(f, 'end'); return out; } follow(); return out; }
    if (end) { if (f.grounded) finish(); else finish(true, p.side.landing, 1); return out; }
    f.velocity = f.grounded ? { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 } : physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (end) { phase(f, 'loop'); f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; f.velocity = { x: f.velocity.x, y: 1.2 }; return out; }
      f.velocity = f.grounded ? { x: 0, y: 0 } : { x: f.velocity.x, y: 0 }; return out;
    }
    if (s.phase === 'loop') {
      if (end) { phase(f, 'end'); return out; }
      // The loop's root motion carries the climb; stay detached from the floor throughout.
      f.grounded = false; f.floor = null;
      follow(); return out;
    }
    if (end) { finish(true, p.up.landing, p.up.mobility); return out; }
    f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  // Dimensional Cape.
  if (s.phase === 'start') {
    if (Math.abs(input.x) > 0.4) r.capeDirection = input.x * f.facing > 0 ? 'forward' : 'back';
    if (end) phase(f, 'loop');
    f.velocity = f.grounded ? { x: 0, y: 0 } : physics.customAir(f.slot, f.velocity, a.gravity * 0.2, a.terminal, a.airFriction);
    return out;
  }
  if (s.phase === 'loop') { if (end) { phase(f, 'end'); return out; } follow(); return out; }
  if (end) { finish(!f.grounded, p.down.landing, 1); return out; }
  f.velocity = f.grounded ? { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 } : physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
function metaKnightVoice(p: MetaKnightSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
