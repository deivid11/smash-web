import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Toad (ACE 2.0 m-ex fighter, PlTd, mexproj 057). Like every ACE fighter his special
 * tuning is compiled m-ex code, so these constants are engine-authored approximations;
 * hitboxes/animations/articles come verbatim from PlTd.dat scripts. */
export interface ToadSpecialData {
  kind: 'Td';
  /** Ice Ball: the shot leaves on the script's flag-24 event (Mario fireball convention). */
  neutral: { shotSpeed: number; shotAngle: number; voice: number };
  /** Quick side poke: pure script attack (2 hits, 17 frames). */
  side: { landing: number; voice: number };
  /** Root-motion recovery (real root Y/Z tracks in SpecialHi) into freefall. */
  up: { landing: number; mobility: number; voice: number };
  down: { landing: number; voice: number };
}

export function parseToadParameters(arc: HsdArchive): ToadSpecialData {
  arc.symbol('ftDataToad');
  return {
    kind: 'Td',
    // Voices are direct toad.ssm samples (the ACE SEM carries no scripts for them):
    // neutral v_mario_hissatu, side v_mario_atk2, up v_mario_jump, down v_mario_atk4.
    neutral: { shotSpeed: 2.1, shotAngle: -0.15, voice: 2579 },
    side: { landing: 10, voice: 2574 },
    up: { landing: 20, mobility: 0.9, voice: 2582 },
    down: { landing: 15, voice: 2576 },

  };
}

/** Item slots 0/1: the mexproj "Ice Ball" (5%) and its large variant (12%, slot 2 repeats slot 1). */
export function parseToadArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return { toad: { ice: parseArticle(metadata, 0, 'iceball'), bigIce: parseArticle(metadata, 1, 'iceball-big') } };
}

/** m-ex action table quirks: idle is Wait (index 2), three Landing entries (primary 13),
 * and the forward smash repeats the AttackS4 figatree three times (primary 52). */
export const TOAD_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'AttackS4', index: 52, figatree: 'AttackS4' },
  { key: 'SpecialN', index: 244, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 245, figatree: 'SpecialAirN' },
  { key: 'SpecialS', index: 246, figatree: 'SpecialS' },
  { key: 'SpecialSAir', index: 247, figatree: 'SpecialSAir' },
  { key: 'SpecialHi', index: 248, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 249, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 250, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 251, figatree: 'SpecialAirLw' },
];

export const TOAD_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
