import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';

/** Meta Knight (ACE 2.0 m-ex fighter, PlMk, mexproj 042). Engine-authored constants:
 * the ACE tuning is compiled m-ex code. His travel specials carry REAL root motion
 * (Drill Rush ~61 units, Shuttle Loop ~26 up), so movement uses rootDelta. */
export interface MetaKnightSpecialData {
  kind: 'Mk';
  /** ftDataMeta declares 4 total jumps; verticals/handling are authored (Kirby-style). */
  jumps: { vertical: number[]; impulseX: number; turnFrames: number; turnThreshold: number; accelMultiplier: number; speedMultiplier: number };
  /** Mach Tornado: spin loops while held (bounded), drifts on stick, exits freefall. */
  neutral: { maxLoops: number; driftAccel: number; driftMax: number; riseSpeed: number; landing: number; voice: number };
  /** Drill Rush: root-motion travel; freefall after the aerial end. */
  side: { landing: number; voice: number };
  /** Shuttle Loop: start → root-motion loop → end, then freefall. */
  up: { landing: number; mobility: number; voice: number };
  /** Dimensional Cape: stick picks the neutral/forward/back root-motion slide. */
  down: { landing: number; voice: number };
}

export function parseMetaKnightParameters(arc: HsdArchive): MetaKnightSpecialData {
  arc.symbol('ftDataMeta');
  return {
    kind: 'Mk',
    jumps: { vertical: [2.3, 2.3, 2.3], impulseX: 0.9, turnFrames: 10, turnThreshold: 0.5, accelMultiplier: 1, speedMultiplier: 1 },
    // Voices are direct metaknight.ssm samples (the ACE SEM carries no scripts for
    // them): neutral se_machtornado, side v_drillrush, up v_shuttleloop, down v_dimensionalcape.
    neutral: { maxLoops: 5, driftAccel: 0.06, driftMax: 1.1, riseSpeed: 0.35, landing: 18, voice: 2135 },
    side: { landing: 20, voice: 2139 },
    up: { landing: 24, mobility: 0.9, voice: 2137 },
    down: { landing: 16, voice: 2138 },

  };
}

/** m-ex action table: idle is Wait (2), three Landing entries (primary 13); the jab is a
 * single looping Attack100 multihit (no Attack11 chain exists). Specials keyed 236-259
 * plus the detached SpecialHiEnd at 265; JumpAerialF2/F3 load by name. */
export const METAKNIGHT_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  ...['SpecialNStart', 'SpecialNSpin', 'SpecialNEnd', 'SpecialAirNStart', 'SpecialAirNEnd',
    'SpecialSStart', 'SpecialSDrill', 'SpecialSEnd', 'SpecialAirSStart', 'SpecialAirSEnd',
    'SpecialHiStart', 'SpecialHi', 'SpecialAirHiStart'].map((key, i) => ({ key, index: 236 + i, figatree: key })),
  ...['SpecialLwStart', 'SpecialLw', 'SpecialLwF', 'SpecialLwB', 'SpecialLwEnd',
    'SpecialAirLwStart', 'SpecialAirLw', 'SpecialAirLwF', 'SpecialAirLwB', 'SpecialAirLwEnd'].map((key, i) => ({ key, index: 250 + i, figatree: key })),
  { key: 'SpecialHiEnd', index: 265, figatree: 'SpecialHiEnd' },
];

export const METAKNIGHT_AIR_JUMPS = ['JumpAerialF', 'JumpAerialF2', 'JumpAerialF3'] as const;

export const METAKNIGHT_MOVES: FighterContent['moves'] = {
  jab: 'Attack100',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
