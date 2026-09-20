import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { RaichuSpecialData } from './raichu-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep, SpecialWorld } from './specials.ts';
import type { ActiveHit } from './moves.ts';
import { pikachuSpecialName, beginPikachuSpecial, stepPikachuSpecial, landPikachuSpecial } from './pikachu.ts';
import { routeAceSound } from './ace-voices.ts';

/** Raichu is a Pikachu clone (PlRc runs the decomp ftPk callbacks for neutral/up/down);
 * only the side special is the ACE author's compiled roll, ported here state by state:
 * start = M343 ground / M348 air, loop = M344 ground hold / M349 air hold,
 * travel = M352 airborne roll, end = M346 ground / M351 air. */
export interface RaichuRuntime { steps: number }
const f32 = Math.fround;
const params = (f: MatchFighter): RaichuSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Rc') throw new Error('Missing Raichu parameters.'); return p;
};
export function raichuSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  if (direction !== 'side') return pikachuSpecialName(f, direction, phase);
  if (phase === 'travel') return 'SpecialAirSTravel';
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  return phase === 'start' ? `${prefix}SStart` : phase === 'loop' ? `${prefix}SHold` : `${prefix}SEnd`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = raichuSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginRaichuSpecial(f: MatchFighter, direction: SpecialDirection): void {
  f.special!.raichu = { steps: 0 };
  beginPikachuSpecial(f, direction);
}
/** M344_Anim / M349_Anim: each script cmd0 of the hold loop is one build-up step (cmd0 is
 * cleared once consumed, so every scripted set counts once). */
function buildUp(f: MatchFighter, p: RaichuSpecialData['side'], r: RaichuRuntime): void {
  const s = f.special!;
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter(e => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  for (const e of events) if (e.type === 'command' && e.index === 0 && e.value !== 0 && r.steps < p.maxSteps) r.steps++;
}
/** M344_Coll (off an edge) and M349_Anim (release/full): the airborne roll's launch. */
function launchRoll(f: MatchFighter, p: RaichuSpecialData['side'], steps: number): void {
  f.grounded = false; f.floor = null;
  f.velocity = { x: f32((p.launchXPerStep * steps + p.launchX) * f.facing), y: f32(p.launchYPerStep * steps + p.launchY) };
  phase(f, 'travel');
}
export function stepRaichuSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void, world?: SpecialWorld): SpecialStep {
  const s = f.special!;
  if (s.direction !== 'side') return stepPikachuSpecial(f, input, physics, finish);
  const p = params(f).side, r = s.raichu!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const groundAnim = !f.animation.startsWith('SpecialAir');
  // ftCommon_Fall(gravity, x40 terminal): vertical only, the roll keeps its horizontal speed.
  const fall = (gravity: number) => { f.velocity = { x: f.velocity.x, y: f32(Math.max(-p.terminal, f.velocity.y - gravity)) }; };
  if (s.phase === 'start') {
    if (groundAnim) {
      // M343_Coll: slipping off an edge keeps the current roll speed into the airborne roll.
      if (!f.grounded) { phase(f, 'travel'); return out; }
      f.velocity = { x: f32(p.rollSpeed * f.facing), y: 0 };
    } else {
      // M348_Coll: landing restarts the ground start.
      if (f.grounded) { phase(f, 'start'); return out; }
      fall(a.gravity);
    }
    if (ended()) {
      // M343_Anim → SpecialSHold plays the roll's code sound (ft_800881D8, fighter id 5088).
      if (groundAnim) out.sounds.push(routeAceSound(f.content.specials.soundBank, 5088));
      phase(f, 'loop');
    }
    return out;
  }
  if (s.phase === 'loop') {
    if (groundAnim) {
      if (!f.grounded) { launchRoll(f, p, r.steps); return out; }
      buildUp(f, p, r);
      // M344_Anim: a fresh B press stops the roll; M344_IASA: a jump leaves it with its speed.
      if (pressed) { phase(f, 'end'); return out; }
      if (world?.jumpPressed) { finish(false, 0, 1); f.state = 'squat'; f.animation = 'Landing'; f.shortHop = false; return out; }
      f.velocity = { x: f32(Math.max(p.rollSpeed, Math.abs(p.speedPerStep * r.steps)) * f.facing), y: 0 };
    } else {
      // M349_Coll: landing resumes the ground hold with the steps already built.
      if (f.grounded) { phase(f, 'loop'); return out; }
      buildUp(f, p, r);
      if (pressed || r.steps >= p.maxSteps) { launchRoll(f, p, r.steps); return out; }
      fall(a.gravity);
    }
    // No re-entry at the clip end: the hold clip loops on its action flag while the
    // script keeps its own 10-frame cycle (unrolled at load, lib/game/raichu-data.ts).
    return out;
  }
  if (s.phase === 'travel') {
    if (f.grounded) { phase(f, 'end'); return out; }
    if (ended()) { phase(f, 'end'); return out; }
    // M352_Phys: vx bleeds by x54 against the facing while any speed remains.
    if (f.velocity.x !== 0) f.velocity.x = f32(f.velocity.x - p.airDecay * f.facing);
    fall(p.airGravity);
    return out;
  }
  if (groundAnim && !f.grounded) { phase(f, 'end'); return out; }
  if (!groundAnim && f.grounded) { phase(f, 'end'); return out; }
  // M346 → Wait, M351 → Fall.
  if (ended()) { finish(false, 0, 1); return out; }
  if (f.grounded) f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 }; else fall(a.gravity);
  return out;
}
export function landRaichuSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!;
  if (s.direction !== 'side') return landPikachuSpecial(f, finish);
  // M348/M349/M351/M352_Coll: every airborne roll state lands into its ground counterpart.
  phase(f, s.phase === 'travel' ? 'end' : s.phase);
  return true;
}
/** SpecialSHold/SpecialAirSHold carry the loop action flag (0x40000000): their clips wrap
 * for both the rendered and the collision pose while the hold's script runs on. */
export function raichuAnimationLoops(f: MatchFighter): boolean {
  return f.content.profile.kind === 'Rc' && f.special?.direction === 'side' && f.special.phase === 'loop';
}
/** M344_Coll / M352_Coll: once the roll has built up, hitbox 0 deals x30 + x34·steps. */
export function raichuHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  const s = f.special;
  if (f.content.profile.kind !== 'Rc' || s?.direction !== 'side' || !s.raichu || s.raichu.steps <= 0 || (s.phase !== 'loop' && s.phase !== 'travel')) return hits;
  const p = params(f).side, damage = Math.trunc(p.damage + p.damagePerStep * s.raichu.steps);
  return hits.map(hit => hit.id === 0 ? { ...hit, damage } : hit);
}
