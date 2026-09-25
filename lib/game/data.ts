import { Matrix4, Vector3 } from 'three';
import { HsdArchive, linkedList } from '../hsd/archive.ts';
import { jointMatrix } from '../hsd/transform.ts';
import type { V3 } from '../hsd/model.ts';
import { MODDED_BONE_TABLES } from './modded-bones.ts';

export const COMMON_WORDS = [0x28, 0x2c, 0x30, 0x5c, 0x60, 0x6c, 0xf4, 0xf8, 0xfc, 0x100, 0x104, 0x108, 0x10c, 0x110, 0x114, 0x118, 0x11c, 0x120, 0x144, 0x148, 0x14c, 0x150, 0x154, 0x194, 0x198, 0x19c, 0x1a0, 0x200, 0x204, 0x438, 0x440, 0x7e8, 0x7ec, 0x7f0] as const;
import type { CustomFighterKind } from '../custom/identity.ts';
/** Fighters read from the disc through their own PlXX archives; local packs are separate. */
export type OriginalFighterKind = 'Fx' | 'Mr' | 'Kb' | 'Ss' | 'Pk' | 'Lk' | 'Cl' | 'Fe' | 'Mt' | 'Ca' | 'Dk' | 'Pr' | 'Ns' | 'Kp' | 'Pe' | 'Fc' | 'Dr' | 'Gn' | 'Pc' | 'Ms' | 'Lg' | 'Ys' | 'Pp' | 'Zd' | 'Sk' | 'Gw' | 'Zx' | 'Td' | 'Mk' | 'Sn' | 'Rc' | 'Lz' | 'Wf' | 'Dd' | 'De' | 'Wr' | 'Sh' | 'Bl' | 'Lc' | 'Nm' | 'Nt' | 'Da' | 'Fy' | 'Sc' | 'Dl' | 'Kx' | 'Lu' | 'Lc2' | 'Sm' | 'Lb' | 'MM' | 'Sd' | 'Cn' | 'Gk' | 'Ts' | 'Bf' | 'WfU';
/** Clone slots ride another fighter's data/animation archives: the ACE 2.0 disc ships
 * no `PlBf.dat` (Blood Falcon reuses Captain Falcon's moveset verbatim), and Wolf
 * SSBU/playable Giga Bowser keep the donor naming only for some of their files.
 * Model files (`Nr`/costumes) resolve through lib/game/costumes.ts instead. */
export const FIGHTER_FILE_OVERRIDES: Partial<Record<OriginalFighterKind, { dat?: string; aj?: string }>> = {
  Bf: { dat: 'PlCa.dat', aj: 'PlCaAJ.dat' },
};
export function fighterDatFile(kind: OriginalFighterKind): string { return FIGHTER_FILE_OVERRIDES[kind]?.dat ?? `Pl${kind}.dat`; }
export function fighterAjFile(kind: OriginalFighterKind): string { return FIGHTER_FILE_OVERRIDES[kind]?.aj ?? `Pl${kind}AJ.dat`; }
export type FighterKind = OriginalFighterKind | CustomFighterKind;
/** Native FTKIND indices from third_party/melee/src/melee/ft/forward.h and the visible names.
 * Zero (Zx) is an ACE 2.0 m-ex fighter with no vanilla FTKIND; he is authored on Link's
 * PlyLink5K skeleton and part table, so he carries Link's native index for bone mapping. */
