import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { LizardonSpecialData } from './lizardon-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** Charizard's native motion states (PlLz `move_logic`, motions 0x157-0x168). The ACE code ships
 * with its author's debug symbols, so each branch below is named after the function it ports.
 * SpecialS_Blown / SpecialAirS_Blown (0x163/0x167) have callbacks but nothing ever enters them. */
export type LizardonState = 'NStart' | 'NLoop' | 'NEnd' | 'Hi' | 'Lw' | 'SStart' | 'S' | 'SEnd';

/** MexTK `state_var` block of the current motion. */
export interface LizardonRuntime {
  state: LizardonState;
  /** SpecialN: state_var1 flame cadence (0..2), state_var4 loop frames (capped at x14), state_var6
   * flames spawned (mod 12), state_var2 the hit group they share (Item_8026AE60), state_var7 the
   * camera-quake clock. */
  cadence: number; loopFrames: number; flames: number; group: number; groups: number; quake: number;
  /** SpecialN: state_var3, the flame's efSync variant (0x1775 + 0..3). */
  effect: number;
  /** SpecialS: state_var2, dash frames against x54. */
  dashFrames: number;
  /** SpecialHi: state_var1..3, the stick drift kept apart from the animation's root motion. */
  drift: { x: number; y: number };
  /** SpecialHi started on the ground plays the grounded motion (0x15D) through the whole flight. */
  groundHi: boolean;
  /** The one-shot turn (SpecialHi flag0 / SpecialLw flag1) has been used. */
  turned: boolean;
  /** Last animation frame whose script flags were consumed (flag0 rising edges burst the rock). */
  flagFrame: number;
  /** Grounded on the previous step (the *_CollCB ground→air transitions). */
  wasGrounded: boolean;
}

const f32 = Math.fround;
const params = (f: MatchFighter): LizardonSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Lz') throw new Error('Missing Charizard parameters.'); return p;
};
const STATE_ANIMATION: Record<LizardonState, (air: boolean, r: LizardonRuntime) => string> = {
  NStart: (air) => air ? 'SpecialAirNStart' : 'SpecialNStart',
  NLoop: (air) => air ? 'SpecialAirN' : 'SpecialN',
  NEnd: (air) => air ? 'SpecialAirNEnd' : 'SpecialNEnd',
  Hi: (air, r) => air && !r.groundHi ? 'SpecialAirHi' : 'SpecialHi',
  Lw: (air) => air ? 'SpecialAirLw' : 'SpecialLw',
  SStart: (air) => air ? 'SpecialAirSStart' : 'SpecialSStart',
  S: (air) => air ? 'SpecialAirS' : 'SpecialS',
  SEnd: (air) => air ? 'SpecialAirSEnd' : 'SpecialSEnd',
};
const PHASE: Record<LizardonState, SpecialRuntime['phase']> = {
  NStart: 'start', NLoop: 'loop', NEnd: 'end', Hi: 'travel', Lw: 'travel', SStart: 'start', S: 'travel', SEnd: 'end',
};
/** Common part SpawnItem_Rock / SpawnItem_RockBurst attach to (ftParts_GetBoneIndex(fp, 0x34)). */
export const LIZARDON_ROCK_PART = 0x34;

export function lizardonSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const r = f.special?.lizardon, air = !f.grounded;
  if (r) return STATE_ANIMATION[r.state](air, r);
  if (direction === 'neutral') return phase === 'start' ? STATE_ANIMATION.NStart(air, r!) : phase === 'loop' ? STATE_ANIMATION.NLoop(air, r!) : STATE_ANIMATION.NEnd(air, r!);
  if (direction === 'side') return STATE_ANIMATION.SStart(air, r!);
  if (direction === 'up') return air ? 'SpecialAirHi' : 'SpecialHi';
  return STATE_ANIMATION.Lw(air, r!);
}
/** Fighter_ChangeMotionState(start 0, speed 1, blend 0). `keepFrame` is the air/ground swap flag
 * set (0x0C4C5080/0x0C4C508B) that carries the animation frame across. */
