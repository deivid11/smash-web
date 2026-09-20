import type { MatchFighter, PlayerInput, FighterState } from './match.ts';
import type { MeleePhysics, Velocity } from './physics.ts';
import type { SpecialDirection, KirbySpecialData, CopySource } from './special-data.ts';
import type { FighterKind } from './data.ts';
import type { SpecialRuntime, SpecialStep } from './specials.ts';
import type { FighterContent } from './load.ts';
import { command, rootDelta } from './specials.ts';

/** Kirby motion states whose figatree names repeat inside PlKb.dat (ftKb_SM order).
 * Each engine key is loaded from its own action-table entry and the figatree name is
 * verified, so no clip is borrowed from another state or character. */
export const KIRBY_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string; joints?: number }> = [
  { key: 'SpecialN', index: 259, figatree: 'SpecialN' }, { key: 'SpecialNLoop', index: 260, figatree: 'SpecialNLoop' },
  { key: 'SpecialNEnd', index: 261, figatree: 'SpecialNEnd' }, { key: 'SpecialNCapture', index: 262, figatree: 'SpecialNLoop' },
  { key: 'Eat', index: 263, figatree: 'Eat' }, { key: 'EatWait', index: 264, figatree: 'EatWait' },
  { key: 'EatWalkSlow', index: 265, figatree: 'EatWalkSlow' }, { key: 'EatWalkMiddle', index: 266, figatree: 'EatWalkMiddle' }, { key: 'EatWalkFast', index: 267, figatree: 'EatWalkFast' },
  { key: 'SpecialNDrink', index: 272, figatree: 'SpecialNDrink' }, { key: 'SpecialNSpit', index: 273, figatree: 'SpecialNSpit' },
  { key: 'SpecialAirN', index: 274, figatree: 'SpecialN' }, { key: 'SpecialAirNLoop', index: 275, figatree: 'SpecialNLoop' },
  { key: 'SpecialS', index: 276, figatree: 'SpecialS' }, { key: 'SpecialAirS', index: 277, figatree: 'SpecialAirS' },
  { key: 'SpecialHi1', index: 278, figatree: 'SpecialHi1' }, { key: 'SpecialHi2', index: 279, figatree: 'SpecialHi2' },
  { key: 'SpecialHi3', index: 280, figatree: 'SpecialHi3' }, { key: 'SpecialHi4', index: 281, figatree: 'SpecialHi4' },
  { key: 'SpecialAirHi1', index: 282, figatree: 'SpecialAirHi1' }, { key: 'SpecialAirHi2', index: 283, figatree: 'SpecialAirHi2' },
  { key: 'SpecialAirHi3', index: 284, figatree: 'SpecialAirHi3' }, { key: 'SpecialAirHiEnd', index: 285, figatree: 'SpecialAirHi4' },
  { key: 'SpecialLw1', index: 286, figatree: 'SpecialLw1' }, { key: 'SpecialLw', index: 287, figatree: 'SpecialLw2' },
  { key: 'SpecialLwEnd', index: 288, figatree: 'SpecialLw2' }, { key: 'SpecialAirLwStart', index: 289, figatree: 'SpecialAirLw1' },
  { key: 'SpecialAirLw', index: 290, figatree: 'SpecialAirLw2' }, { key: 'SpecialAirLwEnd', index: 291, figatree: 'SpecialAirLw2' },
  // Copy abilities (ftkirbyspecial*.c). Keys are prefixed by the roster source kind; the
  // Young Link and Roy entries reuse the Link/Marth figatree names in their clone sections.
  { key: 'MrSpecialN', index: 292, figatree: 'MrSpecialN' }, { key: 'MrSpecialAirN', index: 293, figatree: 'MrSpecialAirN' },
  { key: 'FxSpecialNStart', index: 312, figatree: 'FxSpecialNStart' }, { key: 'FxSpecialNLoop', index: 313, figatree: 'FxSpecialNLoop' }, { key: 'FxSpecialNEnd', index: 314, figatree: 'FxSpecialNEnd' },
  { key: 'FxSpecialAirNStart', index: 315, figatree: 'FxSpecialAirNStart' }, { key: 'FxSpecialAirNLoop', index: 316, figatree: 'FxSpecialAirNLoop' }, { key: 'FxSpecialAirNEnd', index: 317, figatree: 'FxSpecialAirNEnd' },
  { key: 'LkSpecialNStart', index: 294, figatree: 'LkSpecialNStart' }, { key: 'LkSpecialNLoop', index: 295, figatree: 'LkSpecialNLoop' }, { key: 'LkSpecialNEnd', index: 296, figatree: 'LkSpecialNEnd' },
  { key: 'LkSpecialAirNStart', index: 297, figatree: 'LkSpecialAirNStart' }, { key: 'LkSpecialAirNLoop', index: 298, figatree: 'LkSpecialAirNLoop' }, { key: 'LkSpecialAirNEnd', index: 299, figatree: 'LkSpecialAirNEnd' },
  { key: 'SsSpecialNStart', index: 300, figatree: 'SsSpecialNStart' }, { key: 'SsSpecialNHold', index: 301, figatree: 'SsSpecialNHold' }, { key: 'SsSpecialNCancel', index: 302, figatree: 'SsSpecialNCancel' },
  { key: 'SsSpecialN', index: 303, figatree: 'SsSpecialN' }, { key: 'SsSpecialAirNStart', index: 304, figatree: 'SsSpecialAirNStart' }, { key: 'SsSpecialAirN', index: 305, figatree: 'SsSpecialAirN' },
  { key: 'PkSpecialN', index: 318, figatree: 'PkSpecialN' }, { key: 'PkSpecialAirN', index: 319, figatree: 'PkSpecialAirN' },
  { key: 'CaSpecialN', index: 322, figatree: 'CaSpecialN' }, { key: 'CaSpecialAirN', index: 323, figatree: 'CaSpecialAirN' },
  { key: 'DkSpecialNStart', index: 344, figatree: 'DkSpecialNStart' }, { key: 'DkSpecialNLoop', index: 345, figatree: 'DkSpecialNLoop' }, { key: 'DkSpecialNCancel', index: 346, figatree: 'DkSpecialNCansel' },
  { key: 'DkSpecialN', index: 347, figatree: 'DkSpecialN' }, { key: 'DkSpecialNFull', index: 348, figatree: 'DkSpecialN' },
  { key: 'DkSpecialAirNStart', index: 349, figatree: 'DkSpecialAirNStart' }, { key: 'DkSpecialAirNLoop', index: 350, figatree: 'DkSpecialAirNLoop' }, { key: 'DkSpecialAirNCancel', index: 351, figatree: 'DkSpecialAirNCancel' },
  { key: 'DkSpecialAirN', index: 352, figatree: 'DkSpecialAirN' }, { key: 'DkSpecialAirNFull', index: 353, figatree: 'DkSpecialAirN' },
  // The Mewtwo hat animates its own tail bones: these figatrees carry 53 tracks; only Kirby's 46 are sampled.
  { key: 'MtSpecialNStart', index: 389, figatree: 'MtSpecialNStart', joints: 53 }, { key: 'MtSpecialNLoop', index: 390, figatree: 'MtSpecialNLoop', joints: 53 }, { key: 'MtSpecialNLoopFull', index: 391, figatree: 'MtSpecialNLoop', joints: 53 },
  { key: 'MtSpecialNCancel', index: 392, figatree: 'MtSpecialNCancel', joints: 53 }, { key: 'MtSpecialNEnd', index: 393, figatree: 'MtSpecialNEnd', joints: 53 },
  { key: 'MtSpecialAirNStart', index: 394, figatree: 'MtSpecialAirNStart', joints: 53 }, { key: 'MtSpecialAirNLoop', index: 395, figatree: 'MtSpecialAirNLoop', joints: 53 }, { key: 'MtSpecialAirNLoopFull', index: 396, figatree: 'MtSpecialAirNLoop', joints: 53 },
  { key: 'MtSpecialAirNCancel', index: 397, figatree: 'MtSpecialAirNCancel', joints: 53 }, { key: 'MtSpecialAirNEnd', index: 398, figatree: 'MtSpecialAirNEnd', joints: 53 },
  { key: 'ClSpecialNStart', index: 403, figatree: 'LkSpecialNStart' }, { key: 'ClSpecialNLoop', index: 404, figatree: 'LkSpecialNLoop' }, { key: 'ClSpecialNEnd', index: 405, figatree: 'LkSpecialNEnd' },
  { key: 'ClSpecialAirNStart', index: 406, figatree: 'LkSpecialAirNStart' }, { key: 'ClSpecialAirNLoop', index: 407, figatree: 'LkSpecialAirNLoop' }, { key: 'ClSpecialAirNEnd', index: 408, figatree: 'LkSpecialAirNEnd' },
  { key: 'FeSpecialNStart', index: 419, figatree: 'MsSpecialNStart' }, { key: 'FeSpecialNLoop', index: 420, figatree: 'MsSpecialNLoop' }, { key: 'FeSpecialNEnd', index: 421, figatree: 'MsSpecialNEnd' }, { key: 'FeSpecialNEndFull', index: 422, figatree: 'MsSpecialNEnd' },
  { key: 'FeSpecialAirNStart', index: 423, figatree: 'MsSpecialAirNStart' }, { key: 'FeSpecialAirNLoop', index: 424, figatree: 'MsSpecialAirNLoop' }, { key: 'FeSpecialAirNEnd', index: 425, figatree: 'MsSpecialAirNEnd' }, { key: 'FeSpecialAirNEndFull', index: 426, figatree: 'MsSpecialAirNEnd' },
];
/** ftKb_UnkMtxFunc0 draws the copy hat with the matrix of fighter part 6. */
export const COPY_HAT_PART = 6;
/** ftKb_SpecialN_800F5BA4: one chance in specialn_odds_lose_ability_on_hit per damaging hit. */
const LOSE_ABILITY_ODDS = 32;
export const KIRBY_AIR_JUMPS = ['JumpAerialF1', 'JumpAerialF2', 'JumpAerialF3', 'JumpAerialF4', 'JumpAerialF5'] as const;
export const KIRBY_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', strong: 'AttackS4S', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** ftKb_Init_803CB490: draw-set toggles while the stone transformation plays (frames 0–21). */
export const STONE_FLICKER: readonly boolean[] = [false, true, false, false, false, false, true, true, false, false, false, true, true, true, false, false, true, true, true, true, false, true, true];
/** ftKb_Init_803CB4EC: stone shape 1–5 selects visibility alternative 2–6 of model group 0. */
const STONE_ALTERNATIVES = [0, 2, 3, 4, 5, 6] as const;
const CUTTER_LANDING_CHECK_FRAMES = 20; // ftKb_SpecialHi2_Coll: floor snapping starts after this many frames.
const f32 = Math.fround;

