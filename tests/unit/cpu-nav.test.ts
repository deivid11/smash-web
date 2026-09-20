import { describe, expect, it } from 'vitest';
import type { Floor, StageGameplayData, StageSurface } from '../../lib/game/data.ts';
import { blocked, ceilingAbove, floorUnder, islandAt, navGraph, nearestIsland, nextLink } from '../../lib/game/cpu-nav.ts';

/** A synthetic two-tier stage: ground, a soft platform above it, and a raised block with a wall face. */
function stage(): StageGameplayData {
  const floors: Floor[] = [
    { id: 0, a: [-60, 0], b: [60, 0], oneWay: false },
    { id: 1, a: [-30, 30], b: [0, 30], oneWay: true },
    { id: 2, a: [60, 25], b: [100, 25], oneWay: false },
    { id: 3, a: [100, 25], b: [120, 20], oneWay: false },
    { id: 4, a: [-200, -80], b: [-150, -80], oneWay: false },
  ];
  const surfaces: StageSurface[] = [
    ...floors.map(floor => ({ ...floor, kind: 'floor' as const })),
    { id: 10, kind: 'wall', a: [60, 25], b: [60, 0], oneWay: false },
    { id: 11, kind: 'ceiling', a: [-160, -60], b: [-190, -60], oneWay: false },
  ];
  return { scale: 1, floors, surfaces, ledges: [], blast: { left: -300, right: 300, top: 200, bottom: -200 }, spawns: [[0, 0, 0], [10, 0, 0]], mainLeft: -60, mainRight: 120 };
}

describe('CPU navigation graph', () => {
  const data = stage(), graph = navGraph(data);
  it('groups end-to-end floors into islands and keeps soft platforms separate', () => {
    expect(graph.islands.map(island => island.floors.map(floor => floor.id))).toEqual([[0], [1], [2, 3], [4]]);
    expect(graph.islands[2]).toMatchObject({ minX: 60, maxX: 120, oneWay: false });
    expect(islandAt(graph, data, 110, 22, 3)).toBe(2); expect(islandAt(graph, data, 110, 26, null)).toBe(2); expect(islandAt(graph, data, 300, 0, null)).toBeNull();
  });
  it('links islands by jumps, drops and walk-offs and paths through them', () => {
    const kinds = (from: number, to: number) => graph.links.filter(link => link.from === from && link.to === to).map(link => link.kind).sort();
    expect(kinds(0, 1)).toEqual(['jump']); expect(kinds(1, 0)).toEqual(['drop', 'walk']); expect(kinds(0, 2)).toEqual(['jump']); expect(kinds(2, 0)).toEqual(['walk']);
    expect(nextLink(graph, 0, 1)?.kind).toBe('jump'); expect(nextLink(graph, 1, 2)?.to).toBe(0); expect(nextLink(graph, 0, 0)).toBeNull();
    // The far pit under a ceiling has no way up, and nothing reaches it either.
    expect(nextLink(graph, 3, 0)).toBeNull(); expect(nextLink(graph, 0, 3)).toBeNull();
    const up = nextLink(graph, 0, 2)!; expect(up.targetX).toBeGreaterThanOrEqual(65); expect(up.targetY).toBe(25);
  });
  it('sees walls and ceilings when checking a movement', () => {
    expect(blocked(data, 50, 10, 70, 10)).toBe(true); expect(blocked(data, 50, 30, 70, 30)).toBe(false);
    expect(ceilingAbove(data, -170, -80, 30)).toBe(true); expect(ceilingAbove(data, -170, -80, 10)).toBe(false); expect(ceilingAbove(data, 0, 0, 100)).toBe(false);
    expect(blocked(data, -170, -50, -170, -70)).toBe(false); // ceilings only block upward motion
  });
  it('finds the floor under a point and the island nearest to a pinned target', () => {
    expect(floorUnder(data, -10, 40)?.id).toBe(1); expect(floorUnder(data, -10, 10)?.id).toBe(0); expect(floorUnder(data, 200, 0)).toBeNull();
    // A target pinned on the block's wall face is nearest to the ground below it; one hovering just over the platform belongs to the platform.
    expect(nearestIsland(graph, 61, 10)).toBe(0); expect(nearestIsland(graph, 61, 24)).toBe(2); expect(nearestIsland(graph, -10, 33)).toBe(1); expect(nearestIsland(graph, -175, -70)).toBe(3);
  });
});