export const ORIGINAL_FIGHTERS: Readonly<Record<OriginalFighterKind, { name: string; nativeKind: number }>> = Object.freeze({
  Fe: { name: 'Roy', nativeKind: 26 }, Mr: { name: 'Mario', nativeKind: 0 }, Fx: { name: 'Fox', nativeKind: 1 }, Kb: { name: 'Kirby', nativeKind: 4 }, Ss: { name: 'Samus', nativeKind: 13 }, Pk: { name: 'Pikachu', nativeKind: 12 }, Lk: { name: 'Link', nativeKind: 6 }, Cl: { name: 'Young Link', nativeKind: 20 }, Dk: { name: 'Donkey Kong', nativeKind: 3 }, Ca: { name: 'Captain Falcon', nativeKind: 2 }, Mt: { name: 'Mewtwo', nativeKind: 16 }, Pr: { name: 'Jigglypuff', nativeKind: 15 }, Ns: { name: 'Ness', nativeKind: 8 }, Kp: { name: 'Bowser', nativeKind: 5 }, Pe: { name: 'Peach', nativeKind: 9 },
  Fc: { name: 'Falco', nativeKind: 22 }, Dr: { name: 'Dr. Mario', nativeKind: 21 }, Gn: { name: 'Ganondorf', nativeKind: 25 }, Pc: { name: 'Pichu', nativeKind: 23 }, Ms: { name: 'Marth', nativeKind: 18 },
  Lg: { name: 'Luigi', nativeKind: 17 }, Ys: { name: 'Yoshi', nativeKind: 14 }, Pp: { name: 'Ice Climbers', nativeKind: 10 }, Zd: { name: 'Zelda', nativeKind: 19 }, Sk: { name: 'Sheik', nativeKind: 7 }, Gw: { name: 'Mr. Game & Watch', nativeKind: 24 },
  Zx: { name: 'Zero', nativeKind: 6 },
  // ACE fighters with custom skeletons carry no meaningful native index (-1); their
  // bone tables come from MODDED_BONE_TABLES, never from PlCo.
  Td: { name: 'Toad', nativeKind: -1 }, Mk: { name: 'Meta Knight', nativeKind: -1 }, Sn: { name: 'Sonic', nativeKind: -1 }, Rc: { name: 'Raichu', nativeKind: -1 }, Lz: { name: 'Charizard', nativeKind: -1 },
  Wf: { name: 'Wolf', nativeKind: -1 }, Dd: { name: 'Diddy Kong', nativeKind: -1 }, De: { name: 'King Dedede', nativeKind: -1 }, Wr: { name: 'Wario', nativeKind: -1 }, Sh: { name: 'Shadow', nativeKind: -1 },
  Bl: { name: 'Blastoise', nativeKind: -1 }, Lc: { name: 'Lucas', nativeKind: -1 }, Nm: { name: 'Metal Sonic', nativeKind: -1 }, Nt: { name: 'Ninten', nativeKind: -1 }, Da: { name: 'Daisy', nativeKind: -1 },
  Fy: { name: 'Fay', nativeKind: -1 }, Sc: { name: 'Sonic BM', nativeKind: -1 }, Dl: { name: 'Dr. Luigi', nativeKind: -1 }, Kx: { name: 'Knuckles', nativeKind: -1 }, Lu: { name: 'Lucina', nativeKind: -1 },
  Lc2: { name: 'Lucas TDX', nativeKind: -1 }, Sm: { name: 'Shadow Mewtwo', nativeKind: -1 }, Lb: { name: 'Luigi & Boo', nativeKind: -1 }, MM: { name: 'Metal Mario', nativeKind: -1 }, Sd: { name: 'Skull Kid', nativeKind: -1 },
  Cn: { name: 'Chun-Li', nativeKind: -1 },
  // Giga Bowser rides Bowser's part table (verified: 76 model joints each,
  // same Koopa family motion order); Zero precedent (rides Link's table).
  Gk: { name: 'Giga Bowser', nativeKind: 5 },
  Ts: { name: 'Tails', nativeKind: -1 },
  // Blood Falcon (ACE CSS slot 045) is a pure Captain Falcon clone: PlCa.dat
  // moveset on the vanilla PlyCaptain5K skeleton, own PlBf* costume models.
  Bf: { name: 'Blood Falcon', nativeKind: 2 },
  // Wolf SSBU (ACE CSS slot 052): own PlWfU.dat/PlWfUAJ.dat moveset on Wolf's
  // 74-part modded skeleton (PlWfNr_001.dat model variants).
  WfU: { name: 'Wolf SSBU', nativeKind: -1 },
});
/** Original fighter part table: common-part → fighter-part map plus the parts that own no model joint. */
export interface BoneTable { count: number; map: number[]; virtualParts: number[]; virtualAttachments?: Array<{part:number;parent:number;mode:number;tree:number}>; partJoints: number[]; jointCount: number }
export interface CommonGameplayData {
  words: Array<[number, number]>;
  /** ftCommonData.x21C: directional branch threshold for sword-dance chains. */
  specialBranchThreshold?: number;
  /** x58: |stick| below it brakes a run; x38: stick·facing at or below it turns a run around. */
  runBrakeStick?: number; runTurnStick?: number;
  /** x34: stick·facing at or below it turns (ftCo_800C97A8, the special-state turn checks). */
  turnStick?: number;
  stickDeadzone: number; walkThreshold:number; dashThreshold:number; chargeSoundFrame:number; chargeVulnerability:number; fastFallThreshold: number; fastFallWindow: number; nudgeSpeed: number;
  boneMaps: Record<OriginalFighterKind, BoneTable>;
  /** ftLoadCommonData[1], through LightThrowAirLw4 (12-byte entries). */
  itemThrows?: ReadonlyArray<{ speed: number; angle: number }>;
  itemSmashAnimationRate?: number;
  smashInputWindow?: number;
  /** PlCo x40: exclusive stick-tilt age limit for ftCo_Dash_CheckInput (not x40 + x44). */
  dashInputWindow?: number;
  /** PlCo x54: proportional ground-velocity reduction when Dash IASA changes action. */
  dashExitFriction?: number;
  /** PlCo x44: initial Dash (entry arg1=1) cannot reverse while anim_frame <= this. */
  dashInitialLockout?: number;
  /** PlCo x48: an initial Dash rolls forward (EscapeF) from a held shield while anim_frame <= this. */
  dashRollWindow?: number;
  /** PlCo x4C: Dash accepts side-B, the dash attack and ftCo_80091AD8 guard while anim_frame <= this. */
  dashActionWindow?: number;
  lCancel?: { window: number; divisor: number };
  /** ftCo_Damage recovery inputs: x1D0 hitstun jump buffer, x1C anti-mash press gap and the
   * x7E8/x7EC/x7F0 meteor-cancel angle range and lockout. */
  hitstunRecovery?: { jumpBuffer: number; pressGap: number; meteorAngleMin: number; meteorAngleMax: number; meteorLockout: number };
  itemInput?: { smashDeadX:number;smashDeadY:number;angle:number;side:number;up:number;down:number;smashUp:number;smashDown:number;upWindow:number;downWindow:number;airWindow:number;neutralX:number;neutralY:number };
  /** Item-status constants: ftLoadCommonData[12..14] modifier tables (size, Bunny Hood,
   * metal; ftCo_800D105C) and the ftCommonData mushroom/Warp Star/Hammer/metal/cloak fields. */
  itemStatus?: ItemStatusCommon;
  /** ftLoadCommonData[21] (gCrowdConfig): the crowd reaction thresholds read by sfx/crowdsfx.c. */
  crowd?: CrowdConfig;
}
/** gCrowdConfig (third_party/melee/src/melee/sfx/crowdsfx.h), PlCo ftLoadCommonData[21]. */
export interface CrowdConfig {
  /** x0/x4/x8: knockback magnitude for crowd category 1/2/3. */
  kbLow: number; kbMid: number; kbHigh: number;
  /** xC/x10/x14: launch angles (radians) strictly inside (min, max) scale the magnitude by angleMult. */
  angleMin: number; angleMax: number; angleMult: number;
  /** x18: frames a repeat hit from the same attacker still counts as the same flurry. */
  comboFrames: number;
  /** x1C: percent the attacker needs before the crowd will chant their name. */
  chantPercent: number;
  /** x20: frames of quiet (no chant) before another chant may start. */
  cheerLimit: number;
  /** x24: chant repeats that must already have played before a hit may interrupt it. */
  chantInterruptAfter: number;
  /** x28: chant repeats before the closing cheer (also the idle marker). */
  maxChants: number;
  /** x2C: horizontal margin inside the floor extents that counts as "near the edge". */
  edgeMargin: number;
  /** x30/x34/x38: helpless-fall heights (relative to the lowest floor) for gasp category 3/2/1. */
  recoveryHigh: number; recoveryMid: number; recoveryLow: number;
  /** x3C: fighters below the lowest floor + blastOffset that make the whole crowd gasp. */
  nearBlastCount: number; blastOffset: number;
}
export interface ItemStatusCommon {
  /** Fighter_804D6524 (x0..x98): per-attribute ftCo_CalcYScaledKnockback factors for scaled fighters. */
  sizeMods: number[];
  /** Fighter_804D6520: Bunny Hood multipliers (x0 walk … x38 wall-jump y). */
  bunny: number[];
  /** Fighter_804D651C: metal multipliers (x4 jump … x20 wall-jump y). */
  metal: number[];
  giantScale: number; giantScaleLarge: number; smallScale: number; smallScaleLarge: number; // x678/x67C/x680/x684
  sizeFrames: number; sizeBonusFrom: number; sizeBonusMax: number;                          // x688/x68C/x690
  warpGravity: number; warpTerminal: number; warpDriftScale: number; warpDriftFlat: number; warpDriftMax: number; warpFriction: number; // x694-x6A8
  hammerFrames: number; metalArmor: number; cloakFrames: number;                              // x6AC/x6F0/x7CC
  screwJump: number;                                                                           // x800
}
export interface HurtDefinition { bone: number; a: V3; b: V3; radius: number; grabbable?:boolean }
export interface FighterAttributes {
  walkSpeed: number; walkAnimationScaling:[number,number,number]; dashInitial: number; runSpeed: number; friction: number;
  jumpStartup: number; jumpSpeed: number; hopSpeed: number; gravity: number; terminal: number;
  maxJumps: number; modelScale: number; weight: number; runAnimationScaling: number; airFriction: number;
  airDriftStickMul: number; airDriftMax: number;
  landingLag: number; aerialLandingLag: number; aerialForwardLandingLag: number; aerialBackLandingLag: number; aerialUpLandingLag: number; aerialDownLandingLag: number;
  jab2Window: number; jab3Window: number; rapidJabThreshold: number;
  itemThrowVelocity?: number;
  shieldSize: number; shieldBreakY: number; ledgeJumpX: number; ledgeJumpY: number; independentThrows: number;
  /** ftCo_DatAttrs x14C/x158/x15C: the fighter's own ice-block radius and the pop-out hop it
   * takes when the block breaks. Absent on custom fighters, which fall back to the common size. */
  iceSize?: number; iceJumpY?: number; iceJumpX?: number;
}
/** Bone indices in a profile are MODEL JOINT indices. Original scripts and tables use
 * fighter PART indices; `partJoints` translates them once at parse time, so a part
 * without a joint (Kirby's hat slots) can never be referenced by gameplay data. */