const params = (f: MatchFighter): KirbySpecialData => {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Kb') throw new Error('Kirby special data is not loaded.');
  return p;
};
/** Copy-ability motion names: `travel` is the store/cancel state and `end` the release. */
function kirbyCopyName(copy: CopySource, phase: SpecialRuntime['phase'], air: boolean, full: boolean): string {
  const a = air ? 'Air' : '';
  switch (copy) {
    case 'Mr': return `MrSpecial${a}N`;
    case 'Fx': return `FxSpecial${a}N${phase === 'start' ? 'Start' : phase === 'end' ? 'End' : 'Loop'}`;
    case 'Lk': case 'Cl': return `${copy}Special${a}N${phase === 'start' ? 'Start' : phase === 'loop' ? 'Loop' : 'End'}`;
    case 'Pk': return `PkSpecial${a}N`;
    case 'Ca': return `CaSpecial${a}N`;
    // The Samus hold/cancel states only exist grounded; the air flow fires immediately.
    case 'Ss': return phase === 'start' ? `SsSpecial${a}NStart` : phase === 'loop' ? 'SsSpecialNHold' : phase === 'end' ? 'SsSpecialNCancel' : `SsSpecial${a}N`;
    case 'Dk': return phase === 'start' ? `DkSpecial${a}NStart` : phase === 'loop' ? `DkSpecial${a}NLoop` : phase === 'travel' ? `DkSpecial${a}NCancel` : full ? `DkSpecial${a}NFull` : `DkSpecial${a}N`;
    case 'Mt': return phase === 'start' ? `MtSpecial${a}NStart` : phase === 'loop' ? `MtSpecial${a}NLoop${full ? 'Full' : ''}` : phase === 'travel' ? `MtSpecial${a}NCancel` : `MtSpecial${a}NEnd`;
    case 'Fe': return phase === 'start' ? `FeSpecial${a}NStart` : phase === 'loop' ? `FeSpecial${a}NLoop` : `FeSpecial${a}NEnd${full ? 'Full' : ''}`;
    // Clone-template copies reuse their donor's Kirby animations until dedicated hats land.
    case 'Fc': return `FxSpecial${a}N${phase === 'start' ? 'Start' : phase === 'end' ? 'End' : 'Loop'}`;
    case 'Dr': return `MrSpecial${a}N`;
    case 'Pc': return `PkSpecial${a}N`;
    case 'Gn': return `CaSpecial${a}N`;
    case 'Ms': return phase === 'start' ? `FeSpecial${a}NStart` : phase === 'loop' ? `FeSpecial${a}NLoop` : `FeSpecial${a}NEnd${full ? 'Full' : ''}`;
    default: return phase === 'start' ? (air ? 'SpecialAirN' : 'SpecialN') : phase === 'loop' ? (air ? 'SpecialAirNLoop' : 'SpecialNLoop') : 'SpecialNEnd';
  }
}
export function kirbySpecialName(direction: SpecialDirection, phase: SpecialRuntime['phase'], air: boolean, startedAir: boolean, copy: FighterKind | null = null, full = false): string {
  if (direction === 'neutral' && copy && copy !== 'Kb' && !copy.startsWith('custom:')) return kirbyCopyName(copy as CopySource, phase, air, full);
  if (direction === 'neutral') return phase === 'start' ? (air ? 'SpecialAirN' : 'SpecialN') : phase === 'loop' ? (air ? 'SpecialAirNLoop' : 'SpecialNLoop') : phase === 'hit' ? 'SpecialNCapture' : 'SpecialNEnd';
  if (direction === 'side') return startedAir ? 'SpecialAirS' : 'SpecialS';
  if (direction === 'up') return phase === 'start' ? (air ? 'SpecialAirHi1' : 'SpecialHi1') : phase === 'travel' ? 'SpecialAirHi2' : phase === 'loop' ? 'SpecialAirHi3' : (air ? 'SpecialAirHiEnd' : 'SpecialHi4');
  return phase === 'start' ? (air ? 'SpecialAirLwStart' : 'SpecialLw1') : phase === 'loop' ? (air ? 'SpecialAirLw' : 'SpecialLw') : (air ? 'SpecialAirLwEnd' : 'SpecialLwEnd');
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = kirbySpecialName(s.direction, next, !f.grounded, s.startedAir, f.copyAbility, s.copyFull); f.animationFrame = 0; f.stateFrame = 0; f.animationRate = 1; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
/** Entry velocities/flags from the ftKb_*_Enter routines; the caller assigns the start animation. */
export function beginKirbySpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), s = f.special!;
  if (direction === 'neutral') { s.copyCharge = 0; s.copySwings = 0; s.copyFull = false; s.chargeTicks = 0; }
  if (direction === 'side' && !f.grounded && !f.hammerBoostUsed) { f.velocity.y = p.hammer.airBoost; f.hammerBoostUsed = true; }
  if (direction === 'up') s.reversed = false;
  if (direction === 'down') { s.stoneHp = 0; s.stoneShape = 0; s.stoneFrame = 0; s.stoneFlicker = 0; s.stoneShown = false; s.stoneHeld = p.stone.maxFrames; s.stoneLanded = f.grounded; }
}
/** ftKb_SpecialHi_800F331C: advance the transformation toggle table. */
function stepStoneFlicker(s: SpecialRuntime): void {
  if (!s.stoneFlicker) return;
  s.stoneFrame = (s.stoneFrame ?? 0) + (s.stoneFlicker === 1 ? 1 : -1);
  if (s.stoneFrame >= 0 && s.stoneFrame < 22) s.stoneShown = STONE_FLICKER[s.stoneFrame]!;
  else s.stoneFlicker = 0;
}
const cutterDrift = (f: MatchFighter, physics: MeleePhysics, input: PlayerInput, velocity: Velocity): Velocity => {
  const a = f.content.profile.attributes;
  return physics.drift(f.slot, velocity, input.x, f32(a.airDriftStickMul * params(f).cutter.driftMultiplier), a.airDriftMax);
};
/** Original ftKb_DatAttrs-driven state flow for the four specials, with this prototype's
 * orchestration. Copy abilities, inhaled items and the star projectile are not implemented. */
