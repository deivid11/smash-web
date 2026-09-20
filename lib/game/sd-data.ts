import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import { articleModel, type ArticleData, type SpecialAssets } from './special-data.ts';

/** Skull Kid (ACE 2.0 m-ex fighter, PlSd, mexproj 040). The mexproj entry still lists Ness's DOL
 * specials, but PlSd's own `ftFunction` exports replace every one of them (motions 348-376; export
 * 31 is m-ex's enterfloat, export 34 OnLanding). The block carries no debug symbols; each tuning
 * value below is a literal of that compiled code (`M<motion>_<cb>` / offsets cite it) — the
 * ftDataSkul special-attribute block is never read by it. Kit:
 * - Neutral: pull a sticky remote bomb (held item, article 0), throw it, press B to detonate.
 *   The article's state scripts carry no hitbox at all (only the explosion's gfx 1001), so in
 *   ACE 2.0 the bomb is harmless.
 * - Side: a three-hit spin (the only special hitboxes) that ends in an 8-way teleport.
 * - Up: a teleport inside a ±20° cone around straight up or straight down.
 * - Down: a 60-frame pose with no hitbox; its Hold/Hit motions are unreachable in the code.
 * - A Peach-style float (enterfloat), once per airtime.
 * Quirk: AttackHi3's script pointer lands in unrelated data, so the fighter ships with no up tilt. */
export interface SkullKidSpecialData { kind: 'Sd' }
/** The bomb article plus its ItemCommonAttr x4 throw-speed multiplier (the shared item throw). */
export interface SkullKidBombData extends ArticleData { throwSpeedMul: number }

/** Compiled literals (ftFunction rodata 0x2FA0-0x301C, itFunction:0 rodata 0x6B4-0x6E0). */
export const SD_CODE = Object.freeze({
  neutral: {
    /** OnLoad ft_var51 = 1; the spawn spends it. OnFrame counts ft_var45 up past 0x12B while no
     * bomb is out, then refills it (with ColAnim 0x2A). */
    ammo: 1, cooldown: 300,
    /** SpecialAirN's hold entry scales self_vel.y by x2FD0. */
    airHoldVy: 0.7,
    /** M353_Phys: ftCommon_Fall(gravity · x2FA8, fast fall · x2FA8) after the normal air drift. */
    holdGravity: 0.05,
    /** OnFrame: a fresh B with the stick inside ±x2FC0 on both axes detonates from an attack,
     * landing (0x2A-0x4A) or light-throw (0x5E-0x73) motion. */
    detonateStick: 0.4,
    /** ptr_02e94 → fn_03e88: the bomb spawns at FtPart 23 (Fighter_BoneLookup 0x17). */
    spawnPart: 23,
  },
  side: {
    /** SpecialAirS: self_vel.y = 0, self_vel.x · x2FC0. */
    airEntryVx: 0.4,
    /** M357_Phys: ftCommon_8007D344(0, drift base · x2FC0, drift max · x2FC0), then
     * ftCommon_Fall(gravity · x2FA8 · k, fast fall · x2FA8 · k), k = 10 · ft_var50 + 1. */
    airDrift: 0.4, airGravity: 0.05, usesGravityStep: 10,
    /** sub_037f4: the dash speed (x3018) and ft_var48 intangible frames. */
    speed: 2, intangible: 20,
    /** sub_037f4 stick classification: |x| under x2FE8 reads as vertical/neutral, a pure
     * vertical is |x| < x2FD4 with |y| past x2FEC; those snap to x2FC8 (0.5 rad) off the
     * horizontal, which is also the clamp of any free angle. */
    deadX: 0.2, pureX: 0.1, pureY: 0.9, minAngle: 0.5, maxAngle: 2.64159,
  },
  up: {
    /** fn_03b74: the launch speed (x2FB0), its cone (x2FFC / x3004 either side of vertical,
     * mirrored below) and ft_var49 intangible frames. */
    speed: 1.5, coneLow: 1.23, coneHigh: 1.91159, intangible: 20,
  },
  warp: {
    /** M359_Anim / M363_Anim end in the air: self_vel.x · x2FC8 (side only), then
     * SpecialAirHiEnd; M364_Anim: special fall with the air-drift maximum as its multiplier and
     * x2FB8 landing frames. */
    sideEndVx: 0.5, landing: 10,
  },
  float: {
    /** enterfloat: flag1 = 0x3C frames; the entry speed picks the mode (x2FC4 / x2FC8). */
    duration: 60, fallMode: -0.5, riseMode: 0.5,
    /** M361_Phys: mode 1 brakes a rise at gravity · x2FAC; mode 0 falls x0C frames first;
     * the drift adds stick · x3E50 up to air_drift_max. */
    riseBrake: 3, fallFrames: 12, drift: 0.2,
    /** M361_IASA: a C-stick past x3E58 acts. */
    cStick: 0.1,
  },
  bomb: {
    /** itFunction:0 state 0: scale 1 - life · x6E0 while life (x2FD8 = 9) counts down. */
    grow: 9, growStep: 0.1, spawnScale: 0.1,
    /** OnThrow: life x6D8, self_vel.y += x6DC. States 2/3: it_80272860(x6B8, x6B4 / x6BC). */
    throwLife: 150, throwLift: 0.8, gravity: 0.1, dropTerminal: 3, throwTerminal: 2.5,
    /** State 4 → 5 after x6D0 frames; state 5 blinks (Effect_SpawnItEffect 0x1A1) every
     * int(life / x6C4 · x6CC) frames for x6C4 frames, then state 6 (x6D0 frames, script gfx
     * 0x3E9) destroys it. A detonation (state 6) also runs x2FDC = 5 frames. */
    stickFrames: 5, armedLife: 600, blinkPeriod: 78, blinkEffect: 0x1a1, explodeFrames: 5, explodeEffect: 1001,
  },
});

