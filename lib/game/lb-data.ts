import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Luigi & Boo (ACE 2.0 m-ex fighter, PlLb, mexproj 044). Luigi-family kit; the
 * Green Missile (with Misfire) / Super Jump Punch / Cyclone orchestration and
 * even the parameter block are shared with Luigi ([lib/game/luigi.ts](../../lib/game/luigi.ts),
 * [lib/game/luigi-data.ts](../../lib/game/luigi-data.ts)). The Boo-assist Hi extras
 * (SpecialHi 260, SpecialAirHi2 261, SpecialHi_Throw 262) stay unmapped pending
 * their trigger research. */

/** Slot 0 fire pill (6%, lifetime 30 on disc — no override needed). */
export function parseLuigiBooArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return { projectile: parseArticle(metadata, 0, 'luigi-fire') };
}

/** Luigi-style keys onto Lb indices (Launch 247 / Misfire 248 / Fly 249). */
export const LB_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
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

export const LB_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