export function stepKirbySpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, p = params(f), a = f.content.profile.attributes, result: SpecialStep = { handled: true, shots: [], sounds: [] };
  s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const end = ended();
  const gather = () => { const list = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame; return list; };
  let events = gather();
  const groundFriction = () => { f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 }; };
  const airFriction = () => { f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, a.airFriction); };
  const rootMotion = () => { const d = rootDelta(f); f.velocity = physics.motion(f.slot, d.z, d.y, f.facing); };
  if (s.direction === 'neutral' && f.copyAbility === 'Mr' && f.content.copies?.Mr) {
    // ftKb_MrSpecialN: the throw flag spawns Kirby's own copy fireball from LHandN; ordinary physics.
    if (end) { finish(false, 0, 1); return result; }
    result.handled = false;
    if (events.some((e) => e.type === 'flag' && e.flag === 24)) result.shots.push({ player: f.slot, kind: 'fireball', copy: true });
  } else if (s.direction === 'neutral' && f.copyAbility === 'Fx' && f.content.copies?.Fx) {
    // ftKb_FxSpecialN*: Fox's start/loop/end flow; taps queue another loop while cmd_vars[0] is set.
    if (pressed && s.age > 1 && command(f, 0) !== 0) s.queued = true;
    if (end) {
      if (s.phase === 'start') phase(f, 'loop');
      else if (s.phase === 'loop') { if (s.queued) { s.queued = false; phase(f, 'loop'); } else phase(f, 'end'); }
      else { finish(false, 0, 1); return result; }
      events = gather();
    }
    result.handled = false;
    if (events.some((e) => e.type === 'command' && e.index === 2 && e.value === 1)) { result.shots.push({ player: f.slot, kind: 'laser', copy: true }); result.sounds.push(f.facing > 0 ? 110103 : 110106); }
  } else if (s.direction === 'neutral' && (f.copyAbility === 'Ca' || f.copyAbility === 'Pk') && f.content.copies?.[f.copyAbility]) {
    // ftKb_CaSpecialN / ftKb_PkSpecialN: one scripted swing; the copied Thunder Jolt leaves on cmd_vars[0].
    if (end) { finish(false, 0, 1); return result; }
    result.handled = false;
    if (f.copyAbility === 'Pk' && events.some((e) => e.type === 'command' && e.index === 0 && e.value === 1)) result.shots.push({ player: f.slot, kind: 'tjolt', copy: true });
  } else if (s.direction === 'neutral' && (f.copyAbility === 'Lk' || f.copyAbility === 'Cl') && f.content.copies?.[f.copyAbility]) {
    // ftKb_LkSpecialN*: draw, hold to charge, release the arrow on the end script's cmd_vars[1].
    const lp = f.content.copies[f.copyAbility]!.sourceParameters;
    if (lp.kind !== 'Lk' && lp.kind !== 'Cl') throw new Error('Kirby bow copy is missing Link data.');
    if (s.phase === 'start') { if (end) { phase(f, 'loop'); events = gather(); } }
    else if (s.phase === 'loop') {
      s.copyCharge = Math.min(lp.neutral.chargeFrames, (s.copyCharge ?? 0) + 1);
      if (!input.special) { phase(f, 'end'); events = gather(); }
      else if (end) phase(f, 'loop');
    } else if (end) { finish(false, 0, 1); return result; }
    if (s.phase === 'end' && events.some((e) => e.type === 'command' && e.index === 1 && e.value === 1)) result.shots.push({ player: f.slot, kind: 'arrow', copy: true, rawCharge: s.copyCharge ?? 0 });
    if (f.grounded) groundFriction(); else airFriction();
  } else if (s.direction === 'neutral' && f.copyAbility === 'Ss' && f.content.copies?.Ss) {
    // ftKb_SsSpecialN*: the Samus charge flow; B fires, shield stores, the level lives in samusCharge.
    const sp = f.content.copies.Ss.sourceParameters;
    if (sp.kind !== 'Ss') throw new Error('Kirby charge-shot copy is missing Samus data.');
    if (s.phase === 'start') { if (end) { phase(f, !f.grounded || f.samusCharge === sp.neutral.levels ? 'travel' : 'loop'); events = gather(); } }
    else if (s.phase === 'loop') {
      if (pressed) { phase(f, 'travel'); events = gather(); }
      else if (input.shield) { phase(f, 'end'); events = gather(); }
      else {
        s.chargeTicks = (s.chargeTicks ?? 0) + 1;
        if (s.chargeTicks > sp.neutral.interval) { s.chargeTicks = 0; f.samusCharge = Math.min(sp.neutral.levels, f.samusCharge + 1); }
        if (f.samusCharge === sp.neutral.levels) { phase(f, 'end'); events = gather(); }
        else if (end) phase(f, 'loop');
      }
    } else if (end) { finish(false, 0, 1); return result; }
    if (s.phase === 'travel' && events.some((e) => e.type === 'command' && e.index === 1 && e.value === 1)) { result.shots.push({ player: f.slot, kind: 'charge', copy: true, charge: f.samusCharge }); f.samusCharge = 0; }
    if (f.grounded) groundFriction(); else airFriction();
  } else if (s.direction === 'neutral' && f.copyAbility === 'Mt' && f.content.copies?.Mt) {
    // ftKb_MtSpecialN*: Shadow Ball charging with the loop's spark hits; shield stores, B releases.
    const mp = f.content.copies.Mt.sourceParameters;
    if (mp.kind !== 'Mt') throw new Error('Kirby shadow-ball copy is missing Mewtwo data.');
    if (s.phase === 'start') { if (end) { phase(f, 'loop'); events = gather(); } }
    else if (s.phase === 'loop') {
      if (pressed) { phase(f, 'end'); events = gather(); }
      else if (input.shield) { phase(f, 'travel'); events = gather(); }
      else {
        s.chargeTicks = (s.chargeTicks ?? 0) + 1;
        if (s.chargeTicks > mp.neutral.chargeIterations) { s.chargeTicks = 0; f.mewtwoCharge = Math.min(mp.neutral.chargeCycles, f.mewtwoCharge + 1); }
        if (end) { s.copyFull = f.mewtwoCharge >= mp.neutral.chargeCycles; phase(f, 'loop'); }
      }
    } else if (end) { finish(false, 0, 1); return result; }
    if (s.phase === 'end' && events.some((e) => e.type === 'command' && e.index === 1 && e.value === 1)) { result.shots.push({ player: f.slot, kind: 'shadow-ball', copy: true, charge: f.mewtwoCharge }); f.mewtwoCharge = 0; }
    if (f.grounded) groundFriction(); else airFriction();
  } else if (s.direction === 'neutral' && f.copyAbility === 'Dk' && f.content.copies?.Dk) {
    // ftKb_DkSpecialN*: each wind-up loop banks a swing into dkPunchCharge; shield stores, B releases.
    const dp = f.content.copies.Dk.sourceParameters;
    if (dp.kind !== 'Dk') throw new Error('Kirby giant-punch copy is missing Donkey Kong data.');
    if (s.phase === 'start') { if (end) { phase(f, 'loop'); events = gather(); } }
    else if (s.phase === 'loop') {
      if (pressed && s.age > 1) { s.copySwings = f.dkPunchCharge; s.copyFull = f.dkPunchCharge >= dp.neutral.maxSwings; f.dkPunchCharge = 0; phase(f, 'end'); events = gather(); }
      else if (input.shield) { phase(f, 'travel'); events = gather(); }
      else if (end) {
        f.dkPunchCharge = Math.min(dp.neutral.maxSwings, f.dkPunchCharge + 1);
        if (f.dkPunchCharge >= dp.neutral.maxSwings) { phase(f, 'travel'); events = gather(); }
        else phase(f, 'loop');
      }
    } else if (end) { finish(false, 0, 1); return result; }
    if (f.grounded) groundFriction(); else airFriction();
  } else if (s.direction === 'neutral' && f.copyAbility === 'Fe' && f.content.copies?.Fe) {
    // ftKb_MsSpecialN* (Roy's clone slot): Flare Blade charge; the full release uses the 50% explosion script.
    const rp = f.content.copies.Fe.sourceParameters;
    if (rp.kind !== 'Fe') throw new Error('Kirby flare-blade copy is missing Roy data.');
    if (s.phase === 'start') { if (end) { phase(f, 'loop'); events = gather(); } }
    else if (s.phase === 'loop') {
      s.copyCharge = (s.copyCharge ?? 0) + 1;
      if (s.copyCharge >= rp.neutral.maxCharge) { s.copyFull = true; phase(f, 'end'); events = gather(); }
      else if (!input.special) { phase(f, 'end'); events = gather(); }
      else if (end) phase(f, 'loop');
    } else if (end) { finish(false, 0, 1); return result; }
    if (f.grounded) groundFriction(); else airFriction();
  } else if (s.direction === 'neutral') {
    if (s.phase === 'start' && end) phase(f, 'loop');
    else if (s.phase === 'loop') { if (!input.special) phase(f, 'end'); else if (end) phase(f, 'loop'); }
    else if (s.phase === 'end' && end) { finish(false, 0, 1); return result; }
    if (f.grounded) groundFriction(); else airFriction();
  } else if (s.direction === 'side') {
    // ftKb_SpecialS_Coll: leaving the ground drops the hammer and falls.
    if (!s.startedAir && !f.grounded) { finish(false, 0, 1); return result; }
    if (end) { finish(false, 0, 1); return result; }
    if (f.grounded) groundFriction(); else airFriction();
  } else if (s.direction === 'up') {
    const c = p.cutter;
    // ft_80085134 + ftKb_SpecialAirHi*_Phys: animation translation, damped while rising, plus stick drift.
    const airMotion = () => { const d = rootDelta(f); const v = physics.motion(f.slot, d.z, d.y, f.facing); if (v.y > 0) v.y = f32(v.y * c.verticalDamping); f.velocity = cutterDrift(f, physics, input, v); };
    // Phase changes fall through so the new motion's first frame is not skipped.
    if (s.phase === 'start') {
      // ftKb_SpecialHi1_IASA: one reversal while the script has not set cmd_vars[3].
      if (!s.reversed && command(f, 3) === 0 && Math.abs(input.x) > c.reverseRange && input.x * f.facing < 0) { f.facing = -f.facing; s.reversed = true; }
      if (end) { phase(f, 'travel'); f.grounded = false; f.floor = null; }
      else if (f.grounded) groundFriction();
      else airMotion();
    }
    if (s.phase === 'travel') {
      if (ended()) phase(f, 'loop'); else airMotion();
    }
    if (s.phase === 'loop') {
      // ftKb_SpecialAirHi3_Phys keeps the descent velocity and only applies drift.
      f.velocity = cutterDrift(f, physics, input, f.velocity);
    } else if (s.phase === 'end') {
      if (end) { finish(false, 0, 1); return result; }
      if (f.grounded) groundFriction(); else airFriction();
      if (events.some((e) => e.type === 'command' && e.index === 2 && e.value === 1)) result.shots.push({ player: f.slot, kind: 'cutter' });
    }
  } else {
    const st = p.stone;
    for (const e of events) if (e.type === 'command' && e.index === 0) {
      if (e.value === 1 && !s.stoneFlicker && !s.stoneShape) { s.stoneShape = 1 + Math.floor(physics.random() * 5); s.stoneFrame = 0; s.stoneFlicker = 1; }
      if (e.value === 2 && !s.stoneFlicker && s.stoneShape) { s.stoneFrame = 22; s.stoneFlicker = 2; }
    }
    stepStoneFlicker(s);
    if (s.phase === 'start') {
      if (end) { phase(f, 'loop'); f.animationRate = 0; s.stoneHp = st.hp; f.velocity = { x: f.grounded ? f.velocity.x : 0, y: 0 }; }
      else if (f.grounded) groundFriction();
      else rootMotion(); // ft_80085134: the air start hops with the animation, no gravity.
    } else if (s.phase === 'loop') {
      f.animationRate = 0; f.animationFrame = 0;
      if (f.grounded && !s.stoneLanded) { s.stoneLanded = true; result.sounds.push(140007); }
      const held = s.stoneHeld ?? 0;
      if (held <= 0 || (held <= st.maxFrames - st.minFrames && pressed)) {
        phase(f, 'end'); s.stoneHp = 0; f.grounded = false; f.floor = null; f.velocity = { x: 0, y: 0 };
      } else {
        s.stoneHeld = held - 1;
        if (f.grounded) groundFriction(); else f.velocity = { x: 0, y: -st.fallSpeed };
      }
    } else {
      if (end) { finish(false, 0, 1); return result; }
      rootMotion(); // ftKb_SpecialLwEnd_Phys uses the animation translation before ftCo_Fall_Enter.
    }
  }
  return result;
}
/** match.land() already set grounded/velocity.y; return true to stay in the special. */
export function landKirbySpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'side') { finish(); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.max(1, Math.ceil(p.hammer.landingLag)); return true; }
  if (s.direction === 'up') {
    if (s.phase === 'travel' || s.phase === 'loop') { phase(f, 'end'); f.velocity = { x: 0, y: 0 }; }
    else f.animation = kirbySpecialName(s.direction, s.phase, false, s.startedAir, f.copyAbility, s.copyFull);
    return true;
  }
  if (s.direction === 'down') {
    if (s.phase === 'loop') { f.velocity = { x: 0, y: 0 }; }
    f.animation = kirbySpecialName(s.direction, s.phase, false, s.startedAir, f.copyAbility, s.copyFull);
    return true;
  }
  f.animation = kirbySpecialName(s.direction, s.phase, false, s.startedAir, f.copyAbility, s.copyFull);
  return true;
}
/** ftCo_800BD9E0: the ability taken by swallowing. A Kirby victim hands over its own hat (and loses it);
 * fighters without a loaded copy archive (local custom packs) leave the current ability untouched. */