export interface FighterProfile {
  kind: FighterKind; name: string; attributes: FighterAttributes; words: Uint32Array;
  itemHoldBone?: number; itemPickup?: { ground:[number,number,number,number]; air:[number,number,number,number] };
  hurts: HurtDefinition[]; boneMap: number[]; boneCount: number; partJoints: number[]; motionRoot: number;
  nudgeOffset: number; nudgeRadius: number; shieldBone: number; ledgeSnap: { x:number; y:number; height:number };
  /** co_attrs.hit_spark_variant (attributes +0xA0): 0 lets ftColl_80078538 add the random 1007 sparkle when this fighter is hit. Absent on custom fighters. */
  hitSparkVariant?: number;
  /** Original draw-object visibility (ftData x8, costume 0): `groups` are set 0's alternatives
   * (group → alternative → dobj ordinals); `hidden` lists every ordinal the game hides at
   * spawn (sets 0, 1 and 3), so only the selected alternative of each group is drawn. */
  partVisibility: { groups: number[][][]; hidden: number[] };
  /** ftData x3C camera box (unscaled; ftCamera_80076018 multiplies by the model scale) plus the
   * co_attrs x16C/x170 camera bone and offset (ftLib_800866DC). Absent on custom fighters. */
  cameraBox?: FighterCameraBox;
  /** ftData x4C → FtSFX x34: the crowd chant (ftLib_8008746C); 540000 when the fighter has none. */
  chantSound?: number;
}
export interface FighterCameraBox {
  /** x0: camera subject height above the feet. */
  yOffset: number;
  /** x4/x8: horizontal extents ahead of/behind the facing; xC/x10: above/below the subject. */
  front: number; back: number; top: number; bottom: number;
  /** x14 (target_ext.v.z): ifMagnify zooms its ortho view by this / 8. */
  magnify: number;
  /** Model joint of the camera bone (bone_pos), and the offset in that joint's space. */
  joint: number; offset: V3;
}
export interface Floor { id: number; a: [number, number]; b: [number, number]; oneWay: boolean }
/** Ground height of a floor segment at x, clamped to its span. Near-flat segments
 * (the previous slice's only supported shape) keep returning a[1] exactly, so
 * flat-stage simulation stays bit-identical to the horizontal-only adapter. */
export function floorY(floor: Pick<Floor, 'a' | 'b'>, x: number): number {
  const [ax, ay] = floor.a, [bx, by] = floor.b;
  if (Math.abs(ay - by) <= 0.01) return ay;
  const t = Math.max(0, Math.min(1, (x - ax) / (bx - ax)));
  return Math.fround(ay + (by - ay) * t);
}
/** Worst supported rise per unit of horizontal motion, used by the ground-follow
 * tolerance. Steepest verified original floor: Pokémon Stadium's frozen windmill
 * blades at 2.0 (Temple's ramps stay under 1.11). */
