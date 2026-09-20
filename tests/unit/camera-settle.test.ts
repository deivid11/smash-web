import { describe, expect, it } from 'vitest';
import { focusCameraFrame, settleFrameTarget, settleFrameDistance } from '../../web/src/render/camera-framing.ts';

/** Deterministic PRNG so the brawl sim below never flakes. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const W = 1440, H = 960, SAFE = { top: 138, bottom: 207 };
interface Body { x: number; y: number; vx: number; vy: number }

/** 600 frames of synthetic 8-player brawl through the exact renderer focus
 * pipeline (exact fit, glued x, settled height, capped zoom growth). */
function brawl(seed: number): { meanTargetJump: number; maxTargetJump: number; maxZoomJump: number; maxDistance: number } {
  const rand = mulberry32(seed);
  const bodies: Body[] = Array.from({ length: 8 }, () => ({ x: (rand() - 0.5) * 200, y: rand() * 80, vx: 0, vy: 0 }));
  let previous: { target: { x: number; y: number }; distance: number } | undefined;
  let targetSum = 0, targetFrames = 0, maxTargetJump = 0, maxZoomJump = 0, maxDistance = 0;
  for (let frame = 0; frame < 600; frame++) {
    for (const body of bodies) {
      body.vx += (rand() - 0.5) * 6; body.vy += (rand() - 0.5) * 6;
      body.vx *= 0.92; body.vy *= 0.92;
      body.vx = Math.max(-9, Math.min(9, body.vx)); body.vy = Math.max(-7, Math.min(7, body.vy));
      body.x += body.vx; body.y += body.vy;
      if (body.x < -160 || body.x > 160) { body.vx *= -1; body.x = Math.max(-160, Math.min(160, body.x)); }
      if (body.y < 0 || body.y > 130) { body.vy *= -1; body.y = Math.max(0, Math.min(130, body.y)); }
    }
    const me = bodies[0]!;
    const others = bodies.slice(1).map(body => ({ x: body.x, y: body.y }));
    const fit = focusCameraFrame({ x: me.x, y: me.y }, others, W, H, previous, 42, SAFE);
    const shot = previous
      ? { target: { x: fit.target.x, y: settleFrameTarget(previous.target.y, fit.target.y) }, distance: settleFrameDistance(previous.distance, fit.distance) }
      : fit;
    if (previous) {
      const jump = Math.hypot(shot.target.x - previous.target.x, shot.target.y - previous.target.y);
      targetSum += jump; targetFrames++;
      maxTargetJump = Math.max(maxTargetJump, jump);
      maxZoomJump = Math.max(maxZoomJump, Math.abs(shot.distance - previous.distance));
    }
    maxDistance = Math.max(maxDistance, shot.distance);
    previous = { target: shot.target, distance: shot.distance };
  }
  return { meanTargetJump: targetSum / targetFrames, maxTargetJump, maxZoomJump, maxDistance };
}

describe('crowded-shot settling', () => {
  it('eases one axis toward the fit and rejects bad rates', () => {
    expect(settleFrameTarget(100, 140)).toBe(120);
    expect(settleFrameTarget(100, 140, 1)).toBe(140);
    expect(() => settleFrameTarget(100, 140, 0)).toThrow('bounds');
    expect(() => settleFrameTarget(100, NaN)).toThrow('bounds');
  });
  it('caps zoom growth per frame but never the shrink, and rejects bad caps', () => {
    expect(settleFrameDistance(100, 300)).toBeLessThanOrEqual(100 * 1.08 + 4);
    expect(settleFrameDistance(200, 150)).toBe(150);
    expect(settleFrameDistance(0, 150)).toBe(150);
    expect(() => settleFrameDistance(100, 150, 0.5)).toThrow('bounds');
    expect(() => settleFrameDistance(100, 150, 1.08, -1)).toThrow('bounds');
  });
  it('holds the focus close-up band instead of fitting the arena', () => {
    const spread = [{ x: -2000, y: 0 }, { x: 2000, y: 100 }, { x: 1500, y: -50 }];
    const frame = focusCameraFrame({ x: 0, y: 10 }, spread, W, H, undefined, 42, SAFE);
    expect(frame.distance).toBeLessThanOrEqual(200);
    expect(frame.requiredDistance).toBeLessThanOrEqual(200);
  });
  it('keeps 8-player focus motion bounded across a synthetic brawl', () => {
    for (const seed of [7, 42]) {
      const stats = brawl(seed);
      expect(stats.maxZoomJump).toBeLessThanOrEqual(26);
      expect(stats.meanTargetJump).toBeLessThanOrEqual(4.5);
      expect(stats.maxDistance).toBeLessThanOrEqual(200);
    }
  });
});
