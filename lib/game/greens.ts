/** Green Greens prototype stage logic (grgreens.c, GrGr.dat).
 * Verified original values below come from the pinned decomp
 * (third_party/melee/src/melee/gr/grgreens.c) and a local GrGr.dat inspection:
 * yakumono timers/weights/speeds/bounds, the 5x6 block grid
 * derived from the 30 block JObjs (root 6 j5-j34 at model
 * [-85,-75,-65,65,75,85] x [-15,-5,5,15,25], stage scale 0.75), block size
 * 7.6x7.5 (floors 0-29, ceilings 47-76, right walls 80-109, left walls
 * 119-148; area 30 is the static terrain), the 18-block opening layout and
 * the idle/wind/apples cycle [0,1,0,1,0,2,0,1,0,2].
 *
 * PROTOTYPE approximations, never original claims: block floors are stitched
 * 10 wide (x+-5) so adjacent resting blocks form solid walls like the
 * original's mpLib_800581DC joint stitching (the native 7.6-wide lines leave
 * 2.4 gaps); bomb blasts are direct radial hits (damage/radius/angle are
 * placeholders, original block blast values unported) through the original
 * shield/knockback pipeline, and apples reuse Foods (Whispy apple heal/damage
 * unported); wind buildup/recover animations, camera quakes and particles are
 * not simulated; the tree lean is a root offset, not the archived blow clips.
 * Deterministic via the match RNG (HSD_Randi semantics) and fully
 * snapshot-owned for rollback (see capture/restore in lib/game/match.ts).
 */
import type { Floor, StageSurface } from './data.ts';
import type { MeleePhysics } from './physics.ts';

export const GREENS_ROWS = 5;
export const GREENS_COLS = 6;
export const GREENS_COUNT = 30;
/** World X per column (model -85,-75,-65,65,75,85 x0.75). */
export const GREENS_GRID_X = [-63.75, -56.25, -48.75, 48.75, 56.25, 63.75] as const;
/** World Y (block bottom) per row (model -15,-5,5,15,25 x0.75). */
export const GREENS_GRID_Y = [-11.25, -3.75, 3.75, 11.25, 18.75] as const;
export const GREENS_BLOCK_HALF_W = 5;
export const GREENS_BLOCK_H = 7.5;
const GREENS_SPACING = 7.5;
/** Original block line ids: floors 0-29, ceilings 47-76, right walls 80-109, left walls 119-148. */
const GREENS_CEIL_BASE = 47;
const GREENS_RWALL_BASE = 80;
const GREENS_LWALL_BASE = 119;
/** yakumono block spawn window (x0=30, x4=150). */
const GREENS_BLOCK_MIN = 30;
const GREENS_BLOCK_MAX = 150;
/** Column weights by highest occupied row (empty=x1C=40, row0=x18=20, row1=x14=10, row2=x10=5, row3=xC=1, row4=x8=0). */
const GREENS_W_EMPTY = 40;
const GREENS_W_ROW = [20, 10, 5, 1, 0] as const;
/** Bomb denominator (x20=12: Randi(12)==0 is a bomb, ~1/12). */
const GREENS_BOMB_DENOM = 12;
/** Falling physics (x30=0.02 accel, x2C=5 max) from the blast top. */
const GREENS_FALL_ACCEL = 0.02;
const GREENS_FALL_MAX = 5;
export const GREENS_BLAST_TOP = 147.75;
/** Wind (x34=800, x38=1800 idle; x3C=0.24 speed; bounds x40=0,x44=90,x48=40,x4C=-10; blow x54=35 frames). */
const GREENS_WIND_MIN = 800;
const GREENS_WIND_MAX = 1800;
export const GREENS_WIND_SPEED = 0.24;
export const GREENS_WIND_LEFT = 0;
export const GREENS_WIND_RIGHT = 90;
export const GREENS_WIND_TOP = 40;
export const GREENS_WIND_BOTTOM = -10;
const GREENS_WIND_BLOW = 36;
/** Apples (x5C=2,x60=5 count 1-4; x64=40 first, x68=16 cadence; x6C=25,x70=35 height, +-40 x). */
const GREENS_APPLE_MIN = 1;
const GREENS_APPLE_MAX = 4;
const GREENS_APPLE_FIRST = 40;
const GREENS_APPLE_EVERY = 16;
const GREENS_APPLE_Y0 = 25;
const GREENS_APPLE_Y1 = 35;
const GREENS_APPLE_X = 40;
const GREENS_APPLE_RECOVER = 30;
/** Event cycle (grGr_803E7734): 0 idle, 1 wind, 2 apples. */
const GREENS_CYCLE = [0, 1, 0, 1, 0, 2, 0, 1, 0, 2] as const;
/** Opening layout indices (row*6+col) from grGreens_80214B58's 18 BOMB slots. */
const GREENS_OPENING = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 23] as const;
/** BOMB() call order (determines RNG consumption): 0x12,0x0C,0x0D,0x06,0x07,0x08,0x00,0x01,0x02,0x17,0x10,0x11,0x09,0x0A,0x0B,0x03,0x04,0x05. */
const GREENS_BOMB_ORDER = [18, 12, 13, 6, 7, 8, 0, 1, 2, 23, 16, 17, 9, 10, 11, 3, 4, 5] as const;

