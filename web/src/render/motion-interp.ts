/** Cosmetic high-refresh motion interpolation (presentation only).
 *
 * The simulation stays on its fixed 60 Hz accumulator (see
 * web/src/play/game-session.ts); this module only extrapolates rendered
 * positions/poses a fraction of a tick forward so 120/144/165 Hz displays
 * see unique motion every RAF instead of duplicated 60 Hz steps.
 *
 * Nothing here touches authoritative state, snapshots, hashes or rollback:
 * callers must render from copies and never write the results back into the
 * match. All helpers are pure for unit tests. */

export interface InterpSnapshot {
  x: number;
  y: number;
  animation: string;
  animationFrame: number;
  facing: number;
  frame: number;
}

export interface InterpEntry {
  prev?: InterpSnapshot;
  curr?: InterpSnapshot;
}

/** Rendered motion snaps (no blend) past this jump: respawns, teleports and
 * stage transforms move far more per tick than any run, fall or launch. */
export const MOTION_TELEPORT_SNAP = 50;

/** Fast articles (lasers, missiles) legitimately cover more ground per tick
 * than any fighter, so their snap distance is far more generous. */
export const POINT_TELEPORT_SNAP = 160;

export function clampVisualAlpha(alpha: unknown): number {
  const value = typeof alpha === 'number' ? alpha : 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Shift the tracked pair forward only when a new simulation frame arrived.
 * Same-frame re-renders keep the pair so velocity survives across the 2-3
 * RAFs between 60 Hz steps. Rollbacks and resim corrections (same frame with
 * a new revision) reset to a snap. */
export function trackSimSnapshot(
  entry: InterpEntry,
  curr: InterpSnapshot,
  revisionChanged: boolean,
): InterpEntry {
  if (revisionChanged || !entry.curr) return { prev: undefined, curr };
  if (entry.curr.frame === curr.frame) return entry;
  if (curr.frame < entry.curr.frame) return { prev: undefined, curr };
  return { prev: entry.curr, curr };
}

/** True when blending would streak across a teleport, respawn or action cut. */
export function shouldSnapFighter(
  prev: InterpSnapshot | undefined,
  curr: InterpSnapshot,
): boolean {
  if (!prev) return true;
  if (prev.animation !== curr.animation) return true;
  if (curr.frame < prev.frame) return true;
  if (curr.frame === prev.frame) return false;
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  return Math.hypot(dx, dy) > MOTION_TELEPORT_SNAP;
}

/** Forward-extrapolated root position: exactly the display instant
 * (latest sim + leftover accumulator), with no added frame of latency. */
export function extrapolatePosition(
  prev: InterpSnapshot,
  curr: InterpSnapshot,
  alpha: number,
): { x: number; y: number } {
  const t = clampVisualAlpha(alpha);
  if (t <= 0) return { x: curr.x, y: curr.y };
  return { x: curr.x + (curr.x - prev.x) * t, y: curr.y + (curr.y - prev.y) * t };
}

/** Forward-extrapolated animation clock. Snaps on action changes, loop wraps
 * and rewinds so a new clip never blends from the old clip's tail. */
export function extrapolateAnimationFrame(
  prev: InterpSnapshot,
  curr: InterpSnapshot,
  alpha: number,
): number {
  const t = clampVisualAlpha(alpha);
  if (t <= 0) return curr.animationFrame;
  if (prev.animation !== curr.animation) return curr.animationFrame;
  if (curr.frame < prev.frame) return curr.animationFrame;
  if (curr.animationFrame < prev.animationFrame) return curr.animationFrame;
  return curr.animationFrame + (curr.animationFrame - prev.animationFrame) * t;
}

export interface PointSnapshot {
  x: number;
  y: number;
  frame: number;
}

export interface PointEntry {
  prev?: PointSnapshot;
  curr?: PointSnapshot;
}

export function trackPointSnapshot(
  entry: PointEntry,
  curr: PointSnapshot,
  revisionChanged: boolean,
): PointEntry {
  if (revisionChanged || !entry.curr) return { prev: undefined, curr };
  if (entry.curr.frame === curr.frame) return entry;
  if (curr.frame < entry.curr.frame) return { prev: undefined, curr };
  return { prev: entry.curr, curr };
}

export function shouldSnapPoint(
  prev: PointSnapshot | undefined,
  curr: PointSnapshot,
): boolean {
  if (!prev) return true;
  if (curr.frame < prev.frame) return true;
  if (curr.frame === prev.frame) return false;
  return Math.hypot(curr.x - prev.x, curr.y - prev.y) > POINT_TELEPORT_SNAP;
}

export function extrapolatePoint(
  prev: PointSnapshot,
  curr: PointSnapshot,
  alpha: number,
): { x: number; y: number } {
  const t = clampVisualAlpha(alpha);
  if (t <= 0) return { x: curr.x, y: curr.y };
  return { x: curr.x + (curr.x - prev.x) * t, y: curr.y + (curr.y - prev.y) * t };
}
