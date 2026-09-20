import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { FighterProfile } from './data.ts';
import type { ReflectorData, SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Metal Sonic (ACE 2.0 m-ex fighter, PlNm, mexproj 049, internal id 49) is built on Fox's engine
 * slot: MxDt.dat gives him ftFx_SpecialSStart_Enter / ftFx_SpecialAirSStart_Enter for the side
 * special and Fox's motion-state callbacks as raw DOL pointers, and PlNm's symbol-less ftFunction
 * block overrides SpecialN/SpecialAirN/SpecialHi/SpecialAirHi/SpecialLw/SpecialAirLw plus a subset
 * of the move_logic callbacks. So `special_attributes` (ftDataMetalsonic+4, 0xD4 bytes, memcpy'd
 * by OnLoad) keeps the ftFox_DatAttrs layout that the vanilla callbacks read, while PlNm's own code
 * reads its tuning from the ftFunction block's rodata. Both sources are parsed here.
 *
 * Motions (341 + n, anim = action index − 48 in the engine keys):
 *  - 341-343 SpecialNStart/Loop/End have PlNm callbacks but nothing enters them (only M341_Anim
 *    itself does): both SpecialN exports enter 344, the aerial start, on the ground too.
 *  - 349 SpecialSEnd is Fox's and unreachable (PlNm's dash ends go to 352 directly).
 *  - 364/369 SpecialLwTurn are unreachable (PlNm nulls the reflector IASA that enters them).
 *  - Article slot 2 exists in the file but no PlNm code spawns it (both shot spawners pass
 *    item index 0 to the m-ex item-kind lookup). */
export interface MetalSonicSpecialData {
  kind: 'Nm';
  /** SpecialN → 344 (SpecialAirNStart) for both exports; M344_Anim/M341_IASA/M344_Phys, then
   * 345 (SpecialAirNLoop, the full-charge burst) or 346 (SpecialAirNEnd, the shot). */
  neutral: {
    /** M344_Anim: B released in [weakFrom, weakTo] ends with the weak shot, in [strongFrom,
     * strongTo] with the strong one; B held through strongTo plays the 152-frame start out into
     * the Loop. Before weakFrom a release waits for weakFrom. */
    weakFrom: number; weakTo: number; strongFrom: number; strongTo: number;
    /** M341_IASA: |stick x| at or past `driftStick` sets self_vel.x to ±drift (screen space). */
    driftStick: number; drift: number;
    /** M344_Phys / M342_Phys: ApplyFrictionAir. */
    friction: number;
    /** M344_Phys: ftCommon_Fall(gravity, negative terminal) floors the rise at −terminal, in four
     * frame bands (frames riseFrom..bLast apply both B and C, as the compiled chain does). */
    rise: { gravity: number; aLast: number; a: number; from: number; bLast: number; b: number; cLast: number; c: number; dFrom: number; d: number };
    /** M342_Phys (Loop and End): ftCommon_Fall(gravity, terminal). */
    fallGravity: number; fallTerminal: number;
    /** M344_Coll / M345_Coll → ftCo_LandingFallSpecial_Enter lag. */
    landing: number;
    /** M345_Anim: Fighter_TakeDamage on frame `selfDamageFrame`; at the end ftCo_80096900. */
    selfDamage: number; selfDamageFrame: number; loopMobility: number; loopLanding: number;
    /** Shot accessory callbacks: self_vel = gr_vel = −recoil·facing; item 0 from fp->parts[bone]
     * flying (±speed, 0); the strong one lives the article's x0, the weak one `weakLife`. */
    recoil: number; bone: number; strongSpeed: number; weakSpeed: number; weakLife: number;
  };
  /** Fox's SpecialSStart_Enter/SpecialAirSStart_Enter, PlNm's charge (347/350) and dash
   * (348/351) callbacks, Fox's SpecialAirSEnd (352). */
  side: {
    /** Fox block x24 (state_var1, counted down only by 352's phys) and x28 (entry speed divisor). */
    gravityDelay: number; divisor: number;
    /** M347/M350_IASA: release at frame ≥ frames[i] dashes at speeds[i] (highest first). */
    frames: number[]; speeds: number[];
    /** Held B freezes the charge (anim rate 0) at `freezeFrame`. */
    freezeFrame: number;
    /** M347/M350_Phys zero self_vel.x through frame `stillFrames`; M350_Phys falls at
     * (airGravity, airTerminal) with every jump spent. */
    stillFrames: number; airGravity: number; airTerminal: number;
    /** M350: shield cancel and anim end into ftCo_80096900(mobility, landing). */
    airMobility: number; airCancelLanding: number; airEndLanding: number;
    /** M348/M351_IASA: B/L/R/Z from `cancelFrame`; the ground dash leaves at (groundEndX,
     * groundEndY) into 352 (and lands on the spot), the air dash at airEndX. */
    cancelFrame: number; groundEndX: number; groundEndY: number; airEndX: number;
    /** Fox's SpecialAirSEnd: x40 air friction, x48 gravity, x4C mobility, x50 landing. */
    endFriction: number; endGravity: number; mobility: number; landing: number;
  };
  /** PlNm's SpecialHi exports (velocity zeroed, stale state_var1) into Fox's Firefox, with
   * M355_Anim ending the ground travel in special fall. */
  up: {
    /** Fox block: x5C/x60 hold friction/gravity, x64 aim threshold, x68 travel frames, x6C bound
     * threshold (int), x70 decel start, x74 speed, x78 decel, x7C landing friction, x84 bound
     * speed multiplier, x88 facing threshold, x8C/x90 special fall, x94 bound angle (deg). */
    holdFriction: number; holdGravity: number; stickMin: number; travel: number; boundFrames: number;
    decelAfter: number; speed: number; decel: number; landingFriction: number; boundSpeed: number;
    facingStick: number; mobility: number; landing: number; boundAngle: number;
    /** M355_Anim: ftCo_80096900(mobility, landing) once the ground travel's animation ends. */
    groundMobility: number; groundLanding: number;
  };
  /** PlNm's SpecialLw export and Fox's SpecialAirLw_Enter into Fox's Reflector, with PlNm's
   * anim wrappers (no reflector GFX), null IASA (no turn/jump/pass) and ground phys. */
  down: {
    /** Fox block: x98 release lag, xA4 gravity delay (int), xA8 air entry divisor, xAC fall. */
    releaseLag: number; gravityDelay: number; divisor: number; gravity: number;
    /** M360_Phys: ApplyFrictionGround on gr_vel only (self_vel is never refreshed). */
    groundFriction: number;
    /** xB0 ReflectDesc; `bone` is already the fp->parts entry's joint. */
    reflect: ReflectorData;
  };
}

