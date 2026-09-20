import type { HsdArchive } from '../hsd/archive.ts';
import { loadJointAnimation } from '../hsd/animation.ts';
import { parseItemScript } from './item-data.ts';
import type { HitDefinition } from './moves.ts';
import type { MeleePhysics } from './physics.ts';

/** Full Onett stage simulation (gronett.c): two car machines, the hazard
 * warning, the collapsible center building, both awning springs and all
 * stage SFX. Snapshot-owned, driven only by the simulation RNG, stepped once
 * per simulation frame — the Stadium/Greens pattern — so rollback
 * re-simulation reproduces every crossing exactly.
 *
 * Verified against third_party/melee/src/melee/gr/gronett.c:
 * - ALDYakuAll (GrOt.dat) carries the car hit scripts; item states 2–5
 *   (saved_car+2) hold the 30% hits, state 0 (the left-to-right car) is
 *   scriptless, state 1 is never assigned. Only right-to-left cars damage.
 * - The hit offset [0,4,-30] cancels the right-to-left lane depth (z=30), so
 *   the hit lands on the fighter plane (z≈0) exactly like the original.
 * - Hit direction follows the prototype item convention (away from the car).
 * - Knockback angles/growth/base/size come from the disc scripts unchanged.
 * - Car visuals translate the base joints (Ground_801C3FA4 depths
 *   0x1/0x6/0xB/0x10), so every model shares one world track; the
 *   left-to-right mirror rotates the base's first child (the body).
 * - The left-to-right mirror rotates the base joint's first child (the body),
 *   as coded; the post-hit spin accumulates on the same joint.
 * - Awning springs/accumulators and the building state machine are exact
 *   f32 ports; RNG consumption order mirrors the original call sequence.
 * - Camera-relative honk thresholds (cam_z+x64, 100+cam_y) become fixed
 *   framing values; the x740 camera-zoom flag is untracked (presentation).
 * - Map particle-bank generators (tire smoke 0x2C, awning poof 0x7533, the
 *   background flyer 0x7530) have no prototype pipeline and stay silent;
 *   every gameplay effect and every sound plays.
 * - Building hits arrive from strikes/shots/items/headbutts on the rooftop
 *   (the prototype stand-in for the joint contact accumulation, as with
 *   Yoshi blocks); merely standing on the roof never counts. */

export const ONETT_SPAWN_X = 726;
export const ONETT_DESPAWN_X = -642;
export const ONETT_LANE_RTL = 30;
export const ONETT_LANE_LTR = 56;
/** Car visual slot order: Ground_801C3FA4 depths for the driven base joints. */
export const ONETT_CAR_DEPTHS = [0xb, 0x1, 0x6, 0x10] as const;
/** Awning visual depths (both canopy joints, driven in Y exactly as coded). */
export const ONETT_AWNING_DEPTHS = [0xe, 0xf] as const;
/** Rooftop collision line ids (areas 3/4), phased out while collapsed. */
export const ONETT_ROOFTOP_IDS = [46, 47] as const;
/** Awning collision line ids (areas 0/1, joint-local; baked via areaOffsets). */
export const ONETT_AWNING_RANGES = [[0, 6], [6, 12]] as const;
/** Joint-local area bakes, model units: areas 0/1 ride their canopy joints,
 * areas 3/4 ride the center-building rooftop joint (verified against the
 * archive: baked lines coincide with their owner meshes). */
export const ONETT_AREA_BAKES: ReadonlyArray<readonly [number, number, number]> = [
  [0, -108, 55.8], [1, -49.5, 75], [3, 9, 39.5], [4, 9, 39.5],
];
/** Fixed framing stand-ins for the original camera-relative honk thresholds. */
export const ONETT_HONK_X = 620;
export const ONETT_HONK_DONE_X = 160;
/** Warning banner length (un_802FD604(yakumono_param->x60)). */
export const ONETT_WARNING_FRAMES = 60;

