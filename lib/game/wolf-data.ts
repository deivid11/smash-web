import { Matrix4, Vector3 } from 'three';
import type { HsdArchive } from '../hsd/archive.ts';
import type { V3 } from '../hsd/model.ts';
import { jointMatrix } from '../hsd/transform.ts';
import type { FighterContent } from './load.ts';
import type { FighterProfile } from './data.ts';
import type { ReflectorData, SpecialAssets } from './special-data.ts';
import { parseArticle } from './special-data.ts';

/** Wolf (ACE 2.0 m-ex fighter, PlWf, mexproj 027) and Wolf SSBU (PlWfU, CSS slot 052, the same
 * compiled ftFunction byte for byte). The kit runs on Fox's motion slots 341-369,
 * decoded locally from the ftFunction block and it0/it1 from itFunction:
 *  - OnLoad memcpy's 0xD4 bytes of ftFunction rodata (block offset 0xB2C) over
 *    special_attributes, so the tuning lives in the code block in ftFox_DatAttrs layout, not in
 *    ftDataWolf. Both are read from the block below.
 *  - SpecialN/SpecialAirN (341/344): the gun (article 1) is held on FtPart 0x43 for the whole
 *    move; each script command-1 = 1 fires the laser (article 0) from the gun's joint 5. There
 *    is no charge or loop (342/343/345/346 are Fox's, unreachable).
 *  - SpecialS (347/350 → 351 → 352): Wolf Flash. The dash (351) flies on the clip's TransN
 *    (72 forward, 24 up) turned by up to ±10° of stick; B cuts it; the end slash (352) falls
 *    special unless it connected, which instead gives the double jump back.
 *  - SpecialHi (353/354 → 355/356 → 357/358/359): Fox's Firefox with Wolf's numbers.
 *  - SpecialLw (360-369): Fox's Reflector with Wolf's wrappers: jump-cancellable loop, a turn
 *    (364/369), a hit that always returns to the loop, and a two-frame intangible start hit. */
export interface WolfSpecialData {
  kind: 'Wf';
  neutral: {
    /** itFunction:0 OnCreate life (ptr_00278) and fn_0281c's speed (ptr_03b94); the laser's
     * Anim rewrites its velocity from these every frame. */
    laserSpeed: number; laserLife: number;
    /** sub_03aac: Item_Hold(gun, fighter, 0x43). */
    gunPart: number;
  };
  side: {
    /** x24 (state_var1 no-gravity frames) and x28 (entry speed divisor). */
    gravityDelay: number; divisor: number;
    /** M350_Phys: x2C air friction, then x30 gravity capped at x60. */
    startFriction: number; startGravity: number; startTerminal: number;
    /** sub_02a34: |stick y| past `tiltStick` tilts the dash by up to `tiltMax` radians. */
    tiltStick: number; tiltMax: number;
    /** sub_02bdc: SpecialAirSEnd leaves at x3C·facing, x44 frames of x40 friction, then x48 gravity. */
    endSpeed: number; endDelay: number; endFriction: number; endGravity: number;
    /** M352_Anim / M352_Coll: special fall (x4C, x50) and its landing. */
    mobility: number; landing: number;
  };
  up: {
    /** x54 no-gravity frames, x58 entry divisor, x5C/x60 hold friction/gravity. */
    gravityDelay: number; divisor: number; holdFriction: number; holdGravity: number;
    /** ptr_02690: |x|+|y| past it aims; x88 turns the facing; x68 travel frames. */
    stickMin: number; facingStick: number; travel: number;
    /** x6C: ground frames before a floor stops bouncing; x70 decel start; x74 speed; x78 decel. */
    boundFrames: number; decelAfter: number; speed: number; decel: number;
    /** x7C SpecialHiLanding friction, x84 bound speed, x94 bound angle (deg). */
    landingFriction: number; boundSpeed: number; boundAngle: number;
    /** x8C/x90 special fall. */
    mobility: number; landing: number;
    /** sub_030ec / sub_03328: SpecialHiLanding start frame from the ground travel / from a fall. */
    groundEndFrame: number; fallLandFrame: number;
  };
  down: {
    /** x98 release lag, x9C turn frames, xA4 gravity delay (int), xA8 air divisor, xAC gravity. */
    releaseLag: number; turnFrames: number; gravityDelay: number; divisor: number; gravity: number;
    /** xB0 ReflectDesc; `bone` is already the fp->parts entry's joint. */
    reflect: ReflectorData;
  };
}

