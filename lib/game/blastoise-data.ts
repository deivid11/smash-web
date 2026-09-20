import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Blastoise (ACE 2.0 m-ex fighter, PlBl, mexproj 054). Engine-authored
 * constants; hitboxes/animations/articles come verbatim from PlBl.dat. */
export interface BlastoiseSpecialData {
  kind: 'Bl';
  /** Water Gun: single shot on the script flag-24 (Mario fireball convention). */
  neutral: { shotSpeed: number; shotAngle: number; voice: number };
  /** Shell Bash: root-motion dash (real root tracks in SStart/AirSStart). */
  side: { landing: number; mobility: number; voice: number };
  /** Hydro Pump: 28-hit rising torrent (motor rise; root tracks use types 5/7). */
  up: { riseSpeed: number; landing: number; mobility: number; voice: number };
  /** Withdraw: flag-24 spray into a landing slam (1 hit). */
  down: { shotSpeed: number; shotAngle: number; landing: number; voice: number };
}

export function parseBlastoiseParameters(arc: HsdArchive): BlastoiseSpecialData {
  arc.symbol('ftDataBlastoise');
  return {
    kind: 'Bl',
    neutral: { shotSpeed: 2.6, shotAngle: -0.1, voice: 2472 },
    side: { landing: 14, mobility: 1, voice: 2476 },
    up: { riseSpeed: 3.0, landing: 16, mobility: 0.9, voice: 2481 },
    down: { shotSpeed: 2.2, shotAngle: -0.1, landing: 14, voice: 2485 },
  };
}

/** Slots: 0 water (12%), 1 spray (2%). */
export function parseBlastoiseArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return {
    blastoise: {
      water: parseArticle(metadata, 0, 'blastoise-water'),
      spray: parseArticle(metadata, 1, 'blastoise-spray'),
    },
  };
}

/** Duplicates: Landing x3 (primary 13). Specials are single-state. */
export const BLASTOISE_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialN', index: 248, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 249, figatree: 'SpecialAirN' },
  { key: 'SpecialSStart', index: 250, figatree: 'SpecialSStart' },
  { key: 'SpecialAirSStart', index: 251, figatree: 'SpecialAirSStart' },
  { key: 'SpecialHi', index: 252, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 253, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 254, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 255, figatree: 'SpecialAirLw' },
  { key: 'SpecialLwLanding', index: 256, figatree: 'SpecialLwLanding' },
];

export const BLASTOISE_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