export function parseSkullKidParameters(arc: HsdArchive): SkullKidSpecialData {
  arc.symbol('ftDataSkul');
  return { kind: 'Sd' };
}

/** Article 0 (the bomb): model + common block. Its seven state scripts are empty (the explosion's
 * only command is gfx 0x3E9), so it carries no hit. Articles 1/2 are the smash-attack trail props
 * (fn_03fdc from AttackS4S/AttackHi4 anim callbacks) and stay unported. */
export function parseSkullKidArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataSkul') + 0x48);
  const article = arc.pointer(table), common = arc.pointer(article), states = arc.pointer(article + 12);
  const bounds = (v: number, low: number, high: number) => { if (!Number.isFinite(v) || v < low || v > high) throw new Error('Unsupported original Skull Kid bomb value.'); return v; };
  const bomb: SkullKidBombData = {
    model: articleModel(arc, article, 'skullkid-bomb', states), hit: null, speed: 0, angle: 0, lifetime: SD_CODE.bomb.grow,
    gravity: SD_CODE.bomb.gravity, terminal: SD_CODE.bomb.throwTerminal, bounce: 0, minSpeed: 0,
    scale: bounds(arc.f32(common + 0x60), 0.01, 10), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    throwSpeedMul: bounds(arc.f32(common + 4), 0.01, 10),
  };
  return { projectile: bomb };
}

/** Idle is bare `Wait` (keyed to Wait1); Landing primaries at 12. Every special motion is its own
 * table slot: the NHold pairs (250/251, 254/255) share a figatree but only the first carries the
 * detonation script (sound + flag 24 at frame 9); the float plays the grounded `SpecialHi` (262). */
export const SD_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  { key: 'Landing', index: 12, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 249, figatree: 'SpecialNStart' },
  { key: 'SpecialNHold', index: 250, figatree: 'SpecialNHold' },
  { key: 'SpecialAirNStart', index: 253, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNHold', index: 254, figatree: 'SpecialAirNHold' },
  { key: 'SpecialS', index: 257, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 258, figatree: 'SpecialAirS' },
  { key: 'SpecialHiStart', index: 259, figatree: 'SpecialHiStart' },
  { key: 'SpecialHiHold', index: 260, figatree: 'SpecialHiHold' },
  { key: 'SpecialHiEnd', index: 261, figatree: 'SpecialHiEnd' },
  { key: 'SpecialHi', index: 262, figatree: 'SpecialHi' },
  { key: 'SpecialAirHiStart', index: 263, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHiHold', index: 264, figatree: 'SpecialAirHiHold' },
  { key: 'SpecialAirHiEnd', index: 265, figatree: 'SpecialAirHiEnd' },
  { key: 'SpecialLwStart', index: 268, figatree: 'SpecialLwStart' },
  { key: 'SpecialAirLwStart', index: 272, figatree: 'SpecialAirLwStart' },
];

export const SD_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
