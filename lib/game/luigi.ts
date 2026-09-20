import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import type { LuigiSpecialData, DrLuigiSpecialData, LuigiBooSpecialData } from './luigi-data.ts';
import { command, rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';
import type { ActiveHit } from './moves.ts';

/** ftLuigi_MotionVars Green Missile charge/misfire state (ftLg_SpecialS CXX),
 * stored inside the full match snapshot. `flying` marks ftLg_MS_SpecialAirS2 and
 * `hitKey` the launch script whose hitbox it carries. Cyclone/SJP use Mario-style latches. */
export interface LuigiRuntime { charge: number; misfire: boolean; flying: boolean; hitKey: string | null }
const f32 = Math.fround;
const params = (f: MatchFighter): LuigiSpecialData | DrLuigiSpecialData | LuigiBooSpecialData => {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Lg' && p.kind !== 'Dl' && p.kind !== 'Lb') throw new Error('Missing Luigi parameters.');
  return p;
};
export function luigiSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded, r = f.special?.luigi;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') {
    if (phase === 'start') return air ? 'SpecialAirSStart' : 'SpecialSStart';
    if (phase === 'loop') return air ? 'SpecialAirSHold' : 'SpecialSHold';
    if (phase === 'travel') {
      if (r?.flying) return 'SpecialSFly';
      if (r?.misfire) return air ? 'SpecialAirSMisfire' : 'SpecialSMisfire';
      return air ? 'SpecialAirSLaunch' : 'SpecialSLaunch';
    }
    return air ? 'SpecialAirSEnd' : 'SpecialSEnd';
  }
  if (direction === 'up') return air || f.special?.startedAir ? 'SpecialAirHi' : 'SpecialHi';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = luigiSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1;
  f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginLuigiSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f);
  if (direction === 'side') {
    // ftLg_SpecialS_SetVars (x21EC, once on entry): smash-entered missiles start
    // pre-charged and the misfire die HSD_Randi(x44) == 0 is rolled here.
    const smashed = Math.abs(f.previous.x) >= 0.8;
    s.luigi = { charge: smashed ? Math.round(p.side.chargeRate) : 0, misfire: false, flying: false, hitKey: null };
    if (f.grounded) f.velocity.x = f32(f.velocity.x / p.side.traction);
    else { f.velocity.x = f32(f.velocity.x / p.side.traction); f.velocity.y = 0; }
  }
  if (direction === 'up' && !f.grounded) f.velocity.x = f32(f.velocity.x * p.up.velX);
  if (direction === 'down') {
    // Exact enter formula (can dip slightly); grounded spins stay grounded until
    // a mash inside the cmd2 window lifts (mirrors ftLg_SpecialLw_Enter + phys).
    f.velocity.y = f32(p.down.tapMomentum - p.down.tapMax);
    f.velocity.x = Math.max(-p.down.airX, Math.min(p.down.airX, f.velocity.x));
  }
}
/** ftLg_SpecialS damage update (non-misfire): tilt + charge * slope on the
 * launch capsule. Native touches x914[0]; id-0 filter matches every sample. */
export function luigiHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  const s = f.special;
  if ((f.content.profile.kind !== 'Lg' && f.content.profile.kind !== 'Dl' && f.content.profile.kind !== 'Lb') || !s?.luigi || s.direction !== 'side' || s.luigi.misfire) return hits;
  if (s.phase !== 'travel' && s.phase !== 'start') return hits;
  const p = params(f);
  const damage = f32(p.side.damageTilt + s.luigi.charge * p.side.damageSlope);
  return hits.map((hit) => (hit.id === 0 ? { ...hit, damage } : hit));
}
/** The launch script whose hitbox the Fly state carries (Ft_MF_SkipHit keeps x914). */
export function luigiAttackName(f: MatchFighter): string | null {
  const r = f.special?.luigi;
  return f.special?.direction === 'side' && f.special.phase === 'travel' && r?.flying ? r.hitKey : null;
}
/** ftLg_SpecialS_OnGiveDamage (deal_dmg_cb, installed on Fly entry): a connecting missile
 * stops dead (keeping any fall) and enters SpecialAirSEnd. */