export const MAX_FLOOR_SLOPE = 2.5;
export interface Ledge { id:number; floor:number; x:number; y:number; facing:number }
export interface StageSurface extends Floor { kind: 'floor'|'wall'|'ceiling' }
export interface StageGameplayData {
  scale: number; floors: Floor[];
  /** Native static map segments used by item/tether collision, not a replacement fighter ECB. */
  surfaces?: StageSurface[];
  blast: { left: number; right: number; top: number; bottom: number };
  spawns: [V3, V3, ...V3[]]; mainLeft: number; mainRight: number; ledges:Ledge[];
  /** Stage_GetCamBounds*Offset: the camera range in world units (offsets applied). Absent on
   * hand-built stages; readers fall back to STAGE_CAMERA_DEFAULT. */
  camera?: StageCameraBounds;
  /** grGroundParam xB8..xD8: the ifMagnify background colours (RGBA) as a 3×3 grid, row-major
   * from top-left: ifMagnify_802FBBDC blends the four around the fighter's camera-range cell. */
  magnifyColors?: readonly number[];
}
export interface StageCameraBounds { left: number; right: number; top: number; bottom: number }
/** Ground_801C39C0 "use dummy CamRange" default when a stage has no 0x94-0x96 points (Pokémon Stadium). */
export const STAGE_CAMERA_DEFAULT: Readonly<StageCameraBounds> = Object.freeze({ left: -170, right: 170, top: 120, bottom: -60 });
const vec = (arc: HsdArchive, offset: number): V3 => [arc.f32(offset), arc.f32(offset + 4), arc.f32(offset + 8)];
function finiteRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Unsupported gameplay ${label}: ${value}`);
  return value;
}

export function parseCommonGameplay(arc: HsdArchive): CommonGameplayData {
  const root = arc.symbol('ftLoadCommonData');
  const common = arc.pointer(root), parts = arc.pointer(root + 16), virtualTable = arc.pointer(root + 20);
  const boneMap = (kind: number): BoneTable => {
    const table = arc.pointer(parts + kind * 4), count = arc.u32(table + 8), mapping = arc.pointer(table + 4);
    if (count < 1 || count > 256) throw new Error('Invalid fighter bone mapping.');
    const map = [...arc.slice(mapping, Math.min(54, arc.extent(mapping)))];
    if (map.length < 54 || map.some((joint) => joint !== 255 && joint >= count)) throw new Error('Invalid common-to-joint mapping.');
    // ftParts_SetupParts skips the parts listed in Fighter_804D6540 (no JObj is consumed).
    const entry = arc.pointer(virtualTable + kind * 4), virtualParts: number[] = [], virtualAttachments:Array<{part:number;parent:number;mode:number;tree:number}>=[];
    if (entry) {
      const list = arc.pointer(entry), size = arc.u32(entry + 4);
      if (size > 64) throw new Error('Invalid fighter virtual part table.');
      for (let i = 0; i < size; i++) {
        const part = arc.u8(list + i * 4);
        if (part >= count || virtualParts.includes(part)) throw new Error('Invalid fighter virtual part.');
        virtualParts.push(part);virtualAttachments.push({part,parent:arc.u8(list+i*4+1),mode:arc.u8(list+i*4+2),tree:arc.u8(list+i*4+3)});
      }
    }
    const partJoints: number[] = []; let jointCount = 0;
    for (let part = 0; part < count; part++) partJoints.push(virtualParts.includes(part) ? -1 : jointCount++);
    return { count, map, virtualParts, virtualAttachments, partJoints, jointCount };
  };
  return {
    words: COMMON_WORDS.map((offset) => [offset, arc.u32(common + offset)]),
    specialBranchThreshold: finiteRange(arc.f32(common + 0x21c), 0, 1, 'special branch threshold'),
    stickDeadzone: finiteRange(arc.f32(common), 0, 1, 'deadzone'),
    walkThreshold: finiteRange(arc.f32(common+0x24),0,1,'walk threshold'), dashThreshold:finiteRange(arc.f32(common+0x3c),0,1,'dash threshold'),
    runBrakeStick: finiteRange(arc.f32(common + 0x58), 0, 1, 'run brake stick'), runTurnStick: finiteRange(arc.f32(common + 0x38), -1, 0, 'run turn stick'),
    turnStick: finiteRange(arc.f32(common + 0x34), -1, 0, 'turn stick'),
    chargeSoundFrame:finiteRange(arc.f32(common+0x7c8),0,600,'charge sound delay'), chargeVulnerability:finiteRange(arc.f32(common+0x7c4),1,2,'charge vulnerability'),
    fastFallThreshold: finiteRange(arc.f32(common + 0x88), 0, 1, 'fast-fall threshold'),
    fastFallWindow: finiteRange(arc.u32(common + 0x8c), 1, 60, 'fast-fall input window'),
    nudgeSpeed: finiteRange(arc.f32(common + 0x450), 0, 5, 'ground nudge speed'),
    itemThrows: Array.from({length:22},(_,i)=>{const entry=arc.pointer(root+4)+i*12;return {speed:finiteRange(arc.f32(entry),0,100,'item throw speed'),angle:finiteRange(arc.f32(entry+4),-Math.PI*2,Math.PI*2,'item throw angle')};}),
    itemSmashAnimationRate: finiteRange(arc.f32(common+0x400),0.01,10,'item smash animation rate'),
    lCancel: { window: finiteRange(arc.u32(common+0xe4),0,60,'L-cancel window'), divisor: finiteRange(arc.f32(common+0xe8),1,10,'L-cancel divisor') },
    hitstunRecovery: { jumpBuffer: finiteRange(arc.f32(common+0x1d0),0,255,'hitstun jump buffer'), pressGap: finiteRange(arc.u32(common+0x1c),0,255,'meteor cancel press gap'),
      meteorAngleMin: finiteRange(arc.u32(common+0x7e8),0,361,'meteor angle min'), meteorAngleMax: finiteRange(arc.u32(common+0x7ec),0,361,'meteor angle max'), meteorLockout: finiteRange(arc.u32(common+0x7f0),0,255,'meteor cancel lockout') },
    itemInput:{smashDeadX:arc.f32(common+8),smashDeadY:arc.f32(common+12),angle:arc.f32(common+0x20),side:arc.f32(common+0x98),up:arc.f32(common+0xac),down:arc.f32(common+0xb0),smashUp:arc.f32(common+0xcc),smashDown:arc.f32(common+0xd4),upWindow:arc.f32(common+0xd0),downWindow:arc.f32(common+0xd8),airWindow:arc.u32(common+0x3fc),neutralX:arc.f32(common+0xdc),neutralY:arc.f32(common+0xe0)},
    smashInputWindow: finiteRange(arc.u32(common+0x40)+arc.f32(common+0x44),0,60,'smash input window'),
    dashInputWindow: finiteRange(arc.u32(common+0x40),0,60,'dash input window'),
    dashExitFriction: finiteRange(arc.f32(common+0x54),0,1,'dash exit friction'),
    dashInitialLockout: finiteRange(arc.f32(common+0x44),0,60,'initial dash reverse lockout'),
    dashRollWindow: finiteRange(arc.f32(common+0x48),0,60,'initial dash roll window'),
    dashActionWindow: finiteRange(arc.f32(common+0x4c),0,60,'dash action window'),
    itemStatus: parseItemStatusCommon(arc, root, common),
    crowd: parseCrowdConfig(arc, root),
    boneMaps: { Fe: boneMap(ORIGINAL_FIGHTERS.Fe.nativeKind), Fx: boneMap(ORIGINAL_FIGHTERS.Fx.nativeKind), Mr: boneMap(ORIGINAL_FIGHTERS.Mr.nativeKind), Kb: boneMap(ORIGINAL_FIGHTERS.Kb.nativeKind), Ss: boneMap(ORIGINAL_FIGHTERS.Ss.nativeKind), Pk: boneMap(ORIGINAL_FIGHTERS.Pk.nativeKind), Lk: boneMap(ORIGINAL_FIGHTERS.Lk.nativeKind), Cl: boneMap(ORIGINAL_FIGHTERS.Cl.nativeKind), Mt: boneMap(ORIGINAL_FIGHTERS.Mt.nativeKind), Ca: boneMap(ORIGINAL_FIGHTERS.Ca.nativeKind), Dk: boneMap(ORIGINAL_FIGHTERS.Dk.nativeKind), Pr: boneMap(ORIGINAL_FIGHTERS.Pr.nativeKind), Ns: boneMap(ORIGINAL_FIGHTERS.Ns.nativeKind), Kp: boneMap(ORIGINAL_FIGHTERS.Kp.nativeKind), Pe: boneMap(ORIGINAL_FIGHTERS.Pe.nativeKind),
      Fc: boneMap(ORIGINAL_FIGHTERS.Fc.nativeKind), Dr: boneMap(ORIGINAL_FIGHTERS.Dr.nativeKind), Gn: boneMap(ORIGINAL_FIGHTERS.Gn.nativeKind), Pc: boneMap(ORIGINAL_FIGHTERS.Pc.nativeKind), Ms: boneMap(ORIGINAL_FIGHTERS.Ms.nativeKind),
      Lg: boneMap(ORIGINAL_FIGHTERS.Lg.nativeKind), Ys: boneMap(ORIGINAL_FIGHTERS.Ys.nativeKind), Pp: boneMap(ORIGINAL_FIGHTERS.Pp.nativeKind), Zd: boneMap(ORIGINAL_FIGHTERS.Zd.nativeKind), Sk: boneMap(ORIGINAL_FIGHTERS.Sk.nativeKind), Gw: boneMap(ORIGINAL_FIGHTERS.Gw.nativeKind),
      // Zero shares Link's part table (verified: 76 parts, virtual part 68, 75 model joints);
      // Toad/Meta Knight/Sonic use their ACE mexproj tables (custom skeletons, no donor).
      Zx: boneMap(ORIGINAL_FIGHTERS.Zx.nativeKind),
      Td: MODDED_BONE_TABLES.Td, Mk: MODDED_BONE_TABLES.Mk, Sn: MODDED_BONE_TABLES.Sn, Rc: MODDED_BONE_TABLES.Rc, Lz: MODDED_BONE_TABLES.Lz,
      Wf: MODDED_BONE_TABLES.Wf, Dd: MODDED_BONE_TABLES.Dd, De: MODDED_BONE_TABLES.De, Wr: MODDED_BONE_TABLES.Wr, Sh: MODDED_BONE_TABLES.Sh,
      Bl: MODDED_BONE_TABLES.Bl, Lc: MODDED_BONE_TABLES.Lc, Nm: MODDED_BONE_TABLES.Nm, Nt: MODDED_BONE_TABLES.Nt, Da: MODDED_BONE_TABLES.Da,
      Fy: MODDED_BONE_TABLES.Fy, Sc: MODDED_BONE_TABLES.Sc, Dl: MODDED_BONE_TABLES.Dl, Kx: MODDED_BONE_TABLES.Kx, Lu: MODDED_BONE_TABLES.Lu,
      Lc2: MODDED_BONE_TABLES.Lc2, Sm: MODDED_BONE_TABLES.Sm, Lb: MODDED_BONE_TABLES.Lb, MM: MODDED_BONE_TABLES.MM, Sd: MODDED_BONE_TABLES.Sd,
      Cn: MODDED_BONE_TABLES.Cn, Gk: boneMap(ORIGINAL_FIGHTERS.Gk.nativeKind),
      Ts: MODDED_BONE_TABLES.Ts, Bf: boneMap(ORIGINAL_FIGHTERS.Bf.nativeKind), WfU: MODDED_BONE_TABLES.Wf },
  };
}

function parseCrowdConfig(arc: HsdArchive, root: number): CrowdConfig {
  const config = arc.pointer(root + 21 * 4);
  const f = (offset: number, min: number, max: number, label: string) => finiteRange(arc.f32(config + offset), min, max, `crowd ${label}`);
  const i = (offset: number, min: number, max: number, label: string) => finiteRange(arc.u32(config + offset) | 0, min, max, `crowd ${label}`);
  return {
    kbLow: f(0x00, 0, 1000, 'knockback low'), kbMid: f(0x04, 0, 1000, 'knockback mid'), kbHigh: f(0x08, 0, 1000, 'knockback high'),
    angleMin: f(0x0c, 0, Math.PI * 2, 'angle min'), angleMax: f(0x10, 0, Math.PI * 2, 'angle max'), angleMult: f(0x14, 0, 4, 'angle multiplier'),
    comboFrames: f(0x18, 0, 7200, 'combo frames'), chantPercent: i(0x1c, 0, 999, 'chant percent'), cheerLimit: i(0x20, 0, 72000, 'cheer limit'),
    chantInterruptAfter: i(0x24, 0, 100, 'chant interrupt'), maxChants: i(0x28, 1, 100, 'chant repeats'), edgeMargin: f(0x2c, 0, 500, 'edge margin'),
    recoveryHigh: f(0x30, -1000, 1000, 'recovery high'), recoveryMid: f(0x34, -1000, 1000, 'recovery mid'), recoveryLow: f(0x38, -1000, 1000, 'recovery low'),
    nearBlastCount: i(0x3c, 1, 8, 'near-blast count'), blastOffset: f(0x40, -1000, 1000, 'blast offset'),
  };
}

function parseItemStatusCommon(arc: HsdArchive, root: number, common: number): ItemStatusCommon {
  const table = (index: number, count: number, label: string) => {
    const pointer = arc.pointer(root + index * 4);
    return Array.from({ length: count }, (_, i) => finiteRange(arc.f32(pointer + i * 4), -100, 100, label));
  };
  const f = (offset: number, min: number, max: number, label: string) => finiteRange(arc.f32(common + offset), min, max, label);
  const i = (offset: number, min: number, max: number, label: string) => finiteRange(arc.u32(common + offset) | 0, min, max, label);
  return {
    sizeMods: table(12, 39, 'size modifier'), bunny: table(13, 15, 'bunny hood modifier'), metal: table(14, 9, 'metal modifier'),
    giantScale: f(0x678, 1, 4, 'giant scale'), giantScaleLarge: f(0x67c, 1, 4, 'giant scale (large)'), smallScale: f(0x680, 0.1, 1, 'small scale'), smallScaleLarge: f(0x684, 0.1, 1, 'small scale (large)'),
    sizeFrames: i(0x688, 1, 7200, 'mushroom frames'), sizeBonusFrom: i(0x68c, 0, 999, 'mushroom bonus threshold'), sizeBonusMax: i(0x690, 0, 7200, 'mushroom bonus cap'),
    warpGravity: f(0x694, 0, 10, 'warp star gravity'), warpTerminal: f(0x698, 0, 500, 'warp star terminal'), warpDriftScale: f(0x69c, 0, 20, 'warp star drift'),
    warpDriftFlat: f(0x6a0, -20, 20, 'warp star drift flat'), warpDriftMax: f(0x6a4, 0, 20, 'warp star drift max'), warpFriction: f(0x6a8, 0, 20, 'warp star friction'),
    hammerFrames: i(0x6ac, 1, 7200, 'hammer frames'), metalArmor: f(0x6f0, 0, 500, 'metal armor'), cloakFrames: i(0x7cc, 1, 7200, 'cloak frames'),
    screwJump: f(0x800, 0.5, 4, 'screw attack jump'),
  };
}

/** Translates an original fighter part index into a model joint index. */
export function partJoint(bones: Pick<BoneTable, 'partJoints'>, part: number, label: string): number {
  const joint = bones.partJoints[part];
  if (joint === undefined || joint < 0) throw new Error(`Original ${label} references fighter part ${part}, which owns no model joint.`);
  return joint;
}

/** ftData x8 (FtPartsDesc): vis_table[costume][set]. ftParts_8007487C hides every draw object of
 * sets 0, 1 and 3 (set 2 targets the extra hat list) and ftParts_80074B6C then shows only the
 * selected alternative of each group in set 0. Costume 0 is the only costume loaded here. */
function parsePartVisibility(arc: HsdArchive, root: number): FighterProfile['partVisibility'] {
  const lookup = arc.pointer(root + 8), groupCount = arc.u32(lookup), table = arc.pointer(lookup + 4);
  // Mr. Game & Watch owns 11 visibility groups (flat body parts); the cap stays
  // a corruption guard well above any verified original count.
  if (groupCount > 16) throw new Error('Invalid original part visibility groups.');
  const readSet = (index: number): number[][][] => {
    const set = arc.pointer(table + index * 4);
    if (!set) return Array.from({ length: groupCount }, () => []);
    return Array.from({ length: groupCount }, (_, group) => {
      const alternatives = arc.u32(set + group * 8), list = arc.pointer(set + group * 8 + 4);
      if (alternatives > 16) throw new Error('Invalid original part visibility alternatives.');
      return Array.from({ length: alternatives }, (_, alternative) => {
        const size = arc.u32(list + alternative * 8), indices = arc.pointer(list + alternative * 8 + 4);
        if (size > 128) throw new Error('Invalid original part visibility list.');
        return [...arc.slice(indices, size)];
      });
    });
  };
  const groups = readSet(0);
  const hidden = new Set<number>();
  for (const index of [0, 1, 3]) for (const group of readSet(index)) for (const alternative of group) for (const dobj of alternative) hidden.add(dobj);
  return { groups, hidden: [...hidden].sort((a, b) => a - b) };
}

export function parseFighterProfile(arc: HsdArchive, kind: OriginalFighterKind, common: CommonGameplayData): FighterProfile {
  const root = [...arc.symbols.values()][0];
  if (root === undefined) throw new Error('Fighter data has no root.');
  const attrs = arc.pointer(root);
  const f = (offset: number) => arc.f32(attrs + offset);
  const words = Uint32Array.from({ length: 0x9c / 4 }, (_, i) => arc.u32(attrs + i * 4));
  const attributes: FighterAttributes = {
    walkSpeed: f(8), walkAnimationScaling:[f(0x0c),f(0x10),f(0x14)], dashInitial: f(0x1c), runSpeed: f(0x28), friction: f(0x18),
    jumpStartup: f(0x38), jumpSpeed: f(0x40), hopSpeed: f(0x4c), gravity: f(0x5c), terminal: f(0x60),
    maxJumps: arc.u32(attrs + 0x58), modelScale: f(0x8c), weight: f(0x88), runAnimationScaling: f(0x2c), airFriction: f(0x70),
    airDriftStickMul: finiteRange(f(0x64), 0, 1, 'air drift stick multiplier'), airDriftMax: finiteRange(f(0x6c), 0, 10, 'air drift maximum'),
    landingLag: f(0xe4), aerialLandingLag: f(0xe8), aerialForwardLandingLag: f(0xec), aerialBackLandingLag: f(0xf0), aerialUpLandingLag: f(0xf4), aerialDownLandingLag: f(0xf8),
    jab2Window: finiteRange(f(0x7c), 0, 120, 'jab 2 window'), jab3Window: finiteRange(f(0x80), 0, 120, 'jab 3 window'),
    rapidJabThreshold: finiteRange(arc.u32(attrs + 0x98), 0, 100, 'rapid jab threshold'),
    itemThrowVelocity:finiteRange(f(0xb0),0,10,'item throw velocity multiplier'),
    shieldSize: finiteRange(f(0x90),1,100,'shield size'), shieldBreakY:f(0x94), ledgeJumpX:f(0xa8), ledgeJumpY:f(0xac), independentThrows:arc.u8(attrs+0x180),
    iceSize: finiteRange(f(0x14c),1,100,'ice block size'), iceJumpY: finiteRange(f(0x158),0,20,'ice break hop'), iceJumpX: finiteRange(f(0x15c),0,20,'ice break drift'),
  };
  attributes.walkAnimationScaling.forEach(value=>finiteRange(value,0.001,20,'walk animation scaling'));
  finiteRange(attributes.gravity, 0.001, 2, 'gravity'); finiteRange(attributes.runSpeed, 0.01, 20, 'run speed');
  finiteRange(attributes.jumpSpeed, 0.01, 20, 'jump speed'); finiteRange(attributes.weight, 1, 300, 'weight');
  finiteRange(attributes.maxJumps, 1, 6, 'jump count'); finiteRange(attributes.modelScale, 0.1, 5, 'model scale');
  finiteRange(attributes.jumpStartup, 1, 20, 'jump squat');
  for (const lag of ['landingLag', 'aerialLandingLag', 'aerialForwardLandingLag', 'aerialBackLandingLag', 'aerialUpLandingLag', 'aerialDownLandingLag'] as const) finiteRange(attributes[lag], 0, 120, lag);
  const hurt = arc.pointer(root + 0x30), count = arc.u32(hurt), definitions = arc.pointer(hurt + 4);
  if (count < 1 || count > 15) throw new Error('Invalid original hurtbox count.');
  const bones = common.boneMaps[kind];
  const hurts = Array.from({ length: count }, (_, i): HurtDefinition => {
    const pointer = definitions + i * 40, part = arc.u32(pointer);
    if (part >= bones.count) throw new Error('Hurtbox bone is out of bounds.');
    return { bone: partJoint(bones, part, 'hurtbox'), grabbable:arc.u32(pointer+8)!==0, a: vec(arc, pointer + 12), b: vec(arc, pointer + 24), radius: finiteRange(arc.f32(pointer + 36), 0.01, 50, 'hurtbox radius') };
  });
  const nudge = arc.pointer(root + 0x50), ecb=arc.pointer(root+0x44), shieldPart=arc.u8(arc.pointer(root+8)+0x11);
  if(shieldPart>=bones.count)throw Error('Invalid original shield bone.');
  const boneMap = bones.map.map((part) => part === 255 ? 255 : partJoint(bones, part, 'common bone'));
  const pickup=arc.pointer(root+0x40),pickupBox=(offset:number):[number,number,number,number]=>[0,4,8,12].map(i=>finiteRange(arc.f32(pickup+offset+i),-100,100,'item pickup bound')) as [number,number,number,number];
  return { kind, name: ORIGINAL_FIGHTERS[kind].name, attributes, words, shieldBone: partJoint(bones, shieldPart, 'shield bone'),
    itemHoldBone:partJoint(bones,arc.u8(arc.pointer(root+8)+0x10),'item hold bone'),itemPickup:{ground:pickupBox(0),air:pickupBox(32)},
    ledgeSnap:{x:finiteRange(arc.f32(ecb+16),0,100,'ledge snap x'),y:finiteRange(arc.f32(ecb+20),0,100,'ledge snap y'),height:finiteRange(arc.f32(ecb+24),0,100,'ledge snap height')}, hurts, boneMap, boneCount: bones.jointCount, partJoints: [...bones.partJoints], motionRoot: boneMap[1]!,
    partVisibility: parsePartVisibility(arc, root), cameraBox: parseCameraBox(arc, root, attrs, bones), chantSound: parseChantSound(arc, root),
    nudgeOffset: arc.f32(nudge), nudgeRadius: finiteRange(arc.f32(nudge + 4), 0, 20, 'ground nudge radius'), hitSparkVariant: arc.u32(attrs + 0xa0) };
}
/** ftCamera_UpdateCameraBox inputs. Presentation/crowd data only, so a table the parser cannot
 * vouch for (extension fighters' part tables) is dropped instead of failing the fighter. */
function parseCameraBox(arc: HsdArchive, root: number, attrs: number, bones: Pick<BoneTable, 'partJoints'>): FighterCameraBox | undefined {
  try {
    const box = arc.pointer(root + 0x3c), values = Array.from({ length: 6 }, (_, i) => arc.f32(box + i * 4));
    const joint = bones.partJoints[arc.u32(attrs + 0x16c)], offset = vec(arc, attrs + 0x170);
    if (joint === undefined || joint < 0 || ![...values, ...offset].every((value) => Number.isFinite(value) && Math.abs(value) <= 200) || values[5]! <= 0) return undefined;
    return { yOffset: values[0]!, front: values[1]!, back: values[2]!, top: values[3]!, bottom: values[4]!, magnify: values[5]!, joint, offset };
  } catch { return undefined; }
}
function parseChantSound(arc: HsdArchive, root: number): number | undefined {
  try {
    const id = arc.u32(arc.pointer(root + 0x4c) + 0x34);
    return id > 0 && id < 10_000_000 ? id : undefined;
  } catch { return undefined; }
}

/** Researched world offset for one collision area whose lines are stored in an owner
 * joint's local frame: [area, dx, dy] in stage units. Duplicate rest-pose lines
 * (identical locals across areas) accept any bijection between the listed areas and
 * their owner joints — the resulting world set is the same — so tables list areas in
 * order against owner joints in dump order (see each stages.ts entry for derivation). */
export type AreaOffset = readonly [area: number, dx: number, dy: number];
export function parseStageGameplay(arc: HsdArchive, staticAreas?: readonly number[], areaOffsets?: readonly AreaOffset[]): StageGameplayData {
  const scale = finiteRange(arc.f32(arc.symbol('grGroundParam')), 0.1, 5, 'stage scale');
  const coll = arc.symbol('coll_data'), vertices = arc.pointer(coll), vertexCount = arc.u32(coll + 4);
  const lines = arc.pointer(coll + 8), lineCount = arc.u32(coll + 12), first = arc.u16(coll + 16), count = arc.u16(coll + 18);
  if (vertexCount > 10000 || lineCount > 10000 || first + count > lineCount) throw new Error('Invalid stage collision arrays.');
  // Joint-local lines (verified stacked duplicates) shift to their owner joints' rest
  // pose: floor ranges index the main range (global id = first + local), surface
  // ranges are already global ids. Without offsets every shift reads (0, 0).
  let shiftFor = (_id: number): { dx: number; dy: number } => ({ dx: 0, dy: 0 });
  if (areaOffsets?.length) {
    const areaTable = arc.pointer(coll + 0x24), areaCount = arc.u32(coll + 0x28);
    if (areaCount > 64) throw new Error('Invalid stage collision area table.');
    const byLine = new Map<number, { dx: number; dy: number }>();
    for (const [area, dx, dy] of areaOffsets) {
      if (!Number.isInteger(area) || area < 0 || area >= areaCount || !Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Invalid stage collision area offset.');
      const entry = areaTable + area * 0x28, shift = { dx, dy };
      const mark = (start: number, size: number) => { for (let i = start; i < start + size; i++) byLine.set(i, shift); };
      mark(first + arc.u16(entry), arc.u16(entry + 2));
      mark(arc.u16(entry + 4), arc.u16(entry + 6));
      mark(arc.u16(entry + 8), arc.u16(entry + 10));
      mark(arc.u16(entry + 12), arc.u16(entry + 14));
    }
    const zero = { dx: 0, dy: 0 };
    shiftFor = (id) => byLine.get(id) ?? zero;
  }
  let floors: Floor[] = [];
  for (let id = first; id < first + count; id++) {
    const line = lines + id * 16, a = arc.u16(line), b = arc.u16(line + 2);
    if (a >= vertexCount || b >= vertexCount) throw new Error('Stage line references an invalid vertex.');
    const shift = shiftFor(id);
    floors.push({ id, a: [Math.fround(arc.f32(vertices + a * 8) * scale + shift.dx), Math.fround(arc.f32(vertices + a * 8 + 4) * scale + shift.dy)],
      b: [Math.fround(arc.f32(vertices + b * 8) * scale + shift.dx), Math.fround(arc.f32(vertices + b * 8 + 4) * scale + shift.dy)], oneWay: !!(arc.u16(line + 14) & 0x100) });
  }
  // Multi-area MapCollData (MapJoint table at +0x24): some stages own areas whose
  // lines the original stage code spawns/moves at runtime (Corneria's Arwings and
  // fin platforms). A stage descriptor may declare its verified always-active areas;
  // only their floor ranges are kept then. Without a declaration every line stays,
  // so single-area and fully static multi-area stages are unchanged.
  if (staticAreas) {
    const areaTable = arc.pointer(coll + 0x24), areaCount = arc.u32(coll + 0x28);
    if (areaCount > 64 || staticAreas.some((index) => !Number.isInteger(index) || index < 0 || index >= areaCount)) throw new Error('Invalid stage collision area selection.');
    const kept = new Set<number>();
    for (const index of staticAreas) {
      const area = areaTable + index * 0x28;
      const start = arc.u16(area), size = arc.u16(area + 2);
      if (start + size > count) throw new Error('Invalid stage collision area range.');
      for (let floor = start; floor < start + size; floor++) kept.add(first + floor);
    }
    if (!kept.size) throw new Error('Stage area selection keeps no floors.');
    floors = floors.filter((floor) => kept.has(floor.id));
  }
  const surfaces:StageSurface[]=floors.map(floor=>({...floor,kind:'floor'}));
  for(const [offset,kind] of [[0x14,'ceiling'],[0x18,'wall'],[0x1c,'wall']] as const){
    const start=arc.u16(coll+offset),size=arc.u16(coll+offset+2);
    if(size&&start+size>lineCount)throw Error('Invalid static map surface range.');
    const allowed=new Set<number>();
    if(staticAreas){const areas=arc.pointer(coll+0x24);for(const index of staticAreas){const area=areas+index*0x28,local=offset-0x10,s=arc.u16(area+local),n=arc.u16(area+local+2);for(let i=s;i<s+n;i++)allowed.add(i);}}
    for(let id=start;id<start+size;id++){
      if(staticAreas&&!allowed.has(id))continue;
      const line=lines+id*16,a=arc.u16(line),b=arc.u16(line+2);
      if(a>=vertexCount||b>=vertexCount)throw Error('Invalid map surface vertex.');
      const shift=shiftFor(id);
      surfaces.push({id,kind,a:[Math.fround(arc.f32(vertices+a*8)*scale+shift.dx),Math.fround(arc.f32(vertices+a*8+4)*scale+shift.dy)],b:[Math.fround(arc.f32(vertices+b*8)*scale+shift.dx),Math.fround(arc.f32(vertices+b*8+4)*scale+shift.dy)],oneWay:false});
    }
  }
  // Sloped segments are supported by the prototype ground follower; vertical or
  // over-steep "floors" are not, and walls/ceilings remain unsimulated entirely.
  if (floors.length < 1 || floors.some((floor) => {
    const run = Math.abs(floor.a[0] - floor.b[0]), rise = Math.abs(floor.a[1] - floor.b[1]);
    return rise > 0.01 && (run < 0.001 || rise / run > MAX_FLOOR_SLOPE);
  })) {
    throw new Error('This playable slice requires static floors no steeper than the supported slope.');
  }
  const head = arc.symbol('map_head'), table = arc.pointer(head), groupCount = arc.u32(head + 4);
  if (groupCount > 64) throw new Error('Invalid stage point table.');
  const points = new Map<number, V3>();
  for (let group = 0; group < groupCount; group++) {
    const desc = table + group * 12, root = arc.pointer(desc), pairs = arc.pointer(desc + 4), pairCount = arc.u32(desc + 8);
    if (pairCount > 1024) throw new Error('Invalid stage point count.');
    const poses: Matrix4[] = [], seen = new Set<number>();
    function visit(pointer: number, parent: Matrix4 | null, parentScale: V3, depth: number): void {
      if (depth > 128 || seen.has(pointer) || seen.size > 4096) throw new Error('Invalid stage point hierarchy.');
      seen.add(pointer);
      const ownScale = vec(arc, pointer + 0x20), flags = arc.u32(pointer + 4);
      const accScale: V3 = flags & 8 ? [...parentScale] : [ownScale[0] * parentScale[0], ownScale[1] * parentScale[1], ownScale[2] * parentScale[2]];
      const matrix = new Matrix4(); jointMatrix(matrix, ownScale, vec(arc, pointer + 0x14), vec(arc, pointer + 0x2c), accScale);
      if (parent) matrix.premultiply(parent);
      poses.push(matrix);
      if (!(flags & 0x1000)) for (const child of linkedList(arc, arc.pointer(pointer + 8), 12)) visit(child, matrix, accScale, depth + 1);
    }
    visit(root, null, [1, 1, 1], 0);
    for (let i = 0; i < pairCount; i++) {
      const index = arc.u16(pairs + i * 4), id = arc.u16(pairs + i * 4 + 2), matrix = poses[index];
      if (!matrix) throw new Error('Invalid stage point joint index.');
      const position = new Vector3().setFromMatrixPosition(matrix).multiplyScalar(scale);
      points.set(id, [position.x, position.y, position.z]);
    }
  }
  const firstBlast = points.get(0x97), secondBlast = points.get(0x98), spawn0 = points.get(0), spawn1 = points.get(1);
  if (!firstBlast || !secondBlast || !spawn0 || !spawn1) throw new Error('Missing original blast zones or spawn points.');
  const blast = { left: Math.min(firstBlast[0], secondBlast[0]), right: Math.max(firstBlast[0], secondBlast[0]), bottom: Math.min(firstBlast[1], secondBlast[1]), top: Math.max(firstBlast[1], secondBlast[1]) };
  // Ground_801C39C0: CameraLimit points 0x95/0x96 relative to the 0x94 camera origin, which
  // Stage_GetCamBounds*Offset adds back, so absolute corners are the stored bounds.
  const cameraA = points.get(0x95), cameraB = points.get(0x96), cameraOrigin = points.get(0x94);
  const camera = cameraA && cameraB && cameraOrigin
    ? { left: Math.min(cameraA[0], cameraB[0]), right: Math.max(cameraA[0], cameraB[0]), bottom: Math.min(cameraA[1], cameraB[1]), top: Math.max(cameraA[1], cameraB[1]) }
    : { ...STAGE_CAMERA_DEFAULT };
  const groundParam = arc.symbol('grGroundParam');
  const magnifyColors = Array.from({ length: 9 }, (_, index) => arc.u32(groundParam + 0xb8 + index * 4));
  const solid = floors.filter((floor) => !floor.oneWay);
  const ledges:Ledge[]=[];
  for(const floor of solid) {
    const line=lines+floor.id*16;
    if(!(arc.u16(line+14)&0x200))continue;
    for(const side of [0,1]) {
      const neighbor=arc.u16(line+4+side*2);
      if(floors.some(f=>f.id===neighbor))continue;
      const point=side===0?floor.a:floor.b;
      ledges.push({id:floor.id*2+side,floor:floor.id,x:point[0],y:point[1],facing:point[0]<=Math.min(floor.a[0],floor.b[0])?1:-1});
    }
  }
  return { scale, floors, surfaces, ledges, blast, camera, magnifyColors, spawns: [spawn0, spawn1, ...[2, 3].flatMap(id => { const point = points.get(id); return point ? [point] : []; })], mainLeft: Math.min(...solid.flatMap((floor) => [floor.a[0], floor.b[0]])), mainRight: Math.max(...solid.flatMap((floor) => [floor.a[0], floor.b[0]])) };
}