export function copiedAbility(kirby: MatchFighter, victim: MatchFighter): FighterKind | null {
  const kind = victim.content.profile.kind;
  if (kind === 'Kb') { const taken = victim.copyAbility; victim.copyAbility = null; return taken; }
  return kirby.content.copies?.[kind as CopySource] ? kind : kirby.copyAbility;
}
/** Charge scaling for the copied melee releases: DK's banked swings and Roy's Flare Blade
 * both use the source fighter's own coefficients (full releases keep their script damage). */
export function kirbyCopyHits(f: MatchFighter, hits: import('./moves.ts').ActiveHit[]): import('./moves.ts').ActiveHit[] {
  const s = f.special;
  if (f.content.profile.kind !== 'Kb' || !f.copyAbility || !s || s.direction !== 'neutral' || s.phase !== 'end' || s.copyFull) return hits;
  const p = f.content.copies?.[f.copyAbility as CopySource]?.sourceParameters;
  if (p?.kind === 'Dk' && (s.copySwings ?? 0) > 0) return hits.map((h) => ({ ...h, damage: h.damage + (s.copySwings ?? 0) * p.neutral.damagePerSwing }));
  if (p?.kind === 'Fe') return hits.map((h) => ({ ...h, damage: p.neutral.baseDamage + Math.trunc((s.copyCharge ?? 0) / 30) * p.neutral.damagePerSecond }));
  return hits;
}
/** ftKb_SpecialN_800F5BA4: a damaging hit may knock the ability off (no star item is dropped here). */
export function loseCopyAbility(f: MatchFighter, physics: MeleePhysics): boolean {
  if (!f.copyAbility || f.combat.partner !== null) return false;
  if (Math.floor(physics.random() * LOSE_ABILITY_ODDS) !== 0) return false;
  f.copyAbility = null; return true;
}
export function copyHat(f: MatchFighter): { model: import('../hsd/model.ts').HsdModel; joint: number } | null {
  const copy = f.copyAbility ? f.content.copies?.[f.copyAbility as CopySource] : undefined;
  if (!copy?.hat) return null;
  const joint = f.content.profile.partJoints[COPY_HAT_PART];
  if (joint === undefined || joint < 0) return null;
  return { model: copy.hat, joint };
}
/** Final Cutter's rise passes through floors until ftKb_SpecialHi2_Coll starts checking. */
export function kirbyIgnoresLanding(f: MatchFighter): boolean {
  return f.content.profile.kind === 'Kb' && f.special?.direction === 'up' && (f.special.phase === 'start' || (f.special.phase === 'travel' && f.stateFrame <= CUTTER_LANDING_CHECK_FRAMES));
}
/** ftColl_80076640 with dmg.x1834: the stone absorbs damage until its HP runs out; only the
 * excess of the breaking hit is applied and it knocks Kirby out of the stone. */
