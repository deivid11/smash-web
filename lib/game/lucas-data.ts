import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Lucas (ACE 2.0 m-ex fighter, PlLc, mexproj 030). Engine-authored orchestration;
 * hitboxes/animations/articles come verbatim from PlLc.dat (Ness-shared kit). */
export interface LucasSpecialData {
  kind: 'Lc';
  /** PK Freeze: charge while held, release to fire the freeze block. */
  neutral: { chargeFrames: number; voice: number };
  /** PK Fire: single shot on flag-24, on the grounded/aerial trajectory pair. */
  side: { shotSpeed: number; shotAngle: number; airSpeed: number; airAngle: number; voice: number };
  /** PK Thunder rocket: 23-hit melee launch into helpless (guided ball pending). */
  up: { riseSpeed: number; landing: number; mobility: number; voice: number };
  /** PSI Magnet: holdable absorb loop around TransN. */
  down: { landing: number; voice: number; absorb: { bone: number; offset: [number, number, number]; radius: number }; healMul: number };
}

/** Each ACE Ness clone keeps a real ftNessAttributes block behind its own ftData symbol, but the
 * two Wave-3 fighters push it `shift` bytes past ftData x4 (PlLc2 is exact). Reading the PK Fire
 * trajectories beats inventing them — with the whole group range-checked together, because an
 * m-ex layout that drifts would otherwise hand the engine plausible-looking neighbouring floats.
 * Only the fields verified against the original block are read; the rest stay engine-authored. */
export function nessClonePkFire(arc: HsdArchive, symbol: string, shift: number,
  fallback: { shotSpeed: number; shotAngle: number; airSpeed: number; airAngle: number; landing: number },
): { shotSpeed: number; shotAngle: number; airSpeed: number; airAngle: number; landing: number } {
  try {
    const base = arc.pointer(arc.symbol(symbol) + 4) + shift;
    const read = (offset: number, low: number, high: number): number => {
      const value = arc.f32(base + offset);
      if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${symbol} PSI attribute ${offset} is out of range.`);
      return value;
    };
    // ftNessAttributes x20/x24 aerial pair, x28/x2C grounded pair, x70 PK Thunder landing lag.
    return { airAngle: read(0x20, -1.6, 1.6), airSpeed: read(0x24, 0.2, 12), shotAngle: read(0x28, -1.6, 1.6), shotSpeed: read(0x2c, 0.2, 12), landing: read(0x70, 1, 60) };
  } catch { return { ...fallback }; }
}

export function parseLucasParameters(arc: HsdArchive): LucasSpecialData {
  const fire = nessClonePkFire(arc, 'ftDataLucas', 0x18, { shotSpeed: 2.2, shotAngle: 0, airSpeed: 2.2, airAngle: 0, landing: 14 });
  return {
    kind: 'Lc',
    neutral: { chargeFrames: 50, voice: 1682 },
    side: { shotSpeed: fire.shotSpeed, shotAngle: fire.shotAngle, airSpeed: fire.airSpeed, airAngle: fire.airAngle, voice: 1685 },
    up: { riseSpeed: 3.0, landing: fire.landing, mobility: 1, voice: 1691 },
    down: { landing: 10, voice: 1697, absorb: { bone: 1, offset: [0, 8, 0], radius: 12 }, healMul: 1.5 },
  };
}

/** Slots: 1 PK Fire (3%), 3 freeze block (2%). Slots 0/2 have no hit. */
export function parseLucasArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  return {
    lucas: {
      freeze: parseArticle(metadata, 3, 'lucas-freeze'),
      fire: parseArticle(metadata, 1, 'lucas-fire'),
    },
  };
}

/** Duplicates: Landing x3 (14), NHold x2 (247), AirNHold x2 (251), Hi x2 (259). */
export const LUCAS_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
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

export const LUCAS_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