export type GreensStatus = 0 | 1 | 2 | 3;
export interface GreensBlock { status: GreensStatus; bomb: boolean; y: number; vy: number }
export interface GreensRuntime {
  blocks: GreensBlock[];
  spawnTimer: number;
  cycle: number;
  phase: 0 | 1 | 2;
  phaseTimer: number;
  windDir: 0 | 1;
  /** 0 calm, 1 blowing left (-speed), 2 blowing right (+speed). */
  windActive: 0 | 1 | 2;
  applesLeft: number;
  applesTotal: number;
  appleSide: 0 | 1;
}

const f32 = Math.fround;
const randi = (physics: MeleePhysics, n: number): number => (n <= 0 ? 0 : Math.floor(physics.random() * n));
/** grgreens.c randrange (handles min>max for wind/apple timers). */
const randrange = (physics: MeleePhysics, min: number, max: number): number => {
  if (min > max) {
    const diff = min - max;
    return max + (diff !== 0 ? randi(physics, diff) : 0);
  }
  if (min < max) {
    const diff = max - min;
    return min + (diff !== 0 ? randi(physics, diff) : 0);
  }
  return min;
};
export const greensIndex = (row: number, col: number): number => row * GREENS_COLS + col;
export const greensRow = (index: number): number => Math.floor(index / GREENS_COLS);
export const greensCol = (index: number): number => index % GREENS_COLS;
export const greensTargetY = (row: number): number => GREENS_GRID_Y[row]!;
export const greensX = (col: number): number => GREENS_GRID_X[col]!;

export function createGreensRuntime(physics: MeleePhysics): GreensRuntime {
  const blocks: GreensBlock[] = Array.from({ length: GREENS_COUNT }, () => ({ status: 0 as GreensStatus, bomb: false, y: 0, vy: 0 }));
  // Opening 18 resting blocks; bomb flags consume RNG in BOMB() order first.
  const bombs = new Map<number, boolean>();
  for (const index of GREENS_BOMB_ORDER) bombs.set(index, randi(physics, GREENS_BOMB_DENOM) === 0);
  for (const index of GREENS_OPENING) {
    const row = greensRow(index);
    blocks[index] = { status: 3, bomb: bombs.get(index) ?? false, y: greensTargetY(row), vy: 0 };
  }
  const spawnTimer = randrange(physics, GREENS_BLOCK_MIN, GREENS_BLOCK_MAX);
  // Wind init (grGreens_802139C4 order after blocks): idle timer then direction.
  const phaseTimer = randrange(physics, GREENS_WIND_MAX, GREENS_WIND_MIN);
  const windDir = randi(physics, 2) as 0 | 1;
  return { blocks, spawnTimer, cycle: 0, phase: 0, phaseTimer, windDir, windActive: 0, applesLeft: 0, applesTotal: 0, appleSide: 0 };
}

export interface GreensStepOut { apples: Array<{ x: number; y: number }>; windStarted: boolean; windEnded: boolean }

/** Advances blocks, the spawn clock and the wind/apple cycle one frame. Apple
 * positions are returned for the match to spawn as Foods (prototype proxy);
 * the match applies windActive push and drives the tree lean. */
