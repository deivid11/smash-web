import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { NessSpecialData } from './ness-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime, SpecialStep } from './specials.ts';

/** ftNess_MotionVars, snapshot-owned. `ball`/`shot` latch which article this special owns,
 * `selfHit` carries the PK Thunder contact point into the next step, `pkt2` the launch. */
export interface NessRuntime {
  loop1: number; loop2: number; shotFired: boolean; ballGone: boolean;
  selfHit: { x: number; y: number } | null;
  /** ftNs_SpecialHi_ItemPKThunder_CheckNessCollide: 1 while the ball still overlaps Ness
   * (it spawns on top of him), 0 once it has left and the self-hit is armed, 2 after it
   * connected. Without the disarmed start PK Thunder would hit its owner on frame one. */
  thunderColl: 0 | 1 | 2;
  pkt2: boolean; pkt2Angle: number; pkt2Speed: number;
  absorbed: number; releaseLag: number;
}
const f32 = Math.fround;
const params = (f: MatchFighter): NessSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Ns') throw new Error('Missing Ness parameters.'); return p;
};
export function nessSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir', r = f.special?.ness;
  if (direction === 'neutral') return phase === 'start' ? `${prefix}NStart` : phase === 'loop' ? `${prefix}NHold0` : phase === 'travel' ? `${prefix}NHold1` : `${prefix}NEnd`;
  if (direction === 'side') return f.grounded ? 'SpecialS' : 'SpecialAirS';
  if (direction === 'up') {
    if (phase === 'hit') return r?.pkt2 && f.grounded ? 'SpecialHi' : 'SpecialAirHi';
    return phase === 'start' ? `${prefix}HiStart` : phase === 'loop' ? `${prefix}HiHold` : `${prefix}HiEnd`;
  }
  return phase === 'start' ? `${prefix}LwStart` : phase === 'loop' ? `${prefix}LwHold` : phase === 'hit' ? `${prefix}LwHit` : `${prefix}LwEnd`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = nessSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginNessSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), s = f.special!;
  s.ness = { loop1: 0, loop2: 0, shotFired: false, ballGone: false, selfHit: null, thunderColl: 1, pkt2: false, pkt2Angle: 0, pkt2Speed: 0, absorbed: 0, releaseLag: direction === 'down' ? Math.ceil(p.magnet.releaseLag) : 0 };
  // The native Enter callbacks stop the fall; the hold states then use their own slow fall.
  if (!f.grounded) f.velocity = { x: f32(f.velocity.x * 0.5), y: 0 };
  else if (direction === 'up' || direction === 'neutral') f.velocity.x = 0;
}
/** ftColl_CreateAbsorbHit: the PSI Magnet absorb bubble while the start/loop states run. */
export function nessAbsorber(f: MatchFighter): { bone: number; offset: [number, number, number]; radius: number; healMul: number } | null {
  if (f.state !== 'special') return null;
  const s = f.special;
  if (!s || s.direction !== 'down' || (s.phase !== 'start' && s.phase !== 'loop')) return null;
  if (f.content.profile.kind === 'Ns') {
    const p = params(f);
    return { ...p.magnet.absorb, offset: [...p.magnet.absorb.offset] as [number, number, number], healMul: p.magnet.healMul };
  }
  // ACE Ness-clones (Lucas/Ninten) author the same TransN bubble.
  const p = f.content.specials.parameters;
  if ((p.kind === 'Lc' || p.kind === 'Nt') && p.down.absorb) {
    return { bone: p.down.absorb.bone, offset: [...p.down.absorb.offset] as [number, number, number], radius: p.down.absorb.radius, healMul: p.down.healMul };
  }
  return null;
}
/** The forward-smash bat reflects with the native xB8 ReflectDesc while its hits are armed. */
export function nessBatReflector(f: MatchFighter): import('./special-data.ts').ReflectorData | null {
  if (f.content.profile.kind !== 'Ns' || f.state !== 'attack' || f.attackName !== 'AttackS4') return null;
  return params(f).bat;
}
export function landNessSpecial(f: MatchFighter, finish: () => void): boolean {
  const p = params(f), s = f.special!;
  if (s.direction === 'up' && s.phase === 'hit') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.thunder.landingLag)); return true;
  }
  if (s.direction === 'side' && s.startedAir) {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.fire.landingLag)); return true;
  }
  f.animation = nessSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Original ftNs orchestration over the prototype floor solver; the PK Thunder 2 wall
 * rebound/wallhug and the dedicated yo-yo charge-hold hitboxes are not ported. */
