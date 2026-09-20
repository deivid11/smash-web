import { Matrix4, Vector3 } from 'three';
import type { HsdArchive } from '../hsd/archive.ts';
import type { V3 } from '../hsd/model.ts';
import { jointMatrix } from '../hsd/transform.ts';
import type { FighterContent } from './load.ts';
import type { HitDefinition } from './moves.ts';
import type { ArticleData, SpecialAssets } from './special-data.ts';
import { itemHit, parseArticle } from './special-data.ts';

/** Diddy Kong (ACE 2.0 m-ex fighter, PlDd, mexproj 028), ported from PlDd's compiled
 * `ftFunction`/`itFunction` (the block ships its debug symbols; local analysis covers
 * the fighter and it0-it2 for the popgun, peanut and banana). OnLoad copies
 * ftDataDiddy x4 (0x100 bytes) over special_attributes, so every tuning value below is read from
 * that block; the few numbers the code keeps as literals are read from its rodata and pinned.
 * Motions 341-374:
 *  - N (341-350): Peanut Popgun. The gun (article 0) is held on FtPart 0x1F from the start
 *    script's cmd0; B held in Charge/Danger counts the charge, release shoots (Gun_Shoot). Danger
 *    running out blows the gun up (Blow: 5% from its script, +5% more in the air from the code).
 *  - S (351/357 → 358 → 359 | 352-356): Monkey Flip. A fixed jump (x54, x58) whose element-8
 *    boxes grab a rival and cling to it (SpecialSStick); A/B kicks off (SStickAttack → the
 *    throw), jump leaps off (SStickJump → a spike throw); A/B during the jump kicks instead.
 *    The captive runs Diddy's Taro motions (369-374): grounded it mashes out, airborne it falls.
 *  - Hi (360-366): Rocketbarrel Boost. Charge while B is held (x6C frames at most), launch at
 *    90° ∓ (90 - xC0)·tilt with a speed by charge, then steer by the stick under full gravity;
 *    a ceiling crashes it (5% self damage).
 *  - Lw (367/368): Banana Peel. The banana (article 2) goes into his hand on cmd0 and is tossed
 *    behind him on cmd1; one banana at a time (ft_var2). Grounded rivals that walk over it trip. */
