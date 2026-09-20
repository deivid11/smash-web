import type { HsdArchive } from '../../../lib/hsd/archive.ts';
import type { ModelJoint } from '../../../lib/hsd/model.ts';
import type { HsdModel } from '../../../lib/hsd/model.ts';
import { loadJointAnimation, type AnimationClip } from '../../../lib/hsd/animation.ts';
import { ONETT_CAR_DEPTHS, ONETT_AWNING_DEPTHS, ONETT_LANE_LTR, ONETT_LANE_RTL, type OnettRuntime } from '../../../lib/game/onett.ts';
import type { ModelInstance } from './model-instance.ts';

/** Onett stage presentation from authoritative match state (gronett.c).
 * Joint indices below are resolved with the original Ground_801C3FA4
 * depth-first walk (first child first, never descending into joints with
 * flags & 0x1000), so the layout tracks the archive instead of hardcoding
 * joint numbers. The left-to-right mirror rotates the driven middle joint's
 * first child, and the post-hit spin accumulates there too — exactly where
 * the original writes them. */
export interface OnettLayout {
  carRoot: number;
  /** Driven base joint per car slot ([0xB,0x1,0x6,0x10] depths); the whole
   * car translates with its base, so every model shares one world track. */
  carJoints: readonly [number, number, number, number];
  /** First child per base joint (the body: mirror/spin target). */
  mirrorChild: readonly [number, number, number, number];
  /** Bind-pose base translations per middle joint (world tracks keep them). */
  restX: readonly [number, number, number, number];
  restZ: readonly [number, number, number, number];
  /** Owning car slot per draw of the car root. */
  carOfDraw: readonly number[];
  townRoot: number;
  /** Awning spring joints ([0xE,0xF] depths): both canopy joints. */
  awningJoints: readonly [number, number];
  buildingRoot: number;
  /** DFS depths of the building joints hidden during the rebuild blink. */
  blinkJoints: readonly [number, number, number];
  /** Center-building animation clips by table slot (null when absent). */
  buildingClips: ReadonlyArray<AnimationClip | null>;
}
/** Ground_801C3FA4: depth steps from the gobj root itself (depth 0 is the
 * root; depth 1 its first child), descending child-first and never into
 * joints with flags & 0x1000. Verified: depths 0x1/0x6/0xB/0x10 resolve to
 * the four car base joints, 0xE/0xF to both canopy joints, and 5/2/4 to the
 * rebuild-blink joints. */
function dfsResolve(joints: readonly ModelJoint[], depth: number): number {
  let current: number | undefined = 0;
  let remaining: number = depth;
  while (current !== undefined && remaining !== 0) {
    remaining -= 1;
    const joint: ModelJoint = joints[current]!;
    if (!(joint.flags & 0x1000) && joint.children.length > 0) {
      current = joint.children[0]!;
      continue;
    }
    let cursor: number | undefined = current;
    let next: number | null = null;
    while (cursor !== undefined) {
      const parent = joints.findIndex((candidate) => candidate.children.includes(cursor!));
      if (parent < 0) break;
      const siblings = joints[parent]!.children;
      const at = siblings.indexOf(cursor);
      if (at + 1 < siblings.length) { next = siblings[at + 1]!; break; }
      if (parent === 0) break;
      cursor = parent;
    }
    if (next === null) return -1;
    current = next;
  }
  return current ?? -1;
}
function findRoot(model: HsdModel, joints: number): number {
  return model.roots.findIndex((root) => root.joints.length === joints);
}
export function readOnettTraffic(model: HsdModel): OnettLayout | null {
  try {
    const carRoot = findRoot(model, 21);
    const townRoot = findRoot(model, 23);
    const buildingRoot = findRoot(model, 6);
    if (carRoot < 0 || townRoot < 0 || buildingRoot < 0) return null;
    const carJoints = model.roots[carRoot]!.joints;
    if (carJoints[0]?.children.length !== 4) return null;
    const driven = ONETT_CAR_DEPTHS.map((depth) => dfsResolve(carJoints, depth));
    if (driven.some((joint) => joint < 0)) return null;
    // Every driven joint must parent body geometry (rejects a shifted layout).
    for (const joint of driven) {
      if (!model.roots[carRoot]!.parts.some((part) => {
        let owner = part.owner;
        while (owner !== joint && owner !== 0) {
          const parent = carJoints.findIndex((candidate) => candidate.children.includes(owner));
          if (parent < 0) break;
          owner = parent;
        }
        return owner === joint;
      })) return null;
    }
    const mirrorChild = driven.map((joint) => carJoints[joint]!.children[0] ?? -1);
    if (mirrorChild.some((child) => child < 0)) return null;
    const carOfDraw = model.roots[carRoot]!.parts.map((part) => {
      let joint = part.owner;
      if (!Number.isInteger(joint) || joint < 0 || joint >= carJoints.length) return -1;
      while (carJoints[joint]!.parent !== 0 && joint !== 0) {
        const parent = carJoints.findIndex((candidate) => candidate.children.includes(joint));
        if (parent < 0) return -1;
        joint = parent;
      }
      return driven.indexOf(joint);
    });
    if (carOfDraw.some((car) => car < 0)) return null;
    if (![0, 1, 2, 3].every((car) => carOfDraw.includes(car))) return null;
    const townJoints = model.roots[townRoot]!.joints;
    const awningJoints = ONETT_AWNING_DEPTHS.map((depth) => dfsResolve(townJoints, depth));
    if (awningJoints.some((joint) => joint < 0)) return null;
    const buildingJoints = model.roots[buildingRoot]!.joints;
    if (buildingJoints[0]?.children.length !== 3) return null;
    const blinkJoints = [5, 2, 4].map((depth) => dfsResolve(buildingJoints, depth));
    if (blinkJoints.some((joint) => joint < 0)) return null;
    const buildingClips: Array<AnimationClip | null> = [];
    try {
      const archive: HsdArchive = model.archive;
      const head = archive.symbol('map_head');
      const headCount = archive.u32(head + 12);
      if (headCount > 1024) return null;
      const descs = archive.pointer(head + 8);
      let table = 0;
      for (let i = 0, seen = 0; i < headCount; i++) {
        const pointer = archive.pointer(descs + i * 0x34);
        if (!pointer || pointer === 0xffffffff) continue;
        if (seen === buildingRoot) { table = archive.pointer(descs + i * 0x34 + 4); break; }
        seen += 1;
      }
      for (let slot = 0; slot < 6; slot++) {
        try {
          const clip = table ? loadJointAnimation(archive, archive.pointer(table + slot * 4)) : null;
          buildingClips.push(clip);
        } catch { buildingClips.push(null); }
      }
    } catch {
      for (let slot = buildingClips.length; slot < 6; slot++) buildingClips.push(null);
    }
    while (buildingClips.length < 6) buildingClips.push(null);
    return {
      carRoot, carJoints: driven as [number, number, number, number],
      mirrorChild: mirrorChild as [number, number, number, number],
      restX: driven.map((joint) => carJoints[joint]!.translation[0]) as [number, number, number, number],
      restZ: driven.map((joint) => carJoints[joint]!.translation[2]) as [number, number, number, number],
      carOfDraw, townRoot, awningJoints: awningJoints as [number, number],
      buildingRoot, blinkJoints: blinkJoints as [number, number, number], buildingClips,
    };
  } catch {
    return null;
  }
}
/** Rest pose for menus and pre-match frames: every parked car stays hidden so
 * the street never shows the overlapping rest-pose pile. */
