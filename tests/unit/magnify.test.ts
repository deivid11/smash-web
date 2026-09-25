import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { LUPE, HUD_PIXELS_PER_UNIT, MAGNIFY_EDGE_X, MAGNIFY_EDGE_Y, magnifyBackground, magnifyEdge, magnifyHalfExtent, magnifyPlacement } from '../../web/src/render/magnify.ts';
import { clampToCameraBounds, confineCameraTarget, type CameraBounds } from '../../web/src/render/camera-framing.ts';

describe('ifMagnify edge placement (ifMagnify_802FB73C / 802FB8C0)', () => {
  it('clips the centre→fighter ray to the ±252.7 × ±162.7 rectangle and names the edge', () => {
    expect(magnifyEdge(-900, 0)).toEqual({ x: -MAGNIFY_EDGE_X, y: 0, edge: 2 });
    expect(magnifyEdge(900, 90)).toEqual({ x: MAGNIFY_EDGE_X, y: MAGNIFY_EDGE_X * 90 / 900, edge: 4 });
    expect(magnifyEdge(0, 500)).toEqual({ x: 0, y: MAGNIFY_EDGE_Y, edge: 1 });
    const below = magnifyEdge(100, -400);
    expect(below.edge).toBe(3); expect(below.y).toBe(-MAGNIFY_EDGE_Y); expect(below.x).toBeCloseTo(100 * MAGNIFY_EDGE_Y / 400, 5);
    // The corner diagonal (ratio 0.6438464) still resolves to a side, like the original compare.
    expect(magnifyEdge(MAGNIFY_EDGE_X, MAGNIFY_EDGE_Y).edge).toBe(4);
  });
  it('places the lupe ~70/79 px in from a 640×480 edge with the arrow aimed at the fighter', () => {
    const left = magnifyPlacement(-200, 240, 640, 480);
    expect(left.edge).toBe(2); expect(Math.cos(left.rotation)).toBeCloseTo(-1, 6); expect(Math.sin(left.rotation)).toBeCloseTo(0, 6);
    expect(left.x).toBeGreaterThan(68); expect(left.x).toBeLessThan(72); expect(left.y).toBeCloseTo(240, 6);
    const top = magnifyPlacement(320, -500, 640, 480);
    expect(top.edge).toBe(1); expect(top.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(top.y).toBeGreaterThan(77); expect(top.y).toBeLessThan(81);
    // The ring is ~33 px (480 lines) and scales with the viewport height.
    expect(LUPE.ringOuter * top.unit).toBeCloseTo(LUPE.ringOuter * HUD_PIXELS_PER_UNIT, 6);
    expect(magnifyPlacement(-10, 540, 1920, 1080).unit).toBeCloseTo(HUD_PIXELS_PER_UNIT * 1080 / 480, 6);
  });
  it('keeps the original side inset on wide screens instead of stretching the 4:3 rectangle', () => {
    const wide = magnifyPlacement(-500, 540, 1920, 1080), scale = 1080 / 480;
    expect(wide.edge).toBe(2);
    const inset = wide.x / scale;
    expect(inset).toBeGreaterThan(68); expect(inset).toBeLessThan(72);
  });
  it('lays the rectangle out between the HUD bars, unchanged without insets', () => {
    expect(magnifyPlacement(320, 900, 640, 480, { top: 0, bottom: 0 })).toEqual(magnifyPlacement(320, 900, 640, 480));
    // A 120-px card row at the bottom of 720 lines: the lupe keeps ~79 original pixels above it.
    const below = magnifyPlacement(640, 2000, 1280, 720, { top: 60, bottom: 120 }), scale = 720 / 480;
    expect(below.edge).toBe(3);
    const gap = (720 - 120 - below.y) / scale;
    expect(gap).toBeGreaterThan(77); expect(gap).toBeLessThan(81);
    const above = magnifyPlacement(640, -500, 1280, 720, { top: 60, bottom: 120 });
    expect((above.y - 60) / scale).toBeGreaterThan(77);
  });
  it('frames the ortho lens from the camera-box zoom and model scale', () => {
    // Mario: magnify 10.8 × scale 1.1 → 0.1 × 64 × 11.88 / 8.
    expect(magnifyHalfExtent(10.8, 1.1)).toBeCloseTo(9.504, 6);
  });
});

describe('ifMagnify background blend (ifMagnify_802FBBDC)', () => {
  const bounds: CameraBounds = { left: -100, right: 100, top: 100, bottom: -100 };
  const grid = [0x100000ff, 0x200000ff, 0x300000ff, 0x400000ff, 0x500000ff, 0x600000ff, 0x700000ff, 0x800000ff, 0x900000ff];
  const red = (rgba: number) => rgba >>> 24;
  it('uses the grid cell at the camera range corners and the centre colour in the middle', () => {
    expect(red(magnifyBackground(-100, 100, bounds, grid))).toBe(0x10);
    expect(red(magnifyBackground(100, -100, bounds, grid))).toBe(0x90);
    expect(red(magnifyBackground(0, 0, bounds, grid))).toBe(0x50);
  });
  it('holds the edge colour outside the range and blends inside it', () => {
    expect(red(magnifyBackground(-500, 0, bounds, grid))).toBe(0x40);
    expect(red(magnifyBackground(0, 900, bounds, grid))).toBe(0x20);
    // Halfway between the middle-left (0x40) and centre (0x50) cells.
    expect(red(magnifyBackground(-50, 0, bounds, grid))).toBe(0x48);
  });
  it('keeps a flat stage grid flat and falls back to black without data', () => {
    const flat = new Array(9).fill(0x0c0628ff);
    for (const [x, y] of [[-300, 20], [10, -90], [150, 150]]) expect(magnifyBackground(x!, y!, bounds, flat)).toBe(0x0c0628ff);
    expect(magnifyBackground(0, 0, bounds, [])).toBe(0x000000ff);
  });
});

describe('stage camera range (Camera_8002958C / Camera_8002A768)', () => {
  const fd: CameraBounds = { left: -170, right: 170, top: 114, bottom: -80 };
  it('clamps a launched fighter to the camera range edge', () => {
    expect(clampToCameraBounds({ x: -230, y: 20 }, fd)).toEqual({ x: -170, y: 20 });
    expect(clampToCameraBounds({ x: 10, y: -130 }, fd)).toEqual({ x: 10, y: -80 });
    expect(clampToCameraBounds({ x: 5, y: 6 }, fd)).toEqual({ x: 5, y: 6 });
  });
  const view = (target: { x: number; y: number }, distance: number, aspect: number) => {
    const camera = new PerspectiveCamera(42, aspect, 0.1, 5000);
    camera.position.set(target.x, target.y + 32, distance); camera.lookAt(target.x, target.y, 0); camera.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const far = new Vector3(sx, sy, 0.5).unproject(camera), dir = far.sub(camera.position);
      const t = -camera.position.z / dir.z, x = camera.position.x + dir.x * t, y = camera.position.y + dir.y * t;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY };
  };
  it('shifts a shot that would show past the range back inside it', () => {
    const shot = confineCameraTarget({ x: -150, y: 90 }, 150, 32, 42, 16 / 9, fd);
    const seen = view(shot, 150, 16 / 9);
    expect(seen.minX).toBeGreaterThanOrEqual(fd.left - 1e-6); expect(seen.maxY).toBeLessThanOrEqual(fd.top + 1e-6);
    expect(shot.x).toBeGreaterThan(-150); expect(shot.y).toBeLessThan(90);
  });
  it('leaves an inside shot alone and centres one wider than the range', () => {
    expect(confineCameraTarget({ x: 0, y: 20 }, 120, 32, 42, 16 / 9, fd)).toEqual({ x: 0, y: 20 });
    const wide = confineCameraTarget({ x: 60, y: 20 }, 600, 32, 42, 16 / 9, fd), seen = view(wide, 600, 16 / 9);
    expect((seen.minX + seen.maxX) / 2).toBeCloseTo((fd.left + fd.right) / 2, 4);
    expect((seen.minY + seen.maxY) / 2).toBeCloseTo((fd.top + fd.bottom) / 2, 4);
  });
  it('ignores degenerate inputs', () => {
    expect(confineCameraTarget({ x: 1, y: 2 }, Number.NaN, 32, 42, 1, fd)).toEqual({ x: 1, y: 2 });
    expect(confineCameraTarget({ x: 1, y: 2 }, 100, 32, 42, 1, { left: 5, right: 5, top: 1, bottom: 0 })).toEqual({ x: 1, y: 2 });
  });
});
