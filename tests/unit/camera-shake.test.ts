import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import type { AnimationClip } from '../../lib/hsd/animation.ts';
import { CameraShake, isCameraShakeLevel, loadCameraShakeLevel, parseCameraQuakes } from '../../web/src/render/camera-shake.ts';
import { koPlacement } from '../../lib/game/ko-effect.ts';

const clip = (value: number): AnimationClip => ({name: 'fixture', endFrame: 30, joints: [{endFrame: 30, tracks: [5, 6].map(type => ({type, keys: [{time: 0, duration: 30, mode: 2, p0: value, p1: 0, d0: 0, d1: 0}]}))}]});
const clips = {small: clip(1), medium: clip(2), large: clip(3)};
const hit = (damage = 5) => ({type: 'hit' as const, player: 0, x: 0, y: 0, damage});
const ko = {type: 'ko' as const, player: 0, x: 250, y: 0};

describe('native-curve camera shake adapter', () => {
  it('selects mild hits, stronger hits and large KOs without additive multi-player amplification', () => {
    const shake = new CameraShake(clips);
    shake.events([hit()]); expect(shake.sample().x).toBe(1);
    shake.events([hit(15)]); expect(shake.sample().x).toBe(2);
    shake.events(Array(8).fill(ko)); expect(shake.sample().x).toBe(3);
    shake.events([hit()]); expect(shake.sample().x).toBe(3);
  });
  it('does not shake for shield/jump/zero damage events and never needs simulation RNG', () => {
    const shake = new CameraShake(clips);
    shake.events([{...hit(), type: 'shield'}, {...hit(), type: 'jump'}, hit(0)]);
    expect(shake.sample()).toEqual({x: 0, y: 0});
  });
  it('freezes with a paused clock, finishes on presentation time and resets on rematch/stage change', () => {
    const shake = new CameraShake(clips); shake.events([ko]); shake.update(10);
    const before = shake.sample(); shake.update(0); expect(shake.sample()).toEqual(before);
    shake.update(20); expect(shake.sample()).toEqual({x: 0, y: 0});
    shake.events([ko]); shake.reset(); expect(shake.sample().x).toBe(0);
    shake.events([ko]); shake.setClips(clips); expect(shake.sample().x).toBe(0);
    expect(parseCameraQuakes()).toEqual({});
  });
  it('preserves tracking camera, responsive HUD view offset, projection and inverse exactly after every pass', () => {
    const camera = new PerspectiveCamera(42, 1.5, 1, 2000);
    camera.position.set(20, 40, 220); camera.lookAt(0, 10, 0);
    camera.setViewOffset(900, 600, 0, 40, 900, 600);
    const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
    const position = camera.position.clone(), quaternion = camera.quaternion.clone(), view = {...camera.view};
    const shake = new CameraShake(clips); shake.events([ko]);
    for (let i = 0; i < 20; i++) {
      const restore = shake.apply(camera, 900, 600);
      expect(camera.projectionMatrix.equals(projection)).toBe(false);
      restore(); expect(camera.projectionMatrix.equals(projection)).toBe(true);
      expect(camera.projectionMatrixInverse.equals(inverse)).toBe(true);
      expect(camera.position.equals(position)).toBe(true); expect(camera.quaternion.equals(quaternion)).toBe(true); expect(camera.view).toEqual(view);
    }
    const restore = shake.apply(camera, 900, 600, true); expect(camera.projectionMatrix.equals(projection)).toBe(true); restore();
  });
});

describe('configurable camera-shake level', () => {
  it('defaults to full and validates persisted values', () => {
    expect(new CameraShake(clips).getLevel()).toBe('full');
    expect(isCameraShakeLevel('off')).toBe(true);
    expect(isCameraShakeLevel('reduced')).toBe(true);
    expect(isCameraShakeLevel('full')).toBe(true);
    expect(isCameraShakeLevel('extreme')).toBe(false);
    expect(loadCameraShakeLevel()).toBe('full');
  });
  it('off ignores hits and KOs and never moves the projection', () => {
    const camera = new PerspectiveCamera(42, 1.5, 1, 2000);
    camera.position.set(20, 40, 220); camera.lookAt(0, 10, 0);
    const projection = camera.projectionMatrix.clone();
    const shake = new CameraShake(clips, 'off');
    shake.events([hit(), hit(15), hit(25), ko]);
    expect(shake.sample()).toEqual({x: 0, y: 0});
    const restore = shake.apply(camera, 900, 600);
    expect(camera.projectionMatrix.equals(projection)).toBe(true); restore();
  });
  it('reduced keeps KO + strong hits while skipping jab-level small quakes', () => {
    const shake = new CameraShake(clips, 'reduced');
    shake.events([hit()]); expect(shake.sample()).toEqual({x: 0, y: 0});
    shake.events([hit(15)]); expect(shake.sample().x).toBe(2);
    shake.reset(); shake.events([ko]); expect(shake.sample().x).toBe(3);
  });
  it('switching to off clears an in-flight quake immediately', () => {
    const shake = new CameraShake(clips, 'full');
    shake.events([ko]); expect(shake.sample().x).toBe(3);
    shake.setLevel('off'); expect(shake.sample()).toEqual({x: 0, y: 0});
    shake.setLevel('full'); shake.events([hit()]); expect(shake.sample().x).toBe(1);
  });
});

describe('native KO beam boundary routing', () => {
  const blast = {left: -200, right: 200, bottom: -100, top: 180};
  it.each([
    [-201, 20, -Math.PI / 2], [201, 20, Math.PI / 2], [10, -101, 0], [10, 181, Math.PI],
  ])('orients the (%i,%i) beam inward', (x, y, rotation) => expect(koPlacement(x, y, blast)).toEqual({x, y, rotation}));
  it('preserves native side-first corner priority and clamps only the perpendicular coordinate', () => {
    expect(koPlacement(204, 210, blast)).toEqual({x: 204, y: 180, rotation: Math.PI / 2});
    expect(koPlacement(-205, -120, blast)).toEqual({x: -205, y: -100, rotation: -Math.PI / 2});
    expect(koPlacement(0, 0, blast)).toBeNull(); expect(koPlacement(NaN, 100, blast)).toBeNull();
  });
});
