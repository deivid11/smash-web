import type { HsdArchive } from '../hsd/archive.ts';
import type { V3 } from '../hsd/model.ts';
import { articleModel, itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import { partJoint, type FighterProfile } from './data.ts';
import type { FighterContent } from './load.ts';

/** ftGameWatchAttributes fields consumed by the prototype, verified against
 * third_party/melee/src/melee/ft/kinds/ftGameWatch/ftgamewatchspecial*.c.
 * Sausage arcs live in the Chef article table (slot 8); Judgment numbers are
 * the nine SpecialS scripts; oil charge persists on the fighter. */
export interface GamewatchSpecialData {
  kind: 'Gw';
  /** ftDataGamewatch x4 (four GXColor entries, one per costume slot): the spawn
   * diffuse ftMaterial_800BFB4C writes over every mobj (file-white otherwise,
   * which renders the whole fighter white). Slot 0 is the default black. */
  costumes: [V3, V3, V3, V3];
  /** ftDataGamewatch x0 (0.01): ftGw_Init_OnLoad stores it in x34_scale.z and
   * Fighter_UpdateModelScale writes it as the root joint's depth (local X) scale,
   * which is what makes him a flat LCD figure. Presentation only: gameplay reads
   * the unflattened pose (Fighter_UnkApplyTransformation_8006C0F0's x44_mtx). */
  width: number;
  /** ftGw_Init_OnLoad `x5AC.xC[4] = items[10]`: a fifth part-visibility set holding
   * slightly inflated copies of every body/prop alternative. The normal pass hides
   * it; ftDrawCommon_80080E18 draws the selected alternatives first in
   * GAMEWATCH_OUTLINE (x14, white at 50%) lerped over the body colour, so a rim
   * outlines his silhouette. Groups mirror partVisibility.groups. */
  outline: { color: V3; alpha: number; groups: number[][][] };
  neutral: { loopFrame: number; max: number };
  side: { preserve: number; mul: number; velY: number; frictionA: number; frictionB: number };
  up: { stickRange: number; angle: number; landing: number };
  down: {
    momentumPreserve: number; momentumMul: number; fallAccel: number; terminal: number;
    damageAdd: number; damageMul: number;
    absorb: { bone: number; offset: [number, number, number]; radius: number };
  };
  sausage: { life: number; sitLife: number; fall: number; fallMax: number; arcs: Array<{ vx: number; vy: number }> };
  /** x34 GAMEWATCH_JUDGE_ROLL: per-number weights (vanilla: all 1), summed cumulatively by
   * ftGw_SpecialS_GetRandomInt over every number except the last two rolled. */
  judgeRoll: number[];
}
/** ftGw_Init_OnDeath (ftParts_80074A4C per group): the part alternatives every
 * action starts from (Fighter_ChangeMotionState restores them). Only groups
 * 0, 2 and 3 (body variants) show; the throw hand (1), dash helmet (4),
 * hand-held props (5: box, bucket, chair, flag, key, pan, hammer), Oil Panic
 * fill levels (6–8), the second down-smash prop (9) and the dizzy sleep Zs (10)
 * stay hidden until a script (opcode 31) or the bucket code selects them. */
export const GAMEWATCH_PART_DEFAULTS: readonly number[] = [0, -1, 0, 0, -1, -1, -1, -1, -1, -1, -1];
/** ft_data->x48_items[10]: the outline set's FtPartsVisLookup[model_num]
 * ({ count, TempS* } per group; TempS = { size, u8 dobj indices }). */
function outlineGroups(arc: HsdArchive, items: number, groupCount: number): number[][][] {
  const lookup = items ? arc.pointer(items + 10 * 4) : 0;
  if (!lookup) throw Error('Missing original Game & Watch outline set.');
  return Array.from({ length: groupCount }, (_, group) => {
    const alternatives = arc.u32(lookup + group * 8), list = arc.pointer(lookup + group * 8 + 4);
    if (alternatives > 16) throw Error('Invalid original Game & Watch outline set.');
    return Array.from({ length: alternatives }, (_, alternative) => {
      const size = arc.u32(list + alternative * 8);
      if (size > 128) throw Error('Invalid original Game & Watch outline set.');
      return [...arc.slice(arc.pointer(list + alternative * 8 + 4), size)];
    });
  });
}
function range(v: number, lo: number, hi: number, what: string): number {
  if (!Number.isFinite(v) || v < lo || v > hi) throw Error(`Invalid original Game & Watch ${what}.`);
  return v;
}
/** Integer-valued field that may be stored as float or int (decomp types differ
 * from usage in places); accepts either encoding when the value agrees. */
function count(arc: HsdArchive, base: number, offset: number, max: number, what: string): number {
  const u = arc.u32(base + offset), f = arc.f32(base + offset);
  if (Number.isSafeInteger(u) && u >= 0 && u <= max) return u;
  if (Number.isInteger(f) && f >= 0 && f <= max) return f;
  throw Error(`Invalid original Game & Watch ${what}.`);
}
export function parseGamewatchParameters(arc: HsdArchive, profile: FighterProfile): GamewatchSpecialData {
  const base = arc.pointer(arc.symbol('ftDataGamewatch') + 4);
  const f = (o: number) => arc.f32(base + o);
  const u = (o: number) => arc.u32(base + o);
  const roll: number[] = [];
  for (let i = 0; i < 9; i++) {
    const v = u(0x34 + i * 4);
    if (!Number.isInteger(v) || v < 0 || v > 1000) throw Error('Invalid original Judgment roll table.');
    roll.push(v);
  }
  if (roll.filter((v) => v !== 0).length < 2) throw Error('Judgment needs at least two enabled numbers.');
  const p: GamewatchSpecialData = {
    kind: 'Gw',
    costumes: [0, 1, 2, 3].map((i): V3 => [arc.u8(base + 4 + i * 4) / 255, arc.u8(base + 5 + i * 4) / 255, arc.u8(base + 6 + i * 4) / 255]) as [V3, V3, V3, V3],
    width: range(f(0x0), 0.001, 1, 'width'),
    outline: {
      color: [arc.u8(base + 0x14) / 255, arc.u8(base + 0x15) / 255, arc.u8(base + 0x16) / 255], alpha: arc.u8(base + 0x17) / 255,
      groups: outlineGroups(arc, arc.pointer(arc.symbol('ftDataGamewatch') + 0x48), profile.partVisibility.groups.length),
    },
    neutral: { loopFrame: range(f(0x18), 1, 600, 'chef loop frame'), max: count(arc, base, 0x1c, 10, 'chef max') },
    side: {
      preserve: range(f(0x20), 0, 5, 'judge preserve'), mul: range(f(0x24), 0, 5, 'judge mul'),
      velY: f(0x28), frictionA: f(0x2c), frictionB: f(0x30),
    },
    up: { stickRange: range(f(0x58), 0, 1, 'rescue stick'), angle: f(0x5c), landing: range(f(0x60), 0, 120, 'rescue landing') },
    down: {
      momentumPreserve: range(f(0x64), 0, 5, 'panic preserve'), momentumMul: range(f(0x68), 0, 5, 'panic mul'),
      fallAccel: range(f(0x6c), 0, 10, 'panic fall'), terminal: range(f(0x70), 0.1, 20, 'panic terminal'),
      damageAdd: f(0x74), damageMul: f(0x78),
      absorb: {
        bone: partJoint(profile, arc.u32(base + 0x80), 'Oil Panic'),
        offset: [f(0x84), f(0x88), f(0x8c)], radius: range(f(0x90), 0.1, 100, 'panic radius'),
      },
    },
    sausage: { life: 80, sitLife: 30, fall: 0.04, fallMax: 2.5, arcs: [] },
    judgeRoll: roll,
  };
  if (Math.abs(p.side.velY) > 20 || Math.abs(p.side.frictionA) > 20 || Math.abs(p.side.frictionB) > 20) throw Error('Invalid original Judgment motion.');
  if (Math.abs(p.up.angle) > Math.PI * 2) throw Error('Invalid original Rescue angle.');
  if (Math.abs(p.down.damageAdd) > 100 || !(p.down.damageMul >= 0) || p.down.damageMul > 10) throw Error('Invalid original Panic damage.');
  // Chef article (slot 8): life x8, sit life xC, five velocity arcs at +0x10.
  {
    const table = arc.pointer(arc.symbol('ftDataGamewatch') + 0x48);
    const special = arc.pointer(arc.pointer(table + 8 * 4) + 4);
    const life = range(arc.f32(special + 8), 1, 3600, 'sausage life');
    const sit = range(arc.f32(special + 12), 1, 3600, 'sausage sit life');
    const arcs: Array<{ vx: number; vy: number }> = [];
    let fall = -1, fallMax = -1;
    for (let i = 0; i < 5; i++) {
      const b = special + 0x10 + i * 0x14;
      const vx = arc.f32(b), vy = arc.f32(b + 4), fl = arc.f32(b + 8), fm = arc.f32(b + 12);
      if (![vx, vy, fl, fm].every(Number.isFinite) || Math.abs(vx) > 20 || Math.abs(vy) > 20) throw Error('Invalid original sausage arc.');
      if (fall < 0) { fall = fl; fallMax = fm; }
      else if (fl !== fall || fm !== fallMax) throw Error('Sausage arcs diverge in fall speeds.');
      arcs.push({ vx, vy });
    }
    p.sausage = { life, sitLife: sit, fall: range(fall, 0, 5, 'sausage fall'), fallMax: range(fallMax, 0.1, 20, 'sausage terminal'), arcs };
  }
  return p;
}
/** ftGw motion states in action-table order. The nine ground/air SpecialS entries
 * are Judgment 1-9 (rolled, anti-repeat last two); Oil Catch/Shoot and the
 * parachute Fire complete the set. */
export const GAMEWATCH_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'SpecialN', index: 241, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 242, figatree: 'SpecialAirN' },
  ...Array.from({ length: 9 }, (_, i) => ({ key: `SpecialS${i + 1}`, index: 243 + i, figatree: 'SpecialS' })),
  ...Array.from({ length: 9 }, (_, i) => ({ key: `SpecialAirS${i + 1}`, index: 252 + i, figatree: 'SpecialAirS' })),
  { key: 'SpecialHi', index: 261, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 262, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 263, figatree: 'SpecialLw' },
  { key: 'SpecialLwCatch', index: 264, figatree: 'SpecialLwCatch' },
  { key: 'SpecialLwShoot', index: 265, figatree: 'SpecialLwShoot' },
  { key: 'SpecialAirLw', index: 266, figatree: 'SpecialAirLw' },
  { key: 'SpecialAirLwCatch', index: 267, figatree: 'SpecialAirLwCatch' },
  { key: 'SpecialAirLwShoot', index: 268, figatree: 'SpecialAirLwShoot' },
];
export const GAMEWATCH_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', strong: 'AttackS4', sideTilt: 'AttackS3', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** G&W articles: Chef sausage physics (slot 8, st0 4% hit) and the parachute
 * visual (slot 3) shown during Fire Rescue like Mario's cape. Judge numbers,
 * oil fill and bucket ride the fighter model and are not articles. Slots 0-2,
 * 4, 5, 7 (other moves' props) are not loaded. */
export function parseGamewatchArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataGamewatch') + 0x48);
  const read = (index: number, name: string, needHit: boolean): ArticleData => {
    const article = arc.pointer(table + index * 4);
    const common = arc.pointer(article), special = arc.pointer(article + 4);
    const states = arc.pointer(article + 12);
    const model = articleModel(arc, article, name, states);
    const script = arc.pointer(states + 12);
    const hit = script ? itemHit(arc, script) : null;
    if (needHit && !hit) throw new Error(`Original ${name} article has no hit definition.`);
    void special;
    return {
      model, hit, speed: 0, angle: 0, lifetime: 80,
      gravity: arc.f32(common + 16), terminal: arc.f32(common + 20), bounce: arc.f32(common + 0x58),
      minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    };
  };
  const sausage = read(8, 'gw-sausage', true);
  const parachute = read(3, 'gw-parachute', false);
  // It_Kind_GameWatch_Judge: the number sign (it_802C7774) posed at frame number+1.
  const judge = read(6, 'gw-judge', false);
  // it_8027CE64 stores special-attributes word 0 as it_266F_ItemVars: { u16 n; u8* normal
  // joints; u16 m; u8* outline joints }. The item outline pass (it_8026EECC) swaps the two.
  const outline = (index: number): number[] => {
    const vars = arc.pointer(arc.pointer(arc.pointer(table + index * 4) + 4));
    const count = vars ? arc.u16(vars + 8) : 0, list = vars ? arc.pointer(vars + 12) : 0;
    if (count > 64 || (count && !list)) throw new Error('Invalid original Game & Watch article outline.');
    return count ? [...arc.slice(list, count)] : [];
  };
  // Sausage fall uses the shared entries fall speeds (verified uniform across
  // all five arcs), overriding the common block like the native fall call.
  {
    const table = arc.pointer(arc.symbol('ftDataGamewatch') + 0x48);
    const special = arc.pointer(arc.pointer(table + 8 * 4) + 4);
    sausage.gravity = arc.f32(special + 0x10 + 8);
    sausage.terminal = arc.f32(special + 0x10 + 12);
  }
  return { projectile: sausage, accessory: parachute, gamewatch: { sausage, parachute, judge, outlines: { sausage: outline(8), parachute: outline(3), judge: outline(6) } } };
}
