import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { PauseCamera } from '../../web/src/render/pause-camera.ts';

const seeded = (): { pause: PauseCamera; camera: PerspectiveCamera; target: Vector3 } => {
  const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 20_000);
  camera.position.set(0, 60, 170);
  const target = new Vector3(0, 20, 0);
  camera.lookAt(target);
  const pause = new PauseCamera();
  pause.begin(camera, target);
  return { pause, camera, target };
};

describe('manual pause camera', () => {
  it('seeds from the live shot so entering pause never jumps', () => {
    const { pause, camera, target } = seeded();
    // The first applied frame reproduces the live camera position (the smoothed
    // look point starts exactly on the target, so there is no easing gap).
    pause.apply(camera, target);
    expect(camera.position.x).toBeCloseTo(0, 3);
    expect(camera.position.y).toBeCloseTo(60, 2);
    expect(camera.position.z).toBeCloseTo(170, 2);
  });

  it('zooms multiplicatively and clamps to the close limit', () => {
    const { pause } = seeded();
    const start = pause.distance;
    pause.zoom(0.5);
    expect(pause.distance).toBeCloseTo(start * 0.5, 3);
    pause.zoom(0.00001); // way past the minimum in one shot
    expect(pause.distance).toBe(22);
    pause.zoom(-3); // non-positive factors are ignored, not applied
    expect(pause.distance).toBe(22);
  });

  it('orbits yaw freely and clamps pitch below straight-down', () => {
    const { pause } = seeded();
    pause.orbit(Math.PI / 2, 0);
    expect(pause.yaw).toBeCloseTo(-Math.PI / 2, 4);
    pause.orbit(0, 10); // drag far past the floor
    expect(pause.pitch).toBeCloseTo(-1.15, 4);
  });

  it('pans along the camera basis, scaled by zoom distance', () => {
    const { pause, camera, target } = seeded();
    pause.apply(camera, target); // populates camera.matrixWorld for the basis
    pause.nudge(10, 0, camera);
    // At yaw 0 the camera right axis is world +X, so a rightward nudge moves the
    // look point in +X, and the amount grows with distance (never a fixed step).
    expect(pause.pan.x).toBeGreaterThan(0);
    expect(pause.pan.y).toBeCloseTo(0, 5);
    expect(pause.pan.z).toBeCloseTo(0, 5);
  });

  it('resets orbit, zoom, pan and focus back to the entry pose', () => {
    const { pause, camera, target } = seeded();
    const { yaw, pitch, distance } = pause;
    pause.apply(camera, target);
    pause.orbit(0.6, 0.2); pause.zoom(0.4); pause.nudge(5, 5, camera); pause.focus = 1;
    pause.reset();
    expect(pause.yaw).toBeCloseTo(yaw, 6);
    expect(pause.pitch).toBeCloseTo(pitch, 6);
    expect(pause.distance).toBeCloseTo(distance, 6);
    expect(pause.pan.length()).toBe(0);
    expect(pause.focus).toBeNull();
  });
});
