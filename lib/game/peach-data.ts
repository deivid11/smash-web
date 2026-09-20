import type { HsdArchive } from '../hsd/archive.ts';
import { partJoint, type FighterProfile } from './data.ts';
import { itemHit, articleModel, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { HsdModel } from '../hsd/model.ts';
import type { FighterContent } from './load.ts';
import type { V3 } from '../hsd/model.ts';

/** ftPe_DatAttrs (third_party/melee/src/melee/ft/kinds/ftPeach/types.h), USA 1.02.
 * Figatree naming quirk verified against the submotion enum: Toad (SpecialN) plays the
 * figatrees NAMED SpecialLw/SpecialLwHit, while the turnip pull (SpecialLw) plays the
 * figatree NAMED SpecialN. The keyed entries below resolve that swap. */
export interface PeachSpecialData {
  kind: 'Pe';
  /** Float (Fuwafuwa): hover duration in frames (xC). */
  float: { duration: number };
  /** Peach Bomber (ftpeachspecials.c): x34 ground entry, x38/x3C SStart drive, x40 aerial entry,
   * x44/x48 SJump launch (x48 only below the x30 smash window, 0 on both discs), x50–x5C SJump fall,
   * x60/x64 explosion rebound, x68/x6C AirSEnd velocity divisors. */
  bomber: { enterVelX: number; startAccel: number; startVelX: number; airStartVelY: number; velX: number; smashVelX: number; velY: number;
    gravity: number; airFriction: number; hitGravity: number; terminal: number; endVelX: number; endVelY: number; hitDivX: number; hitDivY: number };
  /** Peach Parasol: rise handling and the open-canopy slow fall. */
  parasol: { stick: number; riseFrames: number; fallDamping: number; timeout: number };
  /** Toad: aerial entry, slow fall and the counter detect bubble (xAC ShieldDesc/AbsorbDesc). */
  toad: { airVelXDiv: number; airFriction: number; airVelY: number; fallAccel: number; terminal: number;
    counter: { bone: number; offset: V3; radius: number } };
  /** Turnip pull: the 1-in-x14 rare item roll is not ported (Bob-omb/Mr. Saturn/Beam Sword). */
  veg: { rareChance: number };
}
/** Also reads Daisy's PlDa block: her m-ex kit runs the same ftPe callbacks on the same layout. */
export function parsePeachParameters(arc: HsdArchive, profile: FighterProfile, symbol = 'ftDataPeach'): PeachSpecialData {
  const base = arc.pointer(arc.symbol(symbol) + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Peach parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 100000) throw Error('Invalid original Peach integer.'); return v; };
  const p: PeachSpecialData = {
    kind: 'Pe',
    float: { duration: f(0xc) },
    bomber: { enterVelX: f(0x34), startAccel: f(0x38), startVelX: f(0x3c), airStartVelY: f(0x40), velX: f(0x44), smashVelX: f(0x48), velY: f(0x4c),
      gravity: f(0x50), airFriction: f(0x54), hitGravity: f(0x58), terminal: f(0x5c), endVelX: f(0x60), endVelY: f(0x64), hitDivX: f(0x68), hitDivY: f(0x6c) },
    parasol: { stick: f(0x78), riseFrames: f(0x74), fallDamping: f(0x8c), timeout: u(0x90) },
    toad: { airVelXDiv: f(0x94), airFriction: f(0x98), airVelY: f(0x9c), fallAccel: f(0xa0), terminal: f(0xa4),
      counter: { bone: partJoint(profile, arc.u32(base + 0xac), 'Toad counter'), offset: [f(0xb0), f(0xb4), f(0xb8)], radius: f(0xbc) } },
    veg: { rareChance: u(0x14) },
  };
  if (p.float.duration < 1 || p.float.duration > 600 || p.bomber.velX <= 0 || p.bomber.smashVelX <= 0 || p.bomber.hitDivX <= 0 || p.bomber.hitDivY <= 0 || p.bomber.gravity <= 0 ||
      p.toad.counter.radius <= 0 || p.toad.counter.radius > 100 || p.parasol.timeout < 1) {
    throw Error('Unsupported original Peach bounds.');
  }
  return p;
}
/** ftPe subactions 242–264 in the ftPe_Submotion enum order (Float first, weapon smashes,
 * the swapped SpecialN/SpecialLw figatrees, then the parasol item states). */