export function stepNessSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.ness!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const stationary = (fallAccel = a.gravity, delay = 0) => {
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, s.age > delay ? fallAccel : 0, a.terminal, a.airFriction);
  };
  if (s.direction === 'neutral') {
    if (s.phase === 'start') {
      if (end) { out.shots.push({ player: f.slot, kind: 'pk-flash' }); r.shotFired = true; phase(f, 'loop'); }
      stationary(p.flash.fallAccel, p.flash.gravityDelay); return out;
    }
    if (s.phase === 'loop') {
      // The ball watches this hold state; once it detonates or dies it reports back.
      if (r.ballGone || s.released) { r.loop1 = p.flash.loop1; r.loop2 = p.flash.loop2; phase(f, 'travel'); }
      stationary(p.flash.fallAccel, p.flash.gravityDelay); return out;
    }
    if (s.phase === 'travel') {
      if (r.loop1 > 0) r.loop1 -= 1; else if (r.loop2 > 0) r.loop2 -= 1;
      if (r.loop1 <= 0 && r.loop2 <= 0) phase(f, 'end');
      stationary(); return out;
    }
    if (end) { finish(!f.grounded && p.flash.landingLag > 0, p.flash.landingLag, 1); return out; }
    stationary(); return out;
  }
  if (s.direction === 'side') {
    if (!r.shotFired && f.animationFrame >= 10) {
      // ftNs_SpecialS fires at the native hand pose; the bolt takes the attribute trajectory.
      r.shotFired = true;
      out.shots.push({ player: f.slot, kind: 'pk-fire' });
      out.sounds.push(0x265d8);
    }
    if (end) { finish(); return out; }
    stationary(); return out;
  }
  if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (end) { out.shots.push({ player: f.slot, kind: 'pk-thunder' }); r.shotFired = true; phase(f, 'loop'); }
      stationary(p.thunder.fallAccel, p.thunder.gravityDelay); return out;
    }
    if (s.phase === 'loop') {
      if (r.selfHit) {
        // NessFloatMath_PKThunder2: launch away from the contact point at x54 momentum.
        const dx = f.x - r.selfHit.x, dy = f32(f.y + 5 * f.content.profile.attributes.modelScale) - r.selfHit.y;
        r.pkt2 = true; r.pkt2Angle = Math.atan2(dy, dx); r.pkt2Speed = p.thunder.momentum;
        f.facing = dx >= 0 ? 1 : -1;
        f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps;
        f.velocity = { x: f32(Math.cos(r.pkt2Angle) * r.pkt2Speed), y: f32(Math.sin(r.pkt2Angle) * r.pkt2Speed) };
        r.selfHit = null;
        phase(f, 'hit');
        return out;
      }
      if (r.ballGone) { r.loop1 = p.thunder.loop1; r.loop2 = p.thunder.loop2; phase(f, 'end'); }
      stationary(p.thunder.fallAccel, p.thunder.gravityDelay); return out;
    }
    if (s.phase === 'hit') {
      // PK Thunder 2 flight: constant heading, x5C deceleration, script-owned hits.
      r.pkt2Speed = Math.max(0, f32(r.pkt2Speed - p.thunder.deceleration));
      f.velocity = { x: f32(Math.cos(r.pkt2Angle) * r.pkt2Speed), y: f32(Math.sin(r.pkt2Angle) * r.pkt2Speed) };
      if (end || r.pkt2Speed <= 0.2) { finish(true, p.thunder.landingLag, 1); return out; }
      return out;
    }
    if (end) { finish(); return out; }
    stationary(); return out;
  }
  // PSI Magnet.
  if (s.phase === 'start') {
    if (end) phase(f, 'loop');
  } else if (s.phase === 'loop') {
    if (r.absorbed > 0) {
      f.percent = Math.max(0, f32(f.percent - r.absorbed)); r.absorbed = 0;
      out.sounds.push(0x230a6);
      phase(f, 'hit');
    } else {
      r.releaseLag = Math.max(0, r.releaseLag - 1);
      if (s.released && r.releaseLag === 0) phase(f, 'end');
    }
  } else if (s.phase === 'hit') {
    if (end) phase(f, 'loop');
  } else if (end) { finish(); return out; }
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else {
    const gravity = s.age > p.magnet.gravityDelay ? p.magnet.fallAccel : 0;
    f.velocity = physics.customAir(f.slot, f.velocity, gravity, a.terminal, a.airFriction);
  }
  return out;
}