export interface DiddySpecialData {
  kind: 'Dd';
  neutral: {
    /** x0: the recoil/angle charge divides by (ft_var1 · x0), the rest by ft_var1 alone. */
    chargeFraction: number;
    /** Gun_Shoot lerps: x4/x8 speed, xC/x10 angle (rad), x14/x18 damage, x1C/x20 base knockback,
     * x24/x28 knockback growth, x2C/x30 recoil. */
    speed: [number, number]; angle: [number, number]; damage: [number, number]; base: [number, number]; growth: [number, number]; recoil: [number, number];
    /** Item_Hold(gun, Fighter_BoneLookup(fp, 0x1F)). */
    gunPart: number;
    /** SpecialAirNBlow_Enter: Fighter_TakeDamage(5) on top of the Blow script's own 5%. */
    airBlowDamage: number;
  };
  side: {
    /** SpecialAirSJump_Enter: self_vel = (x54 · facing, x58). */
    jump: [number, number];
    /** x44: LandingFallSpecial after the jump or the kick (fall mobility is the literal 1). */
    landing: number;
    /** OnVictimGrabbed: the captive's grab timer is capped at x48. */
    escapeMax: number;
    /** SpecialAirSStickWaitTaro_Phys: the captive falls by x4C to x50. */
    captiveGravity: number; captiveTerminal: number;
    /** SpecialSStickJump2_Enter (x34, x38) / SpecialSStickAttack2 on its release (x3C, x40). */
    jumpOff: [number, number]; kickOff: [number, number];
    /** SpecialSStickAttack2_Anim: self_vel.y after its Fall (rodata 0x3074). */
    kickFallSpeed: number;
  };
  up: {
    /** SpecialHiStart_IASA: |stick x| ≥ x64 turns him on the start's cmd0. */
    turnStick: number;
    /** SpecialHiCharge_IASA: charge counts while under x68, or under x6C while B is held. */
    chargeMin: number; chargeMax: number;
    /** SpecialAirHiStart/Charge_Phys: ftCommon_Fall(x70, x74). */
    gravity: number; terminal: number;
    /** Blend_ChargeAnimation: the tilt chases the stick by x78 and saturates at ±x7C. */
    tiltStep: number; tiltMax: number;
    /** SpecialAirJump_ApplyDrift: ftCommon_8007D174(stick·x84, stick·x88, x8C). */
    driftAccel: number; driftMax: number; driftFriction: number;
    /** SpecialAirHiJump_Enter: speed lerp x90..x94 by charge, angle 90° − (90° − xC0)·tilt. */
    speed: [number, number]; angleSpan: number;
    /** SpecialAirHiJump_Enter would rewrite an active hitbox 0 (x98/x9C damage, xA0/xA4 base,
     * xA8/xAC growth); the launch box is only created by the script afterwards, so it never fires. */
    launchDamage: [number, number]; launchBase: [number, number]; launchGrowth: [number, number];
    /** SpecialAirHiJump_Phys: while faster than x90 · 0.3 and rising, hitbox 1 deals xB0..xB4 with
     * base xB8..xBC by speed; otherwise every hitbox goes for good. */
    flightDamage: [number, number]; flightBase: [number, number]; flightFloor: number;
    /** Every xC4 flight frames two efSync xE0 at bone xDC (+ xE4..xEC, + xF0..xF8). */
    trailPeriod: number; trailEffect: number; trailBone: number; trailOffsets: [V3, V3];
    /** The XRotN lean turns by at most xC8 per frame toward the velocity. */
    turnRate: number;
    /** xD0/xD4: the special fall after the flight or the crash, and its landing. */
    mobility: number; landing: number;
    /** SpecialAirHiJump_Coll: a ceiling mirrors the velocity, scales it by 0.8 and deals 5%. */
    crashDamping: number; crashDamage: number;
  };
  down: {
    /** Banana_Release: Item_8026AC74 at (cos x60 · x5C · facing, sin x60 · x5C). */
    tossSpeed: number; tossAngle: number;
    /** Banana_Spawn: Fighter_PlayVoiceSFX(0x13A1). */
    voice: number;
  };
  /** OnFrame: per motion-state {state, from frame, rate}; the last matching entry wins. */
  animRates: ReadonlyArray<{ state: number; frame: number; rate: number }>;
}

/** Banana item (itFunction:2) literals: OnSpawn Item_SetLifeTimer(420); Trip_Check reaches
 * 5.5 (+ half the rival's jostle range) across and 1.0 up/down; Trip_Grabbed pops the banana at
 * (facing · 0.5, 1.7); Trip_Enter keeps 0.4 of the victim's speed and starts MissFoot at frame 3;
 * Trip_Anim bounds down at frame 14. */
export const DIDDY_BANANA = Object.freeze({ life: 420, reachX: 5.5, reachY: 1, popX: 0.5, popY: 1.7, tripSpeed: 0.4, tripStart: 3, tripBound: 14, tripSound: 0x10a });
/** Code efSync ids: the peanut's 0x1772 (m-ex 6000 + 2) on any contact; the Rocketbarrel crash's
 * efAsync 0x406 and efSync 0xEA. */
export const DIDDY_FX = Object.freeze({ peanut: 0x1772, crash: 0x406, crashSpark: 0xea });

/** ftFunction rodata the callbacks load (offsets from the code start), pinned below. */
const CODE = { zero: 0x3054, half: 0x305c, one: 0x3060, degrees: 0x306c, damage: 0x3070, kickFall: 0x3074 } as const;
const GUN_PART = 0x1f;

