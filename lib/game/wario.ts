import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { WarioSpecialData } from './wario-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { command, rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

const params = (f: MatchFighter): WarioSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Wr') throw new Error('Missing Wario parameters.'); return p;
};
/** Waft charge plus the Shoulder Bash latches: `airStart` picks M345 over M343 for the whole
 * start, `groundDash` is state_var2 (the one-shot ledge run-off restart), `slowed`/`airDashed`
 * consume flag2, `noCancel` clears flag1 after a mid-dash landing, `hitAir` picks M346 over
 * M344, `jumpHeld` edges the jump-cancel input. */
export interface WarioRuntime { charge: number; airStart?: boolean; groundDash?: boolean; slowed?: boolean; airDashed?: boolean; noCancel?: boolean; hitAir?: boolean; jumpHeld?: boolean }
export function warioSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') {
    // M343/M345 keep their clip across ground/air swaps; M344/M346 are the contact hits.
    const r = f.special?.wario;
    if (phase === 'hit') return r?.hitAir ? 'SpecialAirS' : 'SpecialS';
    if (phase === 'travel') return 'SpecialSJump';
    return r?.airStart ? 'SpecialAirSStart' : 'SpecialSStart';
  }
  if (direction === 'up') return air ? 'SpecialAirHi' : 'SpecialHi';
  if (phase === 'loop') return 'SpecialAirLwLoop';
  if (phase === 'end') return 'SpecialAirLwEnd';
  if (phase === 'travel') return air ? 'SpecialAirLw' : 'SpecialLw';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = warioSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginWarioSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!;
  s.wario = { charge: 0 };
  if (direction === 'neutral' && f.grounded) f.velocity.x = 0;
  // SpecialS: gr_vel = 0, state_var2 = 1. SpecialAirS: self_vel = 0 (hovering start).
  if (direction === 'side') { f.velocity = { x: 0, y: 0 }; s.wario = { charge: 0, airStart: !f.grounded, groundDash: f.grounded, jumpHeld: true }; }
  // Grounded Corkscrew stays grounded until the rise launches (see step).
}
/** PlWr hurtbox_detect_cb (ptr_01fa8 / ptr_02028 / ptr_02080): the start's element-11 boxes
 * touching a fighter while flag0 is up (always, in SJump) swap into the 13% contact hit. */
export function warioBashDetect(f: MatchFighter): boolean {
  const s = f.special, r = s?.wario;
  if (f.content.profile.kind !== 'Wr' || s?.direction !== 'side' || !r || (s.phase !== 'start' && s.phase !== 'travel')) return false;
  if (s.phase === 'start' && !command(f, 0)) return false;
  const p = params(f);
  if (s.phase === 'start' && !r.airStart && f.grounded) { r.hitAir = false; phase(f, 'hit'); return true; }
  const air = s.phase === 'start' && r.airStart;
  f.velocity = { x: Math.fround((air ? p.side.airReboundX : p.side.reboundX) * f.facing), y: air ? p.side.airReboundY : p.side.reboundY };
  f.grounded = false; f.floor = null; r.hitAir = true; phase(f, 'hit');
  return true;
}
export function landWarioSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'side') {
    const r = s.wario!;
    // M345_Coll: an aerial start touching down is a special landing of x44 >> 1.
    if (s.phase === 'start' && r.airStart) return landing(f, finish, p.side.fallLanding >> 1);
    // M343 airborne half: CollAir_IgnoreLedge -> grounded, restart at x3C, flag1 cleared.
    if (s.phase === 'start') { restart(f, p.side.restartFrame); r.noCancel = true; f.velocity.y = 0; return true; }
    // M346_Coll: the aerial contact hit lands straight into Wait; M347_Coll: SJump lands special.
    if (s.phase === 'hit') { finish(); return true; }
    return landing(f, finish, p.side.fallLanding);
  }
  if (s.direction === 'up') {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = Math.max(1, Math.ceil(p.up.landing)); return true;
  }
  f.animation = warioSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** Engine-authored orchestration; hitboxes use the PlWr scripts.
 * N chomps while held, S dashes, Hi corkscrews up, Lw wafts up after charge. */
