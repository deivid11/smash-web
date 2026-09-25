import type { MatchFighter } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import type { PopoSpecialData } from './popo-data.ts';
import { type SpecialRuntime, type SpecialStep } from './specials.ts';

/** Popo-side special orchestration for the Ice Climbers duo. Nana follows and
 * swings through the partner entity in match.ts (see lib/game/nana.ts); this
 * module only runs Popo's own ftPp branches. ftPp partner fields
 * (x1A5C/x7C/x2222) are never read. */
export interface PopoRuntime { spray: boolean; sprayClock: number; hoverArmed: boolean }
const f32 = Math.fround;
const params = (f: MatchFighter): PopoSpecialData => {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Pp') throw new Error('Missing Popo parameters.');
  return p;
};
export function popoSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') {
    if (phase === 'start') return air ? 'SpecialAirS1' : 'SpecialS1';
    if (phase === 'travel') return air ? 'SpecialAirS2' : 'SpecialS2';
    return air ? 'SpecialAirS2' : 'SpecialS2';
  }
  if (direction === 'up') {
    if (phase === 'start') return air || f.special?.startedAir ? 'SpecialAirHiStart' : 'SpecialHiStart';
    if (phase === 'travel') return air || f.special?.startedAir ? 'SpecialAirHiThrow' : 'SpecialHiThrow';
    return air || f.special?.startedAir ? 'SpecialAirHiThrow2' : 'SpecialHiThrow2';
  }
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = popoSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1;
  f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginPopoSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f);
  s.popo = { spray: false, sprayClock: 0, hoverArmed: true };
  if (direction === 'neutral' && !f.grounded && !f.popoHoverUsed) {
    // Air Ice Shot stalls the fall once per airtime (x224C latch).
    f.velocity.y = f32(p.neutral.hover); f.popoHoverUsed = true;
  }
  if (direction === 'side') {
    if (f.grounded) { f.velocity.x = f32(p.side.groundVel * f.facing); f.velocity.y = 0; }
    else f.velocity = { x: f32(p.side.airVelX * f.facing), y: f32(p.side.airVelY1) };
  }
  if (direction === 'up') {
    f.velocity.x = f32(f.velocity.x / p.up.divisorX);
    if (!f.grounded) f.velocity.y = f32(f.velocity.y / p.up.divisorY);
    f.jumpsUsed = f.content.profile.attributes.maxJumps;
  }
}
/** Original ftPp orchestration (solo) over the prototype floor adapter. */
export function stepPopoSpecial(f: MatchFighter, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, r = s.popo!, p = params(f), a = f.content.profile.attributes;
  const result: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const ordinary = (gravity = a.gravity, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, a.terminal, friction);
  };
  const gather = () => { const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame; return events; };
  if (s.direction === 'neutral') {
    if (ended()) { finish(false, 0, 1); return result; }
    // Hammer swing spawns the ice block when cmd0 turns 1 (accessory callback).
    if (gather().some((e) => e.type === 'command' && e.index === 0 && e.value === 1)) {
      result.shots.push({ player: f.slot, kind: 'ice-shot' });
    }
    ordinary();
  } else if (s.direction === 'side') {
    // Squall Hammer: S1 raise, S2 spinning advance; ends helpless airborne.
    if (s.phase === 'start' && ended()) {
      phase(f, 'travel');
      if (!f.grounded) f.velocity.y = f32(p.side.airVelY2);
    } else if (s.phase === 'travel' && ended()) { finish(!f.grounded, 0, 1); return result; }
    if (s.phase === 'travel') {
      if (f.grounded) f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    } else ordinary();
  } else if (s.direction === 'up') {
    // Solo Belay (no-Nana native path): Start, Throw rise, Throw2, helpless.
    if (s.phase === 'start' && ended()) {
      phase(f, 'travel');
      // PROTOTYPE partner Belay: with Nana in tow the throw lifts well past the solo rise
      // (the original partner-throw heights stay unported — this is a labeled stand-in;
      // solo Popo keeps the native value exactly).
      const partnered = f.nana?.active ? 1.6 : 1;
      f.velocity = { x: 0, y: f32(p.up.rise * partnered) };
      f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps;
    } else if (s.phase === 'travel' && ended()) phase(f, 'end');
    else if (s.phase === 'end' && ended()) { finish(true, p.up.landing, 1); return result; }
    if (s.phase === 'travel' || s.phase === 'end') {
      f.velocity = physics.customAir(f.slot, f.velocity, p.up.fallGravity, p.up.fallTerminal, 0);
    } else ordinary();
  } else {
    // Blizzard: cmd0==1 opens the spray interval, cmd0==2 closes it.
    if (ended()) { finish(false, 0, 1); return result; }
    for (const e of gather()) {
      if (e.type !== 'command' || e.index !== 0) continue;
      if (e.value === 1) { r.spray = true; r.sprayClock = 0; }
      if (e.value === 2) r.spray = false;
    }
    if (r.spray) {
      r.sprayClock++;
      if (r.sprayClock >= p.down.interval) {
        r.sprayClock = 0;
        result.shots.push({ player: f.slot, kind: 'blizzard' });
      }
    }
    ordinary();
  }
  return result;
}
export function landPopoSpecial(f: MatchFighter, finish: (helpless: boolean, lag: number, mobility: number) => void): boolean {
  const s = f.special; if (!s) return false;
  const p = params(f);
  if (s.direction === 'up') {
    finish(false, 0, 1); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.ceil(p.up.landing);
    return true;
  }
  f.animation = popoSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
