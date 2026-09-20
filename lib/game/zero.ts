import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { ZeroSpecialData } from './zero-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep } from './specials.ts';

/** Zero motion vars (engine-authored: the ACE originals live in compiled m-ex code).
 * `charge` counts held Z-Buster frames, `chained` latches the Hienkyaku follow-up,
 * `dived` marks the aerial Sentsuizan plunge. */
export interface ZeroRuntime { charge: number; chained: boolean; dived: boolean }
const f32 = Math.fround;
const params = (f: MatchFighter): ZeroSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Zx') throw new Error('Missing Zero parameters.'); return p;
};
export function zeroSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  if (direction === 'neutral') return phase === 'start' ? `${prefix}NStart` : phase === 'loop' ? `${prefix}NLoop` : `${prefix}NEnd`;
  if (direction === 'side') return phase === 'travel' ? `${prefix}S2` : `${prefix}S1`;
  if (direction === 'up') return `${prefix}Hi`;
  return phase === 'end' ? 'SpecialLwLand' : `${prefix}Lw`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = zeroSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginZeroSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.zero = { charge: 0, chained: false, dived: false };
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
  if (direction === 'up' && !f.grounded) { f.velocity = { x: f32(f.velocity.x * 0.5), y: 0 }; f.jumpsUsed = f.content.profile.attributes.maxJumps; }
  if (direction === 'down' && !f.grounded) f.velocity = { x: f32(f.velocity.x * 0.5), y: 0 };
}
export function landZeroSpecial(f: MatchFighter, finish: () => void): boolean {
  const p = params(f), s = f.special!;
  if (s.direction === 'up') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.up.landing)); return true;
  }
  if (s.direction === 'down' && s.zero?.dived && s.phase !== 'end') {
    // The aerial Sentsuizan plunge ends in the dedicated SpecialLwLand crash slash.
    phase(f, 'end'); f.velocity = { x: 0, y: 0 }; return true;
  }
  f.animation = zeroSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration: hitboxes/animations run from the PlZx scripts, while
 * the state flow approximates the ACE build (its logic is native m-ex code). */
export function stepZeroSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.zero!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [zeroVoice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const stationary = () => { if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction); };
  if (s.direction === 'neutral') {
    if (s.phase === 'start') { if (end) phase(f, 'loop'); stationary(); return out; }
    if (s.phase === 'loop') {
      r.charge++;
      if ((s.released && s.age > 2) || r.charge >= p.neutral.maxHold) {
        out.shots.push({ player: f.slot, kind: r.charge >= p.neutral.chargeFrames ? 'buster-charged' : 'buster' });
        phase(f, 'end');
      }
      stationary(); return out;
    }
    if (end) { finish(); return out; }
    stationary(); return out;
  }
  if (s.direction === 'side') {
    // Hienkyaku: engine-driven dash (the ACE clips carry no root motion; the native
    // velocity lives in m-ex code). A second press after the window chains the follow-up.
    if (pressed && !r.chained && s.phase === 'start' && f.animationFrame >= p.side.chainWindow) {
      r.chained = true; phase(f, 'travel'); f.velocity = { x: f32(p.side.dashSpeed * f.facing), y: 0 }; return out;
    }
    if (end) {
      if (f.grounded) { finish(); return out; }
      finish(true, p.side.landing, 1); return out;
    }
    if (s.age === 1) f.velocity = { x: f32(p.side.dashSpeed * f.facing), y: 0 };
    if (f.grounded) f.velocity = { x: f32(f.velocity.x * p.side.decay), y: 0 };
    else f.velocity = { x: f32(f.velocity.x * p.side.decay), y: physics.customAir(f.slot, f.velocity, p.side.airGravity, a.terminal, 0).y };
    return out;
  }
  if (s.direction === 'up') {
    // Ryuenjin: engine-driven rising slash (no root motion in the clip) exiting helpless.
    if (end) {
      if (f.grounded) { finish(); return out; }
      finish(true, p.up.landing, p.up.mobility); return out;
    }
    if (s.age === 1) {
      f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps;
      f.velocity = { x: f32(p.up.driftX * f.facing), y: p.up.riseSpeed };
    } else if (f.velocity.y > 0) f.velocity = physics.customAir(f.slot, f.velocity, p.up.riseGravity, a.terminal, 0);
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  // Sentsuizan.
  if (s.phase === 'end') {
    if (end) { finish(); return out; }
    f.velocity = { x: 0, y: 0 }; return out;
  }
  if (!f.grounded && !r.dived && s.age >= 4) r.dived = true;
  if (r.dived) {
    f.grounded = false; f.floor = null;
    f.velocity = { x: f32(p.down.diveVx * f.facing), y: p.down.diveVy };
    if (end) { finish(true, p.down.landing, 1); return out; }
    return out;
  }
  if (end) { finish(); return out; }
  stationary(); return out;
}
function zeroVoice(p: ZeroSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
