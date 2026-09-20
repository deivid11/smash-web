import type { HsdArchive } from '../hsd/archive.ts';
import { partJoint, type FighterProfile } from './data.ts';
import type { FighterContent } from './load.ts';
import type { V3 } from '../hsd/model.ts';

/** MarsAttributes shared by Marth/Roy/Lucina; Lucina's values come from
 * ftDataLucina (PlLu.dat carries no ftDataMars symbol). Bounds mirror Marth. */
export interface LucinaSpecialData {
  kind: 'Lu';
  neutral: { maxCharge: number; baseDamage: number; damagePerSecond: number; divisor: number; friction: number };
  side: { branchThreshold?: number; divisor: number; friction: number; boost: number; gravity: number; terminal: number };
  up: { mobility: number; landing: number; reverse: number; threshold: number; angle: number; momentum: number; airScale: number; gravity: number; terminal: number };
  down: { divisor: number; friction: number; gravity: number; terminal: number; multiplier: number; hitlag: number; bone: number; offset: V3; radius: number };
}
export function parseLucinaParameters(arc: HsdArchive, profile: FighterProfile): LucinaSpecialData {
  const base = arc.pointer(arc.symbol('ftDataLucina') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Lucina parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Lucina integer.'); return v; };
  const p: LucinaSpecialData = {
    kind: 'Lu', neutral: { maxCharge: u(0) * 30, baseDamage: u(4), damagePerSecond: u(8), divisor: f(0xc), friction: f(0x10) },
    side: { divisor: f(0x14), friction: f(0x18), boost: f(0x1c), gravity: f(0x20), terminal: f(0x24) },
    up: { mobility: f(0x28), landing: f(0x2c), reverse: f(0x30), threshold: f(0x34), angle: f(0x38), momentum: f(0x3c), airScale: f(0x40), gravity: f(0x44), terminal: f(0x48) },
    down: { divisor: f(0x4c), friction: f(0x50), gravity: f(0x54), terminal: f(0x58), multiplier: f(0x5c), hitlag: f(0x60), bone: partJoint(profile, u(0x64), 'Lucina counter'), offset: [f(0x68), f(0x6c), f(0x70)], radius: f(0x74) },
  };
  if (p.neutral.maxCharge < 1 || p.neutral.maxCharge > 1800 || p.neutral.divisor <= 0 || p.side.divisor <= 0 || p.down.divisor <= 0 || p.up.threshold < 0 || p.up.threshold >= 1 || p.down.radius <= 0) throw Error('Unsupported original Lucina bounds.');
  return p;
}
/** Marth-identical motion order at 239+, except the Full-charge releases reuse
 * the plain NEnd figatrees (PlLu.dat ships no EndFull variants). */
export const LUCINA_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 239, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoop', index: 240, figatree: 'SpecialNLoop' },
  { key: 'SpecialNEnd', index: 241, figatree: 'SpecialNEnd' },
  { key: 'SpecialNEndFull', index: 241, figatree: 'SpecialNEnd' },
  { key: 'SpecialAirNStart', index: 243, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoop', index: 244, figatree: 'SpecialAirNLoop' },
  { key: 'SpecialAirNEnd', index: 245, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialAirNEndFull', index: 245, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialS1', index: 247, figatree: 'SpecialS1' },
  { key: 'SpecialS2Hi', index: 248, figatree: 'SpecialS2Hi' },
  { key: 'SpecialS2Lw', index: 249, figatree: 'SpecialS2Lw' },
  { key: 'SpecialS3Hi', index: 250, figatree: 'SpecialS3Hi' },
  { key: 'SpecialS3S', index: 251, figatree: 'SpecialS3S' },
  { key: 'SpecialS3Lw', index: 252, figatree: 'SpecialS3Lw' },
  { key: 'SpecialS4Hi', index: 253, figatree: 'SpecialS4Hi' },
  { key: 'SpecialS4S', index: 254, figatree: 'SpecialS4S' },
  { key: 'SpecialS4Lw', index: 255, figatree: 'SpecialS4Lw' },
  { key: 'SpecialAirS1', index: 256, figatree: 'SpecialAirS1' },
  { key: 'SpecialAirS2Hi', index: 257, figatree: 'SpecialAirS2Hi' },
  { key: 'SpecialAirS2Lw', index: 258, figatree: 'SpecialAirS2Lw' },
  { key: 'SpecialAirS3Hi', index: 259, figatree: 'SpecialAirS3Hi' },
  { key: 'SpecialAirS3S', index: 260, figatree: 'SpecialAirS3S' },
  { key: 'SpecialAirS3Lw', index: 261, figatree: 'SpecialAirS3Lw' },
  { key: 'SpecialAirS4Hi', index: 262, figatree: 'SpecialAirS4Hi' },
  { key: 'SpecialAirS4S', index: 263, figatree: 'SpecialAirS4S' },
  { key: 'SpecialAirS4Lw', index: 264, figatree: 'SpecialAirS4Lw' },
  { key: 'SpecialHi', index: 265, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 266, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 267, figatree: 'SpecialLw' },
  { key: 'SpecialLwHit', index: 268, figatree: 'SpecialLwHit' },
  { key: 'SpecialAirLw', index: 269, figatree: 'SpecialAirLw' },
  { key: 'SpecialAirLwHit', index: 270, figatree: 'SpecialAirLwHit' },
];

/** No side tilt and no third jab in the shipped table (AttackS3/S3S and
 * Attack13 are absent from PlLu.dat), so both stay omitted. */
export const LUCINA_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', dash: 'AttackDash', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
