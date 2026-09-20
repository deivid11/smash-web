import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SeakSpecialData } from './seak-data.ts';
import { type SpecialRuntime, type SpecialStep } from './specials.ts';
import type { ActiveHit } from './moves.ts';
import type { FighterKind } from './data.ts';

/** ftSk motion vars used by the prototype (needle count lives on the fighter,
 * like Samus charge, so Cancel can store it; Transform completes at Lw2 end). */
export interface SeakRuntime { travelAge: number; whipped: boolean; thrown: boolean; prevShield: boolean }
const f32 = Math.fround;
const params = (f: MatchFighter): SeakSpecialData => {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Sk') throw new Error('Missing Sheik parameters.');
  return p;
};
export function seakSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') {
    if (phase === 'start') return air ? 'SpecialAirNStart' : 'SpecialNStart';
    if (phase === 'loop') return air ? 'SpecialAirNLoop' : 'SpecialNLoop';
    if (phase === 'travel') return air ? 'SpecialAirNCancel' : 'SpecialNCancel';
    return air ? 'SpecialAirNEnd' : 'SpecialNEnd';
  }
  if (direction === 'side') {
    if (phase === 'start') return air ? 'SpecialAirSStart' : 'SpecialSStart';
    if (phase === 'travel') return air ? 'SpecialAirS' : 'SpecialS';
    return air ? 'SpecialAirSEnd' : 'SpecialSEnd';
  }
  if (direction === 'up') {
    if (phase === 'start') return air || f.special?.startedAir ? 'SpecialAirHiStart' : 'SpecialHiStart';
    return air || f.special?.startedAir ? 'SpecialAirHi' : 'SpecialHi';
  }
  if (phase === 'end') return air ? 'SpecialAirLw2' : 'SpecialLw2';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = seakSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1;
  f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginSeakSpecial(f: MatchFighter, direction: SpecialDirection, input: PlayerInput): void {
  const s = f.special!, p = params(f);
  s.seak = { travelAge: 0, whipped: false, thrown: false, prevShield: !!input.shield };
  if (direction === 'neutral' && f.sheikNeedles === 0) f.sheikNeedles = 1;
  if (direction === 'up') {
    f.velocity = { x: 0, y: 0 };
    f.jumpsUsed = f.content.profile.attributes.maxJumps;
  }
  if (direction === 'down') {
    f.velocity.x = f32(f.velocity.x / p.down.divX);
    f.velocity.y = f32(f.velocity.y / p.down.divY);
  }
}
/** Vanish reappearance burst (slot-2 article hit) during the last 5 travel
 * frames. Native explodes exactly on reappear; the window is the prototype's
 * only approximation here. */
export function seakHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  const s = f.special;
  if (f.content.profile.kind !== 'Sk' || !s?.seak || s.direction !== 'up' || s.phase !== 'travel') return hits;
  const p = params(f);
  if (s.seak.travelAge < p.up.travelFrames - 5) return hits;
  const blast = f.content.specials.articles.seak?.vanish.hit;
  if (!blast) return hits;
  return [...hits, { ...blast, id: 4, group: 0, activation: 0 }];
}
/** Original ftSk orchestration over the prototype floor adapter. */
export function stepSeakSpecial(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, r = s.seak!, p = params(f), a = f.content.profile.attributes;
  const result: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const ordinary = (gravity = a.gravity, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, a.terminal, friction);
  };
  if (s.direction === 'neutral') {
    if (s.phase === 'start' && ended()) phase(f, 'loop');
    else if (s.phase === 'loop') {
      // One needle per Loop clip iteration, capped at 6 (native loop counter).
      if (ended()) {
        f.sheikNeedles = Math.min(6, f.sheikNeedles + 1);
        if (input.special) phase(f, 'loop');
        else { phase(f, 'end'); return result; }
      }
      // Shield stores the charge (Cancel), like Samus storage. Edge-detected
      // via runtime: fighter.previous already mirrors the current input here.
      if (input.shield && !r.prevShield) { phase(f, 'travel'); return result; }
      r.prevShield = !!input.shield;
    } else if (s.phase === 'travel' && ended()) { finish(false, 0, 1); return result; }
    else if (s.phase === 'end' && ended()) { finish(false, 0, 1); return result; }
    if (s.phase === 'end' && !r.thrown) {
      r.thrown = true;
      const count = f.sheikNeedles;
      f.sheikNeedles = 0;
      for (let i = 0; i < count; i++) result.shots.push({ player: f.slot, kind: 'needles' });
    }
    ordinary();
  } else if (s.direction === 'side') {
    if (s.phase === 'start' && ended()) {
      phase(f, 'travel');
      if (!r.whipped) { r.whipped = true; result.shots.push({ player: f.slot, kind: 'chain-whip' }); }
    } else if (s.phase === 'travel') {
      if (!input.special || s.age > 120) phase(f, 'end');
      else if (ended()) f.animationRate = 0;
    } else if (s.phase === 'end' && ended()) { finish(false, 0, 1); return result; }
    ordinary();
  } else if (s.direction === 'up') {
    if (s.phase === 'start' && ended()) {
      // Vanish aim: stick beyond threshold picks the vector, else straight up.
      const mag = Math.min(1, Math.hypot(input.x, input.y ?? 0));
      let angle = Math.PI / 2, speed = f32(p.up.distSlope + p.up.distBase);
      if (mag >= p.up.stickThreshold && (Math.abs(input.x) > 0.001 || Math.abs(input.y ?? 0) > 0.001)) {
        if (Math.abs(input.x) > 0.001) f.facing = input.x > 0 ? 1 : -1;
        angle = Math.atan2(input.y ?? 0, input.x * f.facing);
        speed = f32(p.up.distSlope * mag + p.up.distBase);
      }
      f.velocity = { x: f32(Math.cos(angle) * speed), y: f32(Math.sin(angle) * speed) };
      f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps;
      phase(f, 'travel');
    } else if (s.phase === 'travel') {
      r.travelAge++;
      if (ended()) f.animationRate = 0;
      if (r.travelAge >= p.up.travelFrames) { f.animationRate = 1; finish(true, p.up.landing, 1); return result; }
    }
    result.handled = true;
  } else {
    // Transform into Zelda at the end of the Lw2 clip (mirrors Zelda's).
    if (s.phase === 'start' && ended()) phase(f, 'end');
    else if (s.phase === 'end' && ended()) {
      const target: FighterKind = 'Zd';
      return { handled: true, shots: [], sounds: [], transform: target };
    }
    ordinary();
  }
  return result;
}
export function landSeakSpecial(f: MatchFighter, finish: (helpless: boolean, lag: number, mobility: number) => void): boolean {
  const s = f.special; if (!s) return false;
  const p = params(f);
  if (s.direction === 'up') {
    finish(false, 0, 1); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.ceil(p.up.landing);
    return true;
  }
  f.animation = seakSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
