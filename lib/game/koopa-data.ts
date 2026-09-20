import type { HsdArchive } from '../hsd/archive.ts';
import { itemHit, articleModel, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** ftKoopaAttributes (third_party/melee/src/melee/ft/kinds/ftKoopa/types.h), USA 1.02.
 * Offsets follow the ftkoopaspecial* callbacks; the header itself is unnamed. */
export interface KoopaSpecialData {
  kind: 'Kp';
  /** Fire Breath: flame cadence, strength/range pools and their per-frame recovery. */
  breath: { period: number; recoverStrength: number; recoverRange: number; maxStrength: number; minStrength: number; maxRange: number; minRange: number; cycle: number };
  /** Koopa Klaw: bite damage and the toss input threshold. */
  /** Koopa Klaw: bite damage, the toss input threshold, and the victim's mash-out timer
   * (ftCo_CaptureKoopa: x4C armed, x48 off a frame, x44 off a mashed press). */
  klaw: { biteDamage: number; stick: number; escapeBase: number; escapeDecay: number; escapeMash: number };
  /** Whirling Fortress: aerial rise, gravity/terminal, ground/air clamps and landing lag. */
  fortress: { rise: number; gravity: number; terminal: number; groundClamp: number; airClamp: number; groundAccel: number; airAccel: number; loopFrame: number; loopRewind: number; landingLag: number };
  /** Bowser Bomb: entry velocity scales, dive speed and air friction. */
  bomb: { velXMul: number; velYMul: number; airFriction: number; fallAccel: number; terminal: number; diveSpeed: number };
}
export function parseKoopaParameters(arc: HsdArchive): KoopaSpecialData {
  const base = arc.pointer(arc.symbol('ftDataKoopa') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Bowser parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Bowser integer.'); return v; };
  const p: KoopaSpecialData = {
    kind: 'Kp',
    breath: { period: u(4), recoverStrength: f(8), recoverRange: f(0xc), maxStrength: f(0x10), minStrength: f(0x14), maxRange: f(0x18), minRange: f(0x1c), cycle: u(0x20) },
    klaw: { biteDamage: u(0x2c), stick: f(0x30), escapeBase: f(0x4c), escapeDecay: f(0x48), escapeMash: f(0x44) },
    fortress: { rise: f(0x54), gravity: f(0x58), terminal: f(0x5c), groundClamp: f(0x60), airClamp: f(0x64), groundAccel: f(0x68), airAccel: f(0x6c), loopFrame: f(0x70), loopRewind: f(0x78), landingLag: f(0x7c) },
    bomb: { velXMul: f(0x80), velYMul: f(0x84), airFriction: f(0x88), fallAccel: f(0x8c), terminal: f(0x90), diveSpeed: f(0x94) },
  };
  if (p.breath.maxStrength <= p.breath.minStrength || p.breath.maxRange <= p.breath.minRange || p.breath.recoverStrength <= 0 ||
      p.klaw.biteDamage < 1 || p.klaw.biteDamage > 30 || p.fortress.rise <= 0 || p.fortress.gravity <= 0 || p.fortress.terminal <= 0 ||
      p.bomb.diveSpeed >= 0 || p.bomb.fallAccel <= 0) {
    throw Error('Unsupported original Bowser bounds.');
  }
  return p;
}
/** ftKp subactions 248–268 (ftKoopa_MotionState order; the two SpecialSHit table entries
 * are the bite variants Hit0/Hit1 sharing the SpecialSHit figatree). */
export const KOOPA_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  ['SpecialNStart', 'SpecialNStart'], ['SpecialN', 'SpecialN'], ['SpecialNEnd', 'SpecialNEnd'],
  ['SpecialAirNStart', 'SpecialAirNStart'], ['SpecialAirN', 'SpecialAirN'], ['SpecialAirNEnd', 'SpecialAirNEnd'],
  ['SpecialSStart', 'SpecialSStart'], ['SpecialSHit0', 'SpecialSHit'], ['SpecialSHit1', 'SpecialSHit'],
  ['SpecialSEndF', 'SpecialSEndF'], ['SpecialSEndB', 'SpecialSEndB'],
  ['SpecialAirSStart', 'SpecialAirSStart'], ['SpecialAirSHit0', 'SpecialAirSHit'], ['SpecialAirSHit1', 'SpecialAirSHit'],
  ['SpecialAirSEndF', 'SpecialAirSEndF'], ['SpecialAirSEndB', 'SpecialAirSEndB'],
  ['SpecialHi', 'SpecialHi'], ['SpecialAirHi', 'SpecialAirHi'],
  ['SpecialLw', 'SpecialLw'], ['SpecialAirLw', 'SpecialAirLw'], ['SpecialLwLanding', 'SpecialLwLanding'],
].map(([key, figatree], i) => ({ key: key!, index: 248 + i, figatree: figatree! }));
export const KOOPA_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** ftKp_Init_OnLoad slot 0: the Fire Breath flame item (itKoopaFlame attributes:
 * x0 lifetime, x8 launch speed, x10/x14 the spread angle bounds in radians). */
export function parseKoopaArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataKoopa') + 0x48);
  const article = arc.pointer(table), common = arc.pointer(article), special = arc.pointer(article + 4), states = arc.pointer(article + 12);
  if (!common || !special) throw Error('Original Bowser flame article is incomplete.');
  const model = articleModel(arc, article, 'koopa-flame', states);
  const hit = arc.pointer(states + 12) ? itemHit(arc, arc.pointer(states + 12)) : null;
  if (!hit) throw Error('Missing original Bowser flame hitbox.');
  const value = (o: number) => { const v = arc.f32(special + o); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original flame attribute.'); return v; };
  const flame: ArticleData = {
    model, hit, speed: value(8), angle: 0, lifetime: value(0), gravity: arc.f32(common + 16), terminal: arc.f32(common + 20),
    bounce: arc.f32(common + 0x58), minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
  };
  if (flame.speed <= 0 || flame.lifetime <= 0 || flame.lifetime > 600) throw Error('Unsupported original flame bounds.');
  // itKoopaFlame_Spawn: each flame rolls its speed inside x8..xC and its launch angle inside
  // x10..x14, and itKoopaFlame_UnkMotion0_Phys drives it at (sin a, cos a) with no decay, so the
  // angles are measured from straight up.
  const koopa = { flame, speed: [value(8), value(0xc)] as [number, number], angle: [value(0x10), value(0x14)] as [number, number] };
  if (koopa.speed[1] < koopa.speed[0] || koopa.angle[1] < koopa.angle[0] || koopa.angle[0] < 0 || koopa.angle[1] > Math.PI) throw Error('Unsupported original flame launch bounds.');
  return { projectile: flame, koopa };
}
