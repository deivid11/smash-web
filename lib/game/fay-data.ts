import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Fay (ACE 2.0 m-ex fighter, PlFy, mexproj 041). Fox-family kit with authored
 * constants (ACE tuning is compiled m-ex code); hitboxes/animations/articles
 * come verbatim from PlFy.dat scripts. */
export interface FaySpecialData {
  kind: 'Fy';
  /** Blaster: single NBlaster shot on the script flag-24 (fireball convention). */
  neutral: { shotSpeed: number; shotAngle: number; voice: number };
  /** Sniper: tap-S fires SpecialS; held-S fires SHoldStart at frame 34. */
  side: { shotSpeed: number; shotAngle: number; landing: number; mobility: number; voice: number };
  /** Fire Fay: Hold into a motor rise with the script hit, into helpless. */
  up: { riseSpeed: number; riseFrames: number; landing: number; mobility: number; voice: number };
  /** Reflector: holdable loop with the Start hit, Fox-down convention. */
  down: { landing: number; voice: number; reflect: import('./special-data.ts').ReflectorData };
}

export function parseFayParameters(arc: HsdArchive): FaySpecialData {
  arc.symbol('ftDataFay');
  return {
    kind: 'Fy',
    neutral: { shotSpeed: 3.0, shotAngle: 0, voice: 2087 },
    side: { shotSpeed: 3.4, shotAngle: 0, landing: 12, mobility: 1, voice: 2096 },
    up: { riseSpeed: 3.1, riseFrames: 12, landing: 12, mobility: 1, voice: 2103 },
    down: {
      landing: 10, voice: 2094,
      reflect: { bone: 40, offset: [0, 0, 0], radius: 8, damageMultiplier: 1.5, speedMultiplier: 1.4, maxDamage: 50, keepOwner: false },
    },
  };
}

/** Slots: 0 blaster (3%), 1 gun model (no hit), 3 sniper (15%). NSniper and the
 * second Sniper variant share slot 3; slot 2 (muzzle?) carries no hit. */
export function parseFayArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return {
    projectile: parseArticle(metadata, 0, 'laser'),
    accessory: parseArticle(metadata, 1, 'blaster'),
    fay: {
      laser: parseArticle(metadata, 0, 'laser'),
      gun: parseArticle(metadata, 1, 'blaster'),
      sniper: parseArticle(metadata, 3, 'laser'),
    },
  };
}

/** Duplicates: Wait1 x2 (primary 2), Landing x3 (primary 13). Specials single. */
export const FAY_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialNBlaster', index: 246, figatree: 'SpecialNBlaster' },
  { key: 'SpecialAirNBlaster', index: 248, figatree: 'SpecialAirNBlaster' },
  { key: 'SpecialS', index: 250, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 251, figatree: 'SpecialAirS' },
  { key: 'SpecialHiHold', index: 252, figatree: 'SpecialHiHold' },
  { key: 'SpecialHiHoldAir', index: 253, figatree: 'SpecialHiHoldAir' },
  { key: 'SpecialHi', index: 254, figatree: 'SpecialHi' },
  { key: 'SpecialHiFall', index: 255, figatree: 'SpecialHiFall' },
  { key: 'SpecialLwStart', index: 256, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwLoop', index: 257, figatree: 'SpecialLwLoop' },
  { key: 'SpecialLwHit', index: 258, figatree: 'SpecialLwHit' },
  { key: 'SpecialLwEnd', index: 259, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 260, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwLoop', index: 261, figatree: 'SpecialAirLwLoop' },
  { key: 'SpecialAirLwHit', index: 262, figatree: 'SpecialAirLwHit' },
  { key: 'SpecialAirLwEnd', index: 263, figatree: 'SpecialAirLwEnd' },
  { key: 'SpecialSHoldStart', index: 266, figatree: 'SpecialSHoldStart' },
  { key: 'SpecialSHoldLoop', index: 267, figatree: 'SpecialSHoldLoop' },
  { key: 'SpecialSHoldEnd', index: 268, figatree: 'SpecialSHoldEnd' },
  { key: 'SpecialAirSHoldStart', index: 269, figatree: 'SpecialAirSHoldStart' },
  { key: 'SpecialAirSHoldLoop', index: 270, figatree: 'SpecialAirSHoldLoop' },
  { key: 'SpecialAirSHoldEnd', index: 271, figatree: 'SpecialAirSHoldEnd' },
];

export const FAY_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
