import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Dr. Luigi (ACE 2.0 m-ex fighter, PlDl, mexproj 047). Luigi-family kit; the
 * Green Missile / Super Jump Punch / Cyclone orchestration is shared with
 * Luigi ([lib/game/luigi.ts](../../lib/game/luigi.ts)) over these key names. */
export function parseDrLuigiArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  const projectile = parseArticle(metadata, 0, 'luigi-fire');
  // The 2.0 ISO leaves this slot's lifetime at 0 (the m-ex native spawn owns
  // it); author Luigi-parity 50 so the pill survives its own flight.
  projectile.lifetime = 50;
  return { projectile };
}

/** Luigi-style keys onto DrLuigi indices: Launch 247 (1 hit), Misfire 248
 * (6 hits + fire gfx), Fly 249, air Launch 253 / Misfire 254. */
export const DRLUIGI_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
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

export const DRLUIGI_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