export const PEACH_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  ['Fuwafuwa', 'Fuwafuwa'], ['FloatFallF', 'JumpAerialF'], ['FloatFallB', 'JumpAerialB'],
  ['AttackS4Club', 'AttackS4'], ['AttackS4Pan', 'AttackS4'], ['AttackS4Racket', 'AttackS4'],
  ['SpecialLw', 'SpecialN'],
  ['SpecialSStart', 'SpecialSStart'], ['SpecialSEnd', 'SpecialSEnd'], ['SpecialSJump', 'SpecialSJump'],
  ['SpecialAirSStart', 'SpecialAirSStart'], ['SpecialAirSEnd0', 'SpecialAirSEnd'], ['SpecialAirSEnd1', 'SpecialAirSEnd'],
  ['SpecialHiStart', 'SpecialHiStart'], ['SpecialHiEnd', 'SpecialHiEnd'],
  ['SpecialAirHiStart', 'SpecialAirHiStart'], ['SpecialAirHiEnd', 'SpecialAirHiEnd'],
  ['SpecialN', 'SpecialLw'], ['SpecialNHit', 'SpecialLwHit'], ['SpecialAirN', 'SpecialAirLw'], ['SpecialAirNHit', 'SpecialAirLwHit'],
  ['ItemParasolOpen', 'ItemParasolOpen'], ['ItemParasolFall', 'ItemParasolFall'],
].map(([key, figatree], i) => ({ key: key!, index: 242 + i, figatree: figatree! }));
/** ftPe_Init_OnDeath (and PlDa's identical respawn export): model-part groups for costume 0 —
 * group 3 (the club/pan/racket held by AttackS4*) and group 5 start hidden. */
export const PEACH_PART_DEFAULTS: readonly number[] = [0, 0, 0, -1, 0, -1, 0];
export const PEACH_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4Club', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** ftPe_Init_OnLoad slots: 0 bomber explosion, 1 turnip, 2 parasol, 3 Toad, 4 Toad spores.
 * itPeachTurnipAttributes: x0 lifetime, x4 face count, x8[] {odds, damage} per stitch face. */
export interface PeachArticles {
  explosion: ArticleData;
  turnip: ArticleData & { faces: Array<{ odds: number; damage: number }> };
  parasol: ArticleData;
  /** It_Kind_Peach_Toad: state 0 rides SpecialN, state 1 (`toadHit`) the counter's SpecialNHit. */
  toad: ArticleData & { toadHit: HsdModel };
  /** itPeachToadSporeAttributes: x0 min speed, x4 random extra speed, x8 per-frame velocity
   * decay, xC launch cone around the facing horizontal (it_802BE2E8); life is a fixed 60. */
  spore: ArticleData & { minSpeed: number; speedRange: number; decay: number; cone: number };
}
export function parsePeachArticles(arc: HsdArchive, symbol = 'ftDataPeach'): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol(symbol) + 0x48);
  const read = (slot: number, name: string): ArticleData => {
    const article = arc.pointer(table + slot * 4), common = arc.pointer(article), states = arc.pointer(article + 12);
    if (!common) throw Error(`Original ${name} article is incomplete.`);
    const model = articleModel(arc, article, name, states);
    return { model, hit: arc.pointer(states + 12) ? itemHit(arc, arc.pointer(states + 12)) : null,
      speed: 0, angle: 0, lifetime: 30, gravity: arc.f32(common + 16), terminal: arc.f32(common + 20),
      bounce: arc.f32(common + 0x58), minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0 };
  };
  const special = (slot: number) => arc.pointer(arc.pointer(table + slot * 4) + 4);
  const sf = (slot: number, offset: number) => { const v = arc.f32(special(slot) + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Peach item attribute.'); return v; };
  const su = (slot: number, offset: number) => { const v = arc.u32(special(slot) + offset); if (v > 600) throw Error('Invalid original Peach item integer.'); return v; };
  const explosion = read(0, 'peach-explosion');
  const faceCount = su(1, 4);
  if (faceCount < 1 || faceCount > 16) throw Error('Unsupported original turnip face table.');
  const turnip: PeachArticles['turnip'] = { ...read(1, 'turnip'), faces: Array.from({ length: faceCount }, (_, i) => ({ odds: su(1, 8 + i * 8), damage: su(1, 12 + i * 8) })) };
  turnip.lifetime = sf(1, 0);
  const parasol = read(2, 'peach-parasol');
  const toadStates = arc.pointer(arc.pointer(table + 3 * 4) + 12);
  const toad: PeachArticles['toad'] = { ...read(3, 'peach-toad'), toadHit: articleModel(arc, arc.pointer(table + 3 * 4), 'peach-toad-hit', toadStates + 16) };
  const spore: PeachArticles['spore'] = { ...read(4, 'toad-spore'), minSpeed: sf(4, 0), speedRange: sf(4, 4), decay: sf(4, 8), cone: sf(4, 0xc) };
  spore.lifetime = 60;
  if (!explosion.hit || !spore.hit) throw Error('Missing original Peach article hitboxes.');
  if (!turnip.faces.some(face => face.damage > 0)) throw Error('Unsupported original turnip damage table.');
  return { projectile: turnip, peach: { explosion, turnip, parasol, toad, spore } };
}