export function stepGreens(runtime: GreensRuntime, physics: MeleePhysics): GreensStepOut {
  const out: GreensStepOut = { apples: [], windStarted: false, windEnded: false };
  // Block spawn clock (grGreens_802166C4: post-decrement <0 fires).
  runtime.spawnTimer--;
  if (runtime.spawnTimer < 0) {
    trySpawnBlock(runtime, physics);
    runtime.spawnTimer = randrange(physics, GREENS_BLOCK_MIN, GREENS_BLOCK_MAX);
  }
  stepFalling(runtime);
  stepCycle(runtime, physics, out);
  return out;
}

function columnTop(runtime: GreensRuntime, col: number): number {
  for (let row = GREENS_ROWS - 1; row >= 0; row--) {
    if (runtime.blocks[greensIndex(row, col)]!.status !== 0) return row;
  }
  return -1;
}

function trySpawnBlock(runtime: GreensRuntime, physics: MeleePhysics): void {
  // Weights by stack height (grGreens_802166C4).
  const weights: number[] = [];
  for (let col = 0; col < GREENS_COLS; col++) {
    const top = columnTop(runtime, col);
    weights[col] = top < 0 ? GREENS_W_EMPTY : GREENS_W_ROW[top]!;
  }
  let leftFull = false;
  let rightFull = false;
  for (let k = 0; k < 3; k++) {
    if (weights[k] === 0) leftFull = true;
    if (weights[k + 3] === 0) rightFull = true;
  }
  let cols: number[];
  if (!leftFull) cols = !rightFull ? [0, 1, 2, 3, 4, 5] : [0, 1, 2];
  else if (!rightFull) cols = [3, 4, 5];
  else return;
  let total = 0;
  for (const col of cols) total += weights[col]!;
  if (total <= 0) return;
  let pick = randi(physics, total);
  let col = cols[0]!;
  for (const candidate of cols) {
    pick -= weights[candidate]!;
    if (pick < 0) { col = candidate; break; }
  }
  // Lowest empty slot (bottom-up first free).
  let row = GREENS_ROWS - 1;
  while (row > 0 && runtime.blocks[greensIndex(row - 1, col)]!.status === 0) row--;
  if (runtime.blocks[greensIndex(row, col)]!.status !== 0) return;
  const bomb = randi(physics, GREENS_BOMB_DENOM) === 0;
  runtime.blocks[greensIndex(row, col)] = { status: 1, bomb, y: GREENS_BLAST_TOP, vy: 0 };
}

function stepFalling(runtime: GreensRuntime): void {
  // Bottom-up per column so stacks follow (grGreens_80215ED8).
  for (let col = 0; col < GREENS_COLS; col++) {
    for (let row = 0; row < GREENS_ROWS; row++) {
      const index = greensIndex(row, col);
      const block = runtime.blocks[index]!;
      if (block.status !== 1) continue;
      block.vy = Math.min(GREENS_FALL_MAX, block.vy + GREENS_FALL_ACCEL);
      block.y = f32(block.y - block.vy);
      const target = greensTargetY(row);
      // Stack on a falling block below (become status 2).
      if (row > 0) {
        const below = runtime.blocks[greensIndex(row - 1, col)]!;
        if ((below.status === 1 || below.status === 2) && block.y - below.y < GREENS_SPACING) {
          block.status = 2;
          block.y = f32(below.y + GREENS_SPACING);
        }
      }
      if (block.status !== 1) continue;
      if (block.y <= target) {
        // Land and settle any consecutive stack above (original next_row loop).
        block.y = target; block.vy = 0; block.status = 3;
        for (let r = row + 1; r < GREENS_ROWS; r++) {
          const above = runtime.blocks[greensIndex(r, col)]!;
          if (above.status !== 2) break;
          above.y = greensTargetY(r); above.vy = 0; above.status = 3;
        }
      } else {
        // Carry any consecutive stack above while still falling.
        for (let r = row + 1; r < GREENS_ROWS; r++) {
          const above = runtime.blocks[greensIndex(r, col)]!;
          if (above.status !== 2) break;
          above.y = f32(block.y + (r - row) * GREENS_SPACING);
        }
      }
    }
    // Status-2 blocks whose below vanished keep following down (gap closes next frames).
    for (let row = 1; row < GREENS_ROWS; row++) {
      const block = runtime.blocks[greensIndex(row, col)]!;
      if (block.status !== 2) continue;
      const below = runtime.blocks[greensIndex(row - 1, col)]!;
      if (below.status === 0) {
        // No support: start falling independently (prototype compaction assist).
        block.status = 1;
      } else if (below.status === 3) {
        block.y = greensTargetY(row); block.vy = 0; block.status = 3;
      } else {
        block.y = f32(below.y + GREENS_SPACING);
      }
    }
  }
}

