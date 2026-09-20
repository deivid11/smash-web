import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import { parseSonicArticles, parseSonicKit, type SonicSpecialData } from './sonic-data.ts';

/** Knuckles (ACE 2.0 m-ex fighter, PlKx, mexproj 050). His compiled `ftFunction` is the Sonic
 * m-ex source rebuilt: neutral/up/down are byte-identical once relocated and read the same
 * `ftDataKx` offsets (his own values: a zero homing radius makes the neutral always take the
 * AttackMiss dive), and the side special is a glide. The shared engine is lib/game/sonic.ts. */
export type KnucklesSpecialData = SonicSpecialData;

export function parseKnucklesParameters(arc: HsdArchive): KnucklesSpecialData {
  return parseSonicKit(arc, 'ftDataKx', 'Kx', [2365, 2377, 2379, 2383]);
}

/** Article slot 0 is the same spring as Sonic's (identical itFunction and article data). */
export function parseKnucklesArticles(metadata: HsdArchive): ReturnType<typeof parseSonicArticles> {
  return parseSonicArticles(metadata, 'ftDataKx');
}

/** The base block (2-13) skips the `_ACTION_` wrapper, so idle/walk/run load by explicit keys.
 * Specials follow the move_logic table: motion 341+n plays action `anim_id - 46`. */
export const KNUCKLES_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait_figatree' },
  { key: 'WalkSlow', index: 6, figatree: 'WalkSlow_figatree' },
  { key: 'WalkMiddle', index: 7, figatree: 'WalkMiddle_figatree' },
  { key: 'WalkFast', index: 8, figatree: 'WalkFast_figatree' },
  { key: 'Run', index: 12, figatree: 'Run_figatree' },
  { key: 'RunBrake', index: 13, figatree: 'RunBrake_figatree' },
  { key: 'Landing', index: 14, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 249, figatree: 'SpecialNStart' },
  { key: 'SpecialAirNStart', index: 250, figatree: 'SpecialAirNStart' },
  { key: 'SpecialNCharge', index: 251, figatree: 'SpecialNSpin' },
  { key: 'SpecialNAttack', index: 252, figatree: 'SpecialNSpina' },
  { key: 'SpecialNCancel', index: 253, figatree: 'SpecialNCancel' },
  { key: 'SpecialNHit', index: 254, figatree: 'SpecialNHit' },
  { key: 'SpecialNRebound', index: 255, figatree: 'SpecialNRebound' },
  { key: 'SpecialNLanding', index: 256, figatree: 'SpecialNLanding' },
  { key: 'SpecialHi', index: 257, figatree: 'SpecialHi' },
  { key: 'SpecialLwStart', index: 258, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwCharge', index: 259, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwEnd', index: 260, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 261, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwEnd', index: 263, figatree: 'SpecialAirLwEnd' },
  { key: 'SpecialS', index: 265, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 267, figatree: 'SpecialAirS' },
  { key: 'SpecialLwRun', index: 269, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwRunTurn', index: 270, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwRunJump', index: 271, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialLwDive', index: 272, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialLwStopWallR', index: 273, figatree: 'SpecialSWallR' },
  { key: 'SpecialLwStopWallL', index: 274, figatree: 'SpecialSWallL' },
  { key: 'SpecialAirSTurn', index: 275, figatree: 'SpecialAirSTurn' },
];

export const KNUCKLES_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
