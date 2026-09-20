import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import { itemHit, parseArticle, type ArticleData } from './special-data.ts';

/** Sonic (ACE 2.0 m-ex fighter, PlSn, mexproj 031). The ACE move logic ships as compiled m-ex
 * code (`ftFunction`) WITH its author's debug symbols; every constant below is the attribute
 * that code reads from `ftDataSonic` x4 (MexTK `special_attributes`), named after the function
 * that reads it. Nothing here is engine-authored except the voice sample ids. */
/** Knuckles (PlKx) was built from the same m-ex source: 123 of his functions are byte-identical
 * to Sonic's once relocated, his neutral/up/down read the very same attribute offsets (with his
 * own values), and only the side special is his own: a glide (SpecialAirS/SpecialAirSTurn). */
/** Shadow (PlSh) is the same source recompiled without symbols: his neutral reads Sonic's very
 * offsets, his spin dash and spin charge are Sonic's callbacks over a block shifted by +0x1C/+0x18
 * (with two timing changes, see `cancelOnPress` and `maxChargeFrames`), and his up special is
 * Mewtwo's Teleport (ftmewtwospecialhi.c) transplanted as Chaos Control. */
export interface SonicSpecialData {
  kind: 'Sn' | 'Kx' | 'Sh';
  /** Homing Attack: SpecialNStart → NCharge (rise, B launches early) → search → NAttack/NAttackMiss. */
  neutral: {
    chargeAnimSpeed: number; chargeMinFrames: number; chargeMaxFrames: number; chargeRise: number;
    attackAnimSpeed: number; missSpeed: number; searchRadius: number; targetRaise: number;
    homingSpeed: number; homingFrames: number; aimX: number; aimY: number;
    cancelAirFriction: number; reboundMulX: number; reboundGravity: number; reboundTerminal: number;
    reboundAirFriction: number; bounceMaxX: number; bounceMaxY: number; landingFriction: number; voice: number;
  };
  /** Spin Dash: SStart → SHold (charge, shield stores nothing, B releases) → SpecialS roll. */
  side: {
    holdMinFrames: number; maxCharge: number; effectInterval: number; minSpeed: number; maxSpeed: number;
    airGravity: number; airTerminal: number; friction: number; holdGravity: number; holdAirFriction: number;
    holdTerminal: number; fallMobility: number; fallLanding: number; endAnimSpeed: number; voice: number;
    /** Shadow's SHold_IASA reads the shield on the press frame once the x8C window has passed;
     * Sonic's latches a press from any frame of the hold. */
    cancelOnPress?: boolean;
  };
  /** Spring Jump: spawns the spring article, launches, drifts, then special fall (Sonic, Knuckles). */
  up?: {
    landing: number; fallMobility: number; riseSpeed: number; springRise: number; driftAccel: number;
    driftMax: number; gravity: number; terminal: number; turnThreshold: number; voice: number;
  };
  /** Spin Charge: LwStart → LwCharge (hold down, mash B for levels) → LwRun / LwDive / LwRunJump. */
  down: {
    releaseWindow: number; levelCooldown: number; firstLevelDelay: number; maxLevel: number;
    airGravity: number; airFriction: number; airTerminal: number; maxChargeFrames: number; runLife: number;
    runAccel: number; runSpeed: readonly [number, number, number]; turnAccel: number; turnExitSpeed: number;
    jumpRise: number; jumpIasaDelay: number; jumpDrift: number; jumpMaxX: number; jumpGravity: number;
    jumpTerminal: number; brakeFriction: number; diveSpeed: number; diveLife: number; wallAnimSpeed: number;
    jumpLanding: number; runDamage: readonly [number, number]; jumpDamage: readonly [number, number]; voice: number;
    /** Shadow: the hold loops a spin sound (0x13E9) after `first` frames, then every `every`;
     * his charge has no frame cap (`maxChargeFrames` 0). */
    spinSound?: { first: number; every: number };
    /** Shadow: SpecialLwCharge_Anim spawns efSync 0x1774 + level on part 2 every xEC frames. */
    levelEffectInterval?: number;
  };
  /** Chaos Control (Shadow): ftMt_SpecialHi's Start → Lost (invisible, intangible travel) → End. */
  chaos?: {
    velDivX: number; velDivY: number; gravity: number; terminal: number; duration: number; landDelay: number;
    stickMin: number; momentum: number; momentumAdd: number; drift: number; angleClamp: number; endMul: number;
    mobility: number; landing: number; turnFrames: number; turnStick: number;
    /** SpecialHiLost figatree frame the zoom holds (rate 0), and the ground stick-vs-floor gate. */
    lostFrame: number; voice: number;
  };
  /** Knuckles' glide. x98 ground dash speed and xA0/xA4/xA8 gravity/cap/friction are attributes;
   * the rest are constants compiled into SpecialAirS_* / SpecialAirSTurn_* (PlKx rodata). */
  glide?: {
    dashSpeed: number; gravity: number; terminal: number; friction: number;
    startSpeed: number; pushSpeed: number; pushFrames: number; frictionFrom: number; boostSpeed: number;
    turnWindow: number; turnStick: number; boostStick: number; turnFall: number; turnFriction: number;
    earlyFrames: number; lateAirFriction: number;
  };
}

