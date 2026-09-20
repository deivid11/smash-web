import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { ActiveHit } from './moves.ts';
import type { SpecialDirection } from './special-data.ts';
import { command, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** ftDonkey_SpecialNVars for the active special; the banked arm-swing counter itself is
 * MatchFighter.dkPunchCharge (fighter var x222C), which survives across states. */
export interface DkRuntime { swings: number; full: boolean; cancelQueued: boolean; launched: boolean; repeat: boolean }
const params = (f: MatchFighter) => { const p = f.content.specials.parameters; if (p.kind !== 'Dk') throw Error('Missing Donkey Kong data.'); return p; };
/** ftDk_MS_ThrowFWalkSlow..Fast: cargo carry walk with ftWalkCommon and multiplier 1. */
export function cargoWalking(f: MatchFighter): boolean {
  return !!f.content.cargo && f.state === 'holding' && (f.content.cargo.walks as readonly string[]).includes(f.animation);
}
/** The cargo hold proper (ThrowFWait or a walk), after the lift and before a cargo throw. */
export function cargoCarrying(f: MatchFighter): boolean {
  return !!f.content.cargo && f.state === 'holding' && (f.animation === f.content.cargo.wait || cargoWalking(f));
}
export function dkSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  if (direction === 'neutral') return `${prefix}N${phase === 'start' ? 'Start' : phase === 'loop' ? 'Loop' : phase === 'travel' ? 'Cancel' : f.special?.dk?.full ? 'Full' : ''}`;
  if (direction === 'side') return `${prefix}S`;
  if (direction === 'up') return f.grounded ? 'SpecialHi' : 'SpecialAirHi';
  return `SpecialLw${phase === 'start' ? 'Start' : phase === 'loop' ? 'Loop' : 'End'}`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  f.special!.phase = next; f.special!.lastFrame = -1;
  f.animation = dkSpecialName(f, f.special!.direction, next); f.animationFrame = 0; f.stateFrame = 0; f.animationRate = 1; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginDkSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), a = f.content.profile.attributes;
  f.special!.dk = { swings: 0, full: false, cancelQueued: false, launched: false, repeat: false };
  if (direction === 'neutral') {
    // ftDk_SpecialN_Enter: a fully banked counter releases the full punch immediately.
    if (f.dkPunchCharge >= p.neutral.maxSwings) { f.special!.dk.full = true; f.special!.dk.swings = f.dkPunchCharge; f.dkPunchCharge = 0; }
    if (f.grounded) f.velocity.y = 0;
  }
  if (direction === 'side' && !f.grounded) { f.velocity.x /= p.side.divisor; f.velocity.y = 0; }
  if (direction === 'up') {
    f.velocity.x = Math.max(-p.up.groundSpeed, Math.min(p.up.groundSpeed, f.velocity.x));
    f.velocity.y = f.grounded ? 0 : p.up.airY;
    f.jumpsUsed = a.maxJumps;
  }
  if (direction === 'down') f.velocity.y = 0;
}
/** ftDk_SpecialN_Anim: banked swings add x30 damage on top of the punch script's own values.
 * The full punch script already carries its final damage and gets no bonus. */
export function dkHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  if (f.content.profile.kind !== 'Dk' || !f.special?.dk) return hits;
  const p = params(f), s = f.special, r = s.dk!;
  if (s.direction === 'neutral' && s.phase === 'end' && !r.full && r.swings > 0) return hits.map(h => ({ ...h, damage: h.damage + r.swings * p.neutral.damagePerSwing }));
  return hits;
}
/** Landing during the aerial Spinning Kong continues as the grounded spin (ftDk_SpecialAirHi_Coll). */
export function landDkSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special; if (!s) return false;
  const p = params(f);
  if (s.direction === 'up') {
    f.velocity.x = Math.max(-p.up.groundSpeed, Math.min(p.up.groundSpeed, f.velocity.x));
    phase(f, 'start');
    return true;
  }
  if (s.direction === 'down') { finish(); return true; }
  f.animation = dkSpecialName(f, s.direction, s.phase); f.attackName = f.animation;
  return true;
}
/** Original ftDk_* orchestration over the prototype floor solver. Native charge particles
 * are not implemented; cargo carry and the Headbutt burial live in combat.ts/match.ts. */
export function stepDkSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.dk!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  if (s.direction === 'neutral') {
    if (s.phase === 'start') {
      if (r.full) phase(f, 'end');
      else if (end) phase(f, 'loop');
    } else if (s.phase === 'loop') {
      if (pressed && s.age > 1) { r.swings = f.dkPunchCharge; f.dkPunchCharge = 0; phase(f, 'end'); }
      else {
        if (input.shield) r.cancelQueued = true;
        if (end) {
          // ftDk_SpecialNLoop_Anim: one swing banks per loop; a full bank leaves the state on its own.
          f.dkPunchCharge++;
          if (f.dkPunchCharge >= p.neutral.maxSwings) { f.dkPunchCharge = p.neutral.maxSwings; finish(); return out; }
          if (r.cancelQueued) phase(f, 'travel');
          else phase(f, 'loop');
        }
      }
    } else if (end) {
      if (s.phase === 'end' && !f.grounded) { finish(true, p.neutral.landing); return out; }
      finish(); return out;
    }
  } else if (s.direction === 'side') {
    if (end) { finish(); return out; }
  } else if (s.direction === 'up') {
    if (end) { finish(!f.grounded, p.up.landing); return out; }
  } else {
    if (!f.grounded) { finish(); return out; }
    if (s.phase === 'start' && end) phase(f, 'loop');
    else if (s.phase === 'loop') {
      if (pressed) r.repeat = true;
      if (end) { if (r.repeat) { r.repeat = false; phase(f, 'loop'); } else phase(f, 'end'); }
    } else if (s.phase === 'end' && end) { finish(); return out; }
  }
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter(e => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame;
  if (s.direction === 'neutral' && s.phase === 'end' && !r.launched && f.grounded && events.some(e => e.type === 'create')) {
    // ftDk_SpecialN updateVelocity: grounded launch scales with the banked swings, applied once.
    f.velocity.x = Math.fround(f.facing * p.neutral.punchSpeed * r.swings); r.launched = true;
  }
  if (s.direction === 'up') {
    if (f.grounded) {
      f.velocity = physics.drift(f.slot, { x: f.velocity.x, y: 0 }, input.x, p.up.groundAccel, p.up.groundSpeed); f.velocity.y = 0;
    } else {
      const gravity = command(f, 0) !== 0 ? a.gravity : Math.fround(p.up.gravityScale * a.gravity);
      f.velocity = physics.customAir(f.slot, f.velocity, gravity, a.terminal, 0);
      f.velocity = physics.drift(f.slot, f.velocity, input.x, p.up.airAccel, p.up.airSpeed);
      f.jumpsUsed = a.maxJumps;
    }
    return out;
  }
  if (s.direction === 'side' && !f.grounded) {
    // ftDk_SpecialAirS_Phys: the headbutt hovers until cmd_vars[0], then falls with its own gravity.
    f.velocity = physics.customAir(f.slot, f.velocity, command(f, 0) !== 0 ? p.side.gravity : 0, a.terminal, p.side.friction);
    return out;
  }
  if (f.grounded) f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 };
  else {
    f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    f.velocity = physics.drift(f.slot, f.velocity, input.x, a.airDriftStickMul, a.airDriftMax);
  }
  return out;
}
