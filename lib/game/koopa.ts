import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { KoopaSpecialData } from './koopa-data.ts';
import type { GkSpecialData } from './gk-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { rootDelta, command, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** ftKoopa_MotionVars, snapshot-owned. `bites` counts the Klaw pummel loops, `dive` the
 * Bowser Bomb cmd-armed plunge, `breathTimer` the flame spawn cadence. */
export interface KoopaRuntime { bites: number; dive: boolean; breathTimer: number; tossFacing: number }
const f32 = Math.fround;
const params = (f: MatchFighter): KoopaSpecialData | GkSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Kp' && p.kind !== 'Gk') throw new Error('Missing Bowser parameters.'); return p;
};
export function koopaSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  if (direction === 'neutral') return phase === 'start' ? `${prefix}NStart` : phase === 'loop' ? `${prefix}N` : `${prefix}NEnd`;
  if (direction === 'side') return phase === 'hit' ? `${prefix}SHit0` : phase === 'end' ? `${prefix}SEndF` : `${prefix}SStart`;
  if (direction === 'up') return `${prefix}Hi`;
  return phase === 'end' ? 'SpecialLwLanding' : `${prefix}Lw`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = koopaSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginKoopaSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), s = f.special!;
  s.koopa = { bites: 0, dive: false, breathTimer: 0, tossFacing: 0 };
  if (direction === 'up' && !f.grounded) { f.velocity.y = p.fortress.rise; f.jumpsUsed = f.content.profile.attributes.maxJumps; }
  if (direction === 'down' && !f.grounded) f.velocity = { x: f32(f.velocity.x * p.bomb.velXMul), y: f32(f.velocity.y * p.bomb.velYMul) };
  if (direction === 'neutral') { if (f.grounded) f.velocity.x = 0; }
}
/** ftKp_SpecialS: the Klaw's element-8 window lives in the SpecialSStart script. */
export function koopaKlawActive(f: MatchFighter): boolean {
  return (f.content.profile.kind === 'Kp' || f.content.profile.kind === 'Gk') && f.state === 'special' && f.special?.direction === 'side' && f.special.phase === 'start';
}
/** A caught fighter moves Bowser into the bite loop (ftKp_MS_SpecialSHit0). */
export function beginKoopaKlawCatch(f: MatchFighter): void {
  f.velocity = { x: 0, y: 0 };
  phase(f, 'hit');
}
/** ftKp toss release: leaves the special and runs the shared throw with SpecialSEndF/B. */
function beginKlawThrow(f: MatchFighter, backward: boolean): void {
  const name = (f.grounded ? 'Special' : 'SpecialAir') + (backward ? 'SEndB' : 'SEndF');
  f.special = null;
  f.state = 'throw'; f.stateFrame = 0;
  f.animation = name; f.animationFrame = 0; f.animationRate = 1; f.animationEpoch++;
  f.attackName = name; f.attackSerial++; f.victims.clear();
  f.combat.throwTarget = f.combat.partner; f.combat.motionFacing = f.facing; f.combat.cursor = -1;
}
export function landKoopaSpecial(f: MatchFighter, finish: () => void): boolean {
  const p = params(f), s = f.special!;
  if (s.direction === 'up') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.fortress.landingLag)); return true;
  }
  if (s.direction === 'down' && s.phase !== 'end') {
    // ftKp_SpecialLw_Coll: the plunge ends in the dedicated SpecialLwLanding crash.
    phase(f, 'end'); f.velocity = { x: 0, y: 0 }; return true;
  }
  f.animation = koopaSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Original ftKp orchestration over the prototype floor solver; the native per-flame arc
 * randomization and the Klaw mash-escape are not ported. */
export function stepKoopaSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.koopa!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const stationary = () => { if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction); };
  if (s.direction === 'neutral') {
    if (s.phase === 'start') { if (end) phase(f, 'loop'); stationary(); return out; }
    if (s.phase === 'loop') {
      // Flames spend the shared breath pool; it recovers outside the special (match step).
      f.koopaBreath = Math.max(p.breath.minStrength, f32(f.koopaBreath - 2));
      // ftKp_SpecialN_IASA spawns a flame on EVERY frame it runs and drains the pools by 1 each.
      // This port keeps its own three-frame cadence: with one full hit landing per flame and no
      // rehit gate on the victim, the original cadence would triple an already heavy burn.
      if (++r.breathTimer >= 3) { r.breathTimer = 0; out.shots.push({ player: f.slot, kind: 'koopa-flame', charge: f.koopaBreath }); }
      if (s.released || f.koopaBreath <= p.breath.minStrength) phase(f, 'end');
      stationary(); return out;
    }
    if (end) { finish(); return out; }
    stationary(); return out;
  }
  if (s.direction === 'side') {
    if (s.phase === 'start') {
      if (end) { finish(); return out; }
      if (f.grounded) { const delta = rootDelta(f); f.velocity = { x: physics.motion(f.slot, delta.z, 0, f.facing).x, y: 0 }; }
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      return out;
    }
    // Bite loop: the SpecialSHit script pummels the captured partner (damage-only hits).
    const partner = f.combat.partner;
    if (partner === null) { finish(); return out; }
    if (Math.abs(input.x) > p.klaw.stick) { beginKlawThrow(f, input.x * f.facing < 0); return out; }
    if (end) { r.bites++; phase(f, 'hit'); }
    f.velocity = f.grounded ? { x: 0, y: 0 } : physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'up') {
    if (end) {
      if (f.grounded) { finish(); return out; }
      finish(true, p.fortress.landingLag, 1); return out;
    }
    if (f.grounded) {
      const delta = rootDelta(f);
      let vx = f32(physics.motion(f.slot, delta.z, 0, f.facing).x + f32(input.x * p.fortress.groundAccel));
      vx = Math.sign(vx) * Math.min(Math.abs(vx), p.fortress.groundClamp + Math.abs(delta.z));
      f.velocity = { x: vx, y: 0 };
    } else {
      f.velocity = physics.customAir(f.slot, f.velocity, p.fortress.gravity, p.fortress.terminal, 0);
      f.velocity.x = f32(f.velocity.x + input.x * p.fortress.airAccel);
      f.velocity.x = Math.sign(f.velocity.x) * Math.min(Math.abs(f.velocity.x), p.fortress.airClamp);
    }
    return out;
  }
  // Bowser Bomb.
  if (s.phase === 'end') {
    if (end) { finish(); return out; }
    f.velocity = { x: 0, y: 0 }; return out;
  }
  if (!r.dive && (command(f, 1) !== 0 || !f.grounded && s.age > 16)) r.dive = true;
  if (r.dive) {
    f.grounded = false; f.floor = null;
    f.velocity = { x: physics.customAir(f.slot, { x: f.velocity.x, y: 0 }, 0, a.terminal, p.bomb.airFriction).x, y: p.bomb.diveSpeed };
  } else if (f.grounded) {
    const delta = rootDelta(f); f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
    if (f.velocity.y > 0.01) { f.grounded = false; f.floor = null; }
  } else f.velocity = physics.customAir(f.slot, f.velocity, p.bomb.fallAccel, a.terminal, p.bomb.airFriction);
  if (end && !r.dive) r.dive = true;
  return out;
}