/** Shadow's block: Sonic's neutral offsets, then Chaos Control 0x68-0xA4, the spin dash at
 * 0xA8-0xD8 and the spin charge at 0xDC-0x150 (read where each callback reads it). */
export function parseShadowParameters(arc: HsdArchive): SonicSpecialData {
  const base = arc.pointer(arc.symbol('ftDataShadow') + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error(`Invalid ftDataShadow attribute 0x${offset.toString(16)}.`); return v; };
  const i = (offset: number) => { const v = arc.u32(base + offset); if (v > 1000) throw Error(`Invalid ftDataShadow integer 0x${offset.toString(16)}.`); return v; };
  const sonic = parseSonicKitNeutral(f, i, 2529);
  const runMax = f(0x108), runMin = f(0x10c);
  const p: SonicSpecialData = {
    kind: 'Sh',
    neutral: sonic,
    side: {
      holdMinFrames: i(0xa8), maxCharge: i(0xac), effectInterval: i(0xb0), minSpeed: f(0xb4), maxSpeed: f(0xb8),
      airGravity: f(0xbc), airTerminal: f(0xc0), friction: f(0xc4), holdGravity: f(0xc8), holdAirFriction: f(0xcc),
      holdTerminal: f(0xd0), fallMobility: f(0xd4), fallLanding: f(0xd8),
      // SHold_Anim enters SpecialSEnd at rate 1 (Sonic's reads xC0 = 2).
      endAnimSpeed: 1, voice: 2540, cancelOnPress: true,
    },
    down: {
      releaseWindow: i(0xdc), levelCooldown: i(0xe0), firstLevelDelay: i(0xe4), maxLevel: i(0xe8),
      airGravity: f(0xf0), airFriction: f(0xf4), airTerminal: f(0xf8), maxChargeFrames: 0, runLife: i(0x100),
      // SpecialLwRun_Enter lerps x10C→x108 by level / xE8: the same three speeds as Sonic's table.
      runAccel: f(0x104), runSpeed: [runMin, Math.fround(runMin + (runMax - runMin) / 2), runMax], turnAccel: f(0x110), turnExitSpeed: f(0x114),
      jumpRise: f(0x11c), jumpIasaDelay: i(0x120), jumpDrift: f(0x124), jumpMaxX: f(0x128), jumpGravity: f(0x12c),
      jumpTerminal: f(0x130), brakeFriction: f(0x134), diveSpeed: f(0x138), diveLife: 40, wallAnimSpeed: f(0x13c),
      jumpLanding: f(0x140), runDamage: [f(0x144), f(0x148)], jumpDamage: [f(0x14c), f(0x150)], voice: 2547,
      spinSound: { first: 30, every: i(0xfc) }, levelEffectInterval: i(0xec),
    },
    chaos: {
      velDivX: f(0x68), velDivY: f(0x6c), gravity: f(0x70), terminal: f(0x74), duration: i(0x78), landDelay: f(0x7c),
      stickMin: f(0x80), momentum: f(0x84), momentumAdd: f(0x88), drift: f(0x8c), angleClamp: i(0x90), endMul: f(0x94),
      mobility: f(0x98), landing: f(0x9c), turnFrames: i(0xa0), turnStick: f(0xa4), lostFrame: 3, voice: 2545,
    },
  };
  const c = p.chaos!;
  if (c.duration < 1 || c.velDivX <= 0 || c.velDivY <= 0 || c.stickMin <= 0 || c.stickMin >= 1 || p.side.maxCharge < 1 || p.down.maxLevel < 1 || p.neutral.homingFrames < 1)
    throw Error('Unsupported ftDataShadow attribute bounds.');
  return p;
}
export function parseSonicParameters(arc: HsdArchive): SonicSpecialData {
  // Voices are direct sonic.ssm samples (the ACE SEM carries no scripts for them):
  // neutral v_hissatu, side se_spin0, up se_spring, down se_charge.
  return parseSonicKit(arc, 'ftDataSonic', 'Sn', [1726, 1712, 1716, 1715]);
}
/** Homing Attack block (0x18-0x64), identical in every Sonic-source fighter. */
function parseSonicKitNeutral(f: (offset: number) => number, i: (offset: number) => number, voice: number): SonicSpecialData['neutral'] {
  return {
    chargeAnimSpeed: f(0x18), chargeMinFrames: i(0x1c), chargeMaxFrames: i(0x20), chargeRise: f(0x24),
    attackAnimSpeed: f(0x28), missSpeed: f(0x2c), searchRadius: f(0x30), targetRaise: f(0x34),
    homingSpeed: f(0x38), homingFrames: i(0x3c), aimX: f(0x40), aimY: f(0x44),
    cancelAirFriction: f(0x48), reboundMulX: f(0x4c), reboundGravity: f(0x50), reboundTerminal: f(0x54),
    reboundAirFriction: f(0x58), bounceMaxX: f(0x5c), bounceMaxY: f(0x60), landingFriction: f(0x64), voice,
  };
}
/** One attribute reader for every fighter built on the Sonic m-ex source. */
export function parseSonicKit(arc: HsdArchive, symbol: string, kind: SonicSpecialData['kind'], [nVoice, sVoice, hiVoice, lwVoice]: readonly [number, number, number, number]): SonicSpecialData {
  const base = arc.pointer(arc.symbol(symbol) + 4);
  const f = (offset: number) => { const v = arc.f32(base + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error(`Invalid ${symbol} attribute 0x${offset.toString(16)}.`); return v; };
  const i = (offset: number) => { const v = arc.u32(base + offset); if (v > 1000) throw Error(`Invalid ${symbol} integer 0x${offset.toString(16)}.`); return v; };
  const p: SonicSpecialData = {
    kind,
    neutral: parseSonicKitNeutral(f, i, nVoice),
    side: {
      holdMinFrames: i(0x8c), maxCharge: i(0x90), effectInterval: i(0x94), minSpeed: f(0x98), maxSpeed: f(0x9c),
      airGravity: f(0xa0), airTerminal: f(0xa4), friction: f(0xa8), holdGravity: f(0xac), holdAirFriction: f(0xb0),
      holdTerminal: f(0xb4), fallMobility: f(0xb8), fallLanding: f(0xbc), endAnimSpeed: f(0xc0), voice: sVoice,
    },
    up: {
      landing: f(0x68), fallMobility: f(0x6c), riseSpeed: f(0x70), springRise: f(0x74), driftAccel: f(0x78),
      driftMax: f(0x7c), gravity: f(0x80), terminal: f(0x84), turnThreshold: f(0x88), voice: hiVoice,
    },
    down: {
      releaseWindow: i(0xc4), levelCooldown: i(0xc8), firstLevelDelay: i(0xcc), maxLevel: i(0xd0),
      airGravity: f(0xd8), airFriction: f(0xdc), airTerminal: f(0xe0), maxChargeFrames: i(0xe4), runLife: i(0xe8),
      runAccel: f(0xec), runSpeed: [f(0xf8), f(0xf4), f(0xf0)], turnAccel: f(0xfc), turnExitSpeed: f(0x100),
      jumpRise: f(0x108), jumpIasaDelay: i(0x10c), jumpDrift: f(0x110), jumpMaxX: f(0x114), jumpGravity: f(0x118),
      jumpTerminal: f(0x11c), brakeFriction: f(0x120), diveSpeed: f(0x124), diveLife: i(0x12c), wallAnimSpeed: f(0x130),
      jumpLanding: f(0x134), runDamage: [f(0x138), f(0x13c)], jumpDamage: [f(0x140), f(0x144)], voice: lwVoice,
    },
  };
  if (kind === 'Kx') p.glide = {
    dashSpeed: f(0x98), gravity: f(0xa0), terminal: f(0xa4), friction: f(0xa8),
    // SpecialAirSStart_Enter 0.85, SpecialAirS_Phys 1.2 until frame 10 and friction from 20,
    // SpecialAirS_IASA 1.6 boost / 0.85 stick / 2- and 25-frame gates / 0.07 air friction,
    // SpecialAirSTurn_Phys -0.45 fall and 1.3 air friction, SpecialAirS_Anim ±0.5 turn stick.
    startSpeed: 0.85, pushSpeed: 1.2, pushFrames: 10, frictionFrom: 20, boostSpeed: 1.6,
    turnWindow: 25, turnStick: 0.5, boostStick: 0.85, turnFall: -0.45, turnFriction: 1.3,
    earlyFrames: 2, lateAirFriction: 0.07,
  };
  // Knuckles ships a zero homing radius: his neutral always takes the AttackMiss dive.
  if (p.neutral.homingFrames < 1 || p.side.maxCharge < 1 || p.down.maxLevel < 1 || p.neutral.searchRadius < 0) throw Error(`Unsupported ${symbol} attribute bounds.`);
  return p;
}

/** Article slot 0 is the spring (itFunction item 0: OnSpawn/Idle/Fall/Rebound/Spring_JumpedOn).
 * Its special block is { x0 lifetime, x4 first bounce, x8 minimum bounce, xC bounce decay,
 * x10 rebound lifetime, x14 (unused here), x18 rebound rise, x1C rebound scale }. Only the
 * Rebound state (2) scripts a hit; Idle (0) and Fall (1) are harmless. */
export interface SonicSpringData extends ArticleData {
  bounce: number; minBounce: number; bounceDecay: number; reboundLife: number; reboundRise: number; reboundScale: number;
  reboundHit: ArticleData['hit'];
}
export function parseSonicArticles(metadata: HsdArchive, symbol = 'ftDataSonic'): { sonic: { spring: SonicSpringData } } {
  const table = metadata.pointer(metadata.symbol(symbol) + 0x48);
  const article = metadata.pointer(table), special = metadata.pointer(article + 4), states = metadata.pointer(article + 12);
  const base = parseArticle(metadata, 0, 'sonic-spring');
  const sf = (offset: number) => { const v = metadata.f32(special + offset); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw Error('Invalid Sonic spring attribute.'); return v; };
  const reboundScript = metadata.pointer(states + 2 * 0x10 + 12);
  const reboundHit = reboundScript ? itemHit(metadata, reboundScript) : null;
  if (!reboundHit) throw Error('The Sonic spring rebound carries no original hit.');
  const spring: SonicSpringData = {
    ...base, lifetime: sf(0), bounce: sf(4), minBounce: sf(8), bounceDecay: sf(0xc), reboundLife: sf(0x10),
    reboundRise: sf(0x18), reboundScale: sf(0x1c), reboundHit,
  };
  return { sonic: { spring } };
}

/** m-ex motion table (move_logic): motion 341+n plays action `anim_id - 49`. Several motions
 * share one figatree with different scripts, so every state is keyed to its exact action. */
export const SONIC_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 14, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 246, figatree: 'SpecialNStart' },
  { key: 'SpecialAirNStart', index: 247, figatree: 'SpecialAirNStart' },
  { key: 'SpecialNCharge', index: 248, figatree: 'SpecialNSpin' },
  { key: 'SpecialNAttack', index: 249, figatree: 'SpecialNSpin' },
  { key: 'SpecialNCancel', index: 250, figatree: 'SpecialNCancel' },
  { key: 'SpecialNHit', index: 251, figatree: 'SpecialNHit' },
  { key: 'SpecialNRebound', index: 252, figatree: 'SpecialNRebound' },
  { key: 'SpecialNLanding', index: 253, figatree: 'SpecialNLanding' },
  { key: 'SpecialHi', index: 254, figatree: 'SpecialHi' },
  { key: 'SpecialLwStart', index: 255, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwCharge', index: 256, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwEnd', index: 257, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 258, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwEnd', index: 260, figatree: 'SpecialAirLwEnd' },
  { key: 'SpecialSHold', index: 261, figatree: 'SpecialSHold' },
  { key: 'SpecialS', index: 262, figatree: 'SpecialS' },
  { key: 'SpecialSFull', index: 263, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 264, figatree: 'SpecialAirS' },
  { key: 'SpecialAirSFull', index: 265, figatree: 'SpecialAirS' },
  { key: 'SpecialLwRun', index: 266, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwRunTurn', index: 267, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwRunJump', index: 268, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialLwDive', index: 269, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialLwStopWallR', index: 270, figatree: 'SpecialSWallR' },
  { key: 'SpecialLwStopWallL', index: 271, figatree: 'SpecialSWallL' },
];

export const SONIC_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};

/** The compiled Sonic, Knuckles and Shadow ftFunctions share one spawn routine
 * verified through local disassembly: ftParts_80074A4C sets groups 0-2 to
 * alternative 0 and group 3 to -1. Group 3 is the second five-way hand set on the same joint as
 * group 2's, so leaving it on alternative 0 draws a second hand over the first. */
export const SONIC_PART_DEFAULTS: readonly number[] = [0, 0, 0, -1];
