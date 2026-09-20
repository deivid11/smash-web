import type { HsdArchive } from '../hsd/archive.ts';
import { articleModel, itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** ftIceClimberAttributes fields consumed by the prototype. Offsets verified
 * against third_party/melee/src/melee/ft/kinds/ftPopo/ftpopospecial*.c; the
 * partner (Nana x1A5C/x7C/x2222) fields are never read — Nana follows through
 * the prototype partner entity instead (see lib/game/nana.ts). */
export interface PopoSpecialData {
  kind: 'Pp';
  neutral: { hover: number };
  side: { groundVel: number; airVelY1: number; airVelY2: number; airVelX: number };
  up: { divisorX: number; divisorY: number; rise: number; fallGravity: number; fallTerminal: number; landing: number; landClear: number; stick: number };
  down: { interval: number; offsetX: number; offsetY: number };
  ice: { life: number; lifeDec: number; stopSpeed: number; startSpeed: number; slopeMul: number; damageScale: number; baseDamage: number; slopeUp: number; slopeDown: number };
  blizzard: { speed: number; gravity: number; coneLo: number; coneHi: number };
}
function range(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isFinite(v) || v < lo || v > hi) throw Error(`Invalid original Popo ${what}.`);
  return v;
}
export function parsePopoParameters(arc: HsdArchive): PopoSpecialData {
  const base = arc.pointer(arc.symbol('ftDataPopo') + 4);
  const f = (o: number) => arc.f32(base + o);
  const p: PopoSpecialData = {
    kind: 'Pp',
    neutral: { hover: range(f(0x4), 0, 5, 'hover') },
    side: { groundVel: range(f(0x28), 0, 10, 'squall ground'), airVelY1: range(f(0x20), -5, 5, 'squall air y1'), airVelY2: range(f(0x24), -5, 5, 'squall air y2'), airVelX: range(f(0x2c), 0, 10, 'squall air x') },
    up: { divisorX: range(f(0x84), 1, 10, 'belay div x'), divisorY: range(f(0x88), 1, 10, 'belay div y'), rise: range(f(0xa4), 0, 10, 'belay rise'), fallGravity: range(f(0xa8), 0, 5, 'belay gravity'), fallTerminal: range(f(0xac), 0.1, 10, 'belay terminal'), landing: range(f(0x78), 0, 120, 'belay landing'), landClear: range(f(0x74), 0, 120, 'belay land clear'), stick: range(f(0x80), 0, 1, 'belay stick') },
    down: { interval: range(f(0xb8), 1, 120, 'blizzard interval'), offsetX: f(0xbc), offsetY: f(0xc0) },
    ice: { life: 60, lifeDec: 5, stopSpeed: 0.95, startSpeed: 1.5, slopeMul: 0.8, damageScale: 2, baseDamage: 2, slopeUp: 0.22, slopeDown: 0.25 },
    blizzard: { speed: 2, gravity: 0, coneLo: 0.785, coneHi: 1.745 },
  };
  // Ice climbers ice article (slot 0): life/life-dec/stop/start/slope in x0..x24,
  // damage scale is the u32 at +0x30 (damage = |vel| * scale).
  {
    const table = arc.pointer(arc.symbol('ftDataPopo') + 0x48);
    const special = arc.pointer(arc.pointer(table) + 4);
    const g = (o: number) => arc.f32(special + o);
    p.ice = {
      life: range(g(0), 1, 600, 'ice life'), lifeDec: range(g(4), 0.01, 60, 'ice life dec'),
      stopSpeed: range(g(0x24), 0, 10, 'ice min vel'), startSpeed: range(g(0x10), 0, 20, 'ice speed'),
      slopeMul: range(g(0x14), 0, 5, 'ice slope'), damageScale: range(arc.u32(special + 0x30), 1, 10, 'ice damage scale'),
      baseDamage: range(arc.u32(special + 0x2c), 0, 20, 'ice base damage'),
      slopeUp: range(g(0x1c), 0, 5, 'ice uphill'), slopeDown: range(g(0x18), 0, 5, 'ice downhill'),
    };
  }
  // Blizzard article (slot 1): forward speed x4, per-frame gravity x8, spray
  // cone between xC and x10 radians around straight-down-forward.
  {
    const table = arc.pointer(arc.symbol('ftDataPopo') + 0x48);
    const special = arc.pointer(arc.pointer(table + 4) + 4);
    const lo = arc.f32(special + 0xc), hi = arc.f32(special + 0x10);
    if (!(lo >= 0 && hi >= lo && hi <= Math.PI * 2)) throw Error('Invalid original Popo spray cone.');
    p.blizzard = { speed: range(arc.f32(special + 4), 0, 20, 'blizzard speed'), gravity: range(arc.f32(special + 8), -5, 5, 'blizzard gravity'), coneLo: lo, coneHi: hi };
  }
  if (Math.abs(p.down.offsetX) > 30 || Math.abs(p.down.offsetY) > 30) throw Error('Invalid original Popo spray offset.');
  return p;
}
/** ftPp motion states in action-table order. Nana swings the same leader
 * scripts from her own pose (see lib/game/nana.ts); her mirrored `_1`
 * scripts (251, 252, 256, 257) stay unloaded, so desyncs are out of scope. */
