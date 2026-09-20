import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { PeachSpecialData, PeachArticles } from './peach-data.ts';
import type { DaisySpecialData } from './daisy-data.ts';
import type { SpecialDirection } from './special-data.ts';
import type { CommonGameplayData } from './data.ts';
import { rootDelta, type ShotIntent, type SpecialRuntime, type SpecialStep } from './specials.ts';
import { LIGHT_ITEM_MOTIONS } from './item-common.ts';

/** ftPe_MotionVars plus the float clock, snapshot-owned on the fighter/special. Bomber:
 * `bomberStop` is cmd_vars[0] (a wall/ceiling cut the SStart), `bomberFriction` cmd_vars[1]
 * (the SJump script's frame-4 brake), `hitConnected` cmd_vars[2] (explosion + rebound). */
export interface PeachRuntime { hitConnected: boolean; sporeFired: boolean; parasolOpen: boolean; bomberStop: boolean; bomberFriction: boolean; wasGrounded: boolean }
const f32 = Math.fround;
/** Peach and Daisy (whose m-ex kit runs the same ftPe callbacks on her own attributes). */
export const isPeachKit = (f: MatchFighter): boolean => f.content.profile.kind === 'Pe' || f.content.profile.kind === 'Da';
const params = (f: MatchFighter): PeachSpecialData | DaisySpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Pe' && p.kind !== 'Da') throw new Error('Missing Peach parameters.'); return p;
};
export const peachArticles = (f: MatchFighter): PeachArticles => {
  const articles = f.content.specials.articles.peach; if (!articles) throw new Error('Missing Peach articles.'); return articles;
};
export function peachSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir', r = f.special?.peach;
  if (direction === 'neutral') return phase === 'hit' ? `${prefix}NHit` : `${prefix}N`;
  // ftPe_MS_SpecialAirSJump plays SpecialSJump; AirSEnd_1 follows a contact, AirSEnd_0 a whiff.
  if (direction === 'side') return phase === 'start' ? `${prefix}SStart` : phase === 'travel' ? 'SpecialSJump' : f.grounded ? 'SpecialSEnd' : r?.hitConnected ? 'SpecialAirSEnd1' : 'SpecialAirSEnd0';
  if (direction === 'up') return phase === 'start' ? `${prefix}HiStart` : phase === 'travel' ? 'ItemParasolOpen' : phase === 'hit' ? 'ItemParasolFall' : `${prefix}HiEnd`;
  return r?.parasolOpen ? 'SpecialLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = peachSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginPeachSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), s = f.special!;
  s.peach = { hitConnected: false, sporeFired: false, parasolOpen: false, bomberStop: false, bomberFriction: false, wasGrounded: f.grounded };
  // ftPe_SpecialS_Enter / ftPe_SpecialAirS_Enter.
  if (direction === 'side') {
    if (f.grounded) f.velocity = { x: f32(p.bomber.enterVelX * f.facing), y: 0 };
    else f.velocity = { x: f.velocity.x, y: p.bomber.airStartVelY };
  }
  if (direction === 'up') { f.velocity.y = Math.max(0, f.velocity.y); f.jumpsUsed = f.content.profile.attributes.maxJumps; }
  if (direction === 'neutral' && !f.grounded) { f.velocity.x = f32(f.velocity.x / p.toad.airVelXDiv); f.velocity.y = 0; }
}
/** Toad's counter bubble (ShieldDesc xAC) while the SpecialN pose holds. */
export function peachToadCounter(f: MatchFighter): { bone: number; offset: [number, number, number]; radius: number } | null {
  if (!isPeachKit(f) || f.state !== 'special') return null;
  const s = f.special;
  if (!s || s.direction !== 'neutral' || s.phase !== 'start' || f.animationFrame < 2) return null;
  const p = params(f);
  return { bone: p.toad.counter.bone, offset: [...p.toad.counter.offset] as [number, number, number], radius: p.toad.counter.radius };
}
/** onUnkHit: a blocked hit swaps into SpecialNHit (Toad item to its state 1). The spores come
 * later, one per SpecialNHit script command 3 (doHitAnim -> onHitAccessory4), from the step. */