export function parseDiddyParameters(arc: HsdArchive): DiddySpecialData {
  const code = arc.pointer(arc.symbol('ftFunction'));
  const k = (o: number) => arc.f32(code + o);
  if (k(CODE.zero) !== 0 || k(CODE.half) !== 0.5 || k(CODE.one) !== 1 || k(CODE.degrees) !== 90 || k(CODE.damage) !== 5 || Math.fround(k(CODE.kickFall)) !== Math.fround(0.7))
    throw new Error('Unexpected original Diddy code layout.');
  const attrs = arc.pointer(arc.symbol('ftDataDiddy') + 4);
  const a = (o: number) => arc.f32(attrs + o), ai = (o: number) => arc.u32(attrs + o) | 0;
  const pair = (o: number): [number, number] => [a(o), a(o + 4)];
  const v3 = (o: number): V3 => [a(o), a(o + 4), a(o + 8)];
  const rates: Array<{ state: number; frame: number; rate: number }> = [];
  const table = arc.pointer(attrs + 0xfc);
  if (table) for (let entry = table; rates.length < 64; entry += 12) {
    const state = arc.u32(entry) | 0;
    if (state === -1) break;
    rates.push({ state, frame: arc.f32(entry + 4), rate: arc.f32(entry + 8) });
  }
  const p: DiddySpecialData = {
    kind: 'Dd',
    neutral: {
      chargeFraction: a(0x0), speed: pair(0x4), angle: pair(0xc), damage: pair(0x14), base: pair(0x1c), growth: pair(0x24), recoil: pair(0x2c),
      gunPart: GUN_PART, airBlowDamage: k(CODE.damage),
    },
    side: {
      jump: pair(0x54), landing: a(0x44), escapeMax: a(0x48), captiveGravity: a(0x4c), captiveTerminal: a(0x50),
      jumpOff: pair(0x34), kickOff: pair(0x3c), kickFallSpeed: k(CODE.kickFall),
    },
    up: {
      turnStick: a(0x64), chargeMin: a(0x68), chargeMax: a(0x6c), gravity: a(0x70), terminal: a(0x74), tiltStep: a(0x78), tiltMax: a(0x7c),
      driftAccel: a(0x84), driftMax: a(0x88), driftFriction: a(0x8c), speed: pair(0x90), angleSpan: a(0xc0),
      launchDamage: pair(0x98), launchBase: pair(0xa0), launchGrowth: pair(0xa8), flightDamage: pair(0xb0), flightBase: pair(0xb8), flightFloor: 0.3,
      trailPeriod: ai(0xc4), trailEffect: ai(0xe0), trailBone: ai(0xdc), trailOffsets: [v3(0xe4), v3(0xf0)],
      turnRate: a(0xc8), mobility: a(0xd0), landing: a(0xd4), crashDamping: 0.8, crashDamage: k(CODE.damage),
    },
    down: { tossSpeed: a(0x5c), tossAngle: a(0x60), voice: 0x13a1 },
    animRates: rates,
  };
  const n = p.neutral, s = p.side, u = p.up;
  const finite = [n.chargeFraction, ...n.speed, s.landing, s.escapeMax, s.captiveGravity, u.chargeMax, u.gravity, u.tiltMax, ...u.speed, u.mobility, u.landing, p.down.tossSpeed].every((v) => Number.isFinite(v) && v > 0);
  if (!finite || u.trailPeriod < 1 || u.trailPeriod > 60 || u.trailBone < 0 || u.trailBone > 200 || s.landing > 240 || u.landing > 240 || rates.length === 64)
    throw new Error('Invalid original Diddy special attributes.');
  return p;
}

/** Articles: 0 the popgun (held; state 2, the Blow, carries an 8% fire box on its joint 7 for two
 * frames), 1 the peanut (its hit is rewritten by Gun_Shoot), 2 the banana (3% while airborne).
 * `muzzle` is the gun's joint 7 (Gun_Shoot's JOBJ_GetChild(gun, 7)) in the gun root's rest frame,
 * i.e. relative to the hold part. */
