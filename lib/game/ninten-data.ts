import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';
import { nessClonePkFire } from './lucas-data.ts';

/** Ninten (ACE 2.0 m-ex fighter, PlNt, mexproj 048). Engine-authored constants;
 * Ness-shared kit: Hypnosis (sleep pending), Slingshot fire, Thunder rocket,
 * PSI Magnet absorb loop. Hitboxes/animations/articles verbatim from PlNt.dat. */
export interface NintenSpecialData {
  kind: 'Nt';
  /** PK Hypnosis: holdable loop (sleep status pending in the prototype). */
  neutral: { voice: number };
  /** Slingshot: single shot on flag-24, on the grounded/aerial trajectory pair. */
  side: { shotSpeed: number; shotAngle: number; airSpeed: number; airAngle: number; voice: number };
  /** PK Thunder rocket: 23-hit melee launch into helpless (guided ball pending). */
  up: { riseSpeed: number; landing: number; mobility: number; voice: number };
  /** PSI Magnet: holdable absorb loop around TransN. */
  down: { landing: number; voice: number; absorb: { bone: number; offset: [number, number, number]; radius: number }; healMul: number };
}

export function parseNintenParameters(arc: HsdArchive): NintenSpecialData {
  const fire = nessClonePkFire(arc, 'ftDataNinten', 0x18, { shotSpeed: 2.2, shotAngle: 0, airSpeed: 2.2, airAngle: 0, landing: 14 });
  return {
    kind: 'Nt',
    neutral: { voice: 2293 },
    side: { shotSpeed: fire.shotSpeed, shotAngle: fire.shotAngle, airSpeed: fire.airSpeed, airAngle: fire.airAngle, voice: 2296 },
    up: { riseSpeed: 3.0, landing: fire.landing, mobility: 1, voice: 2301 },
    down: { landing: 10, voice: 2308, absorb: { bone: 1, offset: [0, 8, 0], radius: 12 }, healMul: 1.5 },
  };
}

/** Slot 1 Slingshot pellet (3%). Slots 0/2 have no hit. */
export function parseNintenArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return {
    ninten: { pellet: parseArticle(metadata, 1, 'ninten-pellet') },
  };
}

/** Duplicates: Landing x3 (14), NHold x2 (247), AirNHold x2 (251), Hi x2 (259). */
export const NINTEN_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 14, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 246, figatree: 'SpecialNStart' },
  { key: 'SpecialNHold', index: 247, figatree: 'SpecialNHold' },
  { key: 'SpecialNEnd', index: 249, figatree: 'SpecialNEnd' },
  { key: 'SpecialAirNStart', index: 250, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNHold', index: 251, figatree: 'SpecialAirNHold' },
  { key: 'SpecialAirNEnd', index: 253, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialS', index: 254, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 255, figatree: 'SpecialAirS' },
  { key: 'SpecialHiStart', index: 256, figatree: 'SpecialHiStart' },
  { key: 'SpecialHiHold', index: 257, figatree: 'SpecialHiHold' },
  { key: 'SpecialHiEnd', index: 258, figatree: 'SpecialHiEnd' },
  { key: 'SpecialHi', index: 259, figatree: 'SpecialHi' },
  { key: 'SpecialAirHiStart', index: 260, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHiHold', index: 261, figatree: 'SpecialAirHiHold' },
  { key: 'SpecialAirHiEnd', index: 262, figatree: 'SpecialAirHiEnd' },
  { key: 'SpecialLwStart', index: 265, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwHold', index: 266, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwHit', index: 267, figatree: 'SpecialLwHit' },
  { key: 'SpecialLwEnd', index: 268, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 269, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwHold', index: 270, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialAirLwHit', index: 271, figatree: 'SpecialAirLwHit' },
  { key: 'SpecialAirLwEnd', index: 272, figatree: 'SpecialAirLwEnd' },
];

export const NINTEN_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