export function triggerPeachToad(f: MatchFighter): ShotIntent[] {
  const s = f.special;
  if (!s || s.peach?.sporeFired) return [];
  s.peach!.sporeFired = true;
  phase(f, 'hit');
  return [];
}
/** ftPe_AttackS4_Enter: the forward smash draws a random weapon, never twice in a row. */
export function peachSmashName(f: MatchFighter, physics: MeleePhysics): string {
  if (!isPeachKit(f)) return f.content.moves.strong;
  const names = ['AttackS4Club', 'AttackS4Pan', 'AttackS4Racket'];
  let pick: number;
  do { pick = Math.floor(physics.random() * names.length) % names.length; } while (pick === f.peachLastSmash);
  f.peachLastSmash = pick;
  return names[pick]!;
}
/** ftPe_Float: hover on held jump for the xC duration; one float per airtime. */
export function stepPeachFloat(f: MatchFighter, input: PlayerInput): void {
  if (!isPeachKit(f)) return;
  if (f.grounded) { f.peachFloat = { available: true, timer: 0 }; return; }
  const jumpHeld = input.jump;
  const floating = f.animation === 'Fuwafuwa';
  if (floating) {
    f.peachFloat.timer -= 1;
    if (!jumpHeld || f.peachFloat.timer <= 0) { f.state = 'fall'; f.animation = 'Fall'; f.animationFrame = 0; f.animationEpoch++; return; }
    f.velocity.y = 0;
    return;
  }
  if (f.peachFloat.available && jumpHeld && f.velocity.y <= 0 && f.jumpsUsed >= f.content.profile.attributes.maxJumps && ['jump', 'airjump', 'fall'].includes(f.state)) {
    const p = params(f);
    f.peachFloat = { available: false, timer: Math.ceil(p.float.duration) };
    f.state = 'fall'; f.animation = 'Fuwafuwa'; f.animationFrame = 0; f.animationEpoch++;
    f.velocity.y = 0;
  }
}
/** Held turnip: attack or grab throws it with the shared common item-throw velocities. */
export function peachThrowTurnip(f: MatchFighter, input: PlayerInput, previous: PlayerInput, common: CommonGameplayData, shots: ShotIntent[]): boolean {
  if (!isPeachKit(f) || f.peachTurnip === null) return false;
  if (!['idle', 'walk', 'run', 'jump', 'airjump', 'fall'].includes(f.state)) return false;
  const attack = input.attack && !previous.attack, grab = !!input.grab && !previous.grab;
  if (!attack && !grab) return false;
  const y = input.y ?? (input.down ? -1 : 0);
  const direction = y > 0.5 ? 2 : y < -0.5 ? 3 : input.x * f.facing < -0.28 ? 1 : 0;
  const index = (f.grounded ? 0 : 6) + direction;
  const name = LIGHT_ITEM_MOTIONS[index]!;
  const throwSpec = common.itemThrows?.[index];
  if (!throwSpec) throw new Error('Missing original item throw table.');
  if (direction === 1) f.facing = -f.facing;
  f.state = 'item-throw'; f.animation = name; f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = null;
  shots.push({ player: f.slot, kind: 'turnip', charge: f.peachTurnip, aim: throwSpec.angle, rawCharge: throwSpec.speed });
  f.peachTurnip = null;
  return true;
}
export function landPeachSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!;
  if (s.direction === 'up' && (s.phase === 'travel' || s.phase === 'hit' || s.phase === 'end')) {
    finish(); f.state = 'landing'; f.animation = 'Landing'; f.animationFrame = 0; f.animationEpoch++;
    f.landingFrames = 12; return true;
  }
  // ftPe_SpecialAirSJump_Coll: touching down mid-launch plays the grounded SpecialSEnd from
  // its first frame (enterEndSmash, no explosion). SStart/AirSEnd swap to their ground twins
  // keeping the frame (ftCommon_AirToGroundStateChange).
  if (s.direction === 'side' && s.phase === 'travel') { f.velocity.y = 0; phase(f, 'end'); return true; }
  f.animation = peachSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
/** ftPe doAirEnd0 (the SJump detect box's hurtbox_detect_cb): a fighter contact zeroes the
 * launch, then enterAirEndSmash spawns the explosion item at HipN and rebounds. Returns the
 * explosion intent for the caller to spawn (impact-stage spawns bypass the drained shot queue). */
