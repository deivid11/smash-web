import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Chun-Li (ACE 2.0 m-ex fighter, PlCn, mexproj 055). Engine-authored constants
 * (ACE tuning is compiled m-ex code); hitboxes/animations/articles come
 * verbatim from PlCn.dat scripts. */
export interface ChunLiSpecialData {
  kind: 'Cn';
  /** Kikoken: single N shot on the script flag-24 (fireball convention). */
  neutral: { shotSpeed: number; shotAngle: number; voice: number };
  /** Lightning Legs: Start into the 24-hit held loop, release into End. */
  side: { landing: number; mobility: number; voice: number };
  /** Spinning Bird Kick: single-state root-motion rise into helpless. */
  up: { landing: number; mobility: number; voice: number };
  /** Tensho-style advance: single-state root-motion dash with script hits. */
  down: { landing: number; mobility: number; voice: number };
}

export function parseChunLiParameters(arc: HsdArchive): ChunLiSpecialData {
  arc.symbol('ftDataChunLi');
  return {
    kind: 'Cn',
    // The slot-2/3 special blocks carry 50/60 in the speed field (m-ex native
    // spawn owns the real velocity), so flight is authored fireball-like.
    neutral: { shotSpeed: 2.8, shotAngle: 0, voice: 2506 },
    side: { landing: 12, mobility: 1, voice: 2507 },
    up: { landing: 14, mobility: 1, voice: 2508 },
    down: { landing: 12, mobility: 1, voice: 2511 },
  };
}

/** Slot 2 Kikoken (8%). Slot 3 (13%) has no script cue distinguishing it and
 * stays unmapped pending trigger research (same treatment as Fay's Sniper
 * article until its S variant was confirmed); slots 0/1 are corrupt on disc. */
export function parseChunLiArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return { chunli: { kiko: parseArticle(metadata, 2, 'chunli-kiko') } };
}

/** Landing primaries at 15. No rapid loop, no AttackS4 in the table. */
export const CHUNLI_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 15, figatree: 'Landing' },
  { key: 'SpecialN', index: 250, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 251, figatree: 'SpecialAirN' },
  { key: 'SpecialSStart', index: 252, figatree: 'SpecialSStart' },
  { key: 'SpecialAirSStart', index: 253, figatree: 'SpecialAirSStart' },
  { key: 'SpecialS', index: 254, figatree: 'SpecialS' },
  { key: 'SpecialSEnd', index: 255, figatree: 'SpecialSEnd' },
  { key: 'SpecialAirSEnd', index: 256, figatree: 'SpecialAirSEnd' },
  { key: 'SpecialHi', index: 257, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 258, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 259, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 260, figatree: 'SpecialAirLw' },
];

export const CHUNLI_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
