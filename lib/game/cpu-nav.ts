/** Stage navigation graph for CPU players: floors are grouped into walkable islands, and
 * islands are linked by jump, drop-through and walk-off moves that were checked against the
 * stage's wall and ceiling lines. This replaces the original game's hand-authored per-stage
 * waypoint tables (ftCo_803C6594) with an automatic derivation; it is prototype code. */
import type { Floor, StageGameplayData, StageSurface } from './data.ts';

export interface NavIsland { id: number; floors: readonly Floor[]; minX: number; maxX: number; oneWay: boolean }
export interface NavLink { from: number; to: number; kind: 'jump' | 'drop' | 'walk'; x: number; y: number; targetX: number; targetY: number; cost: number }
export interface NavGraph { islands: readonly NavIsland[]; links: readonly NavLink[]; islandByFloor: ReadonlyMap<number, number>; next: Map<string, NavLink | null> }

/** Generous vertical/horizontal reach for jump links; fighters that fall short simply retry. */
const JUMP_RISE = 95, JUMP_SPAN = 48, SAMPLE = 6, ENDPOINT_TOLERANCE = 0.8;
const graphs = new WeakMap<StageGameplayData, NavGraph>();

export function floorYAt(floor: Floor, x: number): number {
  const dx = floor.b[0] - floor.a[0];
  if (Math.abs(dx) < 1e-6) return Math.max(floor.a[1], floor.b[1]);
  const t = Math.max(0, Math.min(1, (x - floor.a[0]) / dx));
  return floor.a[1] + (floor.b[1] - floor.a[1]) * t;
}
/** Highest floor under (x, y) within a small tolerance above, or null over the void. */
export function floorUnder(stage: StageGameplayData, x: number, y: number, tolerance = 2): Floor | null {
  let best: Floor | null = null, bestY = -Infinity;
  for (const floor of stage.floors) {
    const lo = Math.min(floor.a[0], floor.b[0]), hi = Math.max(floor.a[0], floor.b[0]);
    if (x < lo - 0.01 || x > hi + 0.01) continue;
    const fy = floorYAt(floor, x);
    if (fy <= y + tolerance && fy > bestY) { best = floor; bestY = fy; }
  }
  return best;
}
function crosses(surface: StageSurface, ax: number, ay: number, bx: number, by: number): boolean {
  const fx = surface.b[0] - surface.a[0], fy = surface.b[1] - surface.a[1], mx = bx - ax, my = by - ay;
  const denom = mx * fy - my * fx;
  if (Math.abs(denom) < 1e-9) return false;
  const qx = surface.a[0] - ax, qy = surface.a[1] - ay;
  const t = (qx * fy - qy * fx) / denom, s = (qx * my - qy * mx) / denom;
  return t > 0.001 && t < 0.999 && s > 0.001 && s < 0.999;
}
/** True when a straight movement from a to b passes through a wall, or upward through a ceiling. */
export function blocked(stage: StageGameplayData, ax: number, ay: number, bx: number, by: number): boolean {
  for (const surface of stage.surfaces ?? []) {
    if (surface.kind === 'floor') continue;
    if (surface.kind === 'ceiling' && by <= ay) continue;
    if (crosses(surface, ax, ay, bx, by)) return true;
  }
  return false;
}
/** True when a ceiling line sits directly above (x, y) within `height` units. */
export function ceilingAbove(stage: StageGameplayData, x: number, y: number, height: number): boolean {
  return blocked(stage, x, y + 1, x, y + height);
}
function connected(a: Floor, b: Floor, tolerance = ENDPOINT_TOLERANCE): boolean {
  const near = (p: readonly [number, number], q: readonly [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tolerance;
  return near(a.a, b.b) || near(a.b, b.a) || near(a.a, b.a) || near(a.b, b.b);
}
/** Seams the original stitches at runtime (mpLib_800581DC / mpLib_80058560 link terrain joints to the stadium body) can be a few units apart. */
const STITCH_TOLERANCE = 3;
/** Stitched seam: endpoints close together, or spans overlapping at nearly the same height (a terrain edge running along an apron). */
function stitched(a: Floor, b: Floor): boolean {
  if (connected(a, b, STITCH_TOLERANCE)) return true;
  const lo = Math.max(Math.min(a.a[0], a.b[0]), Math.min(b.a[0], b.b[0])), hi = Math.min(Math.max(a.a[0], a.b[0]), Math.max(b.a[0], b.b[0]));
  if (hi - lo < 0.5) return false;
  const mid = (lo + hi) / 2;
  return Math.abs(floorYAt(a, mid) - floorYAt(b, mid)) <= 2;
}
const chainMaps = new WeakMap<StageGameplayData, ReadonlyMap<number, number>>();
/** Floor id → chain id: floors joined end to end regardless of one-way flags, the walkable
 * adjacency the original expresses with its line links (a platform meeting a slope is one chain). */
export function floorChains(stage: StageGameplayData): ReadonlyMap<number, number> {
  const cached = chainMaps.get(stage);
  if (cached) return cached;
  const byFloor = new Map<number, number>();
  let next = 0;
  for (const floor of stage.floors) {
    if (byFloor.has(floor.id)) continue;
    const members: Floor[] = [floor]; byFloor.set(floor.id, next);
    for (let index = 0; index < members.length; index++) for (const other of stage.floors) {
      if (byFloor.has(other.id) || !stitched(members[index]!, other)) continue;
      members.push(other); byFloor.set(other.id, next);
    }
    next++;
  }
  chainMaps.set(stage, byFloor);
  return byFloor;
}
export function navGraph(stage: StageGameplayData): NavGraph {
  const cached = graphs.get(stage);
  if (cached) return cached;
  // Islands: floors joined end to end; solid and one-way floors never share an island.
  const islands: NavIsland[] = [], islandByFloor = new Map<number, number>();
  for (const floor of stage.floors) {
    if (islandByFloor.has(floor.id)) continue;
    const members: Floor[] = [floor]; islandByFloor.set(floor.id, islands.length);
    for (let index = 0; index < members.length; index++) for (const other of stage.floors) {
      if (islandByFloor.has(other.id) || other.oneWay !== floor.oneWay || !connected(members[index]!, other)) continue;
      members.push(other); islandByFloor.set(other.id, islands.length);
    }
    islands.push({ id: islands.length, floors: members, minX: Math.min(...members.flatMap(f => [f.a[0], f.b[0]])), maxX: Math.max(...members.flatMap(f => [f.a[0], f.b[0]])), oneWay: floor.oneWay });
  }
  const samples = (island: NavIsland): { x: number; y: number }[] => {
    const points: { x: number; y: number }[] = [];
    for (const floor of island.floors) {
      const lo = Math.min(floor.a[0], floor.b[0]), hi = Math.max(floor.a[0], floor.b[0]);
      for (let x = lo + 1; x <= hi - 1 + 1e-6; x += SAMPLE) points.push({ x, y: floorYAt(floor, x) });
      points.push({ x: hi - 1, y: floorYAt(floor, hi - 1) });
    }
    return points;
  };
  const links: NavLink[] = [];
  const best = new Map<string, NavLink>();
  const offer = (link: NavLink) => { const key = `${link.from}>${link.to}:${link.kind}`; const current = best.get(key); if (!current || link.cost < current.cost) best.set(key, link); };
  for (const island of islands) {
    const points = samples(island);
    // Drop-through (one-way islands) and walk-off at both ends.
    if (island.oneWay) for (const point of points) { const below = floorUnder(stage, point.x, point.y - 1, 0); if (below) { const to = islandByFloor.get(below.id)!; if (to !== island.id) offer({ from: island.id, to, kind: 'drop', x: point.x, y: point.y, targetX: point.x, targetY: floorYAt(below, point.x), cost: 4 + Math.abs(point.y - floorYAt(below, point.x)) / 40 }); } }
    for (const side of [-1, 1] as const) {
      const edgeX = side < 0 ? island.minX : island.maxX, edgeFloor = island.floors.find(f => Math.min(f.a[0], f.b[0]) === island.minX && side < 0) ?? island.floors.find(f => Math.max(f.a[0], f.b[0]) === island.maxX && side > 0) ?? island.floors[0]!;
      const y = floorYAt(edgeFloor, edgeX), landX = edgeX + side * 6, below = floorUnder(stage, landX, y - 0.5);
      if (below && islandByFloor.get(below.id) !== island.id && !blocked(stage, edgeX, y + 4, landX, floorYAt(below, landX) + 1)) offer({ from: island.id, to: islandByFloor.get(below.id)!, kind: 'walk', x: edgeX - side * 2, y, targetX: landX, targetY: floorYAt(below, landX), cost: 3 + Math.abs(y - floorYAt(below, landX)) / 40 });
    }
    // Jumps to any island whose floor lies within reach, rising first then moving across (or across then up).
    for (const other of islands) {
      if (other === island) continue;
      for (const from of points) for (const to of samples(other)) {
        const dy = to.y - from.y, dx = Math.abs(to.x - from.x);
        if (dy <= 0 || dy > JUMP_RISE || dx > JUMP_SPAN) continue;
        const apexY = to.y + 8;
        const clearRise = !blocked(stage, from.x, from.y + 2, from.x, apexY) && !blocked(stage, from.x, apexY, to.x, apexY) && !blocked(stage, to.x, apexY, to.x, to.y + 1);
        const clearDiagonal = !blocked(stage, from.x, from.y + 2, to.x, apexY) && !blocked(stage, to.x, apexY, to.x, to.y + 1);
        if (!clearRise && !clearDiagonal) continue;
        const inset = other.maxX - other.minX > 12 ? Math.max(other.minX + 5, Math.min(other.maxX - 5, to.x)) : to.x;
        offer({ from: island.id, to: other.id, kind: 'jump', x: from.x, y: from.y, targetX: inset, targetY: to.y, cost: 6 + dy / 25 + dx / 30 });
      }
    }
  }
  links.push(...best.values());
  const graph: NavGraph = { islands, links, islandByFloor, next: new Map() };
  graphs.set(stage, graph);
  return graph;
}
/** First link of the cheapest island path from `from` to `to`, or null when unreachable or equal. */
export function nextLink(graph: NavGraph, from: number, to: number): NavLink | null {
  if (from === to) return null;
  const key = `${from}>${to}`;
  const cached = graph.next.get(key);
  if (cached !== undefined) return cached;
  // Dijkstra over a handful of islands; stages have well under a hundred.
  const distance = new Map<number, number>([[from, 0]]), first = new Map<number, NavLink>(), done = new Set<number>();
  while (true) {
    let current: number | null = null, currentDistance = Infinity;
    for (const [island, d] of distance) if (!done.has(island) && d < currentDistance) { current = island; currentDistance = d; }
    if (current === null) break;
    if (current === to) break;
    done.add(current);
    for (const link of graph.links) {
      if (link.from !== current) continue;
      const total = currentDistance + link.cost;
      if (total < (distance.get(link.to) ?? Infinity)) { distance.set(link.to, total); first.set(link.to, current === from ? link : first.get(current)!); }
    }
  }
  const result = first.get(to) ?? null;
  graph.next.set(key, result);
  return result;
}
/** Island whose floor is nearest to a point (for targets hanging in the air or pinned on walls). */
export function nearestIsland(graph: NavGraph, x: number, y: number): number | null {
  let best: number | null = null, bestDistance = Infinity;
  for (const island of graph.islands) for (const floor of island.floors) {
    const lo = Math.min(floor.a[0], floor.b[0]), hi = Math.max(floor.a[0], floor.b[0]), cx = Math.max(lo, Math.min(hi, x));
    const distance = Math.hypot(cx - x, floorYAt(floor, cx) - y) + (floorYAt(floor, cx) > y ? 20 : 0);
    if (distance < bestDistance) { bestDistance = distance; best = island.id; }
  }
  return best;
}
export function islandAt(graph: NavGraph, stage: StageGameplayData, x: number, y: number, floorId: number | null): number | null {
  if (floorId !== null) { const island = graph.islandByFloor.get(floorId); if (island !== undefined) return island; }
  const floor = floorUnder(stage, x, y, 3);
  return floor ? graph.islandByFloor.get(floor.id) ?? null : null;
}