export function parkOnettCars(stage: ModelInstance, layout: OnettLayout): void {
  for (let draw = 0; draw < layout.carOfDraw.length; draw++) stage.setDrawHidden(layout.carRoot, draw, true);
  stage.setObjectState(layout.carRoot, null);
  stage.setObjectState(layout.buildingRoot, null);
}
/** Drive the stage models from authoritative runtime state. Called every frame
 * in a match, after the menu stage-motion pass. */
export function applyOnettRuntime(stage: ModelInstance, layout: OnettLayout, rt: OnettRuntime): void {
  const live = new Set<number>();
  if (rt.a.visible) live.add(rt.a.car);
  if (rt.b.visible) live.add(rt.b.car);
  for (let draw = 0; draw < layout.carOfDraw.length; draw++) {
    stage.setDrawHidden(layout.carRoot, draw, !live.has(layout.carOfDraw[draw]!));
  }
  const place = (car: number, x: number, lane: number, mirror: boolean, spin: number): void => {
    if (car < 0 || car > 3) return;
    const joint = layout.carJoints[car]!;
    stage.setJointTranslationOverride(layout.carRoot, joint, [x - layout.restX[car]!, 0, lane - layout.restZ[car]!]);
    stage.setJointRotationOverride(layout.carRoot, layout.mirrorChild[car]!, mirror ? [0, Math.PI, 0] : [0, spin, 0]);
  };
  place(rt.a.car, rt.a.x, ONETT_LANE_RTL, false, rt.a.spin);
  place(rt.b.car, rt.b.x, ONETT_LANE_LTR, true, 0);
  rt.awnings.forEach((spring, index) => {
    stage.setJointTranslationOverride(layout.townRoot, layout.awningJoints[index]!, [0, spring.velocity + spring.accumulator, 0]);
  });
  const building = rt.building;
  const blink = building.state === 7 && (building.timer & 2) !== 0;
  for (const joint of layout.blinkJoints) stage.setJointVisibilityOverride(layout.buildingRoot, joint, !blink);
  const clip = layout.buildingClips[building.anim] ?? null;
  // Frozen states (rubble/idle) hold the last frame; active states advance with
  // the runtime clock and transition exactly when the slot completes.
  const end = clip?.endFrame && clip.endFrame > 0 ? clip.endFrame : 127;
  stage.setObjectClip(layout.buildingRoot, clip);
  stage.setObjectState(layout.buildingRoot, {
    animationFrame: Math.min(Math.max(0, building.animFrame), end),
    visible: true,
  });
}
