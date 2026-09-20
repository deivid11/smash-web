import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** King Dedede (ACE 2.0 m-ex fighter, PlDe, mexproj 032). Engine-authored
 * constants; hitboxes/animations/articles come verbatim from PlDe.dat.
 * 5 jumps (1 ground + 4 air) with authored air-jump verticals. */
export interface DededeSpecialData {
  kind: 'De';
  /** Inhale: loop while held (SpecialNLoop, 2 hits), release to End/Spit. */
  neutral: { voice: number };
  /** Gordo Throw: single-state toss of the Gordo article. */
  side: { shotSpeed: number; shotAngle: number; landing: number; voice: number };
  /** Super Dedede Jump: rise then falling slam with landing lag. */
  up: { riseSpeed: number; landing: number; mobility: number; voice: number };
  /** Jet Hammer: charge while held (LwHold/Max), release into swing. */
  down: { minSpeed: number; maxSpeed: number; chargeFrames: number; landing: number; voice: number };
}

export function parseDededeParameters(arc: HsdArchive): DededeSpecialData {
  arc.symbol('ftDataDedede');
  return {
    kind: 'De',
    neutral: { voice: 1819 },
    side: { shotSpeed: 2.4, shotAngle: 0.1, landing: 12, voice: 1830 },
    up: { riseSpeed: 3.0, landing: 18, mobility: 0.9, voice: 1831 },
    down: { minSpeed: 1.5, maxSpeed: 3.0, chargeFrames: 50, landing: 16, voice: 1834 },
  };
}

/** Slots: 1 Gordo (18%), 3 star (8%). Slots 0/2 have no hit. */
export function parseDededeArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return {
    dedede: {
      gordo: parseArticle(metadata, 1, 'dedede-gordo'),
      star: parseArticle(metadata, 3, 'dedede-star'),
    },
  };
}

/** Air-jump verticals (engine-authored; ACE logic is compiled m-ex code). */
export const DEDEDE_AIR_JUMPS = ['JumpAerialF2', 'JumpAerialF3', 'JumpAerialF4', 'JumpAerialF5'] as const;

/** Duplicates: Landing x3 (primary 14), SpecialNLoop x2 (primary 247),
 * JumpAerialF2 x4 (primaries spread across the air-jump ladder). */
export const DEDEDE_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 14, figatree: 'Landing' },
  { key: 'JumpAerialF2', index: 17, figatree: 'JumpAerialF2' },
  { key: 'JumpAerialF3', index: 242, figatree: 'JumpAerialF2' },
  { key: 'JumpAerialF4', index: 243, figatree: 'JumpAerialF2' },
  { key: 'JumpAerialF5', index: 245, figatree: 'JumpAerialF4' },
  { key: 'SpecialNStart', index: 246, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoop', index: 247, figatree: 'SpecialNLoop' },
  { key: 'SpecialNEnd', index: 248, figatree: 'SpecialNEnd' },
  { key: 'SpecialAirNStart', index: 260, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoop', index: 261, figatree: 'SpecialAirNLoop' },
  { key: 'SpecialAirNEnd', index: 262, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialSStart', index: 263, figatree: 'SpecialSStart' },
  { key: 'SpecialAirSStart', index: 264, figatree: 'SpecialAirSStart' },
  { key: 'SpecialHiStartL', index: 265, figatree: 'SpecialHiStartL' },
  { key: 'SpecialHiStartR', index: 266, figatree: 'SpecialHiStartR' },
  { key: 'SpecialHiJump', index: 267, figatree: 'SpecialHiJump' },
  { key: 'SpecialHiLoop', index: 268, figatree: 'SpecialHiLoop' },
  { key: 'SpecialHiLandingL', index: 271, figatree: 'SpecialHiLandingL' },
  { key: 'SpecialLwStart', index: 275, figatree: 'SpecialLwStart' },
  { key: 'SpecialLw', index: 276, figatree: 'SpecialLw' },
  { key: 'SpecialLwHold', index: 278, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwEnd', index: 277, figatree: 'SpecialLwMax' },
  { key: 'SpecialAirLwStart', index: 286, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLw', index: 287, figatree: 'SpecialAirLw' },
];

export const DEDEDE_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  rapidStart: 'Attack100Start', rapidLoop: 'Attack100',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
