import type { HsdArchive } from '../hsd/archive.ts';
import { loadModel } from '../hsd/model.ts';
import { partJoint, type FighterProfile } from './data.ts';
import { itemHit, type ArticleData, type ReflectorData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** ftMewtwoAttributes (third_party/melee/src/melee/ft/kinds/ftMewtwo/types.h), USA 1.02. */
export interface MewtwoBaseData {
  neutral: { chargeCycles: number; chargeIterations: number; groundRecoilX: number; airRecoilX: number; releaseLag: number; landing: number };
  side: { airBoost: number; reflect: ReflectorData };
  up: { velDivX: number; velDivY: number; gravity: number; terminal: number; duration: number; stickMin: number; momentum: number; momentumAdd: number; drift: number; endMul: number; mobility: number; landing: number };
  down: { gravity: number; terminal: number; offsetX: number; offsetY: number };
}
/** Mewtwo's own block (ftDataMewtwo). */
export interface MewtwoSpecialData extends MewtwoBaseData { kind: 'Mt'; }
/** Shadow Mewtwo's block (ftDataShadowMewtwo, same Mewtwo-family layout). */
export interface ShadowMewtwoSpecialData extends MewtwoBaseData { kind: 'Sm'; }
export function parseMewtwoParameters(arc: HsdArchive, profile: FighterProfile, kind: 'Mt' | 'Sm' = 'Mt'): MewtwoSpecialData | ShadowMewtwoSpecialData {
  const base = arc.pointer(arc.symbol(kind === 'Mt' ? 'ftDataMewtwo' : 'ftDataShadowMewtwo') + 4);
  const f = (o: number) => { const v = arc.f32(base + o); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw new Error('Invalid original Mewtwo parameter.'); return v; };
  const u = (o: number) => { const v = arc.u32(base + o); if (v > 600) throw new Error('Invalid original Mewtwo integer.'); return v; };
  // ftMt_SpecialS_ReflectThink installs the ReflectDesc at +0x1C; native x2218_b4 forbids
  // ownership transfer regardless of the descriptor, so keepOwner is forced on.
  const reflect: ReflectorData = {
    bone: partJoint(profile, arc.u32(base + 0x1c), 'Mewtwo Confusion'), maxDamage: u(0x20),
    offset: [f(0x24), f(0x28), f(0x2c)], radius: f(0x30), damageMultiplier: f(0x34), speedMultiplier: f(0x38), keepOwner: true,
  };
  const p: MewtwoSpecialData | ShadowMewtwoSpecialData = {
    kind,
    neutral: { chargeCycles: f(0), chargeIterations: u(0xc), groundRecoilX: f(4), airRecoilX: f(8), releaseLag: u(0x10), landing: f(0x14) },
    side: { airBoost: f(0x18), reflect },
    up: { velDivX: f(0x40), velDivY: f(0x44), gravity: f(0x48), terminal: f(0x4c), duration: u(0x50), stickMin: f(0x58), momentum: f(0x5c), momentumAdd: f(0x60), drift: f(0x64), endMul: f(0x6c), mobility: f(0x70), landing: f(0x74) },
    down: { gravity: f(0x78), terminal: f(0x7c), offsetX: f(0x80), offsetY: f(0x84) },
  };
  if (p.neutral.chargeCycles < 1 || p.neutral.chargeCycles > 30 || p.neutral.chargeIterations < 1 || p.up.duration < 1 || p.up.velDivX <= 0 || p.up.velDivY <= 0 || p.up.stickMin <= 0 || p.up.stickMin >= 1 || reflect.radius <= 0 || reflect.radius > 100) throw new Error('Unsupported original Mewtwo bounds.');
  return p;
}
/** ftMt subactions 244–262: LoopFull entries reuse the Loop figatree with their own scripts,
 * and aerial Teleport travel reuses the shared SpecialHiLost clip. */
export const MEWTWO_ACTION_KEYS = [
  'SpecialNStart', 'SpecialNLoop', 'SpecialNLoopFull', 'SpecialNCancel', 'SpecialNEnd',
  'SpecialAirNStart', 'SpecialAirNLoop', 'SpecialAirNLoopFull', 'SpecialAirNCancel', 'SpecialAirNEnd',
  'SpecialS', 'SpecialAirS', 'SpecialHiStart', 'SpecialHi', 'SpecialHiLost', 'SpecialAirHiStart', 'SpecialAirHi', 'SpecialLw', 'SpecialAirLw',
].map((key, i) => ({ key, index: 244 + i, figatree: key.replace('LoopFull', 'Loop') }));
export const MEWTWO_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3', strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** ftMt_Init_OnLoad slots: 0 Disable, 1 Shadow Ball. Shadow Ball ItemStates are 16 bytes;
 * flight states 1..8 carry the per-charge hitboxes (it_802C5B18 selects charge+1). */
export function parseMewtwoArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataMewtwo') + 0x48);
  const read = (slot: number, state: number, name: string): ArticleData => {
    const article = arc.pointer(table + slot * 4), common = arc.pointer(article), special = arc.pointer(article + 4), states = arc.pointer(article + 12) + state * 16;
    if (!common || !special) throw new Error(`Original ${name} article is incomplete.`);
    const joint = arc.pointer(arc.pointer(article + 16));
    // itMewtwoDisable draws through efSync particles only; its article has no JObj model.
    const model = joint ? loadModel(arc, { offset: joint, name, animation: arc.pointer(states), materialAnimation: arc.pointer(states + 4) })
      : { archive: arc, roots: [], fogEntries: [], warnings: ['Native Disable is particle-only; no substitute model is drawn.'], stats: { joints: 0, meshes: 0, vertices: 0, triangles: 0, textures: 0 } };
    return { model, hit: arc.pointer(states + 12) ? itemHit(arc, arc.pointer(states + 12)) : null,
      speed: 0, angle: 0, lifetime: arc.f32(special), gravity: arc.f32(common + 16), terminal: arc.f32(common + 20),
      bounce: arc.f32(common + 0x58), minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0 };
  };
  const disable = read(0, 0, 'mewtwo-disable');
  disable.speed = arc.f32(arc.pointer(arc.pointer(table) + 4) + 4); // itMDisableAttributes.x_vel
  if (!disable.hit) throw new Error('Missing Mewtwo Disable hitbox.');
  const special = arc.pointer(arc.pointer(table + 4) + 4);
  const s = (offset: number) => arc.f32(special + offset);
  const wobblePeriod = arc.u32(special + 0x20);
  if (wobblePeriod < 1 || wobblePeriod > 120 || s(0xc) < s(8) || s(0x14) < s(0x10)) throw new Error('Unsupported Mewtwo Shadow Ball attributes.');
  // itMewtwoShadowball_DatAttrs: x8/xC launch speed, x10/x14 damage, x18/x1C scale, x20 wobble
  // period. it_802C53F0 multiplies the launch speed by 0.5 + 0.5·charge/max.
  const charges = Array.from({ length: 8 }, (_, level) => {
    const data = read(1, level + 1, `shadow-ball-${level}`), ratio = level / 7;
    data.speed = Math.fround(Math.fround(s(8) + ratio * (s(0xc) - s(8))) * (0.5 + 0.5 * ratio));
    data.scale *= Math.fround(s(0x18) + ratio * (s(0x1c) - s(0x18)));
    if (!data.hit) throw new Error('Missing Mewtwo Shadow Ball hitbox.');
    return data;
  });
  return { projectile: charges[0]!, accessory: disable, mewtwo: { charges, disable, wobblePeriod } };
}
