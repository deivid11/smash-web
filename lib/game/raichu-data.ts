import type { HsdArchive } from '../hsd/archive.ts';
import { loadModel } from '../hsd/model.ts';
import { itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** Raichu (ACE 2.0 m-ex fighter, PlRc, mexproj 038) is a Pikachu clone: its motion table
 * runs the decomp ftPk callbacks verbatim for neutral (jolt), up (Quick Attack) and down
 * (Thunder), and its ftData attribute block keeps ftPikachuAttributes offsets for those
 * moves. The side special is the author's own compiled roll (M343/M344/M346/M348/M349/
 * M351/M352): a rolling attack that builds speed and damage while held, stops on a fresh B
 * press and launches into an airborne roll off ledges or on release in the air. */
export interface RaichuSpecialData {
  kind: 'Rc';
  neutral: { groundX: number; groundY: number; airX: number; airY: number; landing: number };
  /** Compiled roll attrs, indexed by the build-up counter ft_var51 (one step per script
   * cmd0 while holding): x24 floor roll speed, x28 speed per step, x2C step cap, x30/x34
   * hit damage base/per step, x40 fall terminal, x44/x48 launch vx base/per step,
   * x4C/x50 launch vy base/per step, x54 air roll vx decay, x58 air roll gravity. */
  side: { rollSpeed: number; speedPerStep: number; maxSteps: number; damage: number; damagePerStep: number; terminal: number; launchX: number; launchXPerStep: number; launchY: number; launchYPerStep: number; airDecay: number; airGravity: number };
  up: { delay: number; frames: number; gravity: number; threshold: number; slope: number; speed: number; secondDecay: number; endDrift: number; endMomentum: number; angleDifference: number; mobility: number; landing: number; pitch: number; scale: [number, number, number] };
  down: { boost: number; gravity: number; contactY: number; speed: number; contactX: number; contactHeight: number; cloudOffset: number; height: number; count: number; delay: number };
}

export function parseRaichuParameters(arc: HsdArchive): RaichuSpecialData {
  const base = arc.pointer(arc.symbol('ftDataRaichu') + 4);
  const f = (o: number) => { const v = arc.f32(base + o); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw new Error('Invalid original Raichu parameter.'); return v; };
  const u = (o: number) => { const v = arc.u32(base + o); if (v > 600) throw new Error('Invalid original Raichu counter.'); return v; };
  const p: RaichuSpecialData = {
    kind: 'Rc', neutral: { groundX: f(0), groundY: f(4), airX: f(8), airY: f(12), landing: f(16) },
    side: { rollSpeed: f(0x24), speedPerStep: f(0x28), maxSteps: f(0x2c), damage: f(0x30), damagePerStep: f(0x34), terminal: f(0x40), launchX: f(0x44), launchXPerStep: f(0x48), launchY: f(0x4c), launchYPerStep: f(0x50), airDecay: f(0x54), airGravity: f(0x58) },
    up: { delay: u(0x5c), frames: u(0x60), gravity: f(0x64), threshold: f(0x8c), slope: f(0x90), speed: f(0x94), secondDecay: f(0x98), endDrift: f(0x9c), endMomentum: f(0xa4), angleDifference: u(0xa8), mobility: f(0xac), landing: f(0xb0), pitch: f(0x78), scale: [f(0x7c), f(0x80), f(0x84)] },
    down: { boost: f(0xb4), gravity: f(0xb8), contactY: f(0xbc), speed: f(0xc0), contactX: f(0xc4), contactHeight: f(0xc8), cloudOffset: f(0xcc), height: f(0xd0), count: u(0xd4), delay: u(0xd8) },
  };
  if (p.side.rollSpeed <= 0 || p.side.maxSteps < 1 || p.side.maxSteps > 16 || p.side.terminal <= 0 || p.up.frames < 1 || p.down.count < 1 || p.down.count > 8 || p.down.speed >= 0) throw new Error('Unsupported original Raichu special bounds.');
  return p;
}

/** Item slots: 0 Thunder (Pikachu layout, len/tip in its special block), 1 the jolt — a
 * bouncing article whose special block orders (speed, angle, lifetime), unlike Pikachu's
 * (lifetime, angle, speed). Slot 2 is a dummy thunder copy: there is no ground-wave item,
 * so the jolt bounces everywhere instead of riding Pikachu's joint-6 wave bake. */
