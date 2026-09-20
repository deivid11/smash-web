import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { crowdCameraFrame, focusCameraFrame, classicCameraLimits, CROWD_CAMERA_LIFT, type CrowdFrame, type FramingInsets, type FramingPoint } from '../../web/src/render/camera-framing.ts';

const points = (edge: number, count = 8): readonly FramingPoint[] => Object.freeze(Array.from({length: count}, (_, slot) => Object.freeze({x: -edge + 2 * edge * slot / (count - 1), y: 0})));
function camera(frame: CrowdFrame, width: number, height: number) {
  const camera = new PerspectiveCamera(42, width / height, 0.1, Math.max(20_000, frame.distance * 4));
  camera.position.set(frame.target.x, frame.target.y + CROWD_CAMERA_LIFT, frame.distance);
  camera.setViewOffset(width, frame.viewportHeight, 0, -frame.offsetTop, width, height);
  camera.lookAt(frame.target.x, frame.target.y, 0); camera.updateMatrixWorld(true); return camera;
}
function assertFits(positions: readonly FramingPoint[], frame: CrowdFrame, width: number, height: number, safe: FramingInsets) {
  const view = camera(frame, width, height);
  for (const position of positions) {
    for (const dx of [-8, 0, 8]) for (const dy of [0, 20, 32]) {
      const projected = new Vector3(position.x + dx, position.y + dy, 0).project(view);
      expect(Math.abs(projected.x)).toBeLessThan(1); expect(Math.abs(projected.y)).toBeLessThan(1); expect(Math.abs(projected.z)).toBeLessThan(1);
    }
    const anchor = new Vector3(position.x, position.y + 20, 0).project(view);
    const x = (anchor.x + 1) * width / 2, y = (1 - anchor.y) * height / 2;
    // Actual HUD tag is smaller; use a conservative 28×18px tag anchored at its bottom.
    expect(x - 14).toBeGreaterThanOrEqual(12); expect(x + 14).toBeLessThanOrEqual(width - 12);
    expect(y - 18).toBeGreaterThanOrEqual(safe.top); expect(y).toBeLessThanOrEqual(height - safe.bottom);
  }
}
function insets(width: number, height: number): FramingInsets { return {top: 138, bottom: height <= 600 ? 130 : width <= 620 ? 150 : 140}; }

describe('cosmetic 5–8-player perspective framing', () => {
  for (const [name, edge] of [['Battlefield', 68.4], ['Final Destination', 85.5657]] as const) {
    it.each([[390, 844], [900, 700], [1440, 960], [900, 480]])(`fits all eight ${name} ground-spread bodies/head tags at %i×%i inside the HUD safe area`, (width, height) => {
      const positions = points(edge), safe = insets(width, height);
      const frame = crowdCameraFrame(positions, width, height, undefined, 42, safe);
      assertFits(positions, frame, width, height, safe);
      expect(frame.viewportHeight).toBe(height - safe.top - safe.bottom);
    });
  }
  it('snaps outward on a portrait resize immediately instead of taking dozens of easing frames', () => {
    const positions = points(85.5657), landscape = crowdCameraFrame(positions, 1440, 960, undefined, 42, insets(1440, 960));
    const portrait = crowdCameraFrame(positions, 390, 844, landscape, 42, insets(390, 844));
    expect(portrait.distance).toBeGreaterThan(360); expect(portrait.distance).toBe(portrait.requiredDistance);
    assertFits(positions, portrait, 390, 844, insets(390, 844));
  });
  it('fits sudden horizontal/airborne expansion against the eased center, and eases inward without clipping', () => {
    const safe = insets(390, 844), initial = crowdCameraFrame(points(10), 390, 844, undefined, 42, safe);
    const spread = points(170).map((point, slot) => ({x: point.x + 40, y: slot % 2 ? 100 : -20}));
    const expanded = crowdCameraFrame(spread, 390, 844, initial, 42, safe);
    expect(expanded.distance).toBe(expanded.requiredDistance); assertFits(spread, expanded, 390, 844, safe);
    let current = expanded;
    for (let frame = 0; frame < 20; frame++) {
      const next = crowdCameraFrame(points(10), 390, 844, current, 42, safe);
      expect(next.distance).toBeLessThan(current.distance); expect(next.distance).toBeGreaterThan(next.requiredDistance);
      assertFits(points(10), next, 390, 844, safe); current = next;
    }
  });
  it('supports all five-through-eight counts and measured header/HUD bounds without modifying frozen actor points', () => {
    for (const count of [5, 6, 7, 8]) {
      const positions = points(85.5657, count), safe = {top: 126, bottom: 224};
      const before = JSON.stringify(positions), frame = crowdCameraFrame(positions, 390, 844, undefined, 42, safe);
      assertFits(positions, frame, 390, 844, safe); expect(JSON.stringify(positions)).toBe(before);
    }
  });
  it('rejects invalid geometry rather than producing nonfinite projection matrices', () => {
    expect(() => crowdCameraFrame([], 390, 844)).toThrow('bounds');
    expect(() => crowdCameraFrame(points(10), 0, 844)).toThrow('bounds');
    expect(() => crowdCameraFrame([{x: NaN, y: 0}], 390, 844)).toThrow('bounds');
    expect(() => crowdCameraFrame(points(10), 390, 844, undefined, 42, {top: 138, bottom: 170}, -5)).toThrow('bounds');
    expect(() => crowdCameraFrame(points(10), 390, 844, undefined, 42, {top: NaN, bottom: 1})).toThrow('insets');
  });
});

