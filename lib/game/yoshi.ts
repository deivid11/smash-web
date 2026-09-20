import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import type { YoshiSpecialData } from './yoshi-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** ftYs motion vars used by the prototype (loop freshness, held egg age). */
export interface YoshiRuntime { loopIter: number; eggHeld: boolean; eggAge: number }
const f32 = Math.fround;
const params = (f: MatchFighter): YoshiSpecialData => {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Ys') throw new Error('Missing Yoshi parameters.');
  return p;
};
export function yoshiSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') {
    if (phase === 'start') return air ? 'SpecialAirN1' : 'SpecialN1';
    return air ? 'SpecialAirN2' : 'SpecialN2';
  }
  if (direction === 'side') {
    if (phase === 'start') return air ? 'SpecialAirSStart' : 'SpecialSStart';
    if (phase === 'travel') {
      const r = f.special?.yoshi;
      if (air) return (r?.loopIter ?? 0) === 0 ? 'SpecialAirSLoop1' : 'SpecialAirSLoop2';
      return (r?.loopIter ?? 0) === 0 ? 'SpecialSLoop' : 'SpecialSLoopTired';
    }
    return air ? 'SpecialAirSEnd' : 'SpecialSEnd';
  }
  if (direction === 'up') return air || f.special?.startedAir ? 'SpecialAirHi' : 'SpecialHi';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = yoshiSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1;
  f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginYoshiSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.yoshi = { loopIter: 0, eggHeld: false, eggAge: 0 };
  if (direction === 'up') f.jumpsUsed = f.content.profile.attributes.maxJumps;
}
/** Egg Lay lunge is active during the N1 grab (element-8 capsules); the match
 * buries victims (egg trap) and this phases the encase. */
export function yoshiEggActive(f: MatchFighter): boolean {
  return f.content.profile.kind === 'Ys' && f.state === 'special' && f.special?.direction === 'neutral' && f.special.phase === 'start';
}
export function beginYoshiEgg(f: MatchFighter): void {
  phase(f, 'travel');
}
/** Original ftYs orchestration over the prototype floor adapter. */
export function stepYoshiSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, r = s.yoshi!, p = params(f), a = f.content.profile.attributes;
  const result: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const ordinary = (gravity = a.gravity, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, a.terminal, friction);
  };
  const gather = () => { const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame; return events; };
  if (s.direction === 'neutral') {
    if (s.phase === 'start' && ended()) { finish(false, 0, 1); return result; }
    if (s.phase === 'travel' && ended()) { finish(false, 0, 1); return result; }
    ordinary();
  } else if (s.direction === 'side') {
    // Egg Roll: root-motion advance, stick steers, release or timeout ends it.
    if (s.phase === 'start' && ended()) { phase(f, 'travel'); return result; }
    if (s.phase === 'travel') {
      if (!input.special || s.age > 180) { phase(f, 'end'); return result; }
      if (Math.abs(input.x) > 0.3) f.facing = input.x > 0 ? 1 : -1;
      if (ended()) { r.loopIter++; phase(f, 'travel'); return result; }
      const delta = rootDelta(f);
      f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
      if (!f.grounded) f.velocity = { x: f.velocity.x, y: f32(f.velocity.y - a.gravity) };
      if (f.grounded) f.velocity.y = 0;
      result.handled = true;
      return result;
    }
    if (s.phase === 'end' && ended()) { finish(false, 0, 1); return result; }
    ordinary();
  } else if (s.direction === 'up') {
    // Egg Throw: B edge creates the held egg, cmd0 throws it with the exact
    // stick-magnitude/age ballistics; the egg fizzles if still held at the end.
    if (pressed && !r.eggHeld) { r.eggHeld = true; r.eggAge = 0; }
    if (r.eggHeld) r.eggAge++;
    let threw = false;
    for (const e of gather()) {
      if (e.type === 'command' && e.index === 0 && e.value !== 0 && r.eggHeld) {
        r.eggHeld = false; threw = true;
        const mag = Math.min(1, Math.hypot(input.x, input.y ?? 0) / p.hi.stickDiv) * p.hi.stickScale;
        const use = mag < p.hi.stickMin ? 0 : mag;
        const angle = f.facing > 0 ? p.hi.baseAngle - use : Math.PI - p.hi.baseAngle - use;
        const speed = f32(r.eggAge * p.hi.speedPerFrame + p.hi.speedBase);
        result.shots.push({ player: f.slot, kind: 'yoshi-egg', aim: angle, rawCharge: speed });
      }
    }
    if (threw) { /* the hand is empty; the toss continues through the clip */ }
    if (ended()) { r.eggHeld = false; finish(false, 0, 1); return result; }
    ordinary();
  } else {
    // Yoshi Bomb slams on root motion; cmd0 bursts a star each way (the only
    // star-spawn signal in either slam script, at the impact frames).
    if (ended()) { finish(false, 0, 1); return result; }
    for (const e of gather()) {
      if (e.type === 'command' && e.index === 0 && e.value === 1) {
        result.shots.push({ player: f.slot, kind: 'yoshi-star', variant: 0 });
        result.shots.push({ player: f.slot, kind: 'yoshi-star', variant: 1 });
      }
    }
    const delta = rootDelta(f);
    f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
    if (f.velocity.y > 0.01 || !f.grounded) { f.grounded = false; f.floor = null; }
    if (!f.grounded) f.velocity = { x: f.velocity.x, y: f32(f.velocity.y - a.gravity) };
    else f.velocity.y = 0;
    result.handled = true;
  }
  return result;
}
export function landYoshiSpecial(f: MatchFighter, finish: (helpless: boolean, lag: number, mobility: number) => void): boolean {
  const s = f.special; if (!s) return false;
  if (s.direction === 'side') {
    // Rolling onto the ground continues on the ground loops (iter kept).
    f.animation = yoshiSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
  }
  if (s.direction === 'down') {
    finish(false, 0, 1);
    f.state = 'landing'; f.animation = 'SpecialLwLanding';
    f.landingFrames = Math.max(1, Math.ceil(f.content.clips.get('SpecialLwLanding')!.endFrame));
    return true;
  }
  f.animation = yoshiSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
