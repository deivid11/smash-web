import { floorY, type StageGameplayData } from './data.ts';
import type { V3 } from '../hsd/model.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from './limits.ts';

/** Original point-table scope, intentionally independent of the prototype capacity. */
const NATIVE_SPAWN_SLOTS = 4;
const EDGE_MARGIN = 8;
const MINIMUM_SEPARATION = 12;

/** Native positions are retained for 2–4 fighters. For 5–8, ALL slots use an
 * explicitly prototype-only, evenly spaced layout across the stage's main span:
 * each seat drops onto the topmost solid floor at its x (slopes included), and an
 * uncovered x slides to the nearest solid segment. This is not an original Melee
 * eight-player rule or an edit to the stage's native spawn data.
 */
export function matchSpawnPoints(stage: StageGameplayData, playerCount: number): V3[] {
  if (!Number.isInteger(playerCount) || playerCount < MIN_MATCH_PLAYERS || playerCount > MAX_MATCH_PLAYERS) throw new Error('Invalid spawn player count.');
  if (playerCount <= NATIVE_SPAWN_SLOTS) return Array.from({length: playerCount}, (_, slot) => {
    const native = stage.spawns[slot];
    return native ? [...native] : [stage.mainLeft + (stage.mainRight - stage.mainLeft) * (slot + 1) / (playerCount + 1), 0, 0];
  });
  const solid = stage.floors
    .filter(floor => !floor.oneWay && [...floor.a, ...floor.b].every(Number.isFinite))
    .map(floor => ({ left: Math.min(floor.a[0], floor.b[0]), right: Math.max(floor.a[0], floor.b[0]), floor }))
    .filter(span => span.right - span.left > 0.001);
  if (!solid.length) throw new Error('Stage has no solid floor for the prototype spawn layout.');
  const left = Math.max(stage.mainLeft, stage.blast.left + EDGE_MARGIN) + EDGE_MARGIN;
  const right = Math.min(stage.mainRight, stage.blast.right - EDGE_MARGIN) - EDGE_MARGIN;
  if (right - left < MINIMUM_SEPARATION * (playerCount - 1)) throw new Error('Stage has no sufficiently wide main span for the prototype spawn layout.');
  // The topmost solid surface at x, kept clear of the blast margins.
  const surfaceY = (x: number): number | null => {
    const tops = solid.filter(span => x >= span.left - 0.001 && x <= span.right + 0.001)
      .map(span => floorY(span.floor, x))
      .filter(y => y > stage.blast.bottom + EDGE_MARGIN && y < stage.blast.top - EDGE_MARGIN);
    return tops.length ? Math.max(...tops) : null;
  };
  return Array.from({length: playerCount}, (_, slot) => {
    let x = Math.fround(left + (right - left) * slot / (playerCount - 1));
    let y = surfaceY(x);
    if (y === null) {
      // No solid coverage at this x (a pit): slide to the closest solid segment.
      const nearest = solid.map(span => ({ span, x: Math.max(span.left + 0.5, Math.min(span.right - 0.5, x)) }))
        .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x) || a.x - b.x)[0]!;
      x = Math.fround(nearest.x); y = surfaceY(x) ?? floorY(nearest.span.floor, x);
    }
    return [x, y, 0] as V3;
  });
}
