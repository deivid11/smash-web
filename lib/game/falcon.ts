import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import { command, rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** ftCaptain_MotionVars used by Captain Falcon/Ganondorf; stored inside the full match snapshot.
 * `grav` is the Raptor Boost fall accumulator, `slow`/`slows` the Falcon Kick on-hit
 * speed multiplier and its bounded count, `branch` the resolved hit/end animation,
 * `freefall` the Falcon Dive x2_b1 bit (landing lag + ledge catch armed). */
export interface FalconRuntime { grav: number; slow: number; slows: number; branch: string; freefall: boolean }
const params = (f: MatchFighter) => { const p = f.content.specials.parameters; if (p.kind !== 'Ca' && p.kind !== 'Gn') throw Error('Missing Captain Falcon/Ganondorf data.'); return p; };
export function falconSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const s = f.special, r = s?.falcon;
  if (direction === 'neutral') return f.grounded ? 'SpecialN' : 'SpecialAirN';
  if (direction === 'side') return phase === 'hit' ? r?.branch || 'SpecialS' : s?.startedAir ? 'SpecialAirSStart' : 'SpecialSStart';
  if (direction === 'up') return phase === 'hit' ? 'SpecialHiCatch' : s?.startedAir ? 'SpecialAirHi' : 'SpecialHi';
  return phase === 'end' ? r?.branch || 'SpecialLwEnd' : s?.startedAir ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase'], rate = 1): void {
  f.special!.phase = next; f.special!.lastFrame = -1;
  f.animation = falconSpecialName(f, f.special!.direction, next); f.animationFrame = 0; f.stateFrame = 0; f.animationRate = rate; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginFalconSpecial(f: MatchFighter, direction: SpecialDirection): void {
  f.special!.falcon = { grav: 0, slow: 1, slows: 0, branch: '', freefall: false };
  // ftCa_SpecialS_Enter/setupAirStart zero velocity; ftCa_SpecialLw_800E49FC consumes the jumps.
  if (direction === 'side' || direction === 'up' || direction === 'down') f.velocity = { x: 0, y: 0 };
  if (direction === 'up') f.jumpsUsed = f.content.profile.attributes.maxJumps;
}
/** ftCa_SpecialS_OnDetect window: the elem-11 detect boxes only count while cmd_vars[0] is set. */
export function falconRaptorDetect(f: MatchFighter): boolean {
  return (f.content.profile.kind === 'Ca' || f.content.profile.kind === 'Gn' || f.content.profile.kind === 'Bf') && f.state === 'special' && f.special?.direction === 'side' && f.special.phase === 'start' && command(f, 0) !== 0;
}
/** onDetectGround / onDetectAir: fighter contact turns the dash into the uppercut or spike. */
export function triggerFalconRaptor(f: MatchFighter): void {
  const p = params(f), s = f.special!, r = s.falcon!;
  r.branch = f.grounded ? 'SpecialS' : 'SpecialAirS';
  if (f.grounded) { f.velocity = { x: Math.fround(f.velocity.x * p.side.hitGroundVelMul), y: 0 }; }
  else f.velocity.y = r.grav;
  phase(f, 'hit');
}
/** Falcon Dive's elem-8 boxes are live only during the rising grab window. */
export function falconDiveActive(f: MatchFighter): boolean {
  return (f.content.profile.kind === 'Ca' || f.content.profile.kind === 'Gn' || f.content.profile.kind === 'Bf') && f.state === 'special' && f.special?.direction === 'up' && f.special.phase === 'start';
}
/** ftCa_SpecialLw_800E5128: a caught fighter switches Falcon to SpecialHiCatch. */
export function beginFalconDiveCatch(f: MatchFighter): void {
  f.velocity = { x: 0, y: 0 };
  phase(f, 'hit');
}
/** ftCa_SpecialHi_800E400C: each landed Falcon Kick hit slows the remaining slide, bounded. */
export function falconKickHitLanded(f: MatchFighter): void {
  if ((f.content.profile.kind !== 'Ca' && f.content.profile.kind !== 'Gn' && f.content.profile.kind !== 'Bf') || f.special?.direction !== 'down' || !f.special.falcon) return;
  const p = params(f), r = f.special.falcon;
  if (r.slows < p.down.maxHitSlows) { r.slows++; r.slow = Math.fround(r.slow * p.down.onHitSpeedMul); }
}
/** doCatchAnim → ftCa_MS_SpecialHiThrow: leave the special and run the shared throw release. */
function beginDiveThrow(f: MatchFighter): void {
  f.special = null;
  f.state = 'throw'; f.stateFrame = 0;
  f.animation = 'SpecialHiThrow'; f.animationFrame = 0; f.animationRate = 1; f.animationEpoch++;
  f.attackName = 'SpecialHiThrow'; f.attackSerial++; f.victims.clear();
  f.combat.throwTarget = f.combat.partner; f.combat.motionFacing = f.facing; f.combat.cursor = -1;
}
function downEnd(f: MatchFighter, branch: string): void {
  const p = params(f), r = f.special!.falcon!;
  r.branch = branch;
  phase(f, 'end', branch === 'SpecialAirLwEnd' ? p.down.landingLagMul : branch === 'SpecialLwEnd' ? p.down.groundLagMul : 1);
}
/** Landing while a special owns the fighter; mirrors the ftCa_*_Coll landing exits. */
export function landFalconSpecial(f: MatchFighter, finish: () => void): boolean {
  const p = params(f), s = f.special!;
  if (s.direction === 'up') { finish(); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.max(1, Math.ceil(p.up.landing)); return true; }
  if (s.direction === 'side') {
    const lag = s.phase === 'hit' ? p.side.hitLanding : p.side.missLanding;
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.max(1, Math.ceil(lag)); return true;
  }
  if (s.direction === 'down') {
    const r = s.falcon!;
    if (s.phase === 'start' && s.startedAir) { downEnd(f, 'SpecialAirLwEnd'); return true; }
    if (s.phase === 'end' && (r.branch === 'SpecialLwEndAir' || r.branch === 'SpecialAirLwEndAir')) { downEnd(f, 'SpecialAirLwEnd'); return true; }
    return true; // The grounded kick keeps its own animation.
  }
  f.animation = falconSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Original ftCa orchestration over the prototype floor collision adapter, not a complete engine port. */
export function stepFalconSpecial(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.falcon!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter(e => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  if (s.direction === 'neutral') {
    if (end) { finish(); return out; }
    if (f.grounded) { f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 }; return out; }
    // ftCa_SpecialAirN_IASA: cmd_vars[0] redirects momentum once, from the clamped stick tilt.
    if (events.some(e => e.type === 'command' && e.index === 0 && e.value === 1)) {
      const y = input.y ?? 0;
      let tilt = Math.min(Math.abs(y), p.neutral.stickRangePos) - p.neutral.stickRangeNeg;
      if (tilt < 0) tilt = 0;
      if (y < 0) tilt = -tilt;
      const angle = Math.PI / 180 * (tilt * p.neutral.angleDiff / (p.neutral.stickRangePos - p.neutral.stickRangeNeg));
      f.velocity = { x: Math.fround(p.neutral.velocity * f.facing * Math.cos(angle)), y: Math.fround(p.neutral.velocity * Math.sin(angle)) };
    }
    const mode = command(f, 1);
    if (mode === 1) f.velocity = { x: Math.fround(f.velocity.x * p.neutral.velocityMul), y: Math.fround(f.velocity.y * p.neutral.velocityMul) };
    else if (mode === 2) f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
    else f.velocity = physics.air(f.slot, f.velocity, input.x, false);
    return out;
  }
  if (s.direction === 'side') {
    if (end) {
      if (f.grounded) { finish(); return out; }
      finish(true, s.phase === 'hit' ? p.side.hitLanding : p.side.missLanding, 1);
      return out;
    }
    const delta = rootDelta(f);
    if (f.grounded) f.velocity = { x: s.phase === 'hit' ? physics.ground(f.slot, f.velocity.x, 0) : physics.motion(f.slot, delta.z, 0, f.facing).x, y: 0 };
    else {
      f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
      // ftCa_SpecialAirS(Start)_Phys: cmd_vars[1] arms an own gravity accumulator.
      if (s.phase === 'hit' || command(f, 1) === 1) {
        r.grav = Math.max(-p.side.terminal, Math.fround(r.grav - p.side.gravity));
        f.velocity.y = r.grav;
      }
    }
    return out;
  }
  if (s.direction === 'up') {
    if (s.phase === 'hit') {
      f.velocity = { x: 0, y: 0 };
      if (end) beginDiveThrow(f);
      return out;
    }
    if (end) { finish(true, p.up.landing, p.up.freefallMobility); return out; }
    // ftCa_SpecialHi_IASA (cmd_vars[0]): freefall armed; strong sideways input reverses.
    if (events.some(e => e.type === 'command' && e.index === 0 && e.value === 1)) {
      r.freefall = true;
      if (Math.abs(input.x) > p.up.reverseThreshold) f.facing = input.x > 0 ? 1 : -1;
    }
    if (events.some(e => e.type === 'flag' && e.flag === 102)) { f.grounded = false; f.floor = null; }
    const delta = rootDelta(f);
    if (f.grounded) f.velocity = { x: physics.motion(f.slot, delta.z, 0, f.facing).x, y: 0 };
    else {
      f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
      f.velocity = physics.drift(f.slot, f.velocity, input.x, a.airDriftStickMul * p.up.airFrictionMul, a.airDriftMax * p.up.horizontalVel);
    }
    return out;
  }
  // Falcon Kick.
  if (s.phase === 'start') {
    if (end) {
      downEnd(f, s.startedAir ? (f.grounded ? 'SpecialAirLwEnd' : 'SpecialAirLwEndAir') : f.grounded ? 'SpecialLwEnd' : 'SpecialLwEndAir');
      return out;
    }
    const delta = rootDelta(f);
    if (f.grounded) f.velocity = { x: Math.fround(physics.motion(f.slot, delta.z, 0, f.facing).x * r.slow), y: 0 };
    else if (s.startedAir) f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
    else f.velocity = physics.customAir(f.slot, { x: Math.fround(f.velocity.x * r.slow), y: f.velocity.y }, a.gravity, a.terminal, 0);
    return out;
  }
  if (end) {
    if (r.branch === 'SpecialAirLwEndAir' && !f.grounded) { finish(); return out; } // → normal Fall, no helpless.
    finish(); return out;
  }
  if (f.grounded) {
    const traction = r.branch === 'SpecialAirLwEnd' ? p.down.airLandingTraction : p.down.groundTraction;
    const sliding = command(f, 2) !== 0;
    f.velocity = { x: physics.customAir(f.slot, { x: f.velocity.x, y: 0 }, 0, a.terminal, sliding ? a.friction * traction : a.friction).x, y: 0 };
  } else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