/** Rodata inside the ftFunction code block (offsets from the code start). */
const ATTRS = 0xb2c;
const CODE = { zero: 0x267c, one: 0x2680, tiltStick: 0x2684, aimStick: 0x2690, laserSpeed: 0x3b94, tiltDegrees: 0x3ba0, groundEndFrame: 0x3d04, fallLandFrame: 0x3d08 } as const;
/** itFunction:0 rodata: OnCreate's Item_SetLifeTimer(25). The ftFunction block is identical
 * in PlWf and PlWfU; the check below pins it. */
const LASER_LIFE = 25;
const GUN_PART = 0x43;

export function parseWolfParameters(arc: HsdArchive, profile: FighterProfile): WolfSpecialData {
  const code = arc.pointer(arc.symbol('ftFunction'));
  const k = (o: number) => arc.f32(code + o);
  if (k(CODE.zero) !== 0 || k(CODE.one) !== 1 || Math.fround(k(CODE.laserSpeed)) !== Math.fround(2.3) || k(CODE.groundEndFrame) !== 13 || k(CODE.fallLandFrame) !== 14)
    throw new Error('Unexpected original Wolf code layout.');
  const attrs = code + ATTRS;
  const a = (o: number) => arc.f32(attrs + o), ai = (o: number) => arc.u32(attrs + o) | 0;
  const reflectAt = attrs + 0xb0, reflectJoint = profile.partJoints[arc.u32(reflectAt)];
  if (reflectJoint === undefined || reflectJoint < 0) throw new Error('Invalid original Wolf reflector part.');
  const p: WolfSpecialData = {
    kind: 'Wf',
    neutral: { laserSpeed: k(CODE.laserSpeed), laserLife: LASER_LIFE, gunPart: GUN_PART },
    side: {
      gravityDelay: Math.trunc(a(0x24)), divisor: a(0x28), startFriction: a(0x2c), startGravity: a(0x30), startTerminal: a(0x60),
      tiltStick: k(CODE.tiltStick), tiltMax: Math.fround(k(CODE.tiltDegrees) * 0.0174533),
      endSpeed: a(0x3c), endDelay: Math.trunc(a(0x44)), endFriction: a(0x40), endGravity: a(0x48), mobility: a(0x4c), landing: a(0x50),
    },
    up: {
      gravityDelay: Math.trunc(a(0x54)), divisor: a(0x58), holdFriction: a(0x5c), holdGravity: a(0x60),
      stickMin: k(CODE.aimStick), facingStick: a(0x88), travel: Math.trunc(a(0x68)),
      boundFrames: ai(0x6c), decelAfter: a(0x70), speed: a(0x74), decel: a(0x78),
      landingFriction: a(0x7c), boundSpeed: a(0x84), boundAngle: a(0x94), mobility: a(0x8c), landing: a(0x90),
      groundEndFrame: k(CODE.groundEndFrame), fallLandFrame: k(CODE.fallLandFrame),
    },
    down: {
      releaseLag: Math.trunc(a(0x98)), turnFrames: Math.trunc(a(0x9c)), gravityDelay: ai(0xa4), divisor: a(0xa8), gravity: a(0xac),
      reflect: {
        bone: reflectJoint, offset: [arc.f32(reflectAt + 8), arc.f32(reflectAt + 12), arc.f32(reflectAt + 16)], radius: arc.f32(reflectAt + 20),
        damageMultiplier: arc.f32(reflectAt + 24), speedMultiplier: arc.f32(reflectAt + 28), maxDamage: arc.u32(reflectAt + 4), keepOwner: arc.u8(reflectAt + 32) !== 0,
      },
    },
  };
  const { side: s, up: u, down: d } = p;
  const finite = [s.divisor, s.startGravity, s.endSpeed, u.divisor, u.speed, u.decel, d.divisor, d.gravity, d.reflect.radius].every((v) => Number.isFinite(v) && v > 0);
  if (!finite || s.gravityDelay < 0 || s.gravityDelay > 120 || u.travel < 1 || u.travel > 240 || d.releaseLag < 0 || d.releaseLag > 240
    || d.turnFrames < 1 || d.turnFrames > 60 || d.reflect.maxDamage < 1 || d.reflect.maxDamage > 999)
    throw new Error('Invalid original Wolf special attributes.');
  return p;
}

