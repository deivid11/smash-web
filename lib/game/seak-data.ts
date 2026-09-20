import type { HsdArchive } from '../hsd/archive.ts';
import { articleModel, itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** ftSeakAttributes fields consumed by the prototype. Charge rate is one needle
 * per Loop clip (native loop iteration), the throw count caps at 6, and the
 * Vanish travel budget is the integer at +0x38 — all verified against
 * third_party/melee/src/melee/ft/kinds/ftSeak/ftseakspecial*.c. */
export interface SeakSpecialData {
  kind: 'Sk';
  neutral: { groundFwd: number; groundBaseY: number; airFwd: number; airBaseY: number };
  needles: { speed: number; life: number };
  up: { travelFrames: number; stickThreshold: number; distSlope: number; distBase: number; landing: number };
  down: { divX: number; divY: number };
}
function range(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isFinite(v) || v < lo || v > hi) throw Error(`Invalid original Sheik ${what}.`);
  return v;
}
const NEEDLE_Y = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
export function needleOffsets(): readonly number[] { return NEEDLE_Y; }
export function parseSeakParameters(arc: HsdArchive): SeakSpecialData {
  const base = arc.pointer(arc.symbol('ftDataSeak') + 4);
  const f = (o: number) => arc.f32(base + o);
  const u = (o: number) => arc.u32(base + o);
  const p: SeakSpecialData = {
    kind: 'Sk',
    neutral: {
      groundFwd: range(f(0), 0, 30, 'needle ground fwd'), groundBaseY: range(f(4), 0, 30, 'needle ground y'),
      airFwd: range(f(8), 0, 30, 'needle air fwd'), airBaseY: range(f(0xc), 0, 30, 'needle air y'),
    },
    needles: { speed: 4, life: 30 },
    up: {
      travelFrames: range(u(0x38), 1, 120, 'vanish frames'), stickThreshold: range(f(0x40), 0, 1, 'vanish stick'),
      distSlope: range(f(0x44), 0, 10, 'vanish slope'), distBase: range(f(0x48), 0, 10, 'vanish base'),
      landing: range(f(0x5c), 0, 120, 'vanish landing'),
    },
    down: { divX: range(f(0x60), 1, 10, 'transform div x'), divY: range(f(0x64), 1, 10, 'transform div y') },
  };
  // Needle article (slot 0): life x0, speed x8 (angle rule is code, not data).
  {
    const table = arc.pointer(arc.symbol('ftDataSeak') + 0x48);
    const special = arc.pointer(arc.pointer(table) + 4);
    p.needles = { speed: range(arc.f32(special + 8), 0.1, 30, 'needle speed'), life: range(arc.f32(special), 1, 600, 'needle life') };
  }
  return p;
}
/** ftSk motion states in action-table order. Needle charge/spawn and Vanish are
 * code-driven (no script hits on N); the S whip carries fighter-script hits on
 * throw-out, the chain tip hit (slot 1 state 4) while extended. */
export const SEAK_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'SpecialNStart', index: 242, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoop', index: 243, figatree: 'SpecialNLoop' },
  { key: 'SpecialNCancel', index: 244, figatree: 'SpecialNCansel' },
  { key: 'SpecialNEnd', index: 245, figatree: 'SpecialNEnd' },
  { key: 'SpecialAirNStart', index: 246, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoop', index: 247, figatree: 'SpecialAirNLoop' },
  { key: 'SpecialAirNCancel', index: 248, figatree: 'SpecialAirNCansel' },
  { key: 'SpecialAirNEnd', index: 249, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialSStart', index: 250, figatree: 'SpecialSStart' },
  { key: 'SpecialSEnd', index: 251, figatree: 'SpecialSEnd' },
  { key: 'SpecialS', index: 252, figatree: 'SpecialS' },
  { key: 'SpecialAirSStart', index: 253, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirSEnd', index: 254, figatree: 'SpecialAirSEnd' },
  { key: 'SpecialAirS', index: 255, figatree: 'SpecialAirS' },
  { key: 'SpecialHiStart', index: 256, figatree: 'SpecialHiStart' },
  { key: 'SpecialHi', index: 257, figatree: 'SpecialHi' },
  { key: 'SpecialAirHiStart', index: 258, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHi', index: 259, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 260, figatree: 'SpecialLw' },
  { key: 'SpecialLw2', index: 261, figatree: 'SpecialLw2' },
  { key: 'SpecialAirLw', index: 262, figatree: 'SpecialAirLw' },
  { key: 'SpecialAirLw2', index: 263, figatree: 'SpecialAirLw2' },
  { key: 'Wait1', index: 2, figatree: 'Wait' },
];
export const SEAK_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', strong: 'AttackS4', sideTilt: 'AttackS3', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** Sheik articles: needles (slot 0, 3% thrown hit), chain (slot 1, tip hit from
 * state 4 — the only scripted chain hit), Vanish blast (slot 2, 12% hit with a
 * particle-only article like Mewtwo's Disable). Slots 3-5 have no identified
 * role and are not loaded. */
export function parseSeakArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataSeak') + 0x48);
  const statesOf = (index: number) => arc.pointer(arc.pointer(table + index * 4) + 12);
  const commonOf = (index: number) => arc.pointer(arc.pointer(table + index * 4));
  const base = (index: number, name: string, hitState: number | null): ArticleData => {
    const article = arc.pointer(table + index * 4);
    const common = commonOf(index), states = statesOf(index);
    let model;
    try {
      model = articleModel(arc, article, name, states);
    } catch {
      model = { archive: arc, roots: [], fogEntries: [], warnings: ['Native ' + name + ' is particle-only; no substitute model is drawn.'], stats: { joints: 0, meshes: 0, vertices: 0, triangles: 0, textures: 0 } };
    }
    let hit = null;
    if (hitState !== null) {
      const script = arc.pointer(states + hitState * 16 + 12);
      if (!script) throw new Error(`Original ${name} article state ${hitState} has no script.`);
      hit = itemHit(arc, script);
    }
    if (hitState !== null && !hit) throw new Error(`Original ${name} article has no hit definition.`);
    return {
      model, hit, speed: 0, angle: 0, lifetime: 30,
      gravity: arc.f32(common + 16), terminal: arc.f32(common + 20), bounce: arc.f32(common + 0x58),
      minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    };
  };
  const needles = base(0, 'sheik-needles', 0);
  const chain = base(1, 'sheik-chain', 4);
  const vanish = base(2, 'sheik-vanish', 0);
  return { projectile: needles, accessory: chain, seak: { needles, chain, vanish } };
}
