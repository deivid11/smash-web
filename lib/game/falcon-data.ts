import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';

/** ftCaptain_DatAttrs (third_party/melee/src/melee/ft/kinds/ftCaptain/types.h);
 * values come only from ftDataCaptain. Ganondorf shares the layout, not the data. */
export interface FalconSpecialData {
  kind: 'Ca';
  /** Falcon Punch: aerial stick redirect window and per-frame velocity decay. */
  neutral: { stickRangeNeg: number; stickRangePos: number; angleDiff: number; velocity: number; velocityMul: number };
  /** Raptor Boost: ground hit keeps a fraction of speed; the air variant has its own fall. */
  side: { hitGroundVelMul: number; gravity: number; terminal: number; missLanding: number; hitLanding: number };
  /** Falcon Dive: root-motion climb with bounded drift, freefall exit and catch fall. */
  up: { airFrictionMul: number; horizontalVel: number; freefallMobility: number; landing: number; reverseThreshold: number; catchGravity: number };
  /** Falcon Kick: each landed hit multiplies the remaining slide speed, a bounded number of times. */
  down: { maxHitSlows: number; onHitSpeedMul: number; groundLagMul: number; landingLagMul: number; groundTraction: number; airLandingTraction: number };
}
export function parseFalconParameters(arc: HsdArchive): FalconSpecialData {
  const base = arc.pointer(arc.symbol('ftDataCaptain') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Captain Falcon parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Captain Falcon integer.'); return v; };
  const p: FalconSpecialData = {
    kind: 'Ca',
    neutral: { stickRangeNeg: f(0x0), stickRangePos: f(0x4), angleDiff: f(0x8), velocity: f(0xc), velocityMul: f(0x10) },
    side: { hitGroundVelMul: f(0x14), gravity: f(0x18), terminal: f(0x1c), missLanding: f(0x38), hitLanding: f(0x3c) },
    up: { airFrictionMul: f(0x40), horizontalVel: f(0x44), freefallMobility: f(0x48), landing: f(0x4c), reverseThreshold: f(0x58), catchGravity: f(0x60) },
    down: { maxHitSlows: u(0x78), onHitSpeedMul: f(0x74), groundLagMul: f(0x7c), landingLagMul: f(0x80), groundTraction: f(0x84), airLandingTraction: f(0x88) },
  };
  if (p.neutral.velocity <= 0 || p.neutral.stickRangePos <= p.neutral.stickRangeNeg || p.side.gravity <= 0 || p.side.terminal <= 0 ||
      p.up.horizontalVel <= 0 || p.up.freefallMobility <= 0 || p.up.freefallMobility > 1 || p.up.catchGravity <= 0 ||
      p.down.maxHitSlows < 1 || p.down.maxHitSlows > 16 || p.down.onHitSpeedMul <= 0 || p.down.onHitSpeedMul > 1) {
    throw Error('Unsupported original Captain Falcon bounds.');
  }
  return p;
}
/** ftCa_Init_MotionStateTable specials, action indices 258–274. The wall-rebound
 * SpecialHiThrow1 reuses the SpecialHiThrow figatree with its own script. */
export const FALCON_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  'SpecialN', 'SpecialAirN',
  'SpecialSStart', 'SpecialS', 'SpecialAirSStart', 'SpecialAirS',
  'SpecialHi', 'SpecialAirHi', 'SpecialHiCatch', 'SpecialHiThrow',
  'SpecialLw', 'SpecialLwEnd', 'SpecialAirLw', 'SpecialAirLwEnd', 'SpecialLwEndAir', 'SpecialAirLwEndAir',
].map((key, i) => ({ key, index: 258 + i, figatree: key })).concat([
  { key: 'SpecialHiThrow1', index: 274, figatree: 'SpecialHiThrow' },
  // Falcon splits the hang pose into CliffWait1/CliffWait2; the shared ledge flow uses the first.
  { key: 'CliffWait', index: 209, figatree: 'CliffWait1' },
]);
export const FALCON_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13', rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
