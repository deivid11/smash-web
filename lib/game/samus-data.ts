import type { HsdArchive } from '../hsd/archive.ts';
import { loadModel } from '../hsd/model.ts';
import { itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';

/** ftSs_DatAttrs, not the Fox/Mario layouts. Offsets/types follow ftSamus/types.h. */
export interface SamusSpecialData {
  kind: 'Ss';
  neutral: { levels: number; interval: number; recoil: number; landing: number };
  side: { smashWindow: number; divisor: number; friction: number; spawnX: number };
  up: { groundX: number; accel: number; maxX: number; airY: number; mobility: number; reverse: number; landing: number };
  down: { groundY: number; airY: number; groundSpeed: number; airSpeed: number; groundAccel: number; airAccel: number; groundMomentum: number; airMomentum: number; spawn: [number, number, number] };
  missile: { homingFrames: number; decay: number; minimum: number; turn: number; maxAngle: number; deadAngle: number; delay: number; accel: number; maxSpeed: number };
}
export function parseSamusParameters(arc: HsdArchive): SamusSpecialData {
  const root = arc.symbol('ftDataSamus'), base = arc.pointer(root + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid Samus parameter.'); return v; };
  const table = arc.pointer(root + 0x48), missile = arc.pointer(arc.pointer(table + 8) + 4);
  const m = (offset: number) => { const v = arc.f32(missile + offset); if (!Number.isFinite(v) || v < 0 || v > 1000) throw Error('Invalid Samus missile parameter.'); return v; };
  const levels = f(0x18), interval = arc.u32(base + 0x20);
  if (levels !== 7 || interval > 120 || f(0x2c) <= 0) throw Error('Unsupported Samus charge/missile data.');
  return { kind: 'Ss', neutral: { levels, interval, recoil: f(0x1c), landing: f(0x24) },
    side: { smashWindow: f(0x28), divisor: f(0x2c), friction: f(0x30), spawnX: f(0x34) },
    up: { groundX: f(0x38), accel: f(0x3c), maxX: f(0x40), airY: f(0x44), mobility: f(0x48), reverse: f(0x4c), landing: f(0x50) },
    down: { groundY: f(0x54), airY: f(0x58), groundSpeed: f(0x5c), airSpeed: f(0x60), groundAccel: f(0x64), airAccel: f(0x68), groundMomentum: f(0x6c), airMomentum: f(0x70), spawn: [f(0x74), f(0x78), f(0x7c)] },
    missile: { homingFrames: m(8), decay: m(0x10), minimum: m(0x14), turn: m(0x18), maxAngle: m(0x1c), deadAngle: m(0x20), delay: m(0x28), accel: m(0x30), maxSpeed: m(0x34) } };
}

/** ftSs_Init_OnLoad slots 0=bomb, 1=charge, 2=missile. ItemState entries are 16 bytes.
 * Charge level selects state level+1, not the harmless held state zero. */
export function parseSamusArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataSamus') + 0x48);
  const pointer = (slot: number) => arc.pointer(table + slot * 4);
  const special = (slot: number, offset: number) => arc.f32(arc.pointer(pointer(slot) + 4) + offset);
  const read = (slot: number, state: number, name: string): ArticleData => {
    const article = pointer(slot), common = arc.pointer(article), states = arc.pointer(article + 12) + state * 16;
    const model = arc.pointer(arc.pointer(article + 16));
    const c = (offset: number) => arc.f32(common + offset);
    const hit = itemHit(arc, arc.pointer(states + 12));
    return { model: loadModel(arc, { offset: model, name, animation: arc.pointer(states), materialAnimation: arc.pointer(states + 4) }), hit,
      speed: 0, angle: 0, lifetime: 1, gravity: c(16), terminal: c(20), bounce: c(0x58), minSpeed: 0, scale: c(0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0 };
  };
  const charges = Array.from({ length: 8 }, (_, level) => {
    const data = read(1, level + 1, `charge-${level}`), ratio = level / 7;
    data.speed = Math.fround(special(1, 8) + ratio * (special(1, 12) - special(1, 8))); data.lifetime = special(1, 0);
    data.scale *= Math.fround(special(1, 24) + ratio * (special(1, 28) - special(1, 24)));
    if (!data.hit) throw Error('Missing Samus charge hitbox.');
    return data;
  });
  // it_802B55C8 spawns the same article in state 0 on the right hand while she charges: the
  // harmless orb in the cannon. itSamuschargeshot_UnkMotion0_Anim rescales it every frame over
  // the fired levels' own x18..x1C ramp, so `charges[level].scale` is also the held size.
  const hold = read(1, 0, 'charge-hold');
  const missile = read(2, 0, 'missile'), superMissile = read(2, 1, 'super-missile');
  missile.speed = special(2, 12); missile.lifetime = special(2, 4);
  superMissile.speed = special(2, 44); superMissile.lifetime = special(2, 36);
  const bomb = read(0, 0, 'bomb'), explosion = read(0, 1, 'bomb-explosion'); bomb.lifetime = special(0, 0);
  // itcmd script state 1 ends the blast; verified below by a bounded command walk.
  const blastScript = arc.pointer(arc.pointer(pointer(0) + 12) + 28);
  let cursor = blastScript, frame = 0;
  const bombBlast: Array<{ frame: number; radius: number | null }> = [];
  for (let count = 0; count < 64; count++) {
    const w = arc.u32(cursor), op = w >>> 26;
    if (op === 0) break;
    if (op === 1) frame += w & 0x3ffffff;
    else if (op === 2) frame = w & 0x3ffffff;
    else if (op === 13) bombBlast.push({ frame, radius: Math.fround((w & 0x7fffff) * Math.fround(0.003906)) });
    else if (op === 15) bombBlast.push({ frame, radius: null });
    else if (![11,19].includes(op)) throw Error('Unsupported Samus bomb blast command.');
    cursor += op === 11 ? 24 : op === 10 ? 20 : 4;
  }
  explosion.lifetime = Math.max(1, frame);
  if (![missile, superMissile, bomb, explosion].every(a => a.hit)) throw Error('Missing Samus item hitbox.');
  return { projectile: charges[0]!, accessory: bomb, samus: { charges, hold, missile, superMissile, bomb, explosion, bombBlast, bombLaunchY: arc.f32(arc.pointer(pointer(0)) + 24) } };
}

/** Verified action entries: early SpecialLw entries are bomb-jump states, NOT bomb drop. */
export const SAMUS_ACTION_KEYS = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  ...[['SpecialNStart',249],['SpecialNHold',250],['SpecialNCancel',251],['SpecialN',252],['SpecialAirNStart',253],['SpecialAirN',254],['SpecialS',255],['SpecialAirS',257],['SpecialHi',259],['SpecialAirHi',260],['SpecialLw',261],['SpecialAirLw',262]].map(([key,index]) => ({key: key as string, index: index as number, figatree: key as string})),
  { key: 'SpecialSSmash', index: 256, figatree: 'Special' }, { key: 'SpecialAirSSmash', index: 258, figatree: 'SpecialAir' },
];
