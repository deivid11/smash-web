import type { HsdArchive } from '../hsd/archive.ts';
import { articleModel, type ArticleData, type ReflectorData, type SpecialAssets } from './special-data.ts';
import { partJoint, type FighterProfile } from './data.ts';
import type { FighterContent } from './load.ts';

/** ftZelda_DatAttrs fields consumed by the prototype. Offsets verified against
 * third_party/melee/src/melee/ft/kinds/ftZelda/ftzelda*.c; the wind-down
 * counters and guide speeds the prototype does not orchestrate are unread. */
export interface ZeldaSpecialData {
  kind: 'Zd';
  neutral: { airDivisor: number; airGravity: number; reflect: ReflectorData };
  side: {
    poseMin: number; poseMax: number;
    spawnFwd: number; spawnUp: number;
    travelLife: number; maxGuide: number; guideMin: number; guideMax: number;
  };
  up: {
    divX: number; divY: number; stickThreshold: number; distSlope: number; distBase: number;
    travelFrames: number; mobility: number; landing: number;
  };
  down: { divX: number; divY: number };
  dins: {
    travelLife: number; maxGuide: number; guideMin: number; guideMax: number;
    startSpeed: number; accel: number; maxSpeed: number; steerDead: number; steerGain: number; steerMax: number;
    blastDivisor: number; blastBase: number; blastSlope: number; blastDamageBase: number; blastLife: number;
  };
}
function range(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isFinite(v) || v < lo || v > hi) throw Error(`Invalid original Zelda ${what}.`);
  return v;
}
export function parseZeldaParameters(arc: HsdArchive, profile: FighterProfile): ZeldaSpecialData {
  const base = arc.pointer(arc.symbol('ftDataZelda') + 4);
  const f = (o: number) => arc.f32(base + o);
  const u = (o: number) => { const v = arc.u32(base + o); if (v > 100000) throw Error('Invalid original Zelda integer.'); return v; };
  const reflect: ReflectorData = {
    bone: partJoint(profile, arc.u32(base + 0x84), 'Nayru reflect'),
    maxDamage: u(0x88),
    offset: [f(0x8c), f(0x90), f(0x94)],
    radius: range(f(0x98), 0.1, 100, 'nayru radius'),
    damageMultiplier: f(0x9c), speedMultiplier: f(0xa0),
    keepOwner: arc.u8(base + 0xa4) !== 0,
  };
  const p: ZeldaSpecialData = {
    kind: 'Zd',
    neutral: { airDivisor: range(f(0x8), 1, 10, 'nayru air div'), airGravity: range(f(0xc), 0, 5, 'nayru air gravity'), reflect },
    side: {
      poseMin: range(u(0x10), 1, 120, 'dins pose min'), poseMax: range(u(0x14), 1, 120, 'dins pose max'),
      spawnFwd: f(0x20), spawnUp: f(0x24),
      travelLife: 65, maxGuide: 60, guideMin: 0.3, guideMax: 1.7,
      // NOTE: x28/x2C/x30/x34 (loop drift block) are unread; Zelda holds still
      // while guiding in the prototype, documented in the Zelda guide.
    },
    up: {
      divX: range(f(0x38), 1, 10, 'farore div x'), divY: range(f(0x3c), 1, 10, 'farore div y'),
      stickThreshold: range(f(0x50), 0, 1, 'farore stick'), distSlope: f(0x54), distBase: f(0x58),
      travelFrames: range(u(0x48), 1, 120, 'farore vanish frames'), mobility: range(f(0x5c), 0, 1, 'farore mobility'),
      landing: range(f(0x6c), 0, 120, 'farore landing'),
    },
    down: { divX: range(f(0x70), 1, 10, 'transform div x'), divY: range(f(0x74), 1, 10, 'transform div y') },
    dins: readDins(arc),
  };
  if (Math.abs(p.side.spawnFwd) > 30 || Math.abs(p.side.spawnUp) > 30) throw Error('Invalid original Din spawn offset.');
  if (p.up.distSlope < 0 || p.up.distBase < 0 || p.up.distSlope > 20 || p.up.distBase > 20) throw Error('Invalid original Farore distance.');
  return p;
}
/** Din's Fire articles, read from the disc (slot 0 travel, slot 1 blast).
 * Travel: life x0, max guide x4, visual range x8..xC, initial speed x14,
 * accel x18 capped at x1C, steer deadzone x20/gain x24/clamp x28.
 * Blast: charge divisor x0, gfx base x4, damage = charge * x10 + xC, life 60. */
