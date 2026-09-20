import type { HsdArchive } from '../hsd/archive.ts';
import type { MeleePhysics } from './physics.ts';

/** Peach's Castle Banzai Bill hazard (grcastle.c castle2/castle12 + Bill item).
 * Snapshot-owned, driven only by the simulation RNG, stepped once per simulation
 * frame — the Onett/Greens/Stadium pattern — so rollback re-simulation reproduces
 * every launch exactly.
 *
 * Verified against third_party/melee/src/melee/gr/grcastle.c:
 * - Bill manager creates gobjs 18/19/20 (tiny 8x4 locals) via grCastle_801CF7B0;
 *   respawn timer xD2 rolls between yakumono x0 and x2 (60–800 frames here).
 * - Slot picker de-weights the repeat slot by x6 and picks among 3 visual roots;
 *   target picker rolls 11 TargetTable entries (castle + yellow-platform joints).
 * - Flight itself is a grMaterial item (Item_GObj) with hit/end callbacks
 *   fn_801CFAFC/fn_801CFB68 dealing yakumono x4 via ftLib_80086A4C, plus camera quake.
 *
 * Prototype approximations (explicit, not original engine):
 * - Flight is straight horizontal at prototype speed across the blast box, at a
 *   prototype height band, not the original spline/angle spread (lb_800119DC).
 * - Visual is one of map roots 18/19/20 scaled up (original foreground plane and
 *   per-Bill scale animation unported); parked Bills stay hidden.
 * - Explosion is a prototype radial (original blast values unported, like Green
 *   Greens bombs in lib/game/match.ts); shields hold. Sounds/gfx reuse the common
 *   bomb bank (original Bill bank unported).
 * - RNG order is repeatable and browser-deterministic via physics.random(), but
 *   makes no claim of GameCube HSD_Randi equivalence (separate test scopes).
 */

export interface PeachBillData {
  scale: number;
  spawnMin: number;
  spawnMax: number;
  damage: number;
  speed: number;
  radius: number;
  yMin: number;
  yMax: number;
  boomFrames: number;
  edgeMargin: number;
}

const f32 = Math.fround;
function s16(arc: HsdArchive, base: number, offset: number, label: string, min: number, max: number): number {
  const value = arc.u16(base + offset);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Unsupported Peach Bill yakumono ${label}.`);
  return value;
}

export function parsePeachBillData(arc: HsdArchive): PeachBillData {
  const scale = arc.f32(arc.symbol('grGroundParam'));
  if (!(scale > 0.1) || scale > 5) throw new Error('Unsupported Peach Bill stage scale.');
  if (!arc.symbols.has('yakumono_param')) throw new Error('Peach is missing its stage tuning.');
  const y = arc.symbol('yakumono_param');
  const spawnMin = s16(arc, y, 0x00, 'spawn min', 1, 10000);
  const spawnMax = s16(arc, y, 0x02, 'spawn max', 1, 10000);
  const damage = s16(arc, y, 0x04, 'bill damage', 1, 100);
  if (spawnMax < spawnMin) throw new Error('Unsupported Peach Bill spawn window.');
  return {
    scale,
    spawnMin, spawnMax, damage,
    speed: 10,
    radius: 25,
    yMin: 85, yMax: 135,
    boomFrames: 20,
    edgeMargin: 60,
  };
}

export interface PeachBillRuntime {
  /** 0 idle (hidden, counting to spawn), 1 flying (live, hittable), 2 boom (hidden, gfx playing). */
  state: 0 | 1 | 2;
  timer: number;
  x: number; y: number; vx: number;
  /** Visual root slot 0..2 → map roots 18/19/20. */
  slot: number;
  boom: number;
}

const randi = (physics: MeleePhysics, n: number): number => Math.floor(physics.random() * n);

export function createPeachBillRuntime(physics: MeleePhysics, data: PeachBillData): PeachBillRuntime {
  const timer = data.spawnMin + randi(physics, data.spawnMax - data.spawnMin + 1);
  return { state: 0, timer, x: 0, y: 0, vx: 0, slot: 0, boom: 0 };
}

/** One frame of the Bill manager. Returns true when a launch gfx/sound is due.
 * No allocation; early-outs unless peach-castle with live data. Caller provides
 * blast bounds and scratch sound list (same pattern as stepOnettCars). */
export function stepPeachBill(
  rt: PeachBillRuntime, data: PeachBillData, physics: MeleePhysics,
  blastLeft: number, blastRight: number, sounds: number[],
): boolean {
  if (rt.state === 0) {
    if (rt.timer > 0) rt.timer -= 1;
    if (rt.timer > 0) return false;
    const fromLeft = physics.random() < 0.5;
    const y = f32(data.yMin + physics.random() * (data.yMax - data.yMin));
    const slot = randi(physics, 3);
    rt.slot = slot;
    rt.y = y;
    if (fromLeft) { rt.x = f32(blastLeft - data.edgeMargin); rt.vx = f32(data.speed); }
    else { rt.x = f32(blastRight + data.edgeMargin); rt.vx = f32(-data.speed); }
    rt.state = 1;
    rt.boom = 0;
    rt.timer = Math.ceil((blastRight - blastLeft + data.edgeMargin * 4) / data.speed);
    sounds.push(0x68fb7);
    return true;
  }
  if (rt.state === 1) {
    rt.x = f32(rt.x + rt.vx);
    if (rt.timer > 0) rt.timer -= 1;
    if (rt.timer <= 0 || rt.x < blastLeft - data.edgeMargin * 2 || rt.x > blastRight + data.edgeMargin * 2) {
      rt.state = 0;
      rt.timer = data.spawnMin + randi(physics, data.spawnMax - data.spawnMin + 1);
      rt.boom = 0;
    }
    return false;
  }
  if (rt.boom > 0) rt.boom -= 1;
  if (rt.boom <= 0 && rt.state === 2) {
    rt.state = 0;
    rt.timer = data.spawnMin + randi(physics, data.spawnMax - data.spawnMin + 1);
  }
  return false;
}

/** Detonate at the current position: hide the missile, play boom, radial hits applied by match. */
export function detonatePeachBill(rt: PeachBillRuntime, data: PeachBillData, sounds: number[]): void {
  if (rt.state !== 1) return;
  rt.state = 2;
  rt.boom = data.boomFrames;
  rt.timer = 0;
  sounds.push(0x68fb7);
}