function stepCycle(runtime: GreensRuntime, physics: MeleePhysics, out: GreensStepOut): void {
  if (runtime.phase === 0) {
    runtime.windActive = 0;
    runtime.phaseTimer--;
    if (runtime.phaseTimer <= 0) advanceCycle(runtime, physics, out);
    return;
  }
  if (runtime.phase === 1) {
    // Prototype wind: immediate blow for the original 36 frames (x54).
    if (runtime.phaseTimer === GREENS_WIND_BLOW) {
      runtime.windActive = (runtime.windDir === 0 ? 1 : 2) as 0 | 1 | 2;
      out.windStarted = true;
    }
    runtime.phaseTimer--;
    if (runtime.phaseTimer <= 0) {
      runtime.windActive = 0;
      out.windEnded = true;
      advanceCycle(runtime, physics, out);
    }
    return;
  }
  // Apples: 1-4 Foods from the canopy, first at 40f then every 16f.
  runtime.phaseTimer++;
  if (runtime.applesLeft > 0 && runtime.phaseTimer >= GREENS_APPLE_FIRST &&
    (runtime.phaseTimer - GREENS_APPLE_FIRST) % GREENS_APPLE_EVERY === 0) {
    const sign = runtime.appleSide === 0 ? -1 : 1;
    const x = f32(sign * GREENS_APPLE_X * physics.random());
    const y = f32(GREENS_APPLE_Y0 + (GREENS_APPLE_Y1 - GREENS_APPLE_Y0) * physics.random());
    out.apples.push({ x, y });
    runtime.applesLeft--;
    runtime.appleSide = ((runtime.appleSide + 1) & 1) as 0 | 1;
  }
  if (runtime.applesLeft <= 0 && runtime.phaseTimer >= applePhaseLength(runtime)) advanceCycle(runtime, physics, out);
}

function applePhaseLength(runtime: GreensRuntime): number {
  const count = Math.max(GREENS_APPLE_MIN, runtime.applesTotal);
  return GREENS_APPLE_FIRST + GREENS_APPLE_EVERY * Math.max(0, count - 1) + GREENS_APPLE_RECOVER;
}

function advanceCycle(runtime: GreensRuntime, physics: MeleePhysics, out: GreensStepOut): void {
  void out;
  runtime.cycle = (runtime.cycle + 1) % GREENS_CYCLE.length;
  const phase = GREENS_CYCLE[runtime.cycle]! as 0 | 1 | 2;
  runtime.phase = phase;
  runtime.windActive = 0;
  if (phase === 0) {
    runtime.phaseTimer = randrange(physics, GREENS_WIND_MAX, GREENS_WIND_MIN);
  } else if (phase === 1) {
    runtime.windDir = randi(physics, 2) as 0 | 1;
    runtime.phaseTimer = GREENS_WIND_BLOW;
  } else {
    const count = GREENS_APPLE_MIN + randi(physics, GREENS_APPLE_MAX - GREENS_APPLE_MIN + 1);
    runtime.applesLeft = count;
    runtime.applesTotal = count;
    runtime.phaseTimer = 0;
    runtime.appleSide = randi(physics, 2) as 0 | 1;
  }
}

/** Floors for every live block (falling and resting carry collision, like the
 * original joint lines). Stitched 10 wide so neighbours form solid walls. */
export function greensFloors(runtime: GreensRuntime): Floor[] {
  const floors: Floor[] = [];
  for (let row = 0; row < GREENS_ROWS; row++) {
    for (let col = 0; col < GREENS_COLS; col++) {
      const block = runtime.blocks[greensIndex(row, col)]!;
      if (block.status === 0) continue;
      const x = greensX(col);
      const top = f32(block.y + GREENS_BLOCK_H);
      floors.push({ id: greensIndex(row, col), a: [f32(x - GREENS_BLOCK_HALF_W), top], b: [f32(x + GREENS_BLOCK_HALF_W), top], oneWay: false });
    }
  }
  return floors;
}