/** Fighter part (fp->parts index) the shot callbacks read: `lwz r3, 0x160(bones)`. */
const SHOT_PART = 0x160 / 0x10;

export function parseMetalSonicParameters(arc: HsdArchive, profile: FighterProfile): MetalSonicSpecialData {
  const attrs = arc.pointer(arc.symbol('ftDataMetalsonic') + 4);
  const a = (o: number) => arc.f32(attrs + o), ai = (o: number) => arc.u32(attrs + o) | 0;
  // PlNm's ftFunction block: MEXFunction { code, relocs, … }; rodata sits after the code.
  const code = arc.pointer(arc.symbol('ftFunction'));
  const k = (o: number) => arc.f32(code + o);
  if (k(0x4f64) !== 0 || k(0x4f74) !== 1 || k(0x4fc4) !== 120) throw new Error('Unexpected original Metal Sonic code layout.');
  const reflectAt = attrs + 0xb0, reflectPart = arc.u32(reflectAt), reflectJoint = profile.partJoints[reflectPart];
  if (reflectJoint === undefined || reflectJoint < 0) throw new Error('Invalid original Metal Sonic reflector part.');
  const p: MetalSonicSpecialData = {
    kind: 'Nm',
    neutral: {
      weakFrom: k(0x4f80), weakTo: k(0x4f7c), strongFrom: k(0x4f84), strongTo: k(0x4f88),
      driftStick: k(0x4f54), drift: k(0x4f58), friction: k(0x4fb8),
      rise: { gravity: k(0x4f94), aLast: k(0x4fbc), a: k(0x4f60), from: k(0x4fc0), bLast: k(0x4f8c), b: k(0x4f90), cLast: k(0x4f98), c: k(0x4f9c), dFrom: k(0x4fa0), d: k(0x4fa4) },
      fallGravity: k(0x4fac), fallTerminal: k(0x4fa8), landing: k(0x4f84),
      selfDamage: k(0x4fbc), selfDamageFrame: k(0x4f74), loopMobility: k(0x4f78), loopLanding: k(0x4ff4),
      recoil: k(0x4ff8), bone: SHOT_PART, strongSpeed: k(0x4fcc), weakSpeed: k(0x4fdc), weakLife: k(0x4fbc),
    },
    side: {
      gravityDelay: Math.trunc(a(0x24)), divisor: a(0x28),
      // The 15-frame rung doubles facing (fadds f0,f0,f0) instead of loading a constant.
      frames: [k(0x4fc4), k(0x4fc8), k(0x4fa0), k(0x4fd0), k(0x4fd8), k(0x4fe0), k(0x4fe8), k(0x4f84)],
      speeds: [k(0x4fc0), k(0x4fbc), k(0x4fcc), k(0x4fd4), k(0x4fdc), k(0x4fe4), k(0x4fec), 2],
      freezeFrame: k(0x4fc4), stillFrames: k(0x4f74), airGravity: k(0x4f78), airTerminal: k(0x4fa8),
      airMobility: k(0x4f78), airCancelLanding: k(0x4f80), airEndLanding: k(0x4ff4),
      cancelFrame: k(0x4f68), groundEndX: k(0x4f6c), groundEndY: k(0x4f70), airEndX: 2,
      endFriction: a(0x40), endGravity: a(0x48), mobility: a(0x4c), landing: a(0x50),
    },
    up: {
      holdFriction: a(0x5c), holdGravity: a(0x60), stickMin: a(0x64), travel: Math.trunc(a(0x68)), boundFrames: ai(0x6c),
      decelAfter: a(0x70), speed: a(0x74), decel: a(0x78), landingFriction: a(0x7c), boundSpeed: a(0x84),
      facingStick: a(0x88), mobility: a(0x8c), landing: a(0x90), boundAngle: a(0x94),
      groundMobility: k(0x4f78), groundLanding: k(0x4ff4),
    },
    down: {
      releaseLag: Math.trunc(a(0x98)), gravityDelay: ai(0xa4), divisor: a(0xa8), gravity: a(0xac), groundFriction: k(0x4f78),
      reflect: {
        bone: reflectJoint, offset: [arc.f32(reflectAt + 8), arc.f32(reflectAt + 12), arc.f32(reflectAt + 16)], radius: arc.f32(reflectAt + 20),
        damageMultiplier: arc.f32(reflectAt + 24), speedMultiplier: arc.f32(reflectAt + 28), maxDamage: arc.u32(reflectAt + 4), keepOwner: arc.u8(reflectAt + 32) !== 0,
      },
    },
  };
  const n = p.neutral, s = p.side, u = p.up, d = p.down;
  const ladder = s.frames.every((frame, i) => frame > 0 && frame <= 300 && (i === 0 || frame < s.frames[i - 1]!)) && s.speeds.every((speed) => speed > 0 && speed < 20);
  if (!(n.weakFrom > 0 && n.weakFrom <= n.weakTo && n.weakTo < n.strongFrom && n.strongFrom <= n.strongTo && n.strongTo < 600)
    || n.drift <= 0 || n.friction < 0 || n.rise.gravity <= 0 || n.fallTerminal <= 0 || n.landing < 0 || n.selfDamage < 0 || n.selfDamage > 100
    || n.strongSpeed <= 0 || n.weakSpeed <= 0 || n.weakLife <= 0 || n.weakLife > 600 || !ladder || s.frames.length !== s.speeds.length
    || s.gravityDelay < 0 || s.gravityDelay > 600 || s.divisor <= 0 || s.landing < 0 || s.airEndLanding < 0 || s.cancelFrame < 0
    || u.travel < 1 || u.travel > 600 || u.boundFrames < 0 || u.boundFrames > 600 || u.speed <= 0 || u.speed > 20 || u.landing < 0 || u.groundLanding < 0
    || d.releaseLag < 0 || d.releaseLag > 600 || d.gravityDelay < 0 || d.gravityDelay > 600 || d.divisor <= 0
    || d.reflect.radius <= 0 || d.reflect.radius > 100 || d.reflect.maxDamage < 1 || d.reflect.maxDamage > 999)
    throw new Error('Unsupported original Metal Sonic special parameters.');
  return p;
}

