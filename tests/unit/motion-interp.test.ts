import { describe, expect, it } from 'vitest';
import {
  clampVisualAlpha,
  extrapolateAnimationFrame,
  extrapolatePoint,
  extrapolatePosition,
  shouldSnapFighter,
  shouldSnapPoint,
  trackPointSnapshot,
  trackSimSnapshot,
} from '../../web/src/render/motion-interp.ts';

const fighter = (over: Record<string, number | string> = {}) => ({
  x: 0, y: 0, animation: 'Wait1', animationFrame: 0, facing: 1, frame: 100,
  ...over,
});

describe('motion interpolation (cosmetic only, sim untouched)', () => {
  it('clamps the accumulator alpha into a renderable blend', () => {
    expect(clampVisualAlpha(0.5)).toBe(0.5);
    expect(clampVisualAlpha(0)).toBe(0);
    expect(clampVisualAlpha(1)).toBe(1);
    expect(clampVisualAlpha(-2)).toBe(0);
    expect(clampVisualAlpha(99)).toBe(1);
    expect(clampVisualAlpha(Number.NaN)).toBe(0);
    expect(clampVisualAlpha(undefined)).toBe(0);
  });

  it('keeps the tracked pair across same-frame re-renders so velocity survives', () => {
    const first = fighter({ x: 0, frame: 100 });
    const second = fighter({ x: 2, frame: 101 });
    let entry = trackSimSnapshot({}, first, false);
    expect(entry.prev).toBeUndefined();
    expect(entry.curr).toEqual(first);
    // Same RAF burst with no new sim: pair must not shift (else velocity dies).
    const same = trackSimSnapshot(entry, first, false);
    expect(same).toBe(entry);
    entry = trackSimSnapshot(entry, second, false);
    expect(entry.prev).toEqual(first);
    expect(entry.curr).toEqual(second);
  });

  it('snaps on rollback frames and resim revisions instead of streaking', () => {
    const at101 = fighter({ x: 10, frame: 101 });
    const backTo100 = fighter({ x: 0, frame: 100 });
    let entry = trackSimSnapshot({}, at101, false);
    entry = trackSimSnapshot(entry, backTo100, false);
    expect(entry.prev).toBeUndefined();
    expect(entry.curr).toEqual(backTo100);
    entry = trackSimSnapshot(entry, at101, true);
    expect(entry.prev).toBeUndefined();
  });

  it('snaps fighters on action cuts and teleports, blends on runs', () => {
    const prev = fighter({ x: 0, y: 0, animation: 'Wait1', animationFrame: 5, frame: 100 });
    expect(shouldSnapFighter(undefined, fighter())).toBe(true);
    expect(shouldSnapFighter(prev, fighter({ animation: 'Run', frame: 101 }))).toBe(true);
    expect(shouldSnapFighter(prev, fighter({ x: 500, y: 0, frame: 101 }))).toBe(true);
    expect(shouldSnapFighter(prev, fighter({ x: 2, y: 1, frame: 101 }))).toBe(false);
  });

  it('extrapolates forward to the display instant with no added latency', () => {
    const prev = fighter({ x: 0, y: 10, animation: 'Run', animationFrame: 10, frame: 100 });
    const curr = fighter({ x: 2, y: 12, animation: 'Run', animationFrame: 11, frame: 101 });
    // Halfway into the next tick: one unit past the latest sim, not behind it.
    expect(extrapolatePosition(prev, curr, 0.5)).toEqual({ x: 3, y: 13 });
    expect(extrapolatePosition(prev, curr, 0)).toEqual({ x: 2, y: 12 });
    expect(extrapolateAnimationFrame(prev, curr, 0.5)).toBeCloseTo(11.5);
  });

  it('snaps animation on wraps and cuts instead of blending clip tails', () => {
    const prev = fighter({ animation: 'Wait1', animationFrame: 29, frame: 100 });
    expect(extrapolateAnimationFrame(prev, fighter({ animation: 'Wait1', animationFrame: 0, frame: 101 }), 0.5)).toBe(0);
    expect(extrapolateAnimationFrame(prev, fighter({ animation: 'Run', animationFrame: 0, frame: 101 }), 0.5)).toBe(0);
  });

  it('tracks fast articles per id and snaps only on spawn or rewind', () => {
    const a = { x: 0, y: 0, frame: 50 };
    const b = { x: 100, y: 0, frame: 51 };
    expect(shouldSnapPoint(undefined, b)).toBe(true);
    // Fast lasers must not snap on distance: only spawns/rewinds snap.
    expect(shouldSnapPoint(a, b)).toBe(false);
    expect(shouldSnapPoint(b, a)).toBe(true);
    let entry = trackPointSnapshot({}, a, false);
    expect(trackPointSnapshot(entry, a, false)).toBe(entry);
    entry = trackPointSnapshot(entry, b, false);
    expect(entry.prev).toEqual(a);
    expect(extrapolatePoint(entry.prev!, entry.curr!, 0.5)).toEqual({ x: 150, y: 0 });
  });
});