/** Slots: 0 laser (3%), 1 gun (held model, no hit). `muzzle` is the gun's joint 5 (fn_0281c's
 * JOBJ_GetChild(gun, 5)) in the gun root's rest frame, i.e. relative to the hold part. */
export function parseWolfArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  const laser = parseArticle(metadata, 0, 'wolf-laser'), gun = parseArticle(metadata, 1, 'wolf-gun');
  return { wolf: { laser, gun, muzzle: gunMuzzle(gun.model.roots[0]?.joints ?? []) } };
}
function gunMuzzle(joints: ReadonlyArray<{ parent: number; flags: number; rotation: V3; scale: V3; translation: V3 }>): V3 {
  if (joints.length <= 5) throw new Error('Wolf gun article has no muzzle joint.');
  const poses: Array<{ matrix: Matrix4; accumulated: V3 }> = [];
  for (const joint of joints) {
    const parent = joint.parent >= 0 ? poses[joint.parent] : undefined, parentScale = parent?.accumulated ?? [1, 1, 1];
    const accumulated: V3 = joint.flags & 8 ? [...parentScale] as V3 : [joint.scale[0] * parentScale[0], joint.scale[1] * parentScale[1], joint.scale[2] * parentScale[2]];
    const matrix = new Matrix4(); jointMatrix(matrix, joint.scale, joint.rotation, joint.translation, accumulated);
    if (parent) matrix.premultiply(parent.matrix);
    poses.push({ matrix, accumulated });
  }
  const point = new Vector3().setFromMatrixPosition(poses[5]!.matrix);
  return [Math.fround(point.x), Math.fround(point.y), Math.fround(point.z)];
}

/** m-ex duplicates: Wait1 x2 (primary 2), Landing x3 (primary 13),
 * SpecialNStart x3 (primary 244, the only variant with hits). */
export const WOLF_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 244, figatree: 'SpecialNStart' },
  { key: 'SpecialAirNStart', index: 247, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoop', index: 248, figatree: 'SpecialAirNLoop' },
  { key: 'SpecialAirNEnd', index: 249, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialSStart', index: 250, figatree: 'SpecialSStart' },
  { key: 'SpecialS', index: 251, figatree: 'SpecialS' },
  { key: 'SpecialSEnd', index: 252, figatree: 'SpecialSEnd' },
  { key: 'SpecialAirSStart', index: 253, figatree: 'SpecialAirSStart' },
  { key: 'SpecialAirS', index: 254, figatree: 'SpecialAirS' },
  { key: 'SpecialAirSEnd', index: 255, figatree: 'SpecialAirSEnd' },
  { key: 'SpecialHiHold', index: 256, figatree: 'SpecialHiHold' },
  { key: 'SpecialHiHoldAir', index: 257, figatree: 'SpecialHiHoldAir' },
  { key: 'SpecialHi', index: 258, figatree: 'SpecialHi' },
  { key: 'SpecialHiLanding', index: 259, figatree: 'SpecialHiLanding' },
  { key: 'SpecialHiFall', index: 260, figatree: 'SpecialHiFall' },
  { key: 'SpecialHiBound', index: 261, figatree: 'SpecialHiBound' },
  { key: 'SpecialLwStart', index: 262, figatree: 'SpecialLwStart' },
  { key: 'SpecialLwLoop', index: 263, figatree: 'SpecialLwLoop' },
  { key: 'SpecialLwHit', index: 264, figatree: 'SpecialLwHit' },
  { key: 'SpecialLwEnd', index: 265, figatree: 'SpecialLwEnd' },
  { key: 'SpecialAirLwStart', index: 266, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialAirLwLoop', index: 267, figatree: 'SpecialAirLwLoop' },
  { key: 'SpecialAirLwHit', index: 268, figatree: 'SpecialAirLwHit' },
  { key: 'SpecialAirLwEnd', index: 269, figatree: 'SpecialAirLwEnd' },
];
/** PlWfU.dat table: same duplicate structure (Wait1 x2 primary 2, Landing x3
 * primary 13, SpecialNStart x3 with only the first carrying hits at 245);
 * every special sits one index later than PlWf.dat (verified per-entry). */
export const WFU_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 245, figatree: 'SpecialNStart' },
  ...WOLF_ACTION_KEYS.filter((entry) => entry.index >= 247).map((entry) => ({ ...entry, index: entry.index + 1 })),
];

export const WOLF_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