function readDins(arc: HsdArchive): ZeldaSpecialData['dins'] {
  const table = arc.pointer(arc.symbol('ftDataZelda') + 0x48);
  const travel = arc.pointer(arc.pointer(table) + 4);
  const blast = arc.pointer(arc.pointer(table + 4) + 4);
  const t = (o: number) => arc.f32(travel + o), b = (o: number) => arc.f32(blast + o);
  const dins: ZeldaSpecialData['dins'] = {
    travelLife: t(0), maxGuide: t(4), guideMin: t(8), guideMax: t(12),
    startSpeed: t(0x14), accel: t(0x18), maxSpeed: t(0x1c), steerDead: t(0x20), steerGain: t(0x24), steerMax: t(0x28),
    blastDivisor: b(0), blastBase: b(4), blastSlope: b(0x10), blastDamageBase: b(0xc), blastLife: 60,
  };
  if (!(dins.travelLife >= 1 && dins.travelLife <= 600 && dins.maxGuide >= 1 && dins.maxGuide <= 600) ||
      !(dins.guideMin >= 0 && dins.guideMax >= dins.guideMin && dins.guideMax <= 10) ||
      !(dins.startSpeed >= 0 && dins.startSpeed <= 20 && dins.maxSpeed >= dins.startSpeed && dins.maxSpeed <= 20) ||
      !(dins.steerDead >= 0 && dins.steerDead <= 1 && dins.steerGain >= 0 && dins.steerGain <= 1 && dins.steerMax > 0 && dins.steerMax <= Math.PI * 2) ||
      !(dins.blastDivisor >= 1 && dins.blastDivisor <= 600 && dins.blastSlope >= 0 && dins.blastSlope <= 5 && dins.blastDamageBase >= 0 && dins.blastDamageBase <= 50)) {
    throw Error('Invalid original Din parameters.');
  }
  return dins;
}
/** ftZd motion states in action-table order. Transform completes at the end of
 * the Lw2 clip (native TransformToSubcharacter runs as the anim finishes). */
export const ZELDA_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'SpecialN', index: 245, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 246, figatree: 'SpecialAirN' },
  { key: 'SpecialSStart', index: 247, figatree: 'SpecialSStart' },
  { key: 'SpecialSLoop', index: 248, figatree: 'SpecialSLoop' },
  { key: 'SpecialSEnd', index: 249, figatree: 'SpecialSEnd' },
  { key: 'SpecialAirSStart', index: 250, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirSLoop', index: 251, figatree: 'SpecialAirSLoop' },
  { key: 'SpecialAirSEnd', index: 252, figatree: 'SpecialAirSEnd' },
  { key: 'SpecialHiStart', index: 253, figatree: 'SpecialHiStart' },
  { key: 'SpecialHi', index: 254, figatree: 'SpecialHi' },
  { key: 'SpecialAirHiStart', index: 255, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHi', index: 256, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 257, figatree: 'SpecialLw' },
  { key: 'SpecialLw2', index: 258, figatree: 'SpecialLw2' },
  { key: 'SpecialAirLw', index: 259, figatree: 'SpecialAirLw' },
  { key: 'SpecialAirLw2', index: 260, figatree: 'SpecialAirLw2' },
];
export const ZELDA_MOVES: FighterContent['moves'] = {
  jab: 'Attack11',
  dash: 'AttackDash', strong: 'AttackS4S', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** Zelda articles: slot 0 is the Din's travel fire, slot 1 the detonation blast.
 * Both models resolve through the double-deref probe; neither carries a hit
 * script (full state scans at every stride find none — travel is hitless and
 * blast damage is fully code-driven), so hits are constructed in
 * zelda-projectiles.ts from the verified formulas. */
export function parseZeldaArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataZelda') + 0x48);
  const read = (index: number, name: string): ArticleData => {
    const article = arc.pointer(table + index * 4);
    const common = arc.pointer(article), special = arc.pointer(article + 4);
    const states = arc.pointer(article + 12);
    const model = articleModel(arc, article, name, states);
    void special;
    return {
      model, hit: null, speed: 0, angle: 0, lifetime: 65,
      gravity: arc.f32(common + 16), terminal: arc.f32(common + 20), bounce: arc.f32(common + 0x58),
      minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    };
  };
  const travel = read(0, 'dins-travel');
  const blast = read(1, 'dins-blast');
  return { projectile: travel, accessory: blast, zelda: { travel, blast } };
}