/** Item 0 (the shot, itFunction:0 — straight flight, gone on any hit, shield or stage contact,
 * OnReflect restores the x0 lifetime) and slot 2, which is parsed for completeness but never
 * spawned by PlNm's code. */
export function parseMetalSonicArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  const shot = parseArticle(metadata, 0, 'metal-shot');
  const table = metadata.pointer([...metadata.symbols.values()][0]! + 0x48), special = metadata.pointer(metadata.pointer(table) + 4);
  const lifetime = special ? metadata.f32(special) : 0;
  if (!shot.hit || lifetime <= 0 || lifetime > 600) throw new Error('Unsupported original Metal Sonic shot article.');
  return { metal: { shot: { ...shot, lifetime }, spark: parseArticle(metadata, 2, 'metal-spark') } };
}

/** m-ex action table (anim id − 48): duplicates Wait1 x2 (2), Landing x3 (13). SpecialAirHi
 * (motion 356) plays the SpecialHi figatree; the Turn motions reuse Loop and are unreachable.
 * The grounded SpecialLwStart figatree (265) ships truncated in the 2.0 ISO (joint 4's Y
 * translation stream runs past its buffer), so motion 360 plays the aerial start (269): same
 * length (8 frames) and the same script (body state 2 on frames 6-7). */
export const METALSONIC_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  ...['SpecialNStart', 'SpecialNLoop', 'SpecialNEnd', 'SpecialAirNStart', 'SpecialAirNLoop', 'SpecialAirNEnd',
    'SpecialSStart', 'SpecialS', 'SpecialSEnd', 'SpecialAirSStart', 'SpecialAirS', 'SpecialAirSEnd',
    'SpecialHiHold', 'SpecialHiHoldAir', 'SpecialHi', 'SpecialHiLanding', 'SpecialHiFall', 'SpecialHiBound',
    'SpecialLwStart', 'SpecialLwLoop', 'SpecialLwHit', 'SpecialLwEnd', 'SpecialAirLwStart', 'SpecialAirLwLoop', 'SpecialAirLwHit', 'SpecialAirLwEnd',
  ].map((key, i) => key === 'SpecialLwStart' ? { key, index: 269, figatree: 'SpecialAirLwStart' } : { key, index: 247 + i, figatree: key }),
];

export const METALSONIC_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