function enter(f: MatchFighter, state: LizardonState, keepFrame = false): void {
  const s = f.special!, r = s.lizardon!;
  r.state = state; s.phase = PHASE[state];
  f.animation = STATE_ANIMATION[state](!f.grounded, r); f.attackName = f.animation;
  if (!keepFrame) { f.animationFrame = 0; f.stateFrame = 0; f.attackSerial++; f.victims.clear(); r.flagFrame = 0; }
  f.animationRate = 1; f.animationEpoch++;
}
const clipEnd = (f: MatchFighter) => Math.max(1, f.content.clips.get(f.animation)?.endFrame ?? 1);
/** ftAnim_IsFramesRemaining == 0. */
const animationDone = (f: MatchFighter) => f.animationFrame >= clipEnd(f);
/** SpecialN loops its 16-frame figatree (action flag 0x40000000). */
const wrap = (f: MatchFighter) => { const end = clipEnd(f); if (f.animationFrame >= end) f.animationFrame = f32(f.animationFrame % end); };
/** ftCommon_ApplyFrictionGround. */
const groundFriction = (v: number, friction: number) => Math.abs(v) <= friction ? 0 : f32(v - Math.sign(v) * friction);
/** Script `command` events (ftcmd flag writes) of the current motion that fired after `from`. */
function flagEvents(f: MatchFighter, from: number, index: number): Array<{ frame: number; value: number }> {
  const out: Array<{ frame: number; value: number }> = [];
  for (const e of f.content.timelines.get(f.animation)?.events ?? []) {
    if (e.frame > f.animationFrame) break;
    if (e.type === 'command' && e.index === index && e.frame > from) out.push({ frame: e.frame, value: e.value });
  }
  return out;
}
/** The flag's current value: the motion's Enter wrote `initial`, and frame-0 script writes land
 * before that Enter (ChangeMotionState runs them first), so only later writes count. */
function flag(f: MatchFighter, index: number, initial: number): number {
  const writes = flagEvents(f, 0, index);
  return writes.length ? writes[writes.length - 1]!.value : initial;
}

export function beginLizardonSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, a = f.content.profile.attributes, air = !f.grounded;
  s.lizardon = { state: 'NStart', cadence: 0, loopFrames: 0, flames: 0, group: 0, groups: 0, quake: 0, effect: 0, dashFrames: 0, drift: { x: 0, y: 0 }, groundHi: false, turned: false, flagFrame: 0, wasGrounded: !air };
  const r = s.lizardon;
  if (direction === 'neutral') {
    // SpecialN_Enter: a fresh flame group (state_var2) and every counter zeroed.
    r.state = 'NStart'; r.group = ++r.groups;
    return;
  }
  if (direction === 'side') {
    r.state = 'SStart';
    // SpecialS_Start_Enter zeroes self_vel (the ground speed comes from root motion);
    // SpecialAirS_Start_Enter spends every jump, keeps 0.4 of the drift and stops the fall.
    if (air) { f.jumpsUsed = a.maxJumps; f.velocity = { x: f32(f.velocity.x * params(f).side.airStartSpeed), y: 0 }; }
    return;
  }
  if (direction === 'up') {
    // SpecialHi_OnEnter zeroes the fall and the drift accumulator; the aerial one spends every jump.
    r.state = 'Hi'; r.groundHi = !air; f.velocity = { x: f.velocity.x, y: 0 };
    if (air) f.jumpsUsed = a.maxJumps;
    return;
  }
  // SpecialLw_Enter: flag0 = 0 (no burst yet), flag1 = 1 (the turn window).
  r.state = 'Lw';
}

/** SpecialLw_Enter spawns the held rock unless one is already out (ft_var8). */
function rockShot(f: MatchFighter): SpecialStep['shots'][number] { return { player: f.slot, kind: 'lizardon-rock' }; }

