/**
 * Original off-screen magnifier math (third_party/melee/src/melee/if/ifmagnify.c). Pure and
 * unit-tested; web/src/render/magnifier.ts draws it.
 *
 * - A fighter is "off-screen" when its camera bone (CmSubject bone_pos) projects outside the
 *   screen (Camera_80030BBC, via ftLib_80086A8C).
 * - ifMagnify_802FB8C0 aims a ray from the screen centre at that point, clips it to a fixed
 *   rectangle (±252.7 × ±162.7 of 640×480) and puts the lupe there, arrow rotated toward the
 *   fighter.
 * - ifMagnify_802FBBDC renders the fighter alone through an ortho camera centred on the bone
 *   (half extent 0.1 × 64 texels × camera-box zoom / 8) over a background blended from the
 *   stage's 3×3 grGroundParam colour grid.
 *
 * Wide screens keep the original 67.3-pixel side inset (in 480-line pixels) instead of
 * stretching the 4:3 rectangle, and the rectangle is laid out inside the area our HUD bars
 * leave free (the original HUD never covered its lupe positions); with no insets it is
 * exactly the original rectangle.
 */
import type { CameraBounds } from './camera-framing.ts';

/** IfAll.dat "lupe" joint geometry in HUD units (probed from the USA v1.02 disc): part 1 is the
 * arrow (tip 5.732, base 3.854 ± 0.646), joint 2 the ring (2.772–3.33) around the 64×64
 * render texture disc (radius 2.772, UVs spanning its diameter). */
export const LUPE = Object.freeze({ ringOuter: 3.33, ringInner: 2.772, arrowTip: 5.732, arrowBase: 3.854, arrowHalfWidth: 0.646, texels: 64 });
/** IfAll ScInfDmg_scene_data camera: perspective, fov 41.539°, aspect 1.2167, eye z 64. */
const HUD_HALF_HEIGHT = 64 * Math.tan(41.539 * Math.PI / 360);
const HUD_ASPECT = 1.2166670560836792;
/** 480-line pixels per HUD unit (vertical; the ring is drawn round with this scale). */
export const HUD_PIXELS_PER_UNIT = 240 / HUD_HALF_HEIGHT;
/** ifMagnify_802FB8C0 translate: 0.09125 × edge.x, 0.1 × edge.y HUD units, back in pixels. */
const PLACE_X = 0.09125 * 320 / (HUD_HALF_HEIGHT * HUD_ASPECT), PLACE_Y = 0.1 * HUD_PIXELS_PER_UNIT;
/** ifMagnify_802FB73C clip rectangle (640×480 pixels from the centre). */
export const MAGNIFY_EDGE_X = 252.70001, MAGNIFY_EDGE_Y = 162.7;
/** ifMagnifyPlayer.state.edge: 1 top, 2 left, 3 bottom, 4 right. */
export type MagnifyEdge = 1 | 2 | 3 | 4;

/** ifMagnify_802FB73C: clip the centre→fighter direction to the edge rectangle. */
export function magnifyEdge(dx: number, dy: number, halfX = MAGNIFY_EDGE_X, halfY = MAGNIFY_EDGE_Y): { x: number; y: number; edge: MagnifyEdge } {
  let x: number, y: number;
  if (dx === 0) { y = dy > 0 ? halfY : -halfY; x = 0; }
  else {
    const ratio = dy / dx, limit = halfY / halfX;
    if (ratio > limit || ratio < -limit) {
      y = dy > 0 ? halfY : -halfY;
      x = Math.max(-halfX, Math.min(halfX, y * dx / dy));
    } else {
      x = dx > 0 ? halfX : -halfX;
      y = Math.max(-halfY, Math.min(halfY, x * dy / dx));
    }
  }
  const edge: MagnifyEdge = x === -halfX ? 2 : x === halfX ? 4 : y === halfY ? 1 : 3;
  return { x, y, edge };
}

