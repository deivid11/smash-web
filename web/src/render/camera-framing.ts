export interface FramingPoint { readonly x: number; readonly y: number }
export interface ClassicCameraStage { readonly mainLeft: number; readonly mainRight: number; readonly floors: ReadonlyArray<{ readonly a: readonly [number, number]; readonly b: readonly [number, number] }>; readonly blast: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } }
export interface ClassicCameraLimits { readonly cxLo: number; readonly cxHi: number; readonly cyLo: number; readonly cyHi: number; readonly maxDistance: number }
/** Pan/zoom bounds for the classic 1–4 player camera. The Battlefield-era constants
 * remain the inner bounds so small stages frame exactly as before; wide or tall
 * stages (Temple, Corneria) expand so no living fighter can leave the frame. */
export function classicCameraLimits(stage: Partial<ClassicCameraStage> | undefined, aspect: number): ClassicCameraLimits {
  const legacy: ClassicCameraLimits = { cxLo: -55, cxHi: 55, cyLo: 12, cyHi: 90, maxDistance: 360 };
  if (!stage?.floors?.length || !Number.isFinite(stage.mainLeft) || !Number.isFinite(stage.mainRight) || !Number.isFinite(aspect) || aspect <= 0) return legacy;
  const floorXs = stage.floors.flatMap((floor) => [floor.a[0], floor.b[0]]);
  const floorYs = stage.floors.flatMap((floor) => [floor.a[1], floor.b[1]]);
  if (![...floorXs, ...floorYs].every(Number.isFinite)) return legacy;
  const stageHalf = Math.max((Math.max(...floorYs) - Math.min(...floorYs)) / 2 + 35, (Math.max(...floorXs) - Math.min(...floorXs)) / 2 / aspect + 35);
  return {
    cxLo: Math.min(-55, stage.mainLeft! + 30), cxHi: Math.max(55, stage.mainRight! - 30),
    cyLo: Math.min(12, Math.min(...floorYs) + 12), cyHi: Math.max(90, Math.max(...floorYs) + 36),
    maxDistance: Math.max(360, stageHalf / Math.tan(21 * Math.PI / 180)),
  };
}
export interface FramingInsets { readonly top: number; readonly bottom: number }
export interface FocusOptions { readonly maxOthers?: number; readonly maxDistance?: number; readonly minDistance?: number }
/** Player-prioritized framing for crowded (>4) matches. Fits the focus fighter
 * plus its single nearest rival — everyone else leaves the frame while
 * the focus stays centered and close. The fitted bounds are mirrored across
 * the focus horizontally so the focus sits at the frame center, not at the
 * edge of a lopsided pair; KO drama points pull unmirrored and briefly.
 * Cosmetic only; reuses the crowd fit math and its fast-out/slow-in easing.
 */
export function focusCameraFrame(me: FramingPoint, others: readonly FramingPoint[], width: number, height: number, previous?: Pick<CrowdFrame, 'target' | 'distance'>, fov = 42, insets?: FramingInsets, options: FocusOptions = {}, koFocus: readonly FramingPoint[] = []): CrowdFrame {
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.y) || !Array.isArray(others) || !Array.isArray(koFocus) || others.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Invalid cosmetic camera bounds.');
  const maxOthers = options.maxOthers ?? 1;
  if (!Number.isInteger(maxOthers) || maxOthers < 0 || maxOthers > 7) throw new Error('Invalid cosmetic camera bounds.');
  const maxDistance = options.maxDistance ?? 200;
  if (!Number.isFinite(maxDistance) || maxDistance < MIN_DISTANCE) throw new Error('Invalid cosmetic camera bounds.');
  const minDistance = options.minDistance ?? 130;
  if (!Number.isFinite(minDistance) || minDistance < 50 || minDistance > maxDistance) throw new Error('Invalid cosmetic camera bounds.');
  const nearest = [...others]
    .sort((a, b) => (a.x - me.x) ** 2 + (a.y - me.y) ** 2 - ((b.x - me.x) ** 2 + (b.y - me.y) ** 2))
    .slice(0, maxOthers);
  // Mirror the pair across the focus so the fitted center lands on the focus.
  const mirrored = nearest.map(point => ({ x: 2 * me.x - point.x, y: point.y }));
  const frame = crowdCameraFrame([me, ...nearest, ...mirrored, ...koFocus], width, height, previous, fov, insets, minDistance);
  // Hold a close-up rather than fitting the arena: clamp both ends (raising
  // the floor past the crowd minimum is safe — extra distance only ever fits
  // more). Feeding the clamped distance back as `previous` keeps the zoom
  // stable at the caps until the pair genuinely tightens or spreads.
  return { ...frame, distance: Math.min(Math.max(frame.distance, minDistance), maxDistance), requiredDistance: Math.min(Math.max(frame.requiredDistance, minDistance), maxDistance) };
}
export interface CrowdFrame { readonly target: FramingPoint; readonly distance: number; readonly requiredDistance: number; readonly viewportHeight: number; readonly offsetTop: number }
export const CROWD_CAMERA_LIFT = 32;
const MIN_DISTANCE = 165;