export function landLizardonSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, r = s.lizardon!, p = params(f);
  switch (r.state) {
    case 'Hi':
      // SpecialHi_CollCB → ft_80083A48 → SpecialHi_OnLand: LandingFallSpecial at x78.
      finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
      f.landingFrames = Math.max(1, Math.ceil(p.up.landing)); return true;
    case 'SEnd':
      // SpecialAirS_End_CollCB: ftCo_LandingFallSpecial_Enter at x6C, the air speed kept.
      finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
      f.landingFrames = Math.max(1, Math.ceil(p.side.landing)); return true;
    case 'S':
      // SpecialAirS_CollCB runs ft_80081D0C and ignores the landing, leaving the rush airborne on
      // the floor; the port lets it carry on as the grounded rush, frame kept.
      f.velocity = { x: f.velocity.x, y: 0 }; enter(f, 'S', true); return true;
    default:
      // The *_CollCB air→ground swaps (ftCommon_8007D7FC) keep the animation frame.
      f.velocity = { x: f.velocity.x, y: 0 }; enter(f, r.state, true); return true;
  }
}

/** ft_80084F3C on the ground, ft_80084DB0 (gravity, fast fall, drift) in the air. */
function stationary(f: MatchFighter, input: PlayerInput, physics: MeleePhysics): void {
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.air(f.slot, f.velocity, input.x, f.fastFall);
}
/** ft_80084F3C on the ground, ft_80084EEC (gravity and air friction, no drift) in the air. */
function stationaryNoDrift(f: MatchFighter, physics: MeleePhysics): void {
  const a = f.content.profile.attributes;
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
}
/** ft_80084FA8 / ft_80085134 on a root-motion figatree: the animation's own translation. */
function rootMotion(f: MatchFighter, physics: MeleePhysics): { x: number; y: number } {
  const d = rootDelta(f);
  return physics.motion(f.slot, d.z, f.grounded ? 0 : d.y, f.facing);
}

export function stepLizardonSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.lizardon!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] };
  if (s.age === 0) {
    // Deferred Enter work that needs the engine's start pose to be in place.
    if (r.state === 'Lw') { enter(f, 'Lw'); out.shots.push(rockShot(f)); }
    else enter(f, r.state);
  } else if (r.wasGrounded && !f.grounded && leftGround(f, p, finish)) { r.wasGrounded = false; return out; }
  r.wasGrounded = f.grounded;
  s.age++;
  if (!input.special) s.released = true;
  switch (r.state) {
    case 'NStart':
      // SpecialN_Start_AnimCB → the loop.
      if (animationDone(f)) { enter(f, 'NLoop'); return neutralLoop(f, input, physics, p, out); }
      stationary(f, input, physics); return out;
    case 'NLoop':
      // SpecialN_Loop_AnimCB: a camera quake every x30 frames (visual only here).
      wrap(f); r.quake = r.quake > p.neutral.quakeFrames ? 0 : r.quake + 1;
      return neutralLoop(f, input, physics, p, out);
    case 'NEnd':
      // SpecialN_End_AnimCB: Wait on the ground, Fall in the air.
      if (animationDone(f)) { finish(); return out; }
      stationary(f, input, physics); return out;
    case 'SStart': {
      // SpecialS_Start_AnimCB → SpecialS_Enter / SpecialAirS_Enter.
      if (animationDone(f)) { enterRush(f); return stepRush(f, physics, p, out, finish); }
      // Ground: ft_80084FA8 (root motion); air: ftCommon_Fall at x44 gravity, x48 cap.
      if (f.grounded) f.velocity = { x: rootMotion(f, physics).x, y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, p.side.airStartGravity, p.side.airStartTerminal, 0);
      return out;
    }
    case 'S': return stepRush(f, physics, p, out, finish);
    case 'SEnd': return stepRushEnd(f, physics, p, out, finish);
    case 'Hi': {
      // SpecialHi_AnimCB: special fall (drift x70, landing x78) once the flight plays out.
      if (animationDone(f)) { finish(true, p.up.landing, p.up.driftAccel); return out; }
      // SpecialHi_IASACB: one turn toward any held stick until the script raises flag0 (frame 4).
      if (!r.turned && flag(f, 0, 0) !== 1 && input.x !== 0) { f.facing = input.x > 0 ? 1 : -1; r.turned = true; }
      // SpecialHi_PhysCB: self_vel = state_var drift, ftCommon_8007D3A8 steers it with the stick
      // (x70/x74 of the aerial drift), then the animation's translation is added on top.
      r.drift = physics.drift(f.slot, { x: r.drift.x, y: r.drift.y }, input.x, f32(a.airDriftStickMul * p.up.driftAccel), f32(a.airDriftMax * p.up.driftMax));
      const d = rootDelta(f), root = physics.motion(f.slot, d.z, d.y, f.facing);
      f.velocity = { x: f32(root.x + r.drift.x), y: f32(root.y + r.drift.y) };
      if (f.grounded && f.velocity.y > 0) { f.grounded = false; f.floor = null; }
      return out;
    }
    case 'Lw': {
      // SpecialLw_AnimCB: Wait on the ground, Fall in the air (the rock item dies with the motion).
      if (animationDone(f)) { finish(); return out; }
      // SpecialLw_IASACB: every flag0 the script raises bursts the rock at part 0x34, then clears it.
      for (const write of flagEvents(f, r.flagFrame, 0)) if (write.value === 1) out.shots.push({ player: f.slot, kind: 'lizardon-burst' });
      r.flagFrame = f.animationFrame;
      // ...and flag1 (set by the Enter, cleared by the script on frame 4) allows one turn.
      if (!r.turned && flag(f, 1, 1) !== 0 && input.x !== 0) { f.facing = input.x > 0 ? 1 : -1; r.turned = true; }
      stationaryNoDrift(f, physics); return out;
    }
  }
}

