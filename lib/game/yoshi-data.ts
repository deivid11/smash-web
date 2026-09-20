import type { HsdArchive } from '../hsd/archive.ts';
import { articleModel, itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** Yoshi parameters, all read from the disc. The Egg Throw formula block lives
 * in the shared dat_attrs memory (ftYs_DatAttrs view); star speed/accel come
 * from the star article, star launch height from its common block. Verified
 * against third_party/melee/src/melee/ft/kinds/ftYoshi/ftyoshi*.c and
 * it/kinds/ityoshi{eggthrow,star}.c. */
export interface YoshiSpecialData {
  kind: 'Ys';
  hi: {
    stickDiv: number; stickScale: number; stickMin: number; baseAngle: number;
    speedBase: number; speedPerFrame: number; spawnX: number; spawnY: number;
  };
  eggLife: number;
  stars: { speed: number; accel: number; spawnVY: number; offsetX: number; offsetY: number };
}
function range(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isFinite(v) || v < lo || v > hi) throw Error(`Invalid original Yoshi ${what}.`);
  return v;
}
export function parseYoshiParameters(arc: HsdArchive): YoshiSpecialData {
  const base = arc.pointer(arc.symbol('ftDataYoshi') + 4);
  const f = (o: number) => arc.f32(base + o);
  const p: YoshiSpecialData = {
    kind: 'Ys',
    hi: {
      stickDiv: range(f(0xec), 0.01, 5, 'egg mag divisor'), stickScale: range(f(0xf0), 0, 5, 'egg mag scale'),
      stickMin: range(f(0xf4), 0, 1, 'egg mag min'), baseAngle: range(f(0xf8), 0, Math.PI, 'egg base angle'),
      speedBase: range(f(0xfc), 0, 20, 'egg speed base'), speedPerFrame: range(f(0x100), 0, 5, 'egg speed rate'),
      spawnX: range(f(0x104), -30, 30, 'egg spawn x'), spawnY: range(f(0x108), -30, 30, 'egg spawn y'),
    },
    eggLife: 54,
    stars: { speed: 0.8, accel: 0, spawnVY: 0, offsetX: 8, offsetY: 1 },
  };
  // Thrown-egg life = slot-0 x0; star ballistics from the slot-1 article.
  {
    const table = arc.pointer(arc.symbol('ftDataYoshi') + 0x48);
    const eggSpecial = arc.pointer(arc.pointer(table) + 4);
    p.eggLife = range(arc.f32(eggSpecial), 1, 600, 'egg life');
    const starSpecial = arc.pointer(arc.pointer(table + 4) + 4);
    const starCommon = arc.pointer(arc.pointer(table + 4));
    p.stars = {
      speed: range(arc.f32(starSpecial), 0, 20, 'star speed'),
      accel: range(arc.f32(starSpecial + 4), -5, 5, 'star accel'),
      spawnVY: range(arc.f32(starCommon + 0x18), -20, 20, 'star launch height'),
      offsetX: range(f(0x118), 0, 30, 'star offset x'),
      offsetY: range(f(0x11c), -30, 30, 'star offset y'),
    };
  }
  return p;
}
/** ftYs motion states in action-table order. The repeated N1/SLoop scripts are
 * distinct phases (grab lunge, then freshness variants); air Fly shares clips. */
export const YOSHI_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'SpecialN1', index: 240, figatree: 'SpecialN1' },
  { key: 'SpecialAirN1', index: 243, figatree: 'SpecialAirN1' },
  { key: 'SpecialN2', index: 242, figatree: 'SpecialN2' },
  { key: 'SpecialAirN2', index: 245, figatree: 'SpecialAirN2' },
  { key: 'SpecialSStart', index: 246, figatree: 'SpecialSStart' },
  { key: 'SpecialSLoop', index: 247, figatree: 'SpecialSLoop' },
  { key: 'SpecialSLoopTired', index: 248, figatree: 'SpecialSLoop' },
  { key: 'SpecialSEnd', index: 249, figatree: 'SpecialSEnd' },
  { key: 'SpecialAirSStart', index: 250, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirSLoop1', index: 251, figatree: 'SpecialSLoop' },
  { key: 'SpecialAirSLoop2', index: 252, figatree: 'SpecialSLoop' },
  { key: 'SpecialAirSEnd', index: 253, figatree: 'SpecialAirSEnd' },
  { key: 'SpecialHi', index: 254, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 255, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 256, figatree: 'SpecialLw' },
  { key: 'SpecialLwLanding', index: 257, figatree: 'SpecialLwLanding' },
  { key: 'SpecialAirLw', index: 258, figatree: 'SpecialAirLw' },
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  // Egg shield has no portable anims (verified absent: Guard/GuardOn/GuardOff/
  // GuardDamage exist for no Yoshi action). Mechanical shield (bubble, stun,
  // pushback, break) runs untouched; hold poses freeze his idle, hits flinch.
  { key: 'Guard', index: 2, figatree: 'Wait' },
  { key: 'GuardOn', index: 2, figatree: 'Wait' },
  { key: 'GuardOff', index: 2, figatree: 'Wait' },
  { key: 'GuardDamage', index: 154, figatree: 'DamageN1' },
];
export const YOSHI_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', strong: 'AttackS4S', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** Yoshi articles: thrown egg (slot 0, 12% st0 hit) and Bomb stars (slot 1,
 * 1% hit). Slot 2 ( egglay trap, hitless) is not loaded. */
export function parseYoshiArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataYoshi') + 0x48);
  const read = (index: number, name: string, needHit: boolean): ArticleData => {
    const article = arc.pointer(table + index * 4);
    const common = arc.pointer(article), special = arc.pointer(article + 4);
    const states = arc.pointer(article + 12);
    const model = articleModel(arc, article, name, states);
    const script = arc.pointer(states + 12);
    const hit = script ? itemHit(arc, script) : null;
    if (needHit && !hit) throw new Error(`Original ${name} article has no hit definition.`);
    // Thrown-egg life is the slot-0 x0 (stars live until offstage, capped).
    const lifetime = name === 'yoshi-egg'
      ? (() => { const v = arc.f32(special); if (!(v >= 1 && v <= 600)) throw new Error('Invalid original egg life.'); return v; })()
      : 600;
    void special;
    return {
      model, hit, speed: 0, angle: 0, lifetime,
      gravity: arc.f32(common + 16), terminal: arc.f32(common + 20), bounce: arc.f32(common + 0x58),
      minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    };
  };
  const egg = read(0, 'yoshi-egg', true);
  const star = read(1, 'yoshi-star', true);
  return { projectile: egg, accessory: star, yoshi: { egg, star } };
}