export const POPO_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'SpecialN', index: 242, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 243, figatree: 'SpecialAirN' },
  { key: 'SpecialS1', index: 244, figatree: 'SpecialS1' },
  { key: 'SpecialS2', index: 245, figatree: 'SpecialS2' },
  { key: 'SpecialAirS1', index: 246, figatree: 'SpecialAirS1' },
  { key: 'SpecialAirS2', index: 247, figatree: 'SpecialAirS2' },
  { key: 'SpecialHiStart', index: 248, figatree: 'SpecialHiStart' },
  { key: 'SpecialHiThrow', index: 249, figatree: 'SpecialHiThrow' },
  { key: 'SpecialHiThrow2', index: 250, figatree: 'SpecialHiThrow2' },
  { key: 'SpecialAirHiStart', index: 253, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHiThrow', index: 254, figatree: 'SpecialAirHiThrow' },
  { key: 'SpecialAirHiThrow2', index: 255, figatree: 'SpecialAirHiThrow2' },
  { key: 'SpecialLw', index: 258, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 259, figatree: 'SpecialAirLw' },
  { key: 'Wait1', index: 2, figatree: 'Wait' },
];
export const POPO_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', strong: 'AttackS4', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** Solo articles: Ice Shot (slot 0, accelerating slide) and Blizzard spray
 * (slot 1, resolved through the double-deref article model probe). Slot 2 is
 * the Belay rope (no hitbox) and is not loaded. */
export function parsePopoArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataPopo') + 0x48);
  const read = (index: number, name: string): ArticleData => {
    const article = arc.pointer(table + index * 4);
    const common = arc.pointer(article), special = arc.pointer(article + 4);
    const states = arc.pointer(article + 12);
    const script = arc.pointer(states + 12);
    const model = articleModel(arc, article, name, states);
    const hit = script ? itemHit(arc, script) : null;
    if (!hit) throw new Error(`Original ${name} article has no hit definition.`);
    // Ice lifeTimer starts at x0 and ticks 1/frame while sliding (UnkMotion2);
    // slow grazes subtract x4 extra and melting starts below x8 (rare edge:
    // graze-accelerated melting is not modeled, documented in the POPO guide).
    // Blizzard life is x0 directly.
    const lifetime = name === 'climbers-ice' ? arc.f32(special) : name === 'climbers-blizzard' ? arc.f32(special) : 60;
    return {
      model, hit, speed: 0, angle: 0, lifetime,
      gravity: arc.f32(common + 16), terminal: arc.f32(common + 20), bounce: arc.f32(common + 0x58),
      minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    };
  };
  const ice = read(0, 'climbers-ice');
  const blizzard = read(1, 'climbers-blizzard');
  return { projectile: ice, accessory: blizzard };
}