export interface DiddyArticles { peanut: ArticleData; banana: ArticleData; gun: ArticleData; blast: HitDefinition | null; muzzle: V3 }
export function parseDiddyArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  const gun = parseArticle(metadata, 0, 'diddy-gun');
  const table = metadata.pointer([...metadata.symbols.values()][0]! + 0x48), states = metadata.pointer(metadata.pointer(table) + 12);
  const blastScript = metadata.pointer(states + 2 * 16 + 12);
  return { diddy: { peanut: parseArticle(metadata, 1, 'diddy-peanut'), banana: parseArticle(metadata, 2, 'diddy-banana'), gun, blast: blastScript ? itemHit(metadata, blastScript) : null, muzzle: jointRest(gun.model.roots[0]?.joints ?? [], 7) } };
}
function jointRest(joints: ReadonlyArray<{ parent: number; flags: number; rotation: V3; scale: V3; translation: V3 }>, index: number): V3 {
  if (joints.length <= index) throw new Error('Diddy popgun article has no muzzle joint.');
  const poses: Array<{ matrix: Matrix4; accumulated: V3 }> = [];
  for (const joint of joints) {
    const parent = joint.parent >= 0 ? poses[joint.parent] : undefined, parentScale = parent?.accumulated ?? [1, 1, 1];
    const accumulated: V3 = joint.flags & 8 ? [...parentScale] as V3 : [joint.scale[0] * parentScale[0], joint.scale[1] * parentScale[1], joint.scale[2] * parentScale[2]];
    const matrix = new Matrix4(); jointMatrix(matrix, joint.scale, joint.rotation, joint.translation, accumulated);
    if (parent) matrix.premultiply(parent.matrix);
    poses.push({ matrix, accumulated });
  }
  const point = new Vector3().setFromMatrixPosition(poses[index]!.matrix);
  return [Math.fround(point.x), Math.fround(point.y), Math.fround(point.z)];
}

/** Compacted action indices (the raw table has empties). Duplicates: Wait1 x2 (primary 2),
 * Landing x3 (primary 14). SpecialSKickLanding, SpecialSLanding, SpecialAirSFall and
 * SpecialAirHiJDamage are never entered by the code; the *Capture actions are the captive's. */
export const DIDDY_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 14, figatree: 'Landing' },
  ...([
    [247, 'SpecialNStart'], [248, 'SpecialNCharge'], [249, 'SpecialNDanger'], [250, 'SpecialNBlow'], [251, 'SpecialNShoot'],
    [252, 'SpecialAirNStart'], [253, 'SpecialAirNCharge'], [254, 'SpecialAirNDanger'], [255, 'SpecialAirNBlow'], [256, 'SpecialAirNShoot'],
    [257, 'SpecialSStart'], [260, 'SpecialSStick'], [261, 'SpecialSStickAttack'], [262, 'SpecialSStickAttack2'], [263, 'SpecialSStickJump'], [264, 'SpecialSStickJump2'],
    [265, 'SpecialAirSStart'], [266, 'SpecialAirSJump'], [267, 'SpecialAirSKick'],
    [269, 'SpecialHiStart'], [270, 'SpecialHiCharge'], [271, 'SpecialHiChargeF'], [272, 'SpecialHiChargeB'],
    [273, 'SpecialAirHiStart'], [274, 'SpecialAirHiCharge'], [275, 'SpecialAirHiChargeF'], [276, 'SpecialAirHiChargeB'], [277, 'SpecialAirHiJump'], [278, 'SpecialAirHiDamage'],
    [280, 'SpecialLw'], [281, 'SpecialAirLw'],
  ] as const).map(([index, key]) => ({ key, index, figatree: key })),
];

export const DIDDY_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  rapidStart: 'Attack100Start', rapidLoop: 'Attack100', rapidEnd: 'Attack100End',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
