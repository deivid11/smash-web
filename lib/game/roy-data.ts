import type { HsdArchive } from '../hsd/archive.ts';
import { partJoint, type FighterProfile } from './data.ts';
import type { FighterContent } from './load.ts';
import type { V3 } from '../hsd/model.ts';

/** MarsAttributes shared by ftMars/ftEmblem; values come only from ftDataEmblem. */
export interface RoySpecialData {
  kind: 'Fe';
  neutral: { maxCharge: number; baseDamage: number; damagePerSecond: number; divisor: number; friction: number };
  side: { branchThreshold?: number; divisor: number; friction: number; boost: number; gravity: number; terminal: number };
  up: { mobility: number; landing: number; reverse: number; threshold: number; angle: number; momentum: number; airScale: number; gravity: number; terminal: number };
  down: { divisor: number; friction: number; gravity: number; terminal: number; multiplier: number; hitlag: number; bone: number; offset: V3; radius: number };
}
export function parseRoyParameters(arc: HsdArchive, profile: FighterProfile): RoySpecialData {
  const base = arc.pointer(arc.symbol('ftDataEmblem') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Roy parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Roy integer.'); return v; };
  const p: RoySpecialData = {
    kind: 'Fe', neutral: { maxCharge: u(0) * 30, baseDamage: u(4), damagePerSecond: u(8), divisor: f(0xc), friction: f(0x10) },
    side: { divisor: f(0x14), friction: f(0x18), boost: f(0x1c), gravity: f(0x20), terminal: f(0x24) },
    up: { mobility: f(0x28), landing: f(0x2c), reverse: f(0x30), threshold: f(0x34), angle: f(0x38), momentum: f(0x3c), airScale: f(0x40), gravity: f(0x44), terminal: f(0x48) },
    down: { divisor: f(0x4c), friction: f(0x50), gravity: f(0x54), terminal: f(0x58), multiplier: f(0x5c), hitlag: f(0x60), bone: partJoint(profile, u(0x64), 'Roy counter'), offset: [f(0x68), f(0x6c), f(0x70)], radius: f(0x74) },
  };
  if (p.neutral.maxCharge < 1 || p.neutral.maxCharge > 1800 || p.neutral.divisor <= 0 || p.side.divisor <= 0 || p.down.divisor <= 0 || p.up.threshold < 0 || p.up.threshold >= 1 || p.down.radius <= 0) throw Error('Unsupported original Roy bounds.');
  return p;
}
/** ftFe_Init_MotionStateTable, action indices 237–268. Full-charge end shares a figatree,
 * NOT a script, with normal release. No Marth animation/data is substituted. */
export const ROY_ACTION_KEYS = [
  'SpecialNStart', 'SpecialNLoop', 'SpecialNEnd', 'SpecialNEndFull',
  'SpecialAirNStart', 'SpecialAirNLoop', 'SpecialAirNEnd', 'SpecialAirNEndFull',
  'SpecialS1', 'SpecialS2Hi', 'SpecialS2Lw', 'SpecialS3Hi', 'SpecialS3S', 'SpecialS3Lw', 'SpecialS4Hi', 'SpecialS4S', 'SpecialS4Lw',
  'SpecialAirS1', 'SpecialAirS2Hi', 'SpecialAirS2Lw', 'SpecialAirS3Hi', 'SpecialAirS3S', 'SpecialAirS3Lw', 'SpecialAirS4Hi', 'SpecialAirS4S', 'SpecialAirS4Lw',
  'SpecialHi', 'SpecialAirHi', 'SpecialLw', 'SpecialLwHit', 'SpecialAirLw', 'SpecialAirLwHit',
].map((key, i) => ({ key, index: 237 + i, figatree: key.replace('Full', '') }));
export const ROY_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', dash: 'AttackDash', sideTilt: 'AttackS31', upTilt: 'AttackHi3', downTilt: 'AttackLw3', strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
