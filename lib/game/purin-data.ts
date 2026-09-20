import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';

/** ftPurinAttributes (third_party/melee/src/melee/ft/kinds/ftPurin/types.h), USA 1.02.
 * Offsets follow the ftpurinspecialn/specials callbacks; the multi-jump block at +0
 * shares Kirby's Fighter_x2D0_t layout (ftCo_800D74A4 indexes it identically). */
export interface PurinSpecialData {
  kind: 'Pr';
  jumps: { turnFrames: number; turnThreshold: number; impulseX: number; accelMultiplier: number; speedMultiplier: number; vertical: number[] };
  /** Rollout (ftPr_SpecialN*): charge loop, release roll, turn, wall bounce and roll damage. */
  rollout: {
    releaseFrames: number; hitDecrement: number; gravity: number; terminal: number;
    groundSeed: number; airSeed: number; maxVel: number; maxVelHard: number; airDecel: number; airMinSpeed: number;
    turnStick: number; turnRollRate: number; turnCollThreshold: number; turnTraction: number;
    bounceMul: number; bounceThreshold: number; damageBase: number; damageMul: number;
    recoil: { x: number; y: number }; endGroundMul: number; endAirYMul: number; releaseRollRate: number;
    chargeInitial: number; chargeMax: number; chargeRate: number; rollDegRate: number;
    chargeDecay: number; chargeMin: number; airRateMul: number; velPerCharge: number;
    slopeInfluence: number; minHitVel: number; turnEndRatio: number; wallBounce: number; landingLag: number;
  };
  /** Pound (ftPr_SpecialAirS_Phys): aerial stick-angled boost and its per-frame decay. */
  pound: { stickMin: number; stickMax: number; angle: number; boost: number; decay: number };
}
export function parsePurinParameters(arc: HsdArchive): PurinSpecialData {
  const base = arc.pointer(arc.symbol('ftDataPurin') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid original Jigglypuff parameter.'); return v; };
  const u = (offset: number) => { const v = arc.u32(base + offset); if (v > 600) throw Error('Invalid original Jigglypuff integer.'); return v; };
  const jumpCount = u(0x28);
  if (jumpCount < 1 || jumpCount > 5) throw Error('Unsupported original Jigglypuff multi-jump count.');
  const p: PurinSpecialData = {
    kind: 'Pr',
    jumps: { turnFrames: u(0), turnThreshold: f(4), impulseX: f(8), accelMultiplier: f(0xc), speedMultiplier: f(0x10), vertical: Array.from({ length: jumpCount }, (_, i) => f(0x14 + i * 4)) },
    rollout: {
      releaseFrames: u(0x34), hitDecrement: u(0x38), gravity: f(0x3c), terminal: f(0x40),
      groundSeed: f(0x44), airSeed: f(0x54), maxVel: f(0x4c), maxVelHard: f(0x50), airDecel: f(0x58), airMinSpeed: f(0x5c),
      turnStick: f(0x68), turnRollRate: f(0x6c), turnCollThreshold: f(0x74),
      bounceMul: f(0x78), bounceThreshold: f(0x7c), damageBase: f(0x80), damageMul: f(0x84),
      recoil: { x: f(0x88), y: f(0x8c) }, endGroundMul: f(0x90), endAirYMul: f(0x94), releaseRollRate: f(0x98),
      chargeInitial: f(0xa0), chargeMax: f(0xa4), chargeRate: f(0xa8), rollDegRate: f(0xac),
      chargeDecay: f(0xb4), chargeMin: f(0xb8), airRateMul: f(0xbc), velPerCharge: f(0xc0),
      turnTraction: f(0xc4), slopeInfluence: f(0xc8), minHitVel: f(0xcc), turnEndRatio: f(0xd0), wallBounce: f(0xd4), landingLag: f(0xd8),
    },
    pound: { stickMin: f(0xdc), stickMax: f(0xe0), angle: f(0xe4), boost: f(0xf0), decay: f(0xf4) },
  };
  const r = p.rollout;
  if (p.jumps.turnFrames < 1 || p.jumps.turnFrames > 60 || r.releaseFrames < 1 || r.chargeMax <= r.chargeInitial || r.chargeRate <= 0 ||
      r.chargeMin < 0 || r.velPerCharge <= 0 || r.maxVel <= 0 || r.gravity <= 0 || r.terminal <= 0 || r.wallBounce <= 0 || r.wallBounce > 1 ||
      p.pound.stickMax <= p.pound.stickMin || p.pound.boost <= 0 || p.pound.decay <= 0 || p.pound.decay > 1) {
    throw Error('Unsupported original Jigglypuff bounds.');
  }
  return p;
}
/** ftPr subactions 245–271 (ftPurin_MotionState order after the five air jumps at 240–244).
 * The charge/release/turn/hit states all reuse the one SpecialN figatree with their own scripts. */
export const PURIN_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  ['SpecialNStartR', 'SpecialNStartR'], ['SpecialNStartL', 'SpecialNStartL'],
  ['SpecialNLoop', 'SpecialN'], ['SpecialNFull', 'SpecialN'], ['SpecialNRelease', 'SpecialN'], ['SpecialNTurn', 'SpecialN'],
  ['SpecialNEndR', 'SpecialNEndR'], ['SpecialNEndL', 'SpecialNEndL'],
  ['SpecialAirNStartR', 'SpecialAirNStartR'], ['SpecialAirNStartL', 'SpecialAirNStartL'],
  ['SpecialAirNLoop', 'SpecialN'], ['SpecialAirNFull', 'SpecialN'], ['SpecialAirNRelease', 'SpecialN'], ['SpecialAirNTurn', 'SpecialN'],
  ['SpecialAirNEndR', 'SpecialAirNEndR'], ['SpecialAirNEndL', 'SpecialAirNEndL'],
  ['SpecialNHit', 'SpecialN'],
  ['SpecialS', 'SpecialS'], ['SpecialAirS', 'SpecialAirS'],
  ['SpecialHiL', 'SpecialHiL'], ['SpecialAirHiL', 'SpecialAirHiL'], ['SpecialHiR', 'SpecialHiR'], ['SpecialAirHiR', 'SpecialAirHiR'],
  ['SpecialLwL', 'SpecialLwL'], ['SpecialAirLwL', 'SpecialAirLwL'], ['SpecialLwR', 'SpecialLwR'], ['SpecialAirLwR', 'SpecialAirLwR'],
].map(([key, figatree], i) => ({ key: key!, index: 245 + i, figatree: figatree! })).concat([
  // Jigglypuff names its idle Wait (submotion 2); the engine's Wait1 key maps onto it.
  { key: 'Wait1', index: 2, figatree: 'Wait' },
]);
export const PURIN_AIR_JUMPS = ['JumpAerialF1', 'JumpAerialF2', 'JumpAerialF3', 'JumpAerialF4', 'JumpAerialF5'] as const;
export const PURIN_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
