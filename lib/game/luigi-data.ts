import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';

/** ftLuigiAttributes Green Missile / Super Jump Punch / Cyclone blocks
 * (third_party/melee/src/melee/ft/kinds/ftLuigi/types.h); fireball N uses the
 * article and needs no parameters. Landing lag is an integer count. */
export interface LuigiBaseData {
  side: {
    smash: number; chargeRate: number; maxCharge: number;
    damageTilt: number; damageSlope: number; traction: number; startFriction: number;
    velX: number; mulX: number; velY: number; mulY: number;
    gravityStart: number; fallingSpeed: number; endFriction: number; endDecel: number; gravityMul: number;
    misfireChance: number; misfireVelX: number; misfireVelY: number;
  };
  up: { mobility: number; landing: number; reverse: number; momentumRange: number; angleDiff: number; velX: number; gravity: number; velY: number };
  down: { tapMomentum: number; groundX: number; airX: number; groundMul: number; airMul: number; endFriction: number; tapMax: number; tapGravity: number; landing: number };
}
/** Luigi's own block (ftDataLuigi). */
export interface LuigiSpecialData extends LuigiBaseData { kind: 'Lg'; }
/** Dr. Luigi's block (ftDataDrLuigi, same Luigi-family layout). */
export interface DrLuigiSpecialData extends LuigiBaseData { kind: 'Dl'; }
/** Luigi & Boo's block (ftDataLuigiBoo, same Luigi-family layout). */
export interface LuigiBooSpecialData extends LuigiBaseData { kind: 'Lb'; }
export function parseLuigiParameters(arc: HsdArchive, kind: 'Lg' | 'Dl' | 'Lb' = 'Lg'): LuigiSpecialData | DrLuigiSpecialData | LuigiBooSpecialData {
  const base = arc.pointer(arc.symbol(kind === 'Lg' ? 'ftDataLuigi' : kind === 'Dl' ? 'ftDataDrLuigi' : 'ftDataLuigiBoo') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Luigi parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Luigi integer.'); return v; };
  const p: LuigiSpecialData | DrLuigiSpecialData | LuigiBooSpecialData = {
    kind,
    side: {
      smash: f(0x4), chargeRate: f(0x8), maxCharge: f(0xc),
      damageTilt: f(0x10), damageSlope: f(0x14), traction: f(0x18), startFriction: f(0x1c),
      velX: f(0x24), mulX: f(0x28), velY: f(0x2c), mulY: f(0x30),
      gravityStart: f(0x34), fallingSpeed: f(0x20), endFriction: f(0x38), endDecel: f(0x3c), gravityMul: f(0x40),
      misfireChance: f(0x44), misfireVelX: f(0x48), misfireVelY: f(0x4c),
    },
    up: { mobility: f(0x50), landing: f(0x54), reverse: f(0x58), momentumRange: f(0x5c), angleDiff: f(0x60), velX: f(0x64), gravity: f(0x68), velY: f(0x6c) },
    down: { tapMomentum: f(0x70), groundX: f(0x74), airX: f(0x78), groundMul: f(0x7c), airMul: f(0x80), endFriction: f(0x84), tapMax: f(0x8c), tapGravity: f(0x90), landing: u(0x94) },
  };
  if (p.side.maxCharge < 1 || p.side.maxCharge > 600 || p.side.misfireChance < 1 || p.side.misfireChance > 64 ||
      p.side.traction <= 0 || p.up.mobility <= 0 || p.up.mobility > 1 || p.down.tapGravity < 0) {
    throw Error('Unsupported original Luigi bounds.');
  }
  return p;
}
/** ftLg submotions 243–259 in ftLg_Submotion order. The three ground `SpecialS` entries
 * are Launch (hit), Misfire (hit, fire gfx) and S2/Fly (no hit): both ftLg_MS_SpecialS2 and
 * ftLg_MS_SpecialAirS2 play the Fly entry, carrying the launch hitbox over (Ft_MF_SkipHit). */
export const LUIGI_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'SpecialN', index: 243, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 244, figatree: 'SpecialAirN' },
  { key: 'SpecialSStart', index: 245, figatree: 'SpecialSStart' },
  { key: 'SpecialSHold', index: 246, figatree: 'SpecialSHold' },
  { key: 'SpecialSLaunch', index: 247, figatree: 'SpecialS' },
  { key: 'SpecialSMisfire', index: 248, figatree: 'SpecialS' },
  { key: 'SpecialSFly', index: 249, figatree: 'SpecialS' },
  { key: 'SpecialSEnd', index: 250, figatree: 'SpecialSEnd' },
  { key: 'SpecialAirSStart', index: 251, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirSHold', index: 252, figatree: 'SpecialAirSHold' },
  { key: 'SpecialAirSLaunch', index: 253, figatree: 'SpecialS' },
  { key: 'SpecialAirSMisfire', index: 254, figatree: 'SpecialS' },
  { key: 'SpecialAirSEnd', index: 255, figatree: 'SpecialAirSEnd' },
  { key: 'SpecialHi', index: 256, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 257, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 258, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 259, figatree: 'SpecialAirLw' },
];
export const LUIGI_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', strong: 'AttackS4S', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