/** Ceilings/walls mirror the floor ids into the original line ranges. */
export function greensSurfaces(runtime: GreensRuntime): StageSurface[] {
  const surfaces: StageSurface[] = [];
  for (let row = 0; row < GREENS_ROWS; row++) {
    for (let col = 0; col < GREENS_COLS; col++) {
      const block = runtime.blocks[greensIndex(row, col)]!;
      if (block.status === 0) continue;
      const x = greensX(col);
      const y = block.y;
      const top = f32(y + GREENS_BLOCK_H);
      const index = greensIndex(row, col);
      surfaces.push({ id: GREENS_CEIL_BASE + index, kind: 'ceiling', a: [f32(x + GREENS_BLOCK_HALF_W), y], b: [f32(x - GREENS_BLOCK_HALF_W), y], oneWay: false });
      surfaces.push({ id: GREENS_RWALL_BASE + index, kind: 'wall', a: [f32(x + GREENS_BLOCK_HALF_W), top], b: [f32(x + GREENS_BLOCK_HALF_W), y], oneWay: false });
      surfaces.push({ id: GREENS_LWALL_BASE + index, kind: 'wall', a: [f32(x - GREENS_BLOCK_HALF_W), y], b: [f32(x - GREENS_BLOCK_HALF_W), top], oneWay: false });
    }
  }
  return surfaces;
}

/** Block whose stitched box contains (x,y) within margin, or -1. */
export function greensBlockAt(runtime: GreensRuntime, x: number, y: number, margin: number): number {
  for (let row = 0; row < GREENS_ROWS; row++) {
    for (let col = 0; col < GREENS_COLS; col++) {
      const index = greensIndex(row, col);
      const block = runtime.blocks[index]!;
      if (block.status === 0) continue;
      const cx = greensX(col);
      if (x >= cx - GREENS_BLOCK_HALF_W - margin && x <= cx + GREENS_BLOCK_HALF_W + margin &&
        y >= block.y - margin && y <= block.y + GREENS_BLOCK_H + margin) return index;
    }
  }
  return -1;
}

/** Ceiling surface id back to its block index, or -1 when not a Greens block. */
export function greensBlockForCeiling(id: number): number {
  const index = id - GREENS_CEIL_BASE;
  return index >= 0 && index < GREENS_COUNT ? index : -1;
}

/** Removes a block (status->empty) and compacts falling stacks above per
 * grGreens_80215D54 (resting blocks stay floating). Returns its bomb/pos. */
export function removeGreensBlock(runtime: GreensRuntime, index: number): { bomb: boolean; x: number; y: number } {
  const row = greensRow(index);
  const col = greensCol(index);
  const block = runtime.blocks[index]!;
  const pos = { bomb: block.bomb, x: greensX(col), y: f32(block.y + GREENS_BLOCK_H / 2) };
  runtime.blocks[index] = { status: 0, bomb: false, y: 0, vy: 0 };
  // Compact falling (1/2) blocks above empty slots below (original column shift).
  for (let restart = 0; restart < GREENS_ROWS; restart++) {
    let moved = false;
    for (let r = 1; r < GREENS_ROWS; r++) {
      const upper = runtime.blocks[greensIndex(r, col)]!;
      const lower = runtime.blocks[greensIndex(r - 1, col)]!;
      if ((upper.status === 1 || upper.status === 2) && lower.status === 0) {
        runtime.blocks[greensIndex(r - 1, col)] = { ...upper, status: upper.status === 2 ? 1 : upper.status };
        runtime.blocks[greensIndex(r, col)] = { status: 0, bomb: false, y: 0, vy: 0 };
        moved = true;
        break;
      }
    }
    void row;
    if (!moved) break;
  }
  return pos;
}

/** Neighbour blocks within radius of (x,y) for bomb chains (centers). */
export function greensNeighbors(runtime: GreensRuntime, x: number, y: number, radius: number): number[] {
  const found: number[] = [];
  for (let row = 0; row < GREENS_ROWS; row++) {
    for (let col = 0; col < GREENS_COLS; col++) {
      const index = greensIndex(row, col);
      const block = runtime.blocks[index]!;
      if (block.status === 0) continue;
      const cx = greensX(col);
      const cy = f32(block.y + GREENS_BLOCK_H / 2);
      if (Math.hypot(cx - x, cy - y) <= radius) found.push(index);
    }
  }
  return found;
}