export function luigiHitLanded(f: MatchFighter): void {
  if ((f.content.profile.kind !== 'Lg' && f.content.profile.kind !== 'Dl' && f.content.profile.kind !== 'Lb') || f.special?.direction !== 'side' || f.special.phase !== 'travel' || !f.special.luigi?.flying) return;
  f.velocity = { x: 0, y: Math.min(0, f.velocity.y) };
  missileEnd(f);
}
/** ftLg_SpecialSEnd_Enter / ftLg_SpecialAirSEnd_Enter: speed divided by x38, clip from frame 0. */
function missileEnd(f: MatchFighter): void {
  const p = params(f), r = f.special!.luigi!;
  f.velocity.x = f32(f.velocity.x / p.side.endFriction);
  r.flying = false;
  phase(f, 'end');
}
/** ftLg_SpecialSLaunch_Enter / AirSLaunch_Enter: the entry die already chose the clip. */
function launchMissile(f: MatchFighter): void {
  phase(f, 'travel');
  f.special!.luigi!.hitKey = f.animation;
}
/** ftLg_SpecialSFly_Enter on the launch script's command 0: always airborne, charge-scaled
 * (or fixed misfire) velocity, same animation frame, hitbox kept. */
function flyMissile(f: MatchFighter): void {
  const p = params(f), s = f.special!, r = s.luigi!;
  f.grounded = false; f.floor = null;
  f.velocity = r.misfire
    ? { x: f32(p.side.misfireVelX * f.facing), y: f32(p.side.misfireVelY) }
    : { x: f32((p.side.mulX * r.charge + p.side.velX) * f.facing), y: f32(0.5 * p.side.velY + p.side.velY * (0.5 * r.charge / p.side.maxCharge)) };
  r.flying = true;
  f.animation = 'SpecialSFly'; f.attackName = r.hitKey; s.lastFrame = f.animationFrame;
}
/** Original ftLg orchestration over the prototype floor adapter. */
export function stepLuigiSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, r = s.luigi!, p = params(f), a = f.content.profile.attributes;
  // DrLuigi/LuigiBoo scripts reference Luigi-bank cues absent from the ACE disc;
  // voice their own banks instead (Luigi keeps script audio). Base 2246/2206:
  // N/S/Hi/Lw samples by direction.
  const voice = p.kind === 'Dl' ? { neutral: 2248, side: 2260, up: 2268, down: 2258 }
    : p.kind === 'Lb' ? { neutral: 2208, side: 2220, up: 2228, down: 2218 } : null;
  const result: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 && voice ? [voice[s.direction]] : [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const ordinary = (gravity = a.gravity, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, a.terminal, friction);
  };
  const gather = () => { const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame; return events; };
  if (s.direction === 'neutral') {
    if (ended()) { finish(false, 0, 1); return result; }
    // Same flag-24 fireball spawn contract as Mario (verified script event).
    const evs = gather();
    if (evs.some((e) => e.type === 'flag' && e.flag === 24)) result.shots.push({ player: f.slot, kind: 'fireball' });
    ordinary();
  } else if (s.direction === 'side') {
    const wall = (f.envContact?.wall ?? 0) !== 0;
    if (s.phase === 'start') {
      // ftLg_SpecialS_SetVars runs as x21EC on the first frame: the misfire die.
      if (s.age === 1) r.misfire = Math.floor(physics.random() * p.side.misfireChance) === 0;
      if (ended()) { phase(f, 'loop'); return result; }
      // SStart_Phys: x1C friction only; the air start hangs (cmd0 is never set here).
      if (f.grounded) f.velocity = { x: physics.customAir(f.slot, { x: f.velocity.x, y: 0 }, 0, a.terminal, p.side.startFriction).x, y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, 0, a.terminal, p.side.startFriction);
    } else if (s.phase === 'loop') {
      // SHold_Anim then SHold_IASA: charge, then launch past x0C or on B release.
      if (ended()) phase(f, 'loop');
      r.charge++;
      if (r.charge > p.side.maxCharge || !input.special) {
        // ftLg_SpecialS_Setup efSync 0x50A (common generator 95) at HipN on launch.
        launchMissile(f); (result.effects ??= []).push({ effect: 1290, part: 4 });
        return result;
      }
      ordinary();
    } else if (s.phase === 'travel' && !r.flying) {
      // SpecialS/Misfire_Anim: script command 0 (frame 4) hands over to Fly.
      if (command(f, 0) !== 0) { flyMissile(f); return result; }
      ordinary();
    } else if (s.phase === 'travel') {
      // SpecialAirS2: anim end or a wall ends in AirSEnd; landing is landLuigiSpecial.
      if (ended() || wall) { missileEnd(f); return result; }
      // ftLg_SpecialAirS2_Phys: Fall(x30, x34), then Fall(x40, x34) + x3C friction after the
      // Fly script's command 0 (frame 24).
      const late = command(f, 0) !== 0;
      f.velocity = physics.customAir(f.slot, f.velocity, late ? p.side.gravityMul : p.side.mulY, p.side.gravityStart, late ? p.side.endDecel : 0);
    } else {
      // SEnd -> Wait, AirSEnd -> Fall (never helpless): x3C friction, x40 gravity in the air.
      if (ended()) { finish(false, 0, 1); return result; }
      if (f.grounded) f.velocity = { x: physics.customAir(f.slot, { x: f.velocity.x, y: 0 }, 0, a.terminal, p.side.endDecel).x, y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, p.side.gravityMul, a.terminal, p.side.endDecel);
    }
  } else if (s.direction === 'up') {
    if (ended()) { finish(true, p.up.landing, p.up.mobility); return result; }
    result.handled = true;
    // Super Jump Punch mirrors Mario's aim/reverse shape with Luigi's ranges.
    if (command(f, 0) === 0 && Math.abs(input.x) > p.up.momentumRange) {
      const angle = p.up.angleDiff * ((Math.abs(input.x) - p.up.momentumRange) / (1 - p.up.momentumRange)) * Math.PI / 180;
      if (Math.abs(angle) > Math.abs(s.aim === Math.PI / 2 ? 0 : s.aim)) s.aim = input.x > 0 ? -angle : angle;
    }
    if (pressed && Math.abs(input.x) > p.up.reverse) f.facing = input.x > 0 ? 1 : -1;
    if (gather().some((e) => e.type === 'flag' && e.flag === 101) || command(f, 0) !== 0) { f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps; }
    const delta = rootDelta(f);
    const angle = s.aim === Math.PI / 2 ? 0 : s.aim;
    if (!s.startedAir || command(f, 0) !== 0) f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing, angle);
    else f.velocity = physics.customAir(f.slot, f.velocity, p.up.gravity, a.terminal, 0);
    if (command(f, 0) !== 0 && !f.grounded) {
      f.velocity = { x: f32(f.velocity.x * p.up.velY), y: f32(f.velocity.y * p.up.velY) };
    }
  } else {
    // Cyclone: grounded spins stay grounded (ApplyGroundMovement + end friction
    // once cmd0); a fresh B press inside the cmd2 script window adds TAP_Y_VEL_MAX
    // and goes airborne; airborne mashing ascends toward TAP_Y_VEL_MAX, else
    // normal falling applies. Single-tap grounded cyclones land almost at once.
    if (ended()) {
      if (!f.grounded) f.tornadoUsed = true;
      finish(false, 0, 1); return result;
    }
    result.handled = true;
    const mashable = command(f, 2) !== 0;
    if (pressed && mashable) {
      if (f.grounded) {
        f.velocity.y = f32(f.velocity.y + p.down.tapMax);
        f.grounded = false; f.floor = null;
        if (f.animation === 'SpecialLw') { f.animation = 'SpecialAirLw'; f.attackName = f.animation; }
      } else {
        // ftCommon_Ascend(max, step): rise toward the cap by the tap gravity.
        f.velocity.y = f32(Math.min(f.velocity.y + p.down.tapGravity, p.down.tapMax));
        f.grounded = false; f.floor = null;
      }
    }
    if (f.grounded) {
      const active = command(f, 0) !== 0;
      f.velocity = physics.drift(f.slot, f.velocity, input.x, p.down.groundMul, Math.max(0, p.down.groundX + s.driftLimit));
      if (active) s.driftLimit = f32(s.driftLimit - p.down.endFriction);
      f.velocity.y = 0;
    } else {
      f.velocity = physics.drift(f.slot, f.velocity, input.x, p.down.airMul, Math.max(0, p.down.airX + s.driftLimit));
      if (command(f, 0) !== 0) s.driftLimit = f32(s.driftLimit - p.down.endFriction);
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
    }
    s.lastFrame = f.animationFrame;
  }
  return result;
}
export function landLuigiSpecial(f: MatchFighter, finish: (helpless: boolean, lag: number, mobility: number) => void): boolean {
  const s = f.special; if (!s) return false;
  const p = params(f);
  if (s.direction === 'up') { finish(false, 0, 1); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.ceil(p.up.landing); return true; }
  if (s.direction === 'down') { f.tornadoUsed = true; finish(false, 0, 1); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = p.down.landing; return true; }
  if (s.direction === 'side' && ((s.phase === 'travel' && s.luigi?.flying) || s.phase === 'end')) {
    // ftLg_SpecialAirS2_Coll / AirSEnd_Coll: touching down enters SpecialSEnd from frame 0.
    f.velocity.y = 0;
    if (s.phase === 'travel') missileEnd(f);
    else { f.velocity.x = f32(f.velocity.x / p.side.endFriction); phase(f, 'end'); }
    return true;
  }
  f.animation = luigiSpecialName(f, s.direction, s.phase); f.attackName = luigiAttackName(f) ?? f.animation; return true;
}
