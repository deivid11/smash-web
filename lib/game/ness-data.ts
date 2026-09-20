import type { HsdArchive } from '../hsd/archive.ts';
import { loadModel } from '../hsd/model.ts';
import { partJoint, type FighterProfile } from './data.ts';
import { itemHit, type ArticleData, type ReflectorData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';
import type { V3 } from '../hsd/model.ts';

/** ftNessAttributes (third_party/melee/src/melee/ft/kinds/ftNess/types.h), USA 1.02.
 * The decomp names every field; offsets are copied from that header verbatim. */
export interface NessSpecialData {
  kind: 'Ns';
  /** PK Flash: fighter-side loop timers and the freefall landing lag. */
  flash: { loop1: number; loop2: number; gravityDelay: number; minChargeFrames: number; fallAccel: number; landingLag: number };
  /** PK Fire: launch trajectory/speed pairs and the hand-relative spawn point. */
  fire: { airAngle: number; airSpeed: number; groundAngle: number; groundSpeed: number; spawnX: number; spawnY: number; landingLag: number };
  /** PK Thunder ball control loop plus the PK Thunder 2 self-hit launch. */
  thunder: { loop1: number; loop2: number; gravityDelay: number; fallAccel: number;
    momentum: number; deceleration: number; knockdownAngle: number; wallhugAngle: number; landingLag: number };
  /** PSI Magnet: release lag, gravity delay, heal multiplier and the native AbsorbDesc. */
  magnet: { releaseLag: number; gravityDelay: number; fallAccel: number; healMul: number;
    absorb: { bone: number; offset: V3; radius: number } };
  /** Up/Down smash Yo-Yo charge window; the dedicated charge-hold states are not ported. */
  yoyo: { chargeDuration: number; damageMul: number; rehitRate: number };
  /** Forward-smash baseball bat ReflectDesc (xB8). */
  bat: ReflectorData;
}
export function parseNessParameters(arc: HsdArchive, profile: FighterProfile): NessSpecialData {
  const base = arc.pointer(arc.symbol('ftDataNess') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Ness parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Ness integer.'); return v; };
  const p: NessSpecialData = {
    kind: 'Ns',
    flash: { loop1: u(0), loop2: u(4), gravityDelay: u(8), minChargeFrames: u(0xc), fallAccel: f(0x14), landingLag: f(0x1c) },
    fire: { airAngle: f(0x20), airSpeed: f(0x24), groundAngle: f(0x28), groundSpeed: f(0x2c), spawnX: f(0x30), spawnY: f(0x34), landingLag: f(0x38) },
    thunder: { loop1: u(0x40), loop2: u(0x44), gravityDelay: u(0x48), fallAccel: f(0x50),
      momentum: f(0x54), deceleration: f(0x5c), knockdownAngle: f(0x60), wallhugAngle: f(0x64), landingLag: f(0x70) },
    magnet: { releaseLag: f(0x74), gravityDelay: u(0x84), fallAccel: f(0x8c), healMul: f(0x94),
      absorb: { bone: partJoint(profile, arc.u32(base + 0x98), 'PSI Magnet'), offset: [f(0x9c), f(0xa0), f(0xa4)], radius: f(0xa8) } },
    yoyo: { chargeDuration: f(0xac), damageMul: f(0xb0), rehitRate: f(0xb4) },
    bat: { bone: partJoint(profile, arc.u32(base + 0xb8), 'baseball bat'), maxDamage: arc.u32(base + 0xbc),
      offset: [f(0xc0), f(0xc4), f(0xc8)], radius: f(0xcc), damageMultiplier: f(0xd0), speedMultiplier: f(0xd4), keepOwner: true },
  };
  if (p.flash.loop1 < 1 || p.fire.airSpeed <= 0 || p.fire.groundSpeed <= 0 || p.thunder.momentum <= 0 || p.thunder.deceleration <= 0 ||
      p.magnet.absorb.radius <= 0 || p.magnet.absorb.radius > 100 || p.magnet.healMul <= 0 || p.bat.radius <= 0 || p.bat.radius > 100) {
    throw Error('Unsupported original Ness bounds.');
  }
  return p;
}
/** ftNs subactions 245–275 (ftNs_Submotion order). The yo-yo charge states reuse the smash
 * figatrees, the PK Thunder 2 wall rebound reuses DamageFall, and Wait maps onto Wait1. */
export const NESS_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  ['AttackHi4Charge', 'AttackHi4'], ['AttackHi4Release', 'AttackHi4'], ['AttackLw4Charge', 'AttackLw4'], ['AttackLw4Release', 'AttackLw4'],
  ['SpecialNStart', 'SpecialNStart'], ['SpecialNHold0', 'SpecialNHold'], ['SpecialNHold1', 'SpecialNHold'], ['SpecialNEnd', 'SpecialNEnd'],
  ['SpecialAirNStart', 'SpecialAirNStart'], ['SpecialAirNHold0', 'SpecialAirNHold'], ['SpecialAirNHold1', 'SpecialAirNHold'], ['SpecialAirNEnd', 'SpecialAirNEnd'],
  ['SpecialS', 'SpecialS'], ['SpecialAirS', 'SpecialAirS'],
  ['SpecialHiStart', 'SpecialHiStart'], ['SpecialHiHold', 'SpecialHiHold'], ['SpecialHiEnd', 'SpecialHiEnd'], ['SpecialHi', 'SpecialHi'],
  ['SpecialAirHiStart', 'SpecialAirHiStart'], ['SpecialAirHiHold', 'SpecialAirHiHold'], ['SpecialAirHiEnd', 'SpecialAirHiEnd'], ['SpecialAirHi', 'SpecialHi'],
  ['SpecialAirHiRebound', 'DamageFall'],
  ['SpecialLwStart', 'SpecialLwStart'], ['SpecialLwHold', 'SpecialLwHold'], ['SpecialLwHit', 'SpecialLwHit'], ['SpecialLwEnd', 'SpecialLwEnd'],
  ['SpecialAirLwStart', 'SpecialAirLwStart'], ['SpecialAirLwHold', 'SpecialAirLwHold'], ['SpecialAirLwHit', 'SpecialAirLwHit'], ['SpecialAirLwEnd', 'SpecialAirLwEnd'],
].map(([key, figatree], i) => ({ key: key!, index: 245 + i, figatree: figatree! })).concat([
  { key: 'Wait1', index: 2, figatree: 'Wait' },
]);
export const NESS_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** itFlashAttributes / itNessPKFirepillarAttributes / itPKThunderAttributes read from the
 * article special blocks of ftDataNess x48 slots 0–4 and 8 (ftNs_Init_OnLoad order),
 * plus the two held items that order registers last: slot 9 It_Kind_Ness_Bat and slot 10
 * It_Kind_Ness_Yoyo. Both are spawned by the smash scripts and ride a hand joint, so they
 * carry a model but no article state table of their own. */
export interface NessArticles {
  fire: ArticleData & { pillarOffset: number };
  /** itNesspkfirepillar_UnkMotion0_Anim shrinks the column from full size to `minScale`
   * over its life; `rehit`/`firstDamage`/`rehitDamage` are the state script's own cadence. */
  pillar: ArticleData & { minScale: number; openFrames: number; rehit: number; firstDamage: number; rehitDamage: number };
  flash: ArticleData & { chargeCap: number; control: number; maxDrift: number; maxFall: number; explosionDelay: number; rise: number; launchAngle: number };
  explosion: ArticleData & { baseDamage: number; damagePerCharge: number };
  ball: ArticleData & { stickThreshold: number; turnRadius: number; spawnAngle: number };
  trail: ArticleData;
  bat: ArticleData;
  yoyo: ArticleData;
}
export function parseNessArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataNess') + 0x48);
  const read = (slot: number, name: string): ArticleData => {
    const article = arc.pointer(table + slot * 4), common = arc.pointer(article), states = arc.pointer(article + 12);
    if (!common) throw Error(`Original ${name} article is incomplete.`);
    const model = loadModel(arc, { offset: arc.pointer(arc.pointer(article + 16)), name,
      animation: states ? arc.pointer(states) : 0, materialAnimation: states ? arc.pointer(states + 4) : 0 });
    return { model, hit: states && arc.pointer(states + 12) ? itemHit(arc, arc.pointer(states + 12)) : null,
      speed: 0, angle: 0, lifetime: 30, gravity: arc.f32(common + 16), terminal: arc.f32(common + 20),
      bounce: arc.f32(common + 0x58), minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0 };
  };
  const special = (slot: number) => arc.pointer(arc.pointer(table + slot * 4) + 4);
  const sf = (slot: number, offset: number, max = 1000) => { const v = arc.f32(special(slot) + offset); if (!Number.isFinite(v) || Math.abs(v) > max) throw Error('Invalid original Ness item attribute.'); return v; };
  const fire: NessArticles['fire'] = { ...read(0, 'pk-fire'), pillarOffset: sf(0, 4) };
  fire.lifetime = sf(0, 0);
  // The pillar's own state script (PlNs.dat x3F1C): hit 3%, wait 9, then eleven cycles of
  // "arm a 2% hit for two frames, clear it for six". Its cadence is the whole move's pressure.
  const pillar: NessArticles['pillar'] = { ...read(1, 'pk-fire-pillar'), minScale: sf(1, 8), openFrames: 9, rehit: 8, firstDamage: 3, rehitDamage: 2 };
  pillar.lifetime = sf(1, 0);
  const flash: NessArticles['flash'] = { ...read(2, 'pk-flash'), chargeCap: sf(2, 4), control: sf(2, 0x18), maxDrift: sf(2, 0x20), maxFall: sf(2, 0x24), explosionDelay: sf(2, 0x28), rise: sf(2, 0x14), launchAngle: sf(2, 0x10) };
  flash.lifetime = sf(2, 0);
  flash.gravity = sf(2, 0x1c); // itFlashAttributes x1C, not the shared ItemAttr gravity.
  const explosion: NessArticles['explosion'] = { ...read(8, 'pk-flash-explosion'), baseDamage: sf(8, 0xc), damagePerCharge: sf(8, 0x10) };
  explosion.lifetime = sf(8, 0);
  const ball: NessArticles['ball'] = { ...read(3, 'pk-thunder'), stickThreshold: sf(3, 0xc), turnRadius: sf(3, 0x10), spawnAngle: sf(3, 8, 360) };
  ball.lifetime = sf(3, 0); ball.speed = sf(3, 4);
  const trail = read(4, 'pk-thunder-trail');
  const bat = read(9, 'ness-bat'), yoyo = read(10, 'ness-yoyo');
  if (!fire.hit || !pillar.hit || !explosion.hit || !ball.hit) throw Error('Missing original Ness projectile hitboxes.');
  if (ball.speed <= 0 || ball.turnRadius <= 0 || flash.chargeCap <= 0) throw Error('Unsupported original Ness item bounds.');
  return { projectile: fire, ness: { fire, pillar, flash, explosion, ball, trail, bat, yoyo } };
}