export function stoneAbsorb(f: MatchFighter, damage: number): { absorbed: boolean; damage: number } | null {
  const s = f.special;
  if (f.content.profile.kind !== 'Kb' || !s || s.direction !== 'down' || s.phase !== 'loop' || !(s.stoneHp! > 0)) return null;
  s.stoneHp = f32(s.stoneHp! - damage);
  if (s.stoneHp >= 0) return { absorbed: true, damage: 0 };
  const excess = -s.stoneHp; s.stoneHp = 0;
  return { absorbed: false, damage: excess };
}
/** Visible draw alternative per model group (ftParts_80074B0C), or null when not Kirby. */
export function kirbyPartVisibility(f: MatchFighter): number[] | null {
  if (f.content.profile.kind !== 'Kb' || !f.content.profile.partVisibility.groups.length) return null;
  const s = f.special;
  if (s?.direction === 'down' && s.stoneShown && s.stoneShape) return [STONE_ALTERNATIVES[s.stoneShape] ?? 0, -1];
  return f.content.profile.partVisibility.groups.map(() => 0);
}
/** Draw-object ordinals to hide for the given per-group selection (ftParts_8007487C + ftParts_80074B6C). */
export function hiddenDrawObjects(visibility: { groups: number[][][]; hidden: number[] }, selected: readonly number[]): Set<number> {
  const hidden = new Set(visibility.hidden);
  visibility.groups.forEach((alternatives, group) => { for (const dobj of alternatives[selected[group] ?? -1] ?? []) hidden.delete(dobj); });
  return hidden;
}