/** SpecialN_Loop (the loop's IASA): flames every third frame from the x3C joint, both pools drain
 * by 1 per frame down to their floors, and past x14 frames the stream lasts only while B is held. */
function neutralLoop(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, p: LizardonSpecialData, out: SpecialStep): SpecialStep {
  const r = f.special!.lizardon!, n = p.neutral, fuel = f.lizardonFuel;
  if (r.loopFrames < n.minFrames || input.special) {
    if (r.cadence === 0) spawnFire(f, p, out, physics);
  } else {
    enter(f, 'NEnd');
  }
  r.cadence = r.cadence + 1 > 2 ? 0 : r.cadence + 1;
  fuel.speed = Math.max(n.speedFuel.min, f32(fuel.speed - 1));
  fuel.size = Math.max(n.sizeFuel.min, f32(fuel.size - 1));
  r.loopFrames = Math.min(n.minFrames, r.loopFrames + 1);
  stationary(f, input, physics);
  return out;
}
/** SpecialN_SpawnFire → SpawnItem_Fire: speed scaled by ft_var1/x20, size by ft_var2/x28; every
 * twelfth flame opens a new shared hit group, every third plays the pool-level roar. */
function spawnFire(f: MatchFighter, p: LizardonSpecialData, out: SpecialStep, physics: MeleePhysics): void {
  const r = f.special!.lizardon!, n = p.neutral, fuel = f.lizardonFuel;
  // fire_effect_table1-3: after a 1/2 flame always a 0/3 one; otherwise an even roll between them.
  const pick = () => Math.floor(physics.random() * 32);
  const outer = r.effect === 1 || r.effect === 2 ? 0 : pick() < 16 ? 0 : 1;
  r.effect = outer === 0 ? (pick() & 8 ? 3 : 0) : (pick() & 8 ? 2 : 1);
  if (r.flames === 0) r.group = ++r.groups;
  out.shots.push({ player: f.slot, kind: 'lizardon-flame', charge: f32(fuel.speed / n.speedFuel.max), rawCharge: f32(fuel.size / n.sizeFuel.max), variant: f.special!.serial * 256 + r.group, effect: r.effect });
  if (r.flames % 3 === 0) {
    const level = (fuel.size - n.sizeFuel.min) / (n.sizeFuel.max - n.sizeFuel.min);
    out.sounds.push(level <= 0.33 ? 0x13f5 : level <= 0.66 ? 0x13f2 : 0x13ef);
  }
  r.flames = (r.flames + 1) % 12;
}
/** OnFrame → RefuelFire: both pools refill outside the flamethrower's first five motions. */
export function refuelLizardon(f: MatchFighter): void {
  const p = f.content.specials.parameters; if (p.kind !== 'Lz') return;
  const r = f.special?.lizardon;
  if (r && (r.state === 'NStart' || r.state === 'NLoop' || (r.state === 'NEnd' && f.grounded))) return;
  const n = p.neutral, fuel = f.lizardonFuel;
  fuel.speed = Math.min(n.speedFuel.max, f32(fuel.speed + n.speedFuel.refill));
  fuel.size = Math.min(n.sizeFuel.max, f32(fuel.size + n.sizeFuel.refill));
}
/** OnRespawn: both pools full again. */
export function resetLizardonFuel(f: MatchFighter): void {
  const p = f.content.specials.parameters; if (p.kind !== 'Lz') return;
  f.lizardonFuel = { speed: p.neutral.speedFuel.max, size: p.neutral.sizeFuel.max };
}