export function peachBomberDetect(f: MatchFighter): ShotIntent | null {
  if (!isPeachKit(f) || f.special?.direction !== 'side' || f.special.phase !== 'travel' || f.special.peach?.hitConnected) return null;
  f.velocity = { x: 0, y: Math.min(0, f.velocity.y) };
  return bomberAirEnd(f, true);
}
/** enterAirEndSmash + doPostEnd_SmallerStack. */
function bomberAirEnd(f: MatchFighter, hit: boolean): ShotIntent | null {
  const p = params(f), r = f.special!.peach!;
  f.velocity = { x: f32(f.velocity.x / p.bomber.hitDivX), y: f32(f.velocity.y / p.bomber.hitDivY) };
  r.hitConnected = hit;
  phase(f, 'end');
  if (!hit) return null;
  f.velocity = { x: f32(p.bomber.endVelX * f.facing), y: p.bomber.endVelY };
  return { player: f.slot, kind: 'peach-blast' };
}
/** ftpeachspecials.c over the prototype floor solver: SStart drives toward x3C (or falls in the
 * air), launches into SpecialSJump at x44/x4C, and the SJump's element-11 detect box turns a
 * contact into the explosion item + rebound (peachBomberDetect). Wall/ceiling contacts latch
 * cmd_vars[0]; the AirSEnd tail drops into an ordinary Fall, never helpless. */