/** ftCo_800D730C: during a multi-jump animation the next jump waits for the script's cmd_vars[0]. */
export function airJumpAllowed(f: MatchFighter): boolean {
  return !f.content.airJumps || f.state !== 'airjump' || command(f, 0) === 1;
}
/** ftCo_800D74A4: per-jump vertical impulse, stick impulse and the backwards turn timer. */
export function beginAirJump(f: MatchFighter, input: PlayerInput): string | null {
  const m = f.content.airJumps; if (!m) return null;
  const index = Math.max(0, Math.min(m.vertical.length - 1, f.jumpsUsed - 1));
  f.velocity = { x: f32(input.x * m.impulseX), y: m.vertical[index]! };
  f.airJumpTurn = input.x * f.facing < -m.turnThreshold ? m.turnFrames : 0;
  return m.animations[index]!;
}
/** ft_800CB6EC + ftCo_JumpAerialF1_Phys: turn halfway, then fall with scaled drift. */
export function stepAirJump(f: MatchFighter, input: PlayerInput, physics: MeleePhysics): Velocity | null {
  const m = f.content.airJumps; if (!m || f.state !== 'airjump') return null;
  if (f.airJumpTurn > 0) { f.airJumpTurn--; if (f.airJumpTurn === Math.floor(m.turnFrames / 2)) f.facing = -f.facing; }
  const a = f.content.profile.attributes;
  if (f.fastFall) return physics.air(f.slot, f.velocity, input.x, true);
  const drifted = input.x ? physics.drift(f.slot, f.velocity, input.x, f32(a.airDriftStickMul * m.accelMultiplier), f32(a.airDriftMax * m.speedMultiplier)) : f.velocity;
  return physics.customAir(f.slot, drifted, a.gravity, a.terminal, input.x ? 0 : a.airFriction);
}

