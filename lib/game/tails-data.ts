import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import { articleModel, itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { SonicSpecialData } from './sonic-data.ts';

/** Tails (ACE 2.0 m-ex fighter, PlTs, mexproj 033). The move logic is compiled m-ex code that
 * ships its author's debug symbols (SpecialS_Loop_Phys, SpecialHi_Loop_Phys, …); every constant
 * below is the `ftDataTails` x4 attribute that code reads, named after the function reading it.
 * His down special is Sonic's spin charge: 57 PlTs functions match PlSn once relocated and read
 * Sonic's block shifted by +0x40, so it runs on lib/game/sonic.ts (see `down`).
 * Only the voice sample ids are engine-authored; local research notes are not distributed. */
export interface TailsSpecialData {
  kind: 'Ts';
  /** Tail swipe + shot: SpecialAirN_Phys x0/x4/x8, the flag-0 shot rise xC, entry vy ×x10. */
  neutral: { airFriction: number; gravity: number; terminal: number; shotRise: number; entryRise: number; voice: number };
  /** Rolling spin: SpecialS_Start/Loop/End and the aerial twins (x90–x100). */
  side: {
    loops: number; loopWrap: number; loopRate: number; startSpeed: number; accel: number; stickAccel: number;
    maxSpeed: number; idleFriction: number; endFriction: number; airStartMul: number; airDriftAccel: number;
    airDriftMax: number; airStartRise: number; loopGravity: number; loopTerminal: number; endGravity: number;
    endDriftAccel: number; endDriftMax: number; fallMobility: number; fallLanding: number; voice: number;
  };
  /** Helicopter: SpecialHi_Loop_Phys fuel meter (ft_var32) and the Exhaust fall (x2C–x84). */
  up: {
    landing: number; boostFrames: number; minFuel: number; landFuel: number; burn: number; hitFuel: number;
    heldRate: number; rise: number; maxRise: number; boostRise: number; tapBoost: number; tapCost: number;
    glideGravity: number; glideTerminal: number; driftAccel: number; driftMax: number; exhaustGravity: number;
    exhaustTerminal: number; exhaustDriftAccel: number; exhaustDriftMax: number; voice: number;
  };
  /** Sonic's spin charge on Tails' own values (PlSn offsets + 0x40). */
  down: SonicSpecialData['down'];
}
/** Voices are direct `tails.ssm` samples (base 1854): v_tails_atk1(5), se_sonic_spin0(3),
 * se_tails_tornado(24), v_tails_atk4(8). */
export function parseTailsParameters(arc: HsdArchive): TailsSpecialData {
  const base = arc.pointer(arc.symbol('ftDataTails') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error(`Invalid ftDataTails attribute 0x${offset.toString(16)}.`); return v; };
  const i = (offset: number) => { const v = arc.u32(base + offset); if (v > 1000) throw Error(`Invalid ftDataTails integer 0x${offset.toString(16)}.`); return v; };
  const p: TailsSpecialData = {
    kind: 'Ts',
    neutral: { airFriction: f(0x0), gravity: f(0x4), terminal: f(0x8), shotRise: f(0xc), entryRise: f(0x10), voice: 1859 },
    side: {
      loops: i(0x90), loopWrap: f(0x94), loopRate: f(0x9c), startSpeed: f(0xb8), accel: f(0xbc), stickAccel: f(0xc0),
      maxSpeed: f(0xc4), idleFriction: f(0xc8), endFriction: f(0xcc), airStartMul: f(0xd0), airDriftAccel: f(0xd4),
      airDriftMax: f(0xd8), airStartRise: f(0xdc), loopGravity: f(0xe0), loopTerminal: f(0xe4), endGravity: f(0xe8),
      endDriftAccel: f(0xf4), endDriftMax: f(0xec), fallMobility: f(0xfc), fallLanding: i(0x100), voice: 1857,
    },
    up: {
      landing: i(0x2c), boostFrames: i(0x30), minFuel: i(0x38), landFuel: i(0x3c), burn: i(0x40), hitFuel: i(0x44),
      heldRate: f(0x4c), rise: f(0x50), maxRise: f(0x54), boostRise: f(0x58), tapBoost: f(0x5c), tapCost: i(0x60),
      glideGravity: f(0x64), glideTerminal: f(0x68), driftAccel: f(0x6c), driftMax: f(0x70), exhaustGravity: f(0x74),
      exhaustTerminal: f(0x78), exhaustDriftAccel: f(0x7c), exhaustDriftMax: f(0x80), voice: 1878,
    },
    down: {
      releaseWindow: i(0x104), levelCooldown: i(0x108), firstLevelDelay: i(0x10c), maxLevel: i(0x110),
      airGravity: f(0x118), airFriction: f(0x11c), airTerminal: f(0x120), maxChargeFrames: i(0x124), runLife: i(0x128),
      runAccel: f(0x12c), runSpeed: [f(0x138), f(0x134), f(0x130)], turnAccel: f(0x13c), turnExitSpeed: f(0x140),
      jumpRise: f(0x148), jumpIasaDelay: i(0x14c), jumpDrift: f(0x150), jumpMaxX: f(0x154), jumpGravity: f(0x158),
      jumpTerminal: f(0x15c), brakeFriction: f(0x160), diveSpeed: f(0x164), diveLife: i(0x16c), wallAnimSpeed: f(0x170),
      jumpLanding: f(0x174), runDamage: [f(0x178), f(0x17c)], jumpDamage: [f(0x180), f(0x184)], voice: 1862,
    },
  };
  if (p.side.loops < 1 || p.up.landFuel < 1 || p.up.burn < 1 || p.down.maxLevel < 1 || p.down.runLife < 1) throw Error('Unsupported ftDataTails attribute bounds.');
  return p;
}
/** itFunction:0 shot (MEX_IndexFighterItem slot 0). Special block: x0 flight life (52), x4 fade
 * life (10), x8 launch speed, xC shield-bounce speed factor, x10 shield bounces before the fade. */
export interface TailsShotData extends ArticleData { flightLife: number; fadeLife: number; shieldDecay: number; shieldBounces: number }
/** SpecialN_SpawnProjectile enters item state 1 (airborne); its animation and hit come from there. */
export function parseTailsArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataTails') + 0x48), article = arc.pointer(table);
  const common = arc.pointer(article), special = arc.pointer(article + 4), states = arc.pointer(article + 12);
  if (!common || !special || !states) throw Error('Original Tails shot article is incomplete.');
  const flight = states + 16, hitScript = arc.pointer(flight + 12);
  const u = (offset: number) => { const v = arc.u32(special + offset); if (v > 600) throw Error('Invalid Tails shot integer.'); return v; };
  const shot: TailsShotData = {
    model: articleModel(arc, article, 'tails-shot', flight), hit: hitScript ? itemHit(arc, hitScript) : null,
    speed: arc.f32(special + 8), angle: 0, lifetime: u(0) + u(4), gravity: arc.f32(common + 16), terminal: arc.f32(common + 20),
    bounce: arc.f32(common + 0x58), minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    flightLife: u(0), fadeLife: u(4), shieldDecay: arc.f32(special + 0xc), shieldBounces: u(0x10),
  };
  if (!shot.hit || shot.speed <= 0 || shot.flightLife < 1) throw Error('Unsupported original Tails shot.');
  return { tails: { shot } };
}
/** Compacted PlTs action table (raw submotion = index + 49 up to 272, + 50 after one empty slot).
 * Down special keys mirror Sonic's (the spin charge runs on lib/game/sonic.ts); the spin loops are
 * keyed in motion order 0x16A.. (the table names them Loop1, Loop5, Loop4, Loop3, Loop2). */