function stepBomber(f: MatchFighter, p: PeachSpecialData | DaisySpecialData, physics: MeleePhysics, end: boolean, out: SpecialStep, finish: () => void): SpecialStep {
  const s = f.special!, r = s.peach!, a = f.content.profile.attributes;
  const commands = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.type === 'command' && e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  const wall = (f.envContact?.wall ?? 0) === f.facing, ceiling = !f.grounded && !!f.envContact?.ceiling;
  const airborne = () => { f.grounded = false; f.floor = null; };
  if (s.phase === 'start') {
    // SStart_Coll: leaving the ground mid-drive zeroes the horizontal speed (enterAirStart).
    if (r.wasGrounded && !f.grounded) f.velocity.x = 0;
    r.wasGrounded = f.grounded;
    if (end) {
      if (r.bomberStop) {
        // enterEndSmash (ground) / enterAirEndSmash (air) without a contact.
        if (f.grounded) phase(f, 'end'); else bomberAirEnd(f, false);
        return out;
      }
      if (f.grounded) {
        // ftPe_SpecialSStart_Anim hops the body up and back before the launch.
        const scale = a.modelScale;
        f.x = f32(f.x - 4 * f.facing * scale); f.y = f32(f.y + 3.5 * scale); airborne();
      }
      // enterAirJump: x30 is 0 on both discs, so the x48 smash speed never applies.
      f.velocity = { x: f32(p.bomber.velX * f.facing), y: p.bomber.velY };
      r.bomberFriction = false;
      phase(f, 'travel');
      return out;
    }
    if (f.grounded) {
      // ftCommon_8007CA80: accelerate by x38 toward the x3C cap.
      const accel = f32(p.bomber.startAccel * f.facing), target = f32(p.bomber.startVelX * f.facing);
      let step = accel;
      if (f.velocity.x * accel >= 0) step = accel > 0 ? Math.min(accel, target - f.velocity.x) : Math.max(accel, target - f.velocity.x);
      f.velocity = { x: f32(f.velocity.x + step), y: 0 };
      if (wall) { f.velocity.x = 0; r.bomberStop = true; }
    } else {
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
      if (ceiling) { f.velocity.y = 0; r.bomberStop = true; }
      if (wall) { f.velocity.x = 0; r.bomberStop = true; }
    }
    return out;
  }
  if (s.phase === 'travel') {
    if (commands.some((e) => e.type === 'command' && e.index === 1 && e.value)) r.bomberFriction = true;
    // ftPe_SpecialAirSJump_Anim: script command 3 (frame 25) or the clip end closes a whiff.
    if (end || commands.some((e) => e.type === 'command' && e.index === 3 && e.value)) { bomberAirEnd(f, false); return out; }
    // SJump_Coll: a wall ahead detonates like a fighter contact.
    if (wall) { const blast = bomberAirEnd(f, true); if (blast) out.shots.push(blast); return out; }
    f.velocity = physics.customAir(f.slot, f.velocity, r.bomberFriction ? p.bomber.hitGravity : p.bomber.gravity, p.bomber.terminal, r.bomberFriction ? p.bomber.airFriction : 0);
    return out;
  }
  // SpecialSEnd -> Wait, SpecialAirSEnd -> Fall.
  if (end) { finish(); return out; }
  if (f.grounded) { r.hitConnected = false; f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; }
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
/** Original ftPe orchestration over the prototype floor solver; the rare Bob-omb/Saturn/
 * Beam Sword pulls, turnip re-catching and the held-item presentation are not ported. */
export function stepPeachSpecial(f: MatchFighter, input: PlayerInput, _pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, a = f.content.profile.attributes;
  // Daisy's special cries come straight from daisy.ssm (no SEM script for her bank).
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 && p.kind === 'Da' ? [p.voices[s.direction]] : [] }; s.age++;
  if (!input.special) s.released = true;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const stationary = () => { if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 }; else f.velocity = physics.customAir(f.slot, f.velocity, p.toad.fallAccel, p.toad.terminal, p.toad.airFriction); };
  if (s.direction === 'neutral') {
    // SpecialNHit: each command 3 (frames 10–26) releases one spore at FtPart 109 (+2.5 y).
    const commands = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.type === 'command' && e.frame > s.lastFrame && e.frame <= f.animationFrame);
    s.lastFrame = f.animationFrame;
    if (s.phase === 'hit') for (const e of commands) if (e.type === 'command' && e.index === 3 && e.value) out.shots.push({ player: f.slot, kind: 'toad-spore' });
    if (end) { finish(); return out; }
    stationary(); return out;
  }
  if (s.direction === 'side') return stepBomber(f, p, physics, end, out, () => finish());
  if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (end || (!f.grounded && f.stateFrame >= p.parasol.riseFrames && s.age > 8)) { s.peach!.parasolOpen = true; phase(f, 'travel'); return out; }
      const delta = rootMotionParasol(f, physics);
      f.velocity = delta;
      return out;
    }
    if (s.phase === 'travel') {
      // ItemParasolOpen: a slow damped fall; stick down folds the parasol.
      if ((input.y ?? 0) < -0.6 || input.down || s.age > p.parasol.timeout) { phase(f, 'hit'); return out; }
      f.velocity = physics.customAir(f.slot, f.velocity, 0.02, 0.5, 0.01);
      f.velocity.x = f32(f.velocity.x + input.x * 0.03);
      return out;
    }
    // Folded fall: ordinary helpless-style descent until landing.
    f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0.01);
    return out;
  }
  // Turnip pull: spawnVeg on the script's throw flag (flag 24, frame 1) puts the turnip straight
  // into the hand (ftpickupitem_80094818); it_802BD32C rolls the face with HSD_Randi(total odds).
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame);
  s.lastFrame = f.animationFrame;
  if (f.peachTurnip === null && events.some((e) => e.type === 'flag' && e.flag === 24)) {
    const faces = peachArticles(f).turnip.faces;
    const total = faces.reduce((sum, face) => sum + face.odds, 0);
    const roll = Math.floor(physics.random() * total);
    let face = faces.length - 1;
    for (let i = 0, cumulative = 0; i < faces.length; i++) { cumulative += faces[i]!.odds; if (roll < cumulative) { face = i; break; } }
    f.peachTurnip = face;
  }
  if (end) { finish(); return out; }
  if (f.grounded) f.velocity = { x: physics.stationaryGround(f.slot, f.velocity.x), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction);
  return out;
}
function rootMotionParasol(f: MatchFighter, physics: MeleePhysics): { x: number; y: number } {
  // The parasol rise follows the original root motion of SpecialHiStart.
  const delta = rootDelta(f);
  const v = physics.motion(f.slot, delta.z, delta.y, f.facing);
  if (v.y > 0.01) { f.grounded = false; f.floor = null; }
  return v;
}
