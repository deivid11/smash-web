import type { HsdArchive } from '../hsd/archive.ts';
import { itemHit, articleModel, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** Charizard / Lizardon (ACE 2.0 m-ex fighter, PlLz, mexproj 029). The ftFunction block ships with
 * its author's debug symbols, so every value below is read where the named callback reads it:
 * `special_attributes` (ftDataLizardon+4, 0xB0 bytes, memcpy'd by OnLoad). */
export interface LizardonSpecialData {
  kind: 'Lz';
  /** OnLoad points multi_jump_desc at attrs+0x7C: the Kirby/Jigglypuff multi-jump layout. */
  jumps: { vertical: number[]; impulseX: number; turnFrames: number; turnThreshold: number; accelMultiplier: number; speedMultiplier: number };
  /** Flamethrower (SpecialN_Loop, SpecialN_SpawnFire, RefuelFire, OnRespawn). Two fuel pools:
   * ft_var1 scales the flame speed, ft_var2 its size; both drain 1 per loop frame and refill
   * outside the move. */
  neutral: {
    /** x14: loop frames that always play before B may be released. */
    minFrames: number;
    /** x18/x1C refill per frame, x20/x28 caps (also the respawn values), x24/x2C floors. */
    speedFuel: { refill: number; max: number; min: number };
    sizeFuel: { refill: number; max: number; min: number };
    /** x30: frames between loop camera quakes. */
    quakeFrames: number;
    /** x3C flame joint (fp->parts index), x34/x38 offset scaled by the model scale. */
    bone: number; offset: [number, number];
  };
  /** Flare Blitz-style rush (SpecialS_*): root-motion start, x54-frame dash, end lag. */
  side: {
    airStartSpeed: number; airStartGravity: number; airStartTerminal: number;
    speed: number; friction: number; dashFrames: number;
    endFriction: number; airEndSpeed: number; airEndFriction: number; airEndGravity: number; landing: number;
  };
  /** Fly (SpecialHi_*): animation root motion plus a stick-driven drift, then special fall. */
  up: { driftAccel: number; driftMax: number; landing: number };
  /** Tail fire (SpawnTailFire, a per-frame GObj proc): efSync effect x4 on joint x0. */
  tail: { bone: number; effect: number };
}

export function parseLizardonParameters(arc: HsdArchive): LizardonSpecialData {
  const attrs = arc.pointer(arc.symbol('ftDataLizardon') + 4);
  const f = (o: number) => arc.f32(attrs + o), u = (o: number) => arc.u32(attrs + o) | 0;
  const desc = 0x7c, jumpCount = u(desc + 0x28);
  if (jumpCount < 1 || jumpCount > 5) throw new Error('Unsupported original Charizard multi-jump count.');
  const p: LizardonSpecialData = {
    kind: 'Lz',
    jumps: { turnFrames: u(desc), turnThreshold: f(desc + 4), impulseX: f(desc + 8), accelMultiplier: f(desc + 0xc), speedMultiplier: f(desc + 0x10),
      vertical: Array.from({ length: jumpCount }, (_, i) => f(desc + 0x14 + i * 4)) },
    neutral: {
      minFrames: u(0x14),
      speedFuel: { refill: f(0x18), max: f(0x20), min: f(0x24) },
      sizeFuel: { refill: f(0x1c), max: f(0x28), min: f(0x2c) },
      quakeFrames: u(0x30), bone: u(0x3c), offset: [f(0x34), f(0x38)],
    },
    side: {
      airStartSpeed: f(0x40), airStartGravity: f(0x44), airStartTerminal: f(0x48),
      speed: f(0x4c), friction: f(0x50), dashFrames: u(0x54),
      endFriction: f(0x58), airEndSpeed: f(0x5c), airEndFriction: f(0x60), airEndGravity: f(0x64), landing: f(0x6c),
    },
    up: { driftAccel: f(0x70), driftMax: f(0x74), landing: f(0x78) },
    tail: { bone: u(0), effect: u(4) },
  };
  const n = p.neutral;
  if (n.minFrames < 1 || n.minFrames > 600 || n.speedFuel.max <= n.speedFuel.min || n.sizeFuel.max <= n.sizeFuel.min || n.speedFuel.refill <= 0 || n.sizeFuel.refill <= 0
    || p.side.dashFrames < 1 || p.side.dashFrames > 240 || p.side.landing < 0 || p.up.landing < 0 || p.jumps.turnFrames < 1 || p.jumps.turnFrames > 60)
    throw new Error('Unsupported original Charizard special parameters.');
  return p;
}

/** Item 0 (SpawnItem_Fire): speed rolled in x8..xC, angle (radians from straight up, mirrored by
 * facing) in x10..x14, hitbox cleared after x4 frames, gone after x0. */
export interface LizardonFlameData extends ArticleData { speedRange: [number, number]; angleRange: [number, number]; hitFrames: number }
/** Items 1 and 2 pick one child joint of their model per floor material (special x0 count, x4 table). */
export interface LizardonRockData extends ArticleData { variants: number[] }
/** Item 2 (SpawnItem_RockBurst): x8 lifetime (int), xC speed, x10..x14 angle in degrees from up. */
export interface LizardonBurstData extends LizardonRockData { angleRange: [number, number] }
export interface LizardonArticles { flame: LizardonFlameData; rock: LizardonRockData; burst: LizardonBurstData }

export function parseLizardonArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataLizardon') + 0x48);
  const read = (slot: number, name: string) => {
    const article = arc.pointer(table + slot * 4), common = arc.pointer(article), special = arc.pointer(article + 4), states = arc.pointer(article + 12);
    if (!common || !special || !states) throw Error(`Charizard article ${slot} is incomplete.`);
    const hit = arc.pointer(states + 12) ? itemHit(arc, arc.pointer(states + 12)) : null;
    const base: ArticleData = {
      model: articleModel(arc, article, name, states), hit, speed: 0, angle: 0, lifetime: 0, gravity: arc.f32(common + 16), terminal: arc.f32(common + 20),
      bounce: arc.f32(common + 0x58), minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    };
    return { base, special };
  };
  const value = (o: number) => { if (!Number.isFinite(o) || Math.abs(o) > 1000) throw Error('Invalid Charizard article attribute.'); return o; };
  const variants = (special: number) => {
    const count = arc.u32(special), list = arc.pointer(special + 4);
    if (count < 1 || count > 64) throw Error('Unsupported Charizard rock variant table.');
    return Array.from({ length: count }, (_, i) => arc.u32(list + i * 4) | 0);
  };
  const flame = read(0, 'lizardon-flame'), rock = read(1, 'lizardon-rock'), burst = read(2, 'lizardon-burst');
  const fs = (o: number) => value(arc.f32(flame.special + o));
  const flameData: LizardonFlameData = { ...flame.base, lifetime: fs(0), hitFrames: fs(4), speed: fs(0xc), speedRange: [fs(8), fs(0xc)], angleRange: [fs(0x10), fs(0x14)] };
  if (!flameData.hit || flameData.lifetime <= 0 || flameData.lifetime > 600 || flameData.speedRange[0] <= 0) throw Error('Unsupported Charizard flame bounds.');
  const rockData: LizardonRockData = { ...rock.base, lifetime: 1200, variants: variants(rock.special) };
  const bs = (o: number) => value(arc.f32(burst.special + o));
  const burstData: LizardonBurstData = { ...burst.base, lifetime: arc.u32(burst.special + 8), speed: bs(0xc), variants: variants(burst.special), angleRange: [bs(0x10), bs(0x14)] };
  if (!burstData.hit || burstData.lifetime < 1 || burstData.lifetime > 600 || burstData.speed <= 0) throw Error('Unsupported Charizard rock burst bounds.');
  return { lizardon: { flame: flameData, rock: rockData, burst: burstData } };
}

/** m-ex action table (anim id − 51): every special figatree is unique, keyed to pin the indices.
 * The Blown motions (258, 262) exist but no callback ever enters them. */
export const LIZARDON_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 14, figatree: 'Landing' },
  ...['SpecialNStart', 'SpecialN', 'SpecialNEnd', 'SpecialAirNStart', 'SpecialAirN', 'SpecialAirNEnd'].map((key, i) => ({ key, index: 246 + i, figatree: key })),
  { key: 'SpecialHi', index: 252, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 253, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 254, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 255, figatree: 'SpecialAirLw' },
  { key: 'SpecialSStart', index: 256, figatree: 'SpecialSStart' },
  { key: 'SpecialS', index: 257, figatree: 'SpecialS' },
  { key: 'SpecialSEnd', index: 259, figatree: 'SpecialSEnd' },
  { key: 'SpecialAirSStart', index: 260, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirS', index: 261, figatree: 'SpecialAirS' },
  { key: 'SpecialAirSEnd', index: 263, figatree: 'SpecialAirSEnd' },
];

export const LIZARDON_AIR_JUMPS = ['JumpAerialF', 'JumpAerialF2'] as const;

export const LIZARDON_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