/** ftKb_SpecialNCapture_Anim: an inhaled victim is drawn to the mouth point, then eaten. */
export function stepInhalePull(owner: MatchFighter, victim: MatchFighter, change: (f: MatchFighter, state: FighterState, animation: string) => void): void {
  const eat = owner.content.inhale, p = params(owner).inhale; if (!eat) return;
  const mouthX = f32(owner.x + p.mouthX * owner.facing), mouthY = f32(owner.y + p.mouthY);
  const dx = mouthX - victim.x, dy = mouthY - victim.y, distance = Math.hypot(dx, dy);
  if (distance < p.pullSpeed) { victim.x = mouthX; victim.y = mouthY; change(owner, 'holding', eat.hold); change(victim, 'captured', 'CaptureWaitHi'); return; }
  victim.x = f32(victim.x + dx / distance * p.pullSpeed); victim.y = f32(victim.y + dy / distance * p.pullSpeed);
}
export function beginInhaleCapture(f: MatchFighter): void { phase(f, 'hit'); }
/** ftCo_CaptureWaitKirby runs with Ft_MF_SkipModel: a swallowed victim is not drawn until released. */
export function inhaledVictimHidden(victim: MatchFighter, fighters: readonly MatchFighter[]): boolean {
  if (victim.state !== 'captured' || victim.combat.partner === null) return false;
  const owner = fighters[victim.combat.partner];
  return !!owner?.content.inhale && owner.combat.partner === victim.slot && (owner.state === 'holding' || owner.state === 'throw');
}
/** ftKb_MS_EatWalkSlow..Fast (actions 265-267): walking with the victim kept in the mouth. */
export const KIRBY_EAT_WALKS = ['EatWalkSlow', 'EatWalkMiddle', 'EatWalkFast'] as const;
/** HUD hint for Kirby's mouth hold (ftKb_EatWait_IASA inputs). */
export function inhaleHoldActive(f: MatchFighter): boolean {
  return !!f.content.inhale && f.state === 'holding' && (f.animation === f.content.inhale.hold || f.animation === f.content.inhale.wait || inhaleWalking(f));
}
/** ftKb_EatWalk_Phys runs ftWalkCommon: ordinary walk physics scaled by specialn_walk_speed. */
export function inhaleWalking(f: MatchFighter): boolean {
  return !!f.content.inhale && f.state === 'holding' && (KIRBY_EAT_WALKS as readonly string[]).includes(f.animation);
}
export function isInhaling(f: MatchFighter): boolean {
  return !!f.content.inhale && f.state === 'special' && f.special?.direction === 'neutral' && (f.special.phase === 'start' || f.special.phase === 'loop');
}
