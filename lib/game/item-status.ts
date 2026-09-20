// Fighter-side item statuses that stack (Bunny Hood, Metal Box, Super/Poison Mushroom size,
// Cloaking Device): ft/ftchangeparam.c ftCo_800D105C recomputes the fighter's attribute block
// from the DAT and multiplies it by the PlCo ftLoadCommonData modifier tables; the mushroom
// grow/shrink states (ftCo_Kinoko*.c) ease the scale along the Kinoko item's own ramp curves.
import type { ItemStatusCommon } from './data.ts';

const f32 = Math.fround;

/** Per-fighter item effects. Plain numbers so match snapshots clone them as-is. */
export interface ItemFx {
  bunny: number;        // x2014 frames left with the hood on (0 = none)
  metal: number;        // metal_timer
  metalHealth: number;  // metal_health (damage the metal body absorbs before breaking)
  cloak: number;        // x2030 frames left invisible and damage-immune
  size: 0 | 1 | -1;     // x2220_b5 giant / x2220_b6 small
  sizeTimer: number;    // x2008
  scale: number;        // x34_scale.y relative to the fighter's base scale
  /** fn_800D299C: a running grow/shrink ramp (fighter frozen, velocity parked). */
  ramp: { from: number; to: number; frame: number; curve: 0 | 1; size: 0 | 1 | -1; bonus: number } | null;
  parked: { x: number; y: number } | null;
}
export function newItemFx(): ItemFx {
  return { bunny: 0, metal: 0, metalHealth: 0, cloak: 0, size: 0, sizeTimer: 0, scale: 1, ramp: null, parked: null };
}
export function fxActive(fx: ItemFx | null): fx is ItemFx {
  return !!fx && (fx.bunny > 0 || fx.metal > 0 || fx.cloak > 0 || fx.size !== 0 || fx.scale !== 1 || fx.ramp !== null);
}

/** ftCo_CalcYScaledKnockback: a size-dependent attribute rescale (negative factors divide). */
export function calcYScaled(value: number, scale: number, factor: number): number {
  if (factor === 0) return value;
  if (factor < 0) return f32(value / calcYScaled(1, scale, -factor));
  if (scale >= 1 || factor <= 1) return f32((scale - 1) * value * factor + value);
  return f32(value * scale / factor);
}

/** ftCo_800CF6E8 (prefix fields only): byte offset in ftCo_DatAttrs → Fighter_804D6524 factor offset. */
const SIZE_FIELDS: ReadonlyArray<readonly [number, number]> = [
  [0x0c, 0x10], [0x10, 0x14], [0x14, 0x18], [0x28, 0x1c], [0x2c, 0x20], [0x38, 0x24], [0x40, 0x28], [0x4c, 0x2c],
  [0x5c, 0x30], [0x60, 0x34], [0x64, 0x38], [0x68, 0x3c], [0x6c, 0x40], [0x74, 0x44], [0x88, 0x48], [0x94, 0x4c],
];
/** ftCo_800D105C Bunny Hood block: attribute offset → Fighter_804D6520 multiplier offset. */
const BUNNY_FIELDS: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x04], [0x24, 0x08], [0x28, 0x0c], [0x3c, 0x10], [0x40, 0x14], [0x48, 0x1c], [0x4c, 0x18], [0x5c, 0x20], [0x60, 0x24], [0x74, 0x28],
];
/** ftCo_800D105C metal block: attribute offset → Fighter_804D651C multiplier offset. */
const METAL_FIELDS: ReadonlyArray<readonly [number, number]> = [
  [0x40, 0x04], [0x4c, 0x08], [0x5c, 0x0c], [0x60, 0x10], [0x74, 0x14], [0x88, 0x18],
];

/** The fighter's 0x9C attribute prefix (the words the WASM core reads) with the active item
 * modifiers applied in ftCo_800D105C order: size rescale, then Bunny Hood, then metal. The
 * walk multiplier ftCo_Walk_Enter passes as accel_mul (metal x0, size xC, bunny x0) scales
 * walk_accel_mul/base/max exactly as ftWalkCommon_800E0060 applies it. */
export function statusWords(base: Uint32Array, fx: ItemFx, common: ItemStatusCommon): Uint32Array {
  const words = Uint32Array.from(base), floats = new Float32Array(words.buffer);
  const at = (offset: number) => offset / 4;
  const mul = (offset: number, factor: number) => { floats[at(offset)] = f32(floats[at(offset)]! * factor); };
  const scale = fx.scale;
  if (scale !== 1) for (const [field, factor] of SIZE_FIELDS) floats[at(field)] = calcYScaled(floats[at(field)]!, scale, common.sizeMods[factor / 4]!);
  if (fx.bunny > 0) for (const [field, factor] of BUNNY_FIELDS) mul(field, common.bunny[factor / 4]!);
  if (fx.metal > 0) for (const [field, factor] of METAL_FIELDS) mul(field, common.metal[factor / 4]!);
  let walk = fx.metal > 0 ? common.metal[0]! : 1;
  if (scale !== 1) walk = calcYScaled(walk, scale, common.sizeMods[0xc / 4]!);
  if (fx.bunny > 0) walk = f32(walk * common.bunny[0]!);
  if (walk !== 1) for (const field of [0x00, 0x04, 0x08]) mul(field, walk);
  return words;
}

/** ftColl_8007ABD0 / it_80272460: a scaled fighter's hitboxes (and its items') deal rescaled damage. */
export function scaledDamage(damage: number, fx: ItemFx | null, common: ItemStatusCommon | undefined): number {
  return fx && common && fx.scale !== 1 ? calcYScaled(damage, fx.scale, common.sizeMods[1]!) : damage;
}
/** ftCo_Damage: a scaled victim's applied knockback (x0 factor, negative = divided). */
export function scaledKnockback(fx: ItemFx | null, common: ItemStatusCommon | undefined): number {
  return fx && common && fx.scale !== 1 ? calcYScaled(1, fx.scale, common.sizeMods[0]!) : 1;
}