/** SpecialS_Enter / SpecialAirS_Enter (the rush figatrees carry root motion, so no x4C speed). */
function enterRush(f: MatchFighter): void {
  const r = f.special!.lizardon!;
  enter(f, 'S'); r.dashFrames = 0;
  if (!f.grounded) f.velocity = { x: f.velocity.x, y: 0 };
}
/** SpecialS_AnimCB / PhysCB: x54 frames of animation-driven rush, then the end lag. */
function stepRush(f: MatchFighter, physics: MeleePhysics, p: LizardonSpecialData, out: SpecialStep, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const r = f.special!.lizardon!;
  if (++r.dashFrames >= p.side.dashFrames) { enterRushEnd(f, p); return stepRushEnd(f, physics, p, out, finish); }
  f.velocity = rootMotion(f, physics);
  if (f.grounded) f.velocity.y = 0;
  return out;
}
/** SpecialS_End_Enter / SpecialAirS_End_Enter (x5C of the air speed kept). */
function enterRushEnd(f: MatchFighter, p: LizardonSpecialData): void {
  enter(f, 'SEnd');
  if (!f.grounded) f.velocity = { x: f32(f.velocity.x * p.side.airEndSpeed), y: f.velocity.y };
}
/** SpecialS_End_* / SpecialAirS_End_*: flag0 (frame 2/8) starts the braking, the air version
 * falls at x64 and ends in special fall landing at x6C. */
function stepRushEnd(f: MatchFighter, physics: MeleePhysics, p: LizardonSpecialData, out: SpecialStep, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const a = f.content.profile.attributes, braking = flag(f, 0, 0) !== 0;
  if (animationDone(f)) {
    if (f.grounded) finish(); else finish(true, p.side.landing, 1);
    return out;
  }
  if (f.grounded) {
    f.velocity = { x: braking ? groundFriction(f.velocity.x, p.side.endFriction) : f.velocity.x, y: 0 };
  } else {
    let v = f.velocity;
    if (braking) v = physics.customAir(f.slot, v, 0, 99, p.side.airEndFriction);
    f.velocity = physics.customAir(f.slot, v, p.side.airEndGravity, a.terminal, 0);
  }
  return out;
}
/** The *_CollCB ground→air transitions. SpecialS_End before flag2 (frame 6) keeps the end in the
 * air at x5C of the speed and after it just falls; the rush states spend every jump
 * (ftCommon_8007D60C), the rest only the ground jump (ftCommon_8007D5D4). Returns true when the
 * special ended. */
function leftGround(f: MatchFighter, p: LizardonSpecialData, finish: () => void): boolean {
  const r = f.special!.lizardon!;
  if (r.state === 'Hi') return false;
  if (r.state === 'SEnd' && flag(f, 2, 0) !== 0) { finish(); return true; }
  if (r.state === 'SStart' || r.state === 'S') f.jumpsUsed = f.content.profile.attributes.maxJumps;
  else f.jumpsUsed = Math.max(f.jumpsUsed, 1);
  enter(f, r.state, true);
  if (r.state === 'SEnd') f.velocity = { x: f32(f.velocity.x * p.side.airEndSpeed), y: f.velocity.y };
  return false;
}
