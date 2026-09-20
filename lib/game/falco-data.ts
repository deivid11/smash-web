import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterProfile } from './data.ts';
import type { ReflectorData } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** ftFox_DatAttrs shared by Fox/Falco (ftFalco reuses ftFox code); values come from ftDataFalco. */
export interface FalcoSpecialData {
  kind: 'Fc';
  neutral: { speed: number; angle: number };
  side: { delay: number; divisor: number; friction: number; gravity: number; endGround: number; endAir: number; endFriction: number; endAirFriction: number; endDelay: number; endGravity: number; landing: number; mobility: number };
  up: { delay: number; divisor: number; friction: number; gravity: number; aimThreshold: number; frames: number; slowAfter: number; speed: number; decay: number; landing: number; mobility: number };
  down: { releaseLag: number; delay: number; divisor: number; gravity: number; reflect: ReflectorData };
}
export function parseFalcoParameters(arc: HsdArchive, profile: FighterProfile): FalcoSpecialData {
  const base = arc.pointer(arc.symbol('ftDataFalco') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Falco parameter.'); return v; };
  const reflect = (offset: number): ReflectorData => {
    const p = base + offset, bone = arc.u32(p), radius = arc.f32(p + 20);
    if (bone >= profile.boneCount || radius <= 0 || radius > 100) throw new Error('Invalid original Falco reflector data.');
    return { bone, offset: [arc.f32(p+8),arc.f32(p+12),arc.f32(p+16)], radius, damageMultiplier: arc.f32(p+24), speedMultiplier: arc.f32(p+28), maxDamage: arc.u32(p+4), keepOwner: arc.u8(p+32)!==0 };
  };
  return {
    kind: 'Fc',
    neutral: { speed: f(0x14), angle: f(0x10) },
    side: { delay: f(0x24), divisor: f(0x28), friction: f(0x2c), gravity: f(0x30), endGround: f(0x34), endAir: f(0x3c), endFriction: f(0x38), endAirFriction: f(0x40), endDelay: f(0x44), endGravity: f(0x48), landing: f(0x50), mobility: f(0x4c) },
    up: { delay: f(0x54), divisor: f(0x58), friction: f(0x5c), gravity: f(0x60), aimThreshold: f(0x64), frames: f(0x68), slowAfter: f(0x70), speed: f(0x74), decay: f(0x78), landing: f(0x90), mobility: f(0x8c) },
    down: { releaseLag: f(0x98), delay: arc.u32(base+0xa4), divisor: f(0xa8), gravity: f(0xac), reflect: reflect(0xb0) },
  };
}
/** ftFc_Init_MotionStateTable specials, action indices 246–271. All figatree names are distinct. */
export const FALCO_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  'SpecialNStart', 'SpecialNLoop', 'SpecialNEnd',
  'SpecialAirNStart', 'SpecialAirNLoop', 'SpecialAirNEnd',
  'SpecialSStart', 'SpecialS', 'SpecialSEnd',
  'SpecialAirSStart', 'SpecialAirS', 'SpecialAirSEnd',
  'SpecialHiHold', 'SpecialHiHoldAir', 'SpecialHi', 'SpecialHiLanding', 'SpecialHiFall', 'SpecialHiBound',
  'SpecialLwStart', 'SpecialLwLoop', 'SpecialLwHit', 'SpecialLwEnd',
  'SpecialAirLwStart', 'SpecialAirLwLoop', 'SpecialAirLwHit', 'SpecialAirLwEnd',
].map((key, i) => ({ key, index: 246 + i, figatree: key }));
export const FALCO_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', strong: 'AttackS4', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