export interface MagnifyPlacement {
  /** Lupe centre in CSS pixels (y down). */
  x: number; y: number;
  /** Arrow rotation (radians, counter-clockwise from +x on screen). */
  rotation: number;
  edge: MagnifyEdge;
  /** CSS pixels per HUD unit, for the LUPE dimensions. */
  unit: number;
}
/** Where the lupe sits for a fighter projected at (screenX, screenY) on a width×height view
 * whose top/bottom `insets` (CSS pixels) are covered by HUD bars. */
export function magnifyPlacement(screenX: number, screenY: number, width: number, height: number, insets: { top: number; bottom: number } = { top: 0, bottom: 0 }): MagnifyPlacement {
  const scale = height / 480;
  const top = Math.max(0, insets.top), bottom = Math.max(0, insets.bottom), free = Math.max(0, height - top - bottom);
  const centerX = width / 2, centerY = top + free / 2;
  const dx = (screenX - centerX) / scale, dy = -(screenY - centerY) / scale;
  const halfX = Math.max(1, width / 2 / scale - (320 - MAGNIFY_EDGE_X));
  const halfY = Math.max(1, free / 2 / scale - (240 - MAGNIFY_EDGE_Y));
  const edge = magnifyEdge(dx, dy, halfX, halfY);
  return {
    x: centerX + edge.x * PLACE_X * scale, y: centerY - edge.y * PLACE_Y * scale,
    rotation: Math.atan2(dy, dx), edge: edge.edge, unit: HUD_PIXELS_PER_UNIT * scale,
  };
}

/** ifMagnify_802FBBDC ortho half extent (world units) for a fighter's camera-box zoom. */
export function magnifyHalfExtent(magnify: number, modelScale: number): number {
  return 0.1 * LUPE.texels * (magnify * modelScale) / 8;
}

/** ifMagnify_803F984C: grid cells (0-8, row-major from top-left) for each [y class][x class]. */
const CORNERS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0], [0, 1, 0, 1], [1, 2, 1, 2], [2, 2, 2, 2],
  [0, 0, 3, 3], [0, 1, 3, 4], [1, 2, 4, 5], [2, 2, 5, 5],
  [3, 3, 6, 6], [3, 4, 6, 7], [4, 5, 7, 8], [5, 5, 8, 8],
  [6, 6, 6, 6], [6, 7, 6, 7], [7, 8, 7, 8], [8, 8, 8, 8],
];
/** The lupe background (HSD_SetEraseColor) for a fighter at (x, y): the four grid colours
 * around its camera-range cell, bilinearly weighted, as 0xRRGGBBAA. */
export function magnifyBackground(x: number, y: number, bounds: CameraBounds, grid: readonly number[]): number {
  if (grid.length < 9) return 0x000000ff;
  const midX = 0.5 * (bounds.left + bounds.right), midY = 0.5 * (bounds.top + bounds.bottom);
  const xClass = x < bounds.left ? 0 : x > bounds.right ? 3 : x < midX ? 1 : 2;
  const yClass = y > bounds.top ? 0 : y < bounds.bottom ? 3 : y > midY ? 1 : 2;
  const xBlend = xClass === 0 || xClass === 3 ? 0 : xClass === 1 ? 1 - (x - bounds.left) / (midX - bounds.left) : 1 - (x - midX) / (bounds.right - midX);
  const yBlend = yClass === 0 || yClass === 3 ? 0 : yClass === 1 ? 1 - (bounds.top - y) / (bounds.top - midY) : 1 - (midY - y) / (midY - bounds.bottom);
  const xInv = 1 - xBlend, yInv = 1 - yBlend;
  const cells = CORNERS[yClass * 4 + xClass]!, colors = cells.map((cell) => grid[cell]! >>> 0);
  // mix1 → colors[0], mix0 → colors[1], mix2 → colors[2], mix3 → colors[3].
  const weights = [xBlend * yBlend, xInv * yBlend, xBlend * yInv, xInv * yInv];
  let result = 0;
  for (const shift of [24, 16, 8, 0]) {
    let channel = 0;
    for (let i = 0; i < 4; i++) channel += ((colors[i]! >>> shift) & 0xff) * weights[i]!;
    result = (result | (Math.min(255, Math.max(0, Math.trunc(channel))) << shift)) >>> 0;
  }
  return result;
}
