import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { FighterProfile } from './data.ts';
import type { SpecialAssets } from './special-data.ts';
import { parsePeachArticles, parsePeachParameters, PEACH_ACTION_KEYS, type PeachSpecialData } from './peach-data.ts';

/** Daisy (ACE 2.0 m-ex fighter, PlDa, mexproj 036) runs Peach's kit. Her ftFunction motion
 * table points Float, Bomber, Parasol and the weapon smashes at the DOL's ftPe_* callbacks;
 * her own SpecialS/SStart_Anim, Toad (M365–368) and turnip pull (M352/353) are recompiles of
 * the same ftPe logic (her pull always yields her own turnip article, no rare roll). The
 * ftDataDaisy attribute block keeps Peach's layout with her own values (70-frame float,
 * Bomber launch 4.7, rebound 1.8), and her article table keeps Peach's five slots. */
export type DaisySpecialData = Omit<PeachSpecialData, 'kind'> & {
  kind: 'Da';
  /** Special cries sampled straight from daisy.ssm: the ISO's SEM has no script for the bank. */
  voices: { neutral: number; side: number; up: number; down: number };
};

export function parseDaisyParameters(arc: HsdArchive, profile: FighterProfile): DaisySpecialData {
  return { ...parsePeachParameters(arc, profile, 'ftDataDaisy'), kind: 'Da', voices: { neutral: 1956, side: 1962, up: 1967, down: 1970 } };
}

export function parseDaisyArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return parsePeachArticles(metadata, 'ftDataDaisy');
}

/** Peach's 242–264 table (same order, same swapped SpecialN/SpecialLw figatree names: Toad
 * plays `SpecialLw*`, the turnip pull plays `SpecialN`) plus Daisy's duplicate-entry quirks:
 * Landing x3 (15), JumpAerialF/B x2 (18/19). */
export const DAISY_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 15, figatree: 'Landing' },
  { key: 'JumpAerialF', index: 18, figatree: 'JumpAerialF' },
  { key: 'JumpAerialB', index: 19, figatree: 'JumpAerialB' },
  ...PEACH_ACTION_KEYS,
];

export const DAISY_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4Club', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
