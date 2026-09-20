import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { SONIC_ACTION_KEYS, parseShadowParameters as parseShadowKit, type SonicSpecialData } from './sonic-data.ts';
import type { HsdArchive } from '../hsd/archive.ts';

/** Shadow (ACE 2.0 m-ex fighter, PlSh, mexproj 038). His ftFunction carries no debug symbols, but
 * its motion table and callbacks are Sonic's source recompiled (lib/game/sonic-data.ts), so he runs
 * on the shared Sonic engine with his own attribute block and Chaos Control up special. */
export type ShadowSpecialData = SonicSpecialData;

export function parseShadowParameters(arc: HsdArchive): ShadowSpecialData {
  return parseShadowKit(arc);
}

/** Chaos Control spawns no article (and his spin moves none either). */
export function parseShadowArticles(): SpecialAssets['articles'] {
  return {};
}

/** Sonic's keyed motions (anim_id − 49, the same action layout), with the Chaos Control actions in
 * place of the spring: SpecialHiStart 254 (both starts), SpecialHiLost 272, SpecialHi 273 and
 * SpecialAirHi 274 (motions 350-355). */
export const SHADOW_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  ...SONIC_ACTION_KEYS.filter((entry) => entry.key !== 'SpecialHi'),
  { key: 'SpecialHiStart', index: 254, figatree: 'SpecialHiStart' },
  { key: 'SpecialHiLost', index: 272, figatree: 'SpecialHiLost' },
  { key: 'SpecialHi', index: 273, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 274, figatree: 'SpecialAirHi' },
];

export const SHADOW_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