const LOOP_FIGATREES = ['1', '5', '4', '3', '2'];
export const TAILS_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 14, figatree: 'Landing' },
  { key: 'SpecialN', index: 246, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 247, figatree: 'SpecialAirN' },
  { key: 'SpecialHiEnter', index: 248, figatree: 'SpecialHiEnter' },
  { key: 'SpecialAirHiEnter', index: 249, figatree: 'SpecialAirHiEnter' },
  { key: 'SpecialHiLoop', index: 250, figatree: 'SpecialHiLoop' },
  { key: 'SpecialHiExhaust', index: 251, figatree: 'SpecialHiExhaust' },
  { key: 'SpecialHiCancel', index: 252, figatree: 'SpecialHiCancel' },
  { key: 'SpecialLwStart', index: 253, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwCharge', index: 254, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwEnd', index: 255, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 256, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwEnd', index: 258, figatree: 'SpecialAirLwEnd' },
  { key: 'SpecialLwRun', index: 259, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwRunTurn', index: 260, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwRunJump', index: 261, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialLwDive', index: 262, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialLwStopWallR', index: 263, figatree: 'SpecialSWallR' },
  { key: 'SpecialLwStopWallL', index: 264, figatree: 'SpecialSWallL' },
  { key: 'SpecialSStart', index: 265, figatree: 'SpecialSStart' },
  { key: 'SpecialSEnd', index: 266, figatree: 'SpecialSEnd' },
  ...LOOP_FIGATREES.map((n, tier) => ({ key: `SpecialSLoop${tier + 1}`, index: 267 + tier, figatree: `SpecialSLoop${n}` })),
  { key: 'SpecialAirSStart', index: 272, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirSEnd', index: 273, figatree: 'SpecialAirSEnd' },
  ...LOOP_FIGATREES.map((n, tier) => ({ key: `SpecialAirSLoop${tier + 1}`, index: 274 + tier, figatree: `SpecialAirSLoop${n}` })),
];
export const TAILS_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
