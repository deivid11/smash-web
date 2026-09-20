import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';
import { nessClonePkFire, type LucasSpecialData } from './lucas-data.ts';

/** Lucas TDX (ACE 2.0 m-ex fighter, PlLc2, mexproj 037). A Lucas variant close
 * enough to share the Lucas interface verbatim (kind 'Lc'): same PK Freeze /
 * PK Fire / PK Thunder / PSI Magnet orchestration in
 * [lib/game/lucas.ts](../../lib/game/lucas.ts), same TransN magnet bubble.
 * Slots differ (fire 0, freeze 3); voices come from audio/us/lucas_001.ssm. */
export function parseLc2Parameters(arc: HsdArchive): LucasSpecialData {
  // Unlike PlLc/PlNt, PlLc2's block sits exactly at ftData x4 and every field reads clean:
  // PK Fire 3.0 flat, PK Thunder landing lag 17, and Ness's own TransN magnet bubble.
  const fire = nessClonePkFire(arc, 'ftDataLucas2', 0, { shotSpeed: 2.2, shotAngle: 0, airSpeed: 2.2, airAngle: 0, landing: 14 });
  return {
    kind: 'Lc',
    neutral: { chargeFrames: 50, voice: 2742 },
    side: { shotSpeed: fire.shotSpeed, shotAngle: fire.shotAngle, airSpeed: fire.airSpeed, airAngle: fire.airAngle, voice: 2745 },
    up: { riseSpeed: 3.0, landing: fire.landing, mobility: 1, voice: 2752 },
    down: { landing: 10, voice: 2757, absorb: { bone: 1, offset: [0, 6.5, 0], radius: 8.5 }, healMul: 1 },
  };
}

/** Slot 0 PK Fire (3%), slot 3 freeze block (4%). Slot 1 is corrupt on disc. */
export function parseLc2Articles(metadata: HsdArchive): SpecialAssets['articles'] {
  return {
    lucas: {
      freeze: parseArticle(metadata, 3, 'lucas-freeze'),
      fire: parseArticle(metadata, 0, 'lucas-fire'),
    },
  };
}

/** Idle is bare `Wait` (keyed to Wait1); Landing primaries at 12. Otherwise the
 * Lucas-identical key names onto TDX indices. */
export const LC2_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  { key: 'Landing', index: 12, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 249, figatree: 'SpecialNStart' },
  { key: 'SpecialNHold', index: 250, figatree: 'SpecialNHold' },
  { key: 'SpecialNEnd', index: 252, figatree: 'SpecialNEnd' },
  { key: 'SpecialAirNStart', index: 253, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNHold', index: 254, figatree: 'SpecialAirNHold' },
  { key: 'SpecialAirNEnd', index: 256, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialS', index: 257, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 258, figatree: 'SpecialAirS' },
  { key: 'SpecialHiStart', index: 259, figatree: 'SpecialHiStart' },
  { key: 'SpecialHiHold', index: 260, figatree: 'SpecialHiHold' },
  { key: 'SpecialHiEnd', index: 261, figatree: 'SpecialHiEnd' },
  { key: 'SpecialHi', index: 262, figatree: 'SpecialHi' },
  { key: 'SpecialAirHiStart', index: 263, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHiHold', index: 264, figatree: 'SpecialAirHiHold' },
  { key: 'SpecialAirHiEnd', index: 265, figatree: 'SpecialAirHiEnd' },
  { key: 'SpecialLwStart', index: 268, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwHold', index: 269, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwHit', index: 270, figatree: 'SpecialLwHit' },
  { key: 'SpecialLwEnd', index: 271, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 272, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwHold', index: 273, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialAirLwHit', index: 274, figatree: 'SpecialAirLwHit' },
  { key: 'SpecialAirLwEnd', index: 275, figatree: 'SpecialAirLwEnd' },
];

export const LC2_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