/** Cosmetic framing only. Fit an 8-corner body/head-tag envelope to the actual
 * tilted perspective, reserving pixel margins for labels. The target may ease,
 * but the fit is recomputed against that eased target: sudden spread/resize can
 * never spend multiple frames outside the frustum while zooming out.
 */
export function crowdCameraFrame(points: readonly FramingPoint[], width: number, height: number, previous?: Pick<CrowdFrame, 'target' | 'distance'>, fov = 42, insets?: FramingInsets, minDistance: number = MIN_DISTANCE): CrowdFrame {
  if (!points.length || ![width, height, fov].every(Number.isFinite) || width <= 0 || height <= 0 || fov <= 0 || fov >= 179 || !Number.isFinite(minDistance) || minDistance <= 0 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)) || (previous && ![previous.target.x, previous.target.y, previous.distance].every(Number.isFinite))) throw new Error('Invalid cosmetic camera bounds.');
  const left = Math.min(...points.map(point => point.x)) - 10, right = Math.max(...points.map(point => point.x)) + 10;
  const bottom = Math.min(...points.map(point => point.y)) - 5, top = Math.max(...points.map(point => point.y)) + 32;
  const center = {x: (left + right) / 2, y: (bottom + top) / 2};
  const target = previous ? {x: previous.target.x + (center.x - previous.target.x) * 0.12, y: previous.target.y + (center.y - previous.target.y) * 0.12} : center;
  // Reserve actual overlay bounds when supplied. Responsive fallbacks cover the
  // single-row eight-player HUD before React's first layout, including short landscape.
  let offsetTop = insets?.top ?? Math.min(138, height * 0.3);
  let bottomInset = insets?.bottom ?? (height <= 600 ? 130 : width <= 620 ? 150 : 140);
  if (![offsetTop, bottomInset].every(Number.isFinite) || offsetTop < 0 || bottomInset < 0) throw new Error('Invalid cosmetic camera insets.');
  const maximumInsets = Math.max(0, height - 64);
  if (offsetTop + bottomInset > maximumInsets) { const scale = maximumInsets / (offsetTop + bottomInset); offsetTop *= scale; bottomInset *= scale; }
  const viewportHeight = height - offsetTop - bottomInset;
  const tan = Math.tan(fov * Math.PI / 360), horizontal = tan * width / viewportHeight * Math.max(0.35, 1 - 96 / width), vertical = tan * Math.max(0.35, 1 - 48 / viewportHeight);
  const fits = (distance: number) => {
    const length = Math.hypot(distance, CROWD_CAMERA_LIFT);
    for (const x of [left, right]) for (const y of [bottom, top]) for (const z of [-10, 10]) {
      const dy = y - target.y;
      const depth = length - (CROWD_CAMERA_LIFT * dy + distance * z) / length;
      const viewY = (distance * dy - CROWD_CAMERA_LIFT * z) / length;
      if (depth <= 0.5 || Math.abs(x - target.x) > depth * horizontal || Math.abs(viewY) > depth * vertical) return false;
    }
    return true;
  };
  let low = minDistance, high = minDistance;
  while (!fits(high)) { high *= 2; if (!Number.isFinite(high)) throw new Error('Cosmetic camera bounds exceed finite range.'); }
  if (high !== minDistance) for (let iteration = 0; iteration < 24; iteration++) { const middle = (low + high) / 2; if (fits(middle)) high = middle; else low = middle; }
  const requiredDistance = high + 1; // Small numerical guard beyond the fitted envelope.
  const distance = !previous || requiredDistance >= previous.distance ? requiredDistance : previous.distance + (requiredDistance - previous.distance) * 0.12;
  return {target, distance, requiredDistance, viewportHeight, offsetTop};
}
/** Extra height easing per renderer frame for crowded (>4) shots. The exact
 * fit already eases toward the previous target; this settles the remainder
 * so a nearest-rival swap every few frames reads as drift, not a yank.
 * The focus seat stays glued on x (the mirrored fit centers it exactly). */
