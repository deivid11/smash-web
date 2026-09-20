import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';

/** Wario (ACE 2.0 m-ex fighter, PlWr, mexproj 035). Engine-authored constants;
 * hitboxes/animations come verbatim from PlWr.dat. No articles on disc. */
export interface WarioSpecialData {
  kind: 'Wr';
  /** Chomp: multi-hit bite (SpecialN, 18 hits), holdable. */
  neutral: { voice: number };
  /** Shoulder Bash, decoded from PlWr's compiled SpecialS/M343–M347 (special_attributes):
   * x24 ground dash, x28 aerial dash / ledge run-off, x30/x34 SJump, x38 ground-dash air
   * terminal, x3C restart frame, x40/x44 special-fall drift/landing, x54 slowdown friction,
   * x58/x5C/x60 aerial gravity, x68/x6C and x70/x74 contact rebounds, x78/x7C hit drift. */
  side: { dashVel: number; airDashVel: number; jumpVelX: number; jumpVelY: number; dashTerminal: number; restartFrame: number;
    fallMobility: number; fallLanding: number; slowFriction: number; airGravity0: number; airGravity1: number; airTerminal: number;
    reboundX: number; reboundY: number; airReboundX: number; airReboundY: number; hitDrift: number; hitMaxX: number; voice: number };
  /** Corkscrew: 27-hit rising spin into helpless. */
  up: { riseSpeed: number; riseFrames: number; landing: number; mobility: number; voice: number };
  /** Wario Waft: chargeable gas burst (script has no hits; engine lifts). */
  down: { chargeFrames: number; riseSpeed: number; landing: number; voice: number };
}

export function parseWarioParameters(arc: HsdArchive): WarioSpecialData {
  const base = arc.pointer(arc.symbol('ftDataWario') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Wario parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Wario integer.'); return v; };
  return {
    kind: 'Wr',
    neutral: { voice: 1924 },
    side: { dashVel: f(0x24), airDashVel: f(0x28), jumpVelX: f(0x30), jumpVelY: f(0x34), dashTerminal: f(0x38), restartFrame: f(0x3c),
      fallMobility: f(0x40), fallLanding: u(0x44), slowFriction: f(0x54), airGravity0: f(0x58), airGravity1: f(0x5c), airTerminal: f(0x60),
      reboundX: f(0x68), reboundY: f(0x6c), airReboundX: f(0x70), airReboundY: f(0x74), hitDrift: f(0x78), hitMaxX: f(0x7c), voice: 1928 },
    up: { riseSpeed: 3.0, riseFrames: 16, landing: 14, mobility: 1, voice: 1930 },
    down: { chargeFrames: 60, riseSpeed: 2.6, landing: 14, voice: 1944 },
  };
}

export function parseWarioArticles(): SpecialAssets['articles'] {
  return {};
}

/** Duplicates: Landing x3 (primary 14), AttackS3S x3 (primary 52, middle),
 * CliffWait split 1/2 (shared ledge flow uses the first, like Falcon). */
export const WARIO_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 14, figatree: 'Landing' },
  { key: 'AttackS3S', index: 52, figatree: 'AttackS3S' },
  { key: 'CliffWait', index: 207, figatree: 'CliffWait1' },
  { key: 'SpecialN', index: 250, figatree: 'SpecialN' },
  { key: 'SpecialAirN', index: 251, figatree: 'SpecialAirN' },
  { key: 'SpecialSStart', index: 252, figatree: 'SpecialSStart' },
  { key: 'SpecialS', index: 253, figatree: 'SpecialS' },
  { key: 'SpecialAirSStart', index: 254, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirS', index: 255, figatree: 'SpecialAirS' },
  { key: 'SpecialSJump', index: 256, figatree: 'SpecialSJump' },
  { key: 'SpecialHi', index: 257, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 258, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 259, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 260, figatree: 'SpecialAirLw' },
  { key: 'SpecialAirLwLoop', index: 261, figatree: 'SpecialAirLwLoop' },
  { key: 'SpecialAirLwEnd', index: 262, figatree: 'SpecialAirLwEnd' },
];

/** Wario's Attack13 (166-byte figatree) and Attack100 clips are corrupt in the
 * 2.0 ISO (out-of-bounds); the jab stands as 11->12 with no third hit or rapid. */
export const WARIO_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
