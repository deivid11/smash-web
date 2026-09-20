import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Zero (ACE 2.0 m-ex fighter, PlZx). Unlike vanilla fighters his special-move tuning
 * lives in compiled m-ex PowerPC code, not in ftData: the ftDataZero attribute
 * extension block is only 16 bytes. These constants are therefore engine-authored
 * approximations of the ACE build's behavior, while every hitbox, animation and
 * article still comes verbatim from PlZx.dat scripts. */
export interface ZeroSpecialData {
  kind: 'Zx';
  /** Z-Buster: hold to charge; release fires the small or the charged shot article. */
  neutral: { chargeFrames: number; maxHold: number; shotSpeed: number; chargedSpeed: number; voice: number };
  /** Hienkyaku dash: engine-driven travel (the clips carry no root motion);
   * a second press chains the follow-up dash. */
  side: { chainWindow: number; landing: number; dashSpeed: number; decay: number; airGravity: number; voice: number };
  /** Ryuenjin: engine-driven rising slash into freefall. */
  up: { riseSpeed: number; riseGravity: number; driftX: number; landing: number; mobility: number; voice: number };
  /** Sentsuizan: grounded slash, or the aerial dive that ends in SpecialLwLand. */
  down: { diveVx: number; diveVy: number; landing: number; voice: number };
}

export function parseZeroParameters(arc: HsdArchive): ZeroSpecialData {
  // Validate the archive is really Zero's before handing out the authored constants.
  const root = arc.symbol('ftDataZero');
  if (!arc.pointer(root + 4)) throw new Error('Zero fighter data has no attribute extension block.');
  return {
    kind: 'Zx',
    // Voices are direct zero.ssm samples (the ACE SEM carries no scripts for them):
    // neutral v_link_hissatu, side v_link_atk2, up v_link_jump1, down v_link_atk4.
    neutral: { chargeFrames: 75, maxHold: 600, shotSpeed: 2.6, chargedSpeed: 3.4, voice: 2406 },
    side: { chainWindow: 4, landing: 12, dashSpeed: 2.7, decay: 0.94, airGravity: 0.03, voice: 2400 },
    up: { riseSpeed: 3.1, riseGravity: 0.09, driftX: 0.35, landing: 24, mobility: 0.9, voice: 2410 },
    down: { diveVx: 1.4, diveVy: -3.4, landing: 18, voice: 2402 },

  };
}

/** Item table slots 0/1 are the mexproj "Blaster"/"Blaster 2" articles (verified: both
 * carry models and script hitboxes — 5% small shot, 10% charged shot). */
export function parseZeroArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return { zero: { shot: parseArticle(metadata, 0, 'buster'), charged: parseArticle(metadata, 1, 'buster-charged') } };
}

/** m-ex action table entries whose figatree names repeat or differ from the engine's
 * canonical keys. Zero names his idle Wait (twice) and owns three Landing entries;
 * index 12 is the primary landing (the vanilla submotion-35 rule does not apply to
 * his rebuilt table). Specials are keyed to pin the duplicated S1 variants. */
export const ZERO_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  { key: 'Landing', index: 12, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 243, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoop', index: 244, figatree: 'SpecialNLoop' },
  { key: 'SpecialNEnd', index: 245, figatree: 'SpecialNEnd' },
  { key: 'SpecialAirNStart', index: 246, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoop', index: 247, figatree: 'SpecialAirNLoop' },
  { key: 'SpecialAirNEnd', index: 248, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialS1', index: 249, figatree: 'SpecialS1' },
  { key: 'SpecialS2', index: 250, figatree: 'SpecialS2' },
  { key: 'SpecialAirS1', index: 252, figatree: 'SpecialAirS1' },
  { key: 'SpecialAirS2', index: 253, figatree: 'SpecialAirS2' },
  { key: 'SpecialHi', index: 255, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 256, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 257, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 258, figatree: 'SpecialAirLw' },
  { key: 'SpecialLwLand', index: 261, figatree: 'SpecialLwLand' },
];

export const ZERO_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS41', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