export function stepWarioSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.wario!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 ? [voice(p, s.direction)] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  if (s.direction === 'neutral') {
    // Chomp holds while the button stays down (the 18-hit script loops).
    if (end) {
      if (!s.released) phase(f, 'start');
      else { finish(); return out; }
    }
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.direction === 'side') return stepBash(f, input, physics, end, out, finish);
  if (s.direction === 'up') {
    if (s.age <= 2) { f.velocity = { x: f.velocity.x, y: p.up.riseSpeed }; f.grounded = false; f.floor = null; }
    if (f.stateFrame >= p.up.riseFrames + 18 || end) { finish(true, p.up.landing, p.up.mobility); return out; }
    f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.55, a.terminal, 0);
    return out;
  }
  // Waft: charge while held, release (or full charge) to burst upward.
  if (s.phase === 'start') {
    r.charge++;
    if (s.released || r.charge >= p.down.chargeFrames || end) phase(f, 'travel');
    if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
    else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
    return out;
  }
  if (s.age <= 8 && s.phase === 'travel' && f.stateFrame <= 3) {
    const power = 0.6 + 0.4 * Math.min(1, r.charge / p.down.chargeFrames);
    f.grounded = false; f.floor = null;
    f.velocity = { x: f.velocity.x, y: Math.fround(p.down.riseSpeed * power) };
  }
  if (f.stateFrame >= 40 || end) { finish(true, p.down.landing, 1); return out; }
  f.velocity = physics.customAir(f.slot, f.velocity, a.gravity * 0.7, a.terminal, 0);
  return out;
}
function landing(f: MatchFighter, finish: () => void, lag: number): boolean {
  finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
  f.landingFrames = Math.max(1, lag); return true;
}
/** ActionStateChange back into the same start clip at `frame` (hitboxes and flags re-run). */
function restart(f: MatchFighter, frame: number): void {
  const s = f.special!;
  f.animationFrame = frame; s.lastFrame = frame; f.stateFrame = 0; f.animationEpoch++;
  f.attackSerial++; f.victims.clear();
}
/** PlWr Shoulder Bash (M343 ground start, M345 aerial start, M344/M346 contact hits, M347 SJump).
 * The starts only carry zero-damage element-11 boxes; warioBashDetect swaps into the 13% hit. */
function stepBash(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, end: boolean, out: SpecialStep, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f).side, s = f.special!, r = s.wario!, a = f.content.profile.attributes;
  const jumpPressed = input.jump && !r.jumpHeld; r.jumpHeld = input.jump;
  const specialFall = () => finish(true, p.fallLanding, p.fallMobility);
  if (s.phase === 'start' && !r.airStart) {
    // M343_IASA: jump inside the flag1 window cancels into SJump at x34.
    if (jumpPressed && command(f, 1) && !r.noCancel) {
      f.grounded = false; f.floor = null; f.velocity = { x: f.velocity.x, y: p.jumpVelY };
      phase(f, 'travel'); return out;
    }
    if (!f.grounded && r.groundDash) {
      // M343_Anim: first frame off the ground restarts the dash at x3C with x28.
      r.groundDash = false; restart(f, p.restartFrame);
      f.velocity = { x: Math.fround(f.facing * p.airDashVel), y: f.velocity.y };
    }
    if (end) { finish(); return out; }
    if (f.grounded) {
      // M343_Phys: flag2 1 drives at x24; flag2 2 drops once to 1.2 (x54 friction hits gr_vel,
      // not self_vel, so the slide keeps 1.2 until the clip ends).
      const flag2 = command(f, 2);
      if (flag2 === 1) f.velocity = { x: Math.fround(f.facing * p.dashVel), y: 0 };
      else if (flag2 === 2 && !r.slowed) { r.slowed = true; f.velocity = { x: Math.fround(f.facing * 1.2), y: 0 }; }
      else f.velocity.y = 0;
    } else {
      // Airborne half: ft_80084EEC, then gravity again capped at x38.
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, p.dashTerminal, 0);
    }
    return out;
  }
  if (s.phase === 'start') {
    // M345: flag2 fires the x28 dash once; hover (x58 gravity) until flag1, then x5C, cap x60.
    if (end) { specialFall(); return out; }
    if (command(f, 2) && !r.airDashed) { r.airDashed = true; f.velocity = { x: Math.fround(f.facing * p.airDashVel), y: f.velocity.y }; }
    if (!command(f, 1)) f.velocity = physics.customAir(f.slot, f.velocity, p.airGravity0, p.airTerminal, 0);
    else {
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      f.velocity = physics.customAir(f.slot, f.velocity, p.airGravity1, p.airTerminal, 0);
    }
    return out;
  }
  if (s.phase === 'hit') {
    if (!r.hitAir) {
      // M344: root motion; end -> Wait, walk-off -> Fall.
      if (end || !f.grounded) { finish(); return out; }
      const delta = rootDelta(f);
      f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing);
      return out;
    }
    // M346: gravity, |vx| <= x7C, stick drift x78; end -> special fall.
    if (end) { specialFall(); return out; }
    f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
    f.velocity.x = Math.fround(Math.max(-p.hitMaxX, Math.min(p.hitMaxX, f.velocity.x)) + input.x * p.hitDrift);
    return out;
  }
  // M347 SpecialSJump: x30 forward each frame + ft_80084EEC; flag1 re-opens the double jump.
  if (end) { if (f.grounded) finish(); else specialFall(); return out; }
  // M347_IASA: inside the flag1 window a jump press hands over to the aerial jump (IASA).
  if (jumpPressed && command(f, 1) && f.jumpsUsed < a.maxJumps) { finish(); return out; }
  f.velocity = physics.customAir(f.slot, { x: Math.fround(p.jumpVelX * f.facing), y: f.velocity.y }, a.gravity, a.terminal, a.airFriction);
  return out;
}
function voice(p: WarioSpecialData, direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? p.neutral.voice : direction === 'side' ? p.side.voice : direction === 'up' ? p.up.voice : p.down.voice;
}