export const CROWD_SETTLE_RATE = 0.5;
/** Max zoom growth per renderer frame for crowded shots: genuine spreads
 * still catch up within ~10 frames while pair-swap snaps are crushed. */
export const CROWD_ZOOM_GROWTH = 1.08;
export const CROWD_ZOOM_STEP = 4;
/** Settle one target axis toward the exact fit. Rate 1 tracks exactly. */
export function settleFrameTarget(previous: number, next: number, rate: number = CROWD_SETTLE_RATE): number {
  if (!Number.isFinite(previous) || !Number.isFinite(next) || !Number.isFinite(rate) || rate <= 0 || rate > 1) throw new Error('Invalid cosmetic camera bounds.');
  return previous + (next - previous) * rate;
}
/** Cap zoom growth per renderer frame; shrinking always follows the eased fit. */
export function settleFrameDistance(previous: number, next: number, growth: number = CROWD_ZOOM_GROWTH, step: number = CROWD_ZOOM_STEP): number {
  if (!Number.isFinite(previous) || !Number.isFinite(next) || !Number.isFinite(growth) || growth < 1 || !Number.isFinite(step) || step < 0) throw new Error('Invalid cosmetic camera bounds.');
  return previous > 0 ? Math.min(next, previous * growth + step) : next;
}
/** The stage camera range in world units (Stage_GetCamBounds*Offset). */
export interface CameraBounds { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
/** Camera_8002958C: a subject past the stage camera range pulls the camera only as far as the
 * range's edge, so a launched fighter leaves the shot (and gets the off-screen magnifier). */
export function clampToCameraBounds(point: FramingPoint, bounds: CameraBounds): FramingPoint {
  return { x: Math.min(bounds.right, Math.max(bounds.left, point.x)), y: Math.min(bounds.top, Math.max(bounds.bottom, point.y)) };
}
/** Camera_8002A768 for a look-at camera at (target.x, target.y + lift, distance) aimed at the
 * target: project the four frustum corners onto the z=0 plane and shift the shot so none of
 * them shows past the camera range. A view wider (or taller) than the range sits centred
 * between both edges, as the original averages the two overlaps. Translation only: the zoom
 * is left alone. */
export function confineCameraTarget(target: FramingPoint, distance: number, lift: number, fov: number, aspect: number, bounds: CameraBounds): FramingPoint {
  if (![target.x, target.y, distance, lift, fov, aspect, bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite) || distance <= 0 || aspect <= 0 || fov <= 0 || fov >= 179 || bounds.right <= bounds.left || bounds.top <= bounds.bottom) return target;
  const length = Math.hypot(lift, distance), fy = -lift / length, fz = -distance / length;
  // Camera basis: right = +x; up = right × forward.
  const uy = -fz, uz = fy;
  const tanV = Math.tan(fov * Math.PI / 360), tanH = tanV * aspect;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const dx = sx * tanH, dy = fy + sy * tanV * uy, dz = fz + sy * tanV * uz;
    if (dz > -0.001) continue; // a corner above the horizon never meets the plane
    const t = -distance / dz, x = target.x + t * dx, y = target.y + lift + t * dy;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const left = minX < bounds.left ? bounds.left - minX : 0, right = maxX > bounds.right ? bounds.right - maxX : 0;
  const top = maxY > bounds.top ? bounds.top - maxY : 0, bottom = minY < bounds.bottom ? bounds.bottom - minY : 0;
  const shiftX = left && right ? 0.5 * (left + right) : left || right;
  const shiftY = top && bottom ? 0.5 * (top + bottom) : top || bottom;
  return { x: target.x + shiftX, y: target.y + shiftY };
}
