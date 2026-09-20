import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';

/** ftDonkeyAttributes (third_party/melee/src/melee/ft/kinds/ftDonkey/types.h);
 * cargo-carry fields (x8–x28) and Hand Slap tuning (x68–x70) are not consumed yet. */
export interface DkSpecialData {
  kind: 'Dk';
  /** Giant Punch: x2C max arm swings, x30 damage per banked swing, x34 grounded punch velocity per swing, x38 aerial landing lag. */
  neutral: { maxSwings: number; damagePerSwing: number; punchSpeed: number; landing: number };
  /** Headbutt: x3C aerial entry divisor, x40 aerial friction, x44 aerial gravity after cmd_vars[0]. */
  side: { divisor: number; friction: number; gravity: number };
  /** Spinning Kong: x4C aerial launch, x50 gravity multiplier before cmd_vars[0], x54/x58 speed caps, x5C/x60 drift accel, x64 aerial landing lag. */
  up: { airY: number; gravityScale: number; groundSpeed: number; airSpeed: number; groundAccel: number; airAccel: number; landing: number };
}
export function parseDkParameters(arc: HsdArchive): DkSpecialData {
  const base = arc.pointer(arc.symbol('ftDataDonkey') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Donkey Kong parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Donkey Kong integer.'); return v; };
  const p: DkSpecialData = {
    kind: 'Dk',
    neutral: { maxSwings: u(0x2c), damagePerSwing: u(0x30), punchSpeed: f(0x34), landing: f(0x38) },
    side: { divisor: f(0x3c), friction: f(0x40), gravity: f(0x44) },
    up: { airY: f(0x4c), gravityScale: f(0x50), groundSpeed: f(0x54), airSpeed: f(0x58), groundAccel: f(0x5c), airAccel: f(0x60), landing: f(0x64) },
  };
  if (p.neutral.maxSwings < 1 || p.neutral.maxSwings > 60 || p.neutral.punchSpeed <= 0 || p.neutral.landing < 0 || p.neutral.landing > 120 ||
      p.side.divisor <= 0 || p.side.gravity <= 0 || p.up.airY <= 0 || p.up.gravityScale <= 0 || p.up.gravityScale > 1 ||
      p.up.groundSpeed <= 0 || p.up.airSpeed <= 0 || p.up.groundAccel <= 0 || p.up.airAccel <= 0 || p.up.landing < 0 || p.up.landing > 120) {
    throw Error('Unsupported original Donkey Kong bounds.');
  }
  return p;
}
/** ftDk_Init_MotionStateTable action indices 271–288. The disc's cancel entry is spelled
 * "SpecialNCansel"; the full punch and both Hand Slap ends reuse a figatree with distinct scripts. */
export const DK_ACTION_KEYS = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  { key: 'SpecialNStart', index: 271, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoop', index: 272, figatree: 'SpecialNLoop' },
  { key: 'SpecialNCancel', index: 273, figatree: 'SpecialNCansel' },
  { key: 'SpecialN', index: 274, figatree: 'SpecialN' },
  { key: 'SpecialNFull', index: 275, figatree: 'SpecialN' },
  { key: 'SpecialAirNStart', index: 276, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoop', index: 277, figatree: 'SpecialAirNLoop' },
  { key: 'SpecialAirNCancel', index: 278, figatree: 'SpecialAirNCancel' },
  { key: 'SpecialAirN', index: 279, figatree: 'SpecialAirN' },
  { key: 'SpecialAirNFull', index: 280, figatree: 'SpecialAirN' },
  { key: 'SpecialS', index: 281, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 282, figatree: 'SpecialAirS' },
  { key: 'SpecialHi', index: 283, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 284, figatree: 'SpecialAirHi' },
  { key: 'SpecialLwStart', index: 285, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwLoop', index: 286, figatree: 'SpecialLwLoop' },
  { key: 'SpecialLwEnd', index: 287, figatree: 'SpecialLwEnd' },
  { key: 'SpecialLwEnd1', index: 288, figatree: 'SpecialLwEnd' },
];
/** Only actions present in PlDk.dat: single jab pair, S3 side tilt, S4S smash; no rapid jab. */
export const DK_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
