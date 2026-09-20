import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterProfile } from './data.ts';
import type { ReflectorData } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** ftMario_DatAttrs shared by Mario/Dr. Mario (ftDrMario reuses ftMario code); values from ftDataDrmario. */
export interface DrMarioSpecialData {
  kind: 'Dr';
  cape: { divisor: number; friction: number; boost: number; gravity: number; terminal: number; reflect: ReflectorData };
  up: { mobility: number; landing: number; reverseThreshold: number; aimThreshold: number; angle: number; momentum: number; gravity: number; airScale: number };
  down: { initial: number; groundSpeed: number; airSpeed: number; groundAccel: number; airAccel: number; endFriction: number; boost: number; cap: number; landing: number };
}
export function parseDrMarioParameters(arc: HsdArchive, profile: FighterProfile): DrMarioSpecialData {
  const base = arc.pointer(arc.symbol('ftDataDrmario') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (Math.abs(v) > 1000) throw new Error('Invalid original Dr. Mario parameter.'); return v; };
  const reflect = (offset: number): ReflectorData => {
    const p = base + offset, bone = arc.u32(p), radius = arc.f32(p + 20);
    if (bone >= profile.boneCount || radius <= 0 || radius > 100) throw new Error('Invalid original Dr. Mario reflector data.');
    return { bone, offset: [arc.f32(p+8),arc.f32(p+12),arc.f32(p+16)], radius, damageMultiplier: arc.f32(p+24), speedMultiplier: arc.f32(p+28), maxDamage: arc.u32(p+4), keepOwner: arc.u8(p+32)!==0 };
  };
  return {
    kind: 'Dr',
    cape: { divisor: f(0), friction: f(4), boost: f(8), gravity: f(12), terminal: f(16), reflect: reflect(0x60) },
    up: { mobility: f(0x18), landing: f(0x1c), reverseThreshold: f(0x20), aimThreshold: f(0x24), angle: f(0x28), momentum: f(0x2c), gravity: f(0x30), airScale: f(0x34) },
    down: { initial: f(0x38), groundSpeed: f(0x3c), airSpeed: f(0x40), groundAccel: f(0x44), airAccel: f(0x48), endFriction: f(0x4c), boost: f(0x54), cap: f(0x58), landing: arc.u32(base+0x5c) },
  };
}
/** Dr. Mario uses Mario's motion names (SpecialN/S/Hi/Lw); specialsByName loads all eight. */
export const DRMARIO_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', strong: 'AttackS4S', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