export function parseRaichuArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataRaichu') + 0x48);
  const read = (index: number) => {
    const article = arc.pointer(table + index * 4);
    return { common: arc.pointer(article), special: arc.pointer(article + 4), states: arc.pointer(article + 12), model: arc.pointer(article + 16) };
  };
  const bounds = (v: number, low: number, high: number) => { if (!Number.isFinite(v) || v < low || v > high) throw new Error('Unsupported original Raichu article value.'); return v; };
  const t = read(0);
  const thunder: ArticleData = {
    model: loadModel(arc, { offset: arc.pointer(t.model), name: 'raichu-thunder', animation: arc.pointer(t.states), materialAnimation: arc.pointer(t.states + 4) }),
    hit: itemHit(arc, arc.pointer(t.states + 12)), speed: 0, angle: 0, lifetime: bounds(arc.f32(t.special), 1, 600),
    gravity: arc.f32(t.common + 16), terminal: arc.f32(t.common + 20), bounce: arc.f32(t.common + 0x58), minSpeed: 0, scale: arc.f32(t.common + 0x60), sound: arc.u32(t.common + 0x78), rayScale: 1, deceleration: 0 };
  if (!thunder.hit) throw new Error('Raichu thunder has no hit.');
  const j = read(1);
  const joltScript = arc.pointer(j.states + 12);
  const jolt: ArticleData = {
    model: loadModel(arc, { offset: arc.pointer(j.model), name: 'raichu-jolt', animation: arc.pointer(j.states), materialAnimation: arc.pointer(j.states + 4) }),
    // The jolt item scripts keep no parseable hitbox; the bolt's 5% capsule stands in.
    hit: (joltScript ? itemHit(arc, joltScript) : null) ?? thunder.hit,
    speed: bounds(arc.f32(j.special), 0.1, 10), angle: bounds(arc.f32(j.special + 4), -2, 2), lifetime: bounds(arc.f32(j.special + 8), 10, 600),
    gravity: arc.f32(j.common + 16), terminal: arc.f32(j.common + 20), bounce: arc.f32(j.common + 0x58), minSpeed: 0, scale: arc.f32(j.common + 0x60), sound: arc.u32(j.common + 0x78), rayScale: 1, deceleration: 0 };
  const thunderSpecial = arc.pointer(arc.pointer(table) + 4);
  return { projectile: jolt, pikachu: { thunder, groundJolt: jolt, groundPath: [], thunderLength: arc.f32(thunderSpecial + 4), thunderTip: arc.f32(thunderSpecial + 8) } };
}

/** m-ex table: idle Wait ×2 (keyed to 2), Landing ×3 (primary 12), and Pikachu's key
 * scheme over the special slots (repeated figatrees carry different scripts: the Lw
 * loop/hit pair is named SpecialLwLoopHit, air Hi/S travels reuse their Start/SpecialS
 * figatrees). Slots 244/245 hold the vanilla Skull Bash launch/travel — unreachable in
 * the compiled state table — and 265/266 the unported Quick Attack wall cancels. */
/** The hold clips loop natively (action flag 0x40000000) while their scripts cycle on their
 * own wait+goto, so those scripts unroll well past the clip (see lib/game/raichu.ts). */
export const RAICHU_HOLD_SCRIPT_FRAMES = 1200;
export const RAICHU_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string; scriptFrames?: number }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  { key: 'Landing', index: 12, figatree: 'Landing' },
  // ACE data quirk: slot 205 (the quick ledge roll) reuses the CliffClimbQuick figatree.
  { key: 'CliffEscapeQuick', index: 205, figatree: 'CliffClimbQuick' },
  { key: 'SpecialN', index: 240, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 241, figatree: 'SpecialAirN' },
  { key: 'SpecialSStart', index: 242, figatree: 'SpecialSStart' },
  { key: 'SpecialSHold', index: 243, figatree: 'SpecialSHold', scriptFrames: RAICHU_HOLD_SCRIPT_FRAMES },
  { key: 'SpecialSEnd', index: 246, figatree: 'SpecialSEnd' },
  { key: 'SpecialAirSStart', index: 247, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirSHold', index: 248, figatree: 'SpecialAirSHold', scriptFrames: RAICHU_HOLD_SCRIPT_FRAMES },
  { key: 'SpecialAirSTravel', index: 249, figatree: 'SpecialS' },
  { key: 'SpecialAirSEnd', index: 250, figatree: 'SpecialAirSEnd' },
  { key: 'SpecialHiStart', index: 251, figatree: 'SpecialHiStart' },
  { key: 'SpecialHiTravel', index: 252, figatree: 'SpecialHiStart' },
  { key: 'SpecialHiEnd', index: 253, figatree: 'SpecialHiEnd' },
  { key: 'SpecialAirHiStart', index: 254, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHiTravel', index: 255, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHiEnd', index: 256, figatree: 'SpecialAirHiEnd' },
  { key: 'SpecialLwStart', index: 257, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwLoop', index: 258, figatree: 'SpecialLwLoopHit' },
  { key: 'SpecialLwHit', index: 259, figatree: 'SpecialLwLoopHit' },
  { key: 'SpecialLwEnd', index: 260, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 261, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwLoop', index: 262, figatree: 'SpecialAirLwLoop' },
  { key: 'SpecialAirLwHit', index: 263, figatree: 'SpecialAirLwLoop' },
  { key: 'SpecialAirLwEnd', index: 264, figatree: 'SpecialAirLwEnd' },
];

export const RAICHU_MOVES: FighterContent['moves'] = {
  jab: 'Attack11',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
