/** Bounded procedural platform remixes ("rift floors").
 * Guardrails: solid (`!oneWay`) floors are NEVER moved, so native spawns,
 * blast zones, ledges and grounded logic stay identical to the original stage.
 * Only pass-through (`oneWay`) platforms are jittered vertically within a small
 * bound, plus at most oneextra seeded pass-through platform inside the main
 * span. The stage model/rendering is untouched, so remixes are labeled
 * "visuals approximate" in the UI. Slopes stay within `MAX_FLOOR_SLOPE` from
 * `lib/game/data.ts`; anything steeper is clamped, never simulated.
 */
import { MAX_FLOOR_SLOPE, type Floor, type StageGameplayData } from '../data.ts';
import type { StageId } from '../stages.ts';
import { createRng } from './seed.ts';

export interface RiftRemix {
  baseStage: StageId;
  seed: number;
  label: string;
  /** Vertical shift per one-way floor id. */
  shifts: Readonly<Record<number, number>>;
  extra: { x: number; y: number; halfWidth: number } | null;
}

export const RIFT_JITTER = 2.5;
const EXTRA_HALF_WIDTH = 9;
const EXTRA_CLEARANCE = 6;

/** Plan shifts against a real stage: one bounded shift per one-way floor.
 * Deterministic for a (stage, seed) pair; pure with no simulation access. */
export function planRiftRemixForStage(baseStage: StageId, seed: number, stage: StageGameplayData): RiftRemix {
  const rng = createRng((seed ^ 0x51f15e) >>> 0);
  const shifts: Record<number, number> = {};
  for (const floor of stage.floors) {
    if (floor.oneWay) shifts[floor.id] = Math.fround((rng() * 2 - 1) * RIFT_JITTER);
  }
  const extra = rng() < 0.5
    ? {
        x: Math.fround((rng() * 2 - 1) * Math.max(4, (stage.mainRight - stage.mainLeft) / 6)),
        y: Math.fround(12 + rng() * 8),
        halfWidth: EXTRA_HALF_WIDTH,
      }
    : null;
  return {
    baseStage,
    seed,
    label: `RIFT ${baseStage.toUpperCase()} · #${(seed % 1000).toString().padStart(3, '0')}`,
    shifts: Object.freeze(shifts),
    extra,
  };
}

const slopeOk = (floor: Floor): boolean => {
  const run = Math.abs(floor.a[0] - floor.b[0]);
  const rise = Math.abs(floor.a[1] - floor.b[1]);
  if (rise <= 0.01) return true;
  return run >= 0.001 && rise / run <= MAX_FLOOR_SLOPE;
};

/** Apply a remix to live stage data. Solid floors are returned untouched; the
 * result keeps blast zones, spawns, ledges, surfaces and scale identical. */
export function applyRiftRemix(stage: StageGameplayData, remix: RiftRemix): StageGameplayData {
  const floors = stage.floors.map((floor) => {
    if (!floor.oneWay) return floor;
    const shift = remix.shifts[floor.id] ?? 0;
    if (!Number.isFinite(shift) || shift === 0) return floor;
    const moved: Floor = {
      ...floor,
      a: [floor.a[0], Math.fround(floor.a[1] + shift)],
      b: [floor.b[0], Math.fround(floor.b[1] + shift)],
    };
    return slopeOk(moved) ? moved : floor;
  });
  if (remix.extra) {
    const { x, y, halfWidth } = remix.extra;
    if ([x, y, halfWidth].every(Number.isFinite) && halfWidth >= 3 && halfWidth <= 20) {
      const clearOfBlast = x - halfWidth > stage.blast.left + 4 && x + halfWidth < stage.blast.right - 4 && y > stage.blast.bottom + EXTRA_CLEARANCE && y < stage.blast.top - EXTRA_CLEARANCE;
      const overlapsSolid = stage.floors.some(
        (floor) => !floor.oneWay && x + halfWidth >= Math.min(floor.a[0], floor.b[0]) - 1 && x - halfWidth <= Math.max(floor.a[0], floor.b[0]) + 1 && Math.abs(y - (floor.a[1] + floor.b[1]) / 2) < 3,
      );
      if (clearOfBlast && !overlapsSolid) {
        const id = Math.max(...floors.map((floor) => floor.id)) + 1;
        floors.push({ id, a: [Math.fround(x - halfWidth), Math.fround(y)], b: [Math.fround(x + halfWidth), Math.fround(y)], oneWay: true });
      }
    }
  }
  return { ...stage, floors };
}
