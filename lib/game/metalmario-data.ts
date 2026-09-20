import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Metal Mario (ACE 2.0 m-ex fighter, PlMM, mexproj 046). Mario-family kit with
 * Mario's exact parameter shape (kind 'MM'), read from ftDataMetalMario, so it
 * rides the shared Mario orchestration tail in
 * [lib/game/specials.ts](../../lib/game/specials.ts) with zero special-casing
 * beyond the Mr/Dr dispatch sites. Weight/scale (the metal feel) come verbatim
 * from his ftData attributes. */
export interface MetalMarioSpecialData {
  kind: 'MM';
  cape: { divisor: number; friction: number; boost: number; gravity: number; terminal: number; reflect: import('./special-data.ts').ReflectorData };
  up: { mobility: number; landing: number; reverseThreshold: number; aimThreshold: number; angle: number; momentum: number; gravity: number; airScale: number };
  down: { initial: number; groundSpeed: number; airSpeed: number; groundAccel: number; airAccel: number; endFriction: number; boost: number; cap: number; landing: number };
}

export function parseMetalMarioParameters(arc: HsdArchive, profile: import('./data.ts').FighterProfile): MetalMarioSpecialData {
  const base = arc.pointer(arc.symbol('ftDataMetalMario') + 4);
  const f = (offset: number) => { const value = arc.f32(base + offset); if (Math.abs(value) > 1000) throw new Error('Special parameter exceeds supported bounds.'); return value; };
  const rp = base + 0x60, bone = arc.u32(rp), radius = arc.f32(rp + 20);
  if (bone >= profile.boneCount || radius <= 0 || radius > 100) throw new Error('Invalid original reflector data.');
  return {
    kind: 'MM',
    cape: { divisor: f(0), friction: f(4), boost: f(8), gravity: f(12), terminal: f(16),
      reflect: { bone, offset: [arc.f32(rp + 8), arc.f32(rp + 12), arc.f32(rp + 16)], radius, damageMultiplier: arc.f32(rp + 24), speedMultiplier: arc.f32(rp + 28), maxDamage: arc.u32(rp + 4), keepOwner: arc.u8(rp + 32) !== 0 } },
    up: { mobility: f(0x18), landing: f(0x1c), reverseThreshold: f(0x20), aimThreshold: f(0x24), angle: f(0x28), momentum: f(0x2c), gravity: f(0x30), airScale: f(0x34) },
    down: { initial: f(0x38), groundSpeed: f(0x3c), airSpeed: f(0x40), groundAccel: f(0x44), airAccel: f(0x48), endFriction: f(0x4c), boost: f(0x54), cap: f(0x58), landing: arc.u32(base + 0x5c) },
  };
}

/** Mario-identical slots: 0 fireball (15%), 2 cape model (no hit). */
export function parseMetalMarioArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return {
    projectile: parseArticle(metadata, 0, 'fireball'),
    accessory: parseArticle(metadata, 2, 'cape'),
  };
}

/** All single-state; Landing primaries at 13. */
export const MM_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialN', index: 244, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 245, figatree: 'SpecialAirN' },
  { key: 'SpecialS', index: 246, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 247, figatree: 'SpecialSAir' },
  { key: 'SpecialHi', index: 248, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 249, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 250, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 251, figatree: 'SpecialAirLw' },
];

export const MM_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
