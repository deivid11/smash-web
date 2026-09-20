import { HsdArchive } from '@smash/lib/hsd/archive.ts';
import { COMBAT_MOTIONS } from '@smash/lib/game/combat-data.ts';
import type { CustomFighterKind } from '@smash/lib/custom/identity.ts';
import type { FighterProfile } from '@smash/lib/game/data.ts';
import type { FighterContent } from '@smash/lib/game/load.ts';
import type { HsdModel, ModelJoint } from '@smash/lib/hsd/model.ts';
import type { AnimationClip } from '@smash/lib/hsd/animation.ts';
import type { AttackDefinition, HitDefinition, MoveEvent } from '@smash/lib/game/moves.ts';

/** Original tutorial content, not an extracted fighter or a claim of Melee accuracy.
 * Shared original C helpers still own movement math; these are authored parameters. */
export function makeDummy(kind: CustomFighterKind): FighterContent {
  const words = new Uint32Array(0x9c / 4), view = new DataView(words.buffer);
  const floats: Record<number, number> = {
    0x00: 0.1, 0x04: 0.05, 0x08: 1, 0x0c: 0.35, 0x10: 0.7, 0x14: 1,
    0x18: 0.08, 0x1c: 1.5, 0x20: 0.05, 0x24: 0.04, 0x28: 1.8, 0x2c: 1,
    0x30: 8, 0x34: 2.8, 0x38: 4, 0x3c: 0.8, 0x40: 3, 0x44: 0.7, 0x48: 1.2,
    0x4c: 1.5, 0x50: 0.8, 0x54: 1, 0x5c: 0.12, 0x60: 2.4, 0x64: 0.05,
    0x68: 0.02, 0x6c: 1, 0x70: 0.02, 0x74: 3, 0x78: 2, 0x7c: 18,
    0x80: 18, 0x84: 8, 0x88: 100, 0x8c: 1, 0x90: 12, 0x94: 2.5,
  };
  for (const [offset, value] of Object.entries(floats)) view.setFloat32(Number(offset), value, true);
  view.setUint32(0x58, 2, true); view.setUint32(0x98, 0, true);
  const profile: FighterProfile = {
    kind, name: 'Training Dummy', words, boneCount: 54,
    boneMap: Array.from({ length: 54 }, (_, index) => index), partJoints: Array.from({ length: 54 }, (_, index) => index),
    partVisibility: { groups: [], hidden: [] }, motionRoot: 1, shieldBone: 53,
    nudgeOffset: 0, nudgeRadius: 3, ledgeSnap: { x: 10, y: 12, height: 8 },
    attributes: {
      walkSpeed: 1, walkAnimationScaling: [0.35, 0.7, 1], dashInitial: 1.5, runSpeed: 1.8, friction: 0.08,
      jumpStartup: 4, jumpSpeed: 3, hopSpeed: 1.5, gravity: 0.12, terminal: 2.4, maxJumps: 2,
      modelScale: 1, weight: 100, runAnimationScaling: 1, airFriction: 0.02, airDriftStickMul: 0.04,
      airDriftMax: 0.7, landingLag: 5, aerialLandingLag: 16, aerialForwardLandingLag: 16,
      aerialBackLandingLag: 16, aerialUpLandingLag: 16, aerialDownLandingLag: 16,
      jab2Window: 18, jab3Window: 18, rapidJabThreshold: 0, shieldSize: 12, shieldBreakY: 2.5,
      ledgeJumpX: 1, ledgeJumpY: 3, independentThrows: 15,
    },
    hurts: [{ bone: 4, a: [0, -4, 0], b: [0, 4, 0], radius: 3, grabbable: true }],
  };
  const bytes = new Uint8Array(64), header = new DataView(bytes.buffer);
  header.setUint32(0, 64); header.setUint32(4, 32);
  const joints: ModelJoint[] = Array.from({ length: 54 }, (_, index) => ({
    id: index + 1, parent: index === 0 ? -1 : index === 1 ? 0 : 1, children: [], flags: 0,
    rotation: [0, 0, 0], scale: [1, 1, 1], translation: [0, 0, 0], inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  }));
  for (const bone of [4, 23, 49, 52, 53]) joints[bone]!.translation = [0, 8, bone === 52 ? 6 : 0];
  joints.forEach((joint, index) => { if (joint.parent >= 0) joints[joint.parent]!.children.push(index); });
  const model: HsdModel = {
    archive: new HsdArchive(bytes), roots: [{ name: 'Authored training skeleton', joints, parts: [], animationPointer: 0, materialAnimationPointer: 0, entry: -1 }],
    fogEntries: [], warnings: ['Tutorial geometry and timings, not original game data.'], stats: { joints: 54, meshes: 0, vertices: 0, triangles: 0, textures: 0 },
  };
  const clips = new Map<string, AnimationClip>(), attacks = new Map<string, AttackDefinition>();
  const add = (name: string, endFrame = 30, events: MoveEvent[] = []) => {
    clips.set(name, { name, endFrame, joints: joints.map(() => ({ endFrame, tracks: [] })) });
    attacks.set(name, { name, events, interruptFrame: null, ignoredOpcodes: [] });
  };
  for (const name of new Set([...COMBAT_MOTIONS, 'Wait1', 'WalkSlow', 'WalkMiddle', 'WalkFast', 'Run', 'Landing', 'JumpF', 'JumpAerialF', 'Fall', 'DamageN1', 'DamageFlyN', 'Squat', 'SquatWait', 'SquatRv', 'LandingAirN', 'LandingAirF', 'LandingAirB', 'LandingAirHi', 'LandingAirLw'])) add(name);
  const hit: HitDefinition = { id: 0, group: 0, bone: 0, damage: 6, radius: 3, offset: [0, 8, 8], angle: 45, growth: 70, weightSet: 0, base: 25, grounded: true, airborne: true, element: 0, soundKind: 1, soundSeverity: 0 };
  for (const name of ['Attack11', 'AttackDash', 'AttackS3', 'AttackHi3', 'AttackLw3', 'AttackS4', 'AttackHi4', 'AttackLw4', 'AttackAirN', 'AttackAirF', 'AttackAirB', 'AttackAirHi', 'AttackAirLw']) {
    add(name, 30, [{ frame: 7, type: 'create', hit: { ...hit, offset: [0, 8, name === 'AttackAirB' ? -8 : 8] } }, { frame: 11, type: 'clear', id: null }]);
  }
  for (const name of ['Catch', 'CatchDash']) add(name, 30, [{ frame: 6, type: 'create', hit: { ...hit, damage: 0, element: 8 } }, { frame: 9, type: 'clear', id: null }]);
  for (const name of ['ThrowF', 'ThrowB', 'ThrowHi', 'ThrowLw']) add(name, 30, [{ frame: 0, type: 'throw-hit', index: 0, hit }, { frame: 12, type: 'flag', flag: 20, value: 0 }]);
  for (const prefix of ['Special', 'SpecialAir']) for (const suffix of ['N', 'S', 'Hi', 'Lw']) add(`${prefix}${suffix}`, 24, suffix === 'Hi' ? [] : [{ frame: 8, type: 'create', hit }, { frame: 12, type: 'clear', id: null }]);
  const inert = { model, hit: null, speed: 0, angle: 0, lifetime: 1, gravity: 0, terminal: 1, bounce: 0, minSpeed: 0, scale: 1, sound: 0, rayScale: 1, deceleration: 0 };
  return {
    profile, model, custom: kind, clips, attacks, timelines: attacks,
    moves: { jab: 'Attack11', dash: 'AttackDash', strong: 'AttackS4', sideTilt: 'AttackS3', upTilt: 'AttackHi3', downTilt: 'AttackLw3', upSmash: 'AttackHi4', downSmash: 'AttackLw4', neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw' },
    specials: { parameters: { kind: 'custom' }, articles: { projectile: inert, accessory: inert }, effects: new Map(), sounds: { jump: 0, airJump: 0, ko: 0 } },
  };
}