describe('player-prioritized focus framing for crowded matches', () => {
  const safe = insets(900, 700);
  const me = { x: 0, y: 10 };
  const pack = [{ x: 30, y: 12 }, { x: -25, y: 8 }, { x: 60, y: 40 }, { x: -400, y: 0 }, { x: 500, y: 100 }, { x: -350, y: -50 }, { x: 450, y: 20 }];
  it('centers the frame on the focus, not on the pack midpoint', () => {
    const frame = focusCameraFrame(me, pack, 900, 700, { target: me, distance: 300 }, 42, safe);
    expect(frame.target.x).toBe(me.x);
    // A lopsided pack (everyone to the right) still leaves the focus centered.
    const right = focusCameraFrame(me, [{ x: 100, y: 10 }, { x: 150, y: 12 }, { x: 200, y: 8 }], 900, 700, { target: me, distance: 300 }, 42, safe);
    expect(right.target.x).toBe(me.x);
  });
  it('fits the focus plus its nearest rival while distant fighters leave the frame', () => {
    const frame = focusCameraFrame(me, pack, 900, 700, undefined, 42, safe);
    const kept = [me, { x: -25, y: 8 }];
    assertFits(kept, frame, 900, 700, safe);
    const all = crowdCameraFrame([me, ...pack], 900, 700, undefined, 42, safe);
    expect(frame.requiredDistance).toBeLessThan(all.requiredDistance);
  });
  it('caps the zoom-out on huge stages instead of fitting the arena', () => {
    const spread = [{ x: -2000, y: 0 }, { x: 2000, y: 100 }, { x: 1500, y: -50 }];
    const frame = focusCameraFrame(me, spread, 900, 700, undefined, 42, safe);
    expect(frame.distance).toBeLessThanOrEqual(240);
    expect(frame.requiredDistance).toBeLessThanOrEqual(240);
  });
  it('holds the close-up floor instead of the crowd minimum', () => {
    const frame = focusCameraFrame(me, [{ x: 5, y: 11 }], 900, 700, undefined, 42, safe);
    expect(frame.distance).toBeGreaterThanOrEqual(110);
    expect(frame.distance).toBeLessThan(165);
  });
  it('rejects invalid focus geometry rather than producing bad projections', () => {
    expect(() => focusCameraFrame({ x: NaN, y: 0 }, pack, 900, 700)).toThrow('bounds');
    expect(() => focusCameraFrame(me, [{ x: 1, y: NaN }], 900, 700)).toThrow('bounds');
    expect(() => focusCameraFrame(me, pack, 900, 700, undefined, 42, safe, { maxOthers: 8 })).toThrow('bounds');
    expect(() => focusCameraFrame(me, pack, 900, 700, undefined, 42, safe, { maxDistance: 100 })).toThrow('bounds');
    expect(() => focusCameraFrame(me, pack, 900, 700, undefined, 42, safe, { minDistance: 40 })).toThrow('bounds');
    expect(() => focusCameraFrame(me, pack, 900, 700, undefined, 42, safe, { minDistance: 400 })).toThrow('bounds');
  });
});

describe('classic 1-4-player camera limits', () => {
  const battlefield = { mainLeft: -68.4, mainRight: 68.4, floors: [{ a: [-68.4, 0] as const, b: [68.4, 0] as const }, { a: [-57.6, 27.2] as const, b: [-20, 27.2] as const }, { a: [-18.8, 54.4] as const, b: [18.8, 54.4] as const }], blast: { left: -224, right: 224, top: 200, bottom: -108.8 } };
  const temple = { mainLeft: -314.8, mainRight: 315.3, floors: [{ a: [-314.8, -5] as const, b: [315.3, -5] as const }, { a: [-5, -107] as const, b: [9, -113] as const }, { a: [-207, 45] as const, b: [-198, 49.5] as const }], blast: { left: -330, right: 331, top: 220, bottom: -256 } };
  it('reproduces the legacy Battlefield box exactly on small stages', () => {
    const limits = classicCameraLimits(battlefield, 16 / 9);
    expect(limits.cxLo).toBe(-55); expect(limits.cxHi).toBe(55);
    expect(limits.cyLo).toBe(12); expect(limits.cyHi).toBeCloseTo(90.4, 5);
    expect(limits.maxDistance).toBe(360);
  });
  it('expands pan and zoom on Temple so no fighter column is unreachable', () => {
    const aspect = 16 / 9, limits = classicCameraLimits(temple, aspect);
    expect(limits.cxLo).toBeLessThanOrEqual(-280); expect(limits.cxHi).toBeGreaterThanOrEqual(280);
    expect(limits.cyLo).toBeLessThanOrEqual(-100); // the lower corridor stays reachable
    // Fighters parked at both stage ends must fit within the cap.
    const needed = ((temple.mainRight - temple.mainLeft) / 2 / aspect + 35) / Math.tan(21 * Math.PI / 180);
    expect(needed).toBeLessThanOrEqual(limits.maxDistance);
  });
  it('falls back to the legacy box for degenerate stages instead of nonfinite bounds', () => {
    const legacy = { cxLo: -55, cxHi: 55, cyLo: 12, cyHi: 90, maxDistance: 360 };
    expect(classicCameraLimits({ ...battlefield, floors: [] }, 16 / 9)).toEqual(legacy);
    expect(classicCameraLimits(battlefield, 0)).toEqual(legacy);
    expect(classicCameraLimits(undefined, 16 / 9)).toEqual(legacy);
  });
});