export interface OnettTuning {
  awningInitial: number; maxVelocity: number; velThreshold: number; posThreshold: number;
  damping: number; springForce: number; springConstant: number; maxDisplacement: number; awningDelta: number;
  waitA: number; waitB: number; delayLong: number; delayShort: number;
  buildHits: number; rebuildHits: number; rubbleMin: number; rubbleMax: number;
  waitCar: number; stillWait: number; rankDelayLast: number; rankDelayMid: number;
  speedBase: number; speedRange: number; spinRate: number; warnFrames: number;
}
export interface OnettCarHit {
  damage: number; angle: number; growth: number; base: number; size: number;
  offsetY: number; element: number; soundKind: number; soundSeverity: number;
}
export interface OnettData {
  scale: number; tuning: OnettTuning; hits: readonly [OnettCarHit, OnettCarHit, OnettCarHit, OnettCarHit];
  /** Animation-table slot end frames for the center-building root. */
  buildingClipEnds: ReadonlyArray<number | null>;
}
const f32 = Math.fround;
function yak(arc: HsdArchive, base: number, offset: number, label: string, min: number, max: number): number {
  const value = arc.f32(base + offset);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Unsupported Onett yakumono ${label}.`);
  return value;
}
/** Stage collision + hit scripts + tuning + building clips from the original archive. */
export function parseOnettData(arc: HsdArchive): OnettData {
  const scale = arc.f32(arc.symbol('grGroundParam'));
  if (!(scale > 0.1) || scale > 5) throw new Error('Unsupported Onett stage scale.');
  if (!arc.symbols.has('ALDYakuAll')) throw new Error('Onett is missing its car hit scripts.');
  if (!arc.symbols.has('yakumono_param')) throw new Error('Onett is missing its stage tuning.');
  const yaku = arc.symbol('ALDYakuAll');
  const hits: OnettCarHit[] = [];
  for (let car = 0; car < 4; car++) {
    const script = arc.pointer(yaku + (car + 2) * 4);
    if (!script) throw new Error(`Onett car ${car} has no hit script.`);
    const parsed = parseItemScript(arc, script, `GrOt/car${car}`);
    const created = parsed.events.find((event) => event.type === 'create');
    if (!created || created.type !== 'create') throw new Error(`Onett car ${car} hit is not authored.`);
    const hit = created.hit as HitDefinition;
    if (hit.bone !== 0 || !hit.grounded || !hit.airborne) throw new Error(`Unsupported Onett car ${car} hitbox.`);
    hits.push({
      damage: hit.damage, angle: hit.angle, growth: hit.growth, base: hit.base,
      size: f32(hit.radius), offsetY: f32(hit.offset[1]), element: hit.element ?? 0,
      soundKind: hit.soundKind ?? 0, soundSeverity: hit.soundSeverity ?? 0,
    });
  }
  const y = arc.symbol('yakumono_param');
  const tuning: OnettTuning = {
    awningInitial: yak(arc, y, 0x00, 'awning initial', -10, 10),
    maxVelocity: yak(arc, y, 0x04, 'max velocity', 0, 10),
    velThreshold: yak(arc, y, 0x08, 'velocity threshold', 0, 10),
    posThreshold: yak(arc, y, 0x0c, 'position threshold', 0, 10),
    damping: yak(arc, y, 0x10, 'damping', 0, 1),
    springForce: yak(arc, y, 0x14, 'spring force', 0, 100),
    springConstant: yak(arc, y, 0x18, 'spring constant', 0, 100),
    maxDisplacement: yak(arc, y, 0x1c, 'max displacement', 0, 100),
    awningDelta: yak(arc, y, 0x20, 'awning delta', -100, 100),
    waitA: yak(arc, y, 0x24, 'awning timer', 1, 10000),
    waitB: yak(arc, y, 0x28, 'awning timer', 1, 10000),
    delayLong: yak(arc, y, 0x2c, 'awning timer', 1, 10000),
    delayShort: yak(arc, y, 0x30, 'awning timer', 1, 10000),
    buildHits: yak(arc, y, 0x34, 'build hits', 1, 100),
    rebuildHits: yak(arc, y, 0x38, 'rebuild hits', 1, 100),
    rubbleMin: yak(arc, y, 0x3c, 'rubble timer', 1, 10000),
    rubbleMax: yak(arc, y, 0x40, 'rubble timer', 1, 10000),
    waitCar: yak(arc, y, 0x44, 'car wait', 1, 10000),
    stillWait: yak(arc, y, 0x48, 'car still wait', 1, 10000),
    rankDelayLast: yak(arc, y, 0x4c, 'rank delay', 1, 10000),
    rankDelayMid: yak(arc, y, 0x50, 'rank delay', 1, 10000),
    speedBase: yak(arc, y, 0x54, 'car speed', 0, 50),
    speedRange: yak(arc, y, 0x58, 'car speed range', 0, 50),
    spinRate: yak(arc, y, 0x5c, 'spin rate', 0, 360),
    warnFrames: yak(arc, y, 0x60, 'warning frames', 1, 1000),
  };
  if (tuning.rubbleMax < tuning.rubbleMin || tuning.speedBase + tuning.speedRange <= 0) throw new Error('Unsupported Onett car tuning.');
  // Center-building animation slots (states play slots 1/3/4/5/0; grAnime_801C83D0
  // ends a state when its slot completes).
  const buildingClipEnds: Array<number | null> = [];
  try {
    const head = arc.symbol('map_head');
    const descs = arc.pointer(head + 8);
    const table = arc.pointer(descs + 4 * 0x34 + 4);
    for (let slot = 0; slot < 6; slot++) {
      try {
        const clip = table ? loadJointAnimation(arc, arc.pointer(table + slot * 4)) : null;
        buildingClipEnds.push(clip ? clip.endFrame : null);
      } catch { buildingClipEnds.push(null); }
    }
  } catch { for (let slot = buildingClipEnds.length; slot < 6; slot++) buildingClipEnds.push(null); }
  return { scale, tuning, hits: hits as [OnettCarHit, OnettCarHit, OnettCarHit, OnettCarHit], buildingClipEnds };
}

export interface OnettCarMachine {
  state: 0 | 1 | 2 | 3 | 4 | 5 | 6; car: number; timer: number; sub: number;
  speed: number; x: number; spin: number; visible: boolean;
}
export interface OnettBuilding { state: number; next: number; hits: number; frame: number; timer: number; anim: number; animFrame: number }
export interface OnettAwning {
  initial: number; accumulator: number; velocity: number;
  counterPrev: number; counter: number; flag: number; cooldown: number;
}
export interface OnettRuntime {
  /** Right-to-left hazard car (item states 2–5: the 30% hits). */
  a: OnettCarMachine;
  /** Left-to-right car (item state 0: scriptless, harmless). */
  b: OnettCarMachine;
  warning: number;
  building: OnettBuilding;
  awnings: [OnettAwning, OnettAwning];
}
const randi = (physics: MeleePhysics, n: number): number => Math.floor(physics.random() * n);
const range = (physics: MeleePhysics, lo: number, hi: number): number =>
  Math.floor(lo + physics.random() * (hi - lo));
export function createOnettRuntime(physics: MeleePhysics): OnettRuntime {
  randi(physics, 4); // grOnett_801E41C8 rolls curr_car, then parks it at 4
  const machine = (x: number): OnettCarMachine =>
    ({ state: 0, car: 4, timer: 0, sub: 0, speed: 0, x, spin: 0, visible: false });
  return {
    a: machine(ONETT_SPAWN_X), b: machine(ONETT_DESPAWN_X), warning: 0,
    building: { state: -1, next: 0, hits: 0, frame: 0, timer: 0, anim: 0, animFrame: 0 },
    awnings: [
      { initial: 0, accumulator: 0, velocity: 0, counterPrev: 0, counter: 0, flag: 0, cooldown: 0 },
      { initial: 0, accumulator: 0, velocity: 0, counterPrev: 0, counter: 0, flag: 0, cooldown: 0 },
    ],
  };
}
export interface OnettFighterInfo { low: boolean; rank: number; count: number }
/** One frame of both car machines; mirrors grOnett_801E43E0 control flow
 * (including the A-despawn early return that skips B that frame). */
export function stepOnettCars(
  rt: OnettRuntime, data: OnettData, physics: MeleePhysics,
  fighters: ReadonlyArray<OnettFighterInfo>, sounds: number[], warn: () => void,
): void {
  const t = data.tuning, a = rt.a, b = rt.b;
  switch (a.state) {
    case 0: {
      const old = a.car;
      a.car = old;
      while (a.car === old || a.car === b.car) a.car = randi(physics, 4);
      a.x = ONETT_SPAWN_X; a.spin = 0; a.state = 1; a.timer = t.waitCar;
      break;
    }
    case 1:
      if (a.timer !== 0) a.timer -= 1;
      else {
        a.timer = t.stillWait;
        a.speed = -(t.speedRange * physics.random() + t.speedBase);
        a.state = 2;
      }
      break;
    case 2:
      if (a.timer !== 0) {
        a.timer -= 1;
        for (const fighter of fighters) {
          if (!fighter.low) continue;
          if (fighters.length === 1 || fighter.rank === 0) {
            a.timer = 0; a.visible = true; a.state = 5;
          } else if (fighter.rank === fighters.length - 1) {
            a.timer = t.rankDelayLast; a.state = 3;
          } else {
            a.timer = t.rankDelayMid; a.state = 3;
          }
          a.sub = 0;
        }
      } else {
        a.timer = 0; a.sub = 0; a.visible = true; a.state = 5;
      }
      break;
    case 3:
      if (a.timer !== 0) a.timer -= 1;
      else { a.timer = 0; a.sub = 0; a.visible = true; a.state = 5; }
      break;
    case 4:
      a.spin = f32(a.spin + (Math.PI / 180) * t.spinRate);
      a.x = f32(a.x + a.speed);
      if (a.x <= ONETT_DESPAWN_X) { a.visible = false; a.state = 0; return; }
      break;
    case 5:
    case 6: {
      a.x = f32(a.x + a.speed);
      switch (a.sub) {
        case 0:
          if (a.x <= 580) {
            sounds.push([0x5F377, 0x5F377, 0x5F379, 0x5F37B][a.car]!);
            warn(); a.sub = 1;
          }
          break;
        case 1:
          if (a.x <= ONETT_HONK_X && fighters.some((fighter) => fighter.low)) {
            sounds.push([0x5F370, 0x5F370, 0x5F371, 0x5F372][a.car]!);
            a.sub = 2;
          }
        // fallthrough
        case 2:
          if (a.x <= ONETT_HONK_DONE_X) a.sub = 4;
          break;
        case 4: break;
      }
      if (a.x <= ONETT_DESPAWN_X) { a.visible = false; a.state = 0; return; }
      break;
    }
  }
  switch (b.state) {
    case 0: {
      const old = b.car;
      b.car = old;
      while (b.car === old || b.car === a.car) b.car = randi(physics, 4);
      b.x = ONETT_DESPAWN_X; b.spin = 0; b.state = 1; b.timer = t.waitCar;
      return;
    }
    case 1:
      if (b.timer !== 0) b.timer -= 1;
      else {
        b.timer = t.stillWait;
        b.speed = t.speedRange * physics.random() + t.speedBase;
        b.state = 2;
      }
      return;
    case 2:
      if (b.timer !== 0) b.timer -= 1;
      else { b.timer = 0; b.visible = true; b.sub = 0; b.state = 5; }
      return;
    case 5:
      b.x = f32(b.x + b.speed);
      if (b.sub === 0 && b.x >= -513) {
        sounds.push([0x5F376, 0x5F376, 0x5F378, 0x5F37A][b.car]!);
        b.sub = 4;
      }
      if (b.x >= ONETT_SPAWN_X) { b.visible = false; b.state = 0; }
      break;
  }
}
/** grOnett_801E5030: the hazard car's reaction to dealing damage. */
export function onettCarHitReact(rt: OnettRuntime, physics: MeleePhysics, sounds: number[]): void {
  const a = rt.a;
  if (a.state === 4) {
    sounds.push(physics.random() < 0.5 ? 0x5F37C : 0x5F37D);
  } else if (randi(physics, 2) !== 0) {
    a.speed = f32(a.speed + 0.5 + physics.random());
    if (Math.abs(a.speed) < 0.5) a.speed = 0.5;
    a.state = 4; a.sub = 4; a.timer = 1;
    sounds.push(randi(physics, 2) !== 0 ? 0x5F37C : 0x5F37D);
  } else {
    a.state = 6;
  }
}
/** grOnett_801E40E4: building contact rules per state. */
export function onettBuildingHit(rt: OnettRuntime, data: OnettData): void {
  const building = rt.building, t = data.tuning;
  switch (building.state) {
    case 4:
    case 5: break;
    case 0:
      building.hits += 1;
      building.next = building.hits < t.buildHits ? 1 : 2;
      return;
    case 3:
      building.hits += 1;
      building.next = building.hits < t.rebuildHits ? 4 : 5;
      break;
    default: break;
  }
}
function buildingAnimEnded(data: OnettData, building: OnettBuilding): boolean {
  const end = data.buildingClipEnds[building.anim];
  if (end === null || end === undefined) return building.animFrame >= 127;
  return building.animFrame >= end;
}
/** grOnett_801E3DA0: the center-building state machine. Returns false while
 * the rooftop lines stay live (states 0–4), true once phased out (5–7). */
export function stepOnettBuilding(rt: OnettRuntime, data: OnettData, physics: MeleePhysics, sounds: number[]): boolean {
  const building = rt.building, t = data.tuning;
  building.frame += 1;
  if (building.animFrame < 100000) building.animFrame += 1;
  switch (building.state) {
    case 7:
      building.timer -= 1;
      if (building.timer < 0) building.next = 0;
      break;
    case 1:
      if (buildingAnimEnded(data, building)) building.next = 0;
      break;
    case 2:
      if (building.frame === 0x8c) sounds.push(0x5F373);
      if (buildingAnimEnded(data, building)) building.next = 3;
      break;
    case 4:
      if (buildingAnimEnded(data, building)) building.next = 3;
      break;
    case 5:
      if (building.frame === 0x46 || building.frame === 0x82) sounds.push(0x5F374);
      if (buildingAnimEnded(data, building)) {
        building.timer = range(physics, Math.round(t.rubbleMin), Math.round(t.rubbleMax));
        building.next = 6;
      }
      if (building.frame === 0x14 || building.frame === 0x5a) { /* rooftop phases out below */ }
      break;
    case 6:
      building.timer -= 1;
      if (building.timer < 0) { building.next = 7; building.timer = 0x3c; }
      break;
    default: break;
  }
  if (building.state !== building.next) {
    building.state = building.next;
    switch (building.state) {
      case 7: building.anim = 0; building.animFrame = 0; break;
      case 1: building.anim = 1; building.animFrame = 0; break;
      case 2: building.anim = 3; building.animFrame = 0; break;
      case 4: building.anim = 4; building.animFrame = 0; break;
      case 5: building.anim = 5; building.animFrame = 0; break;
      case 6: building.hits = 0; break;
      default: break;
    }
    building.frame = 0;
  }
  return building.state === 5 || building.state === 6 || building.state === 7;
}
/** grOnett_801E54B4: contact on an awning's lines feeds its spring. */
export function onettAwningTouch(rt: OnettRuntime, data: OnettData, awning: 0 | 1): void {
  const spring = rt.awnings[awning]!;
  spring.flag = 1;
  spring.initial = data.tuning.awningInitial;
  spring.accumulator = f32(spring.accumulator + data.tuning.awningDelta);
  spring.counter += 1;
}
/** grOnett_801E5214: exact spring port (f32 throughout). */
export function stepOnettAwnings(rt: OnettRuntime, data: OnettData, sounds: number[]): void {
  const t = data.tuning;
  for (const spring of rt.awnings) {
    if (spring.accumulator < -t.maxDisplacement) spring.accumulator = -t.maxDisplacement;
    const disp = spring.accumulator;
    const error = f32(disp - spring.velocity);
    let force = f32(spring.initial + t.springConstant);
    const ratio = f32(Math.abs(error) / t.maxDisplacement);
    force = error < 0 ? f32(-(t.springForce * ratio - force)) : f32(t.springForce * ratio + force);
    force = f32(force - t.springConstant);
    force = f32(force * (1 - t.damping));
    if (force > t.maxVelocity) force = t.maxVelocity;
    else if (force < -t.maxVelocity) force = -t.maxVelocity;
    if (Math.abs(spring.velocity - disp) < t.posThreshold && Math.abs(force) < t.velThreshold) {
      spring.velocity = disp;
      spring.initial = 0;
    } else {
      spring.initial = force;
      spring.velocity = f32(spring.velocity + force);
      if (spring.velocity > t.maxDisplacement) spring.velocity = t.maxDisplacement;
      else if (spring.velocity < -t.maxDisplacement) spring.velocity = -t.maxDisplacement;
    }
    if (spring.cooldown === 0 && (spring.counterPrev !== spring.counter || spring.flag !== 0)) {
      sounds.push(0x5F375);
      spring.cooldown = 0xa;
    }
    spring.accumulator = 0;
    spring.counterPrev = spring.counter;
    spring.counter = 0;
    spring.flag = 0;
    if (spring.cooldown !== 0) spring.cooldown -= 1;
  }
}
