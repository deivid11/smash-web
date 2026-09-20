import { describe, expect, it } from 'vitest';
import {
  MUTE_CITY_ANIM_FRAMES, MUTE_CITY_SCRIPT, createMuteCityRuntime,
  muteCitySplinePoint, muteCitySplineWrapped, stepMuteCityScript,
} from '../../lib/game/mutecity.ts';

/** The 60 s road script, replayed in table order without any stage data. */
function runTo(frame: number): ReturnType<typeof createMuteCityRuntime> {
  const runtime = createMuteCityRuntime();
  for (let f = 0; f <= frame; f++) stepMuteCityScript(runtime, MUTE_CITY_SCRIPT, f);
  return runtime;
}

describe('Mute City road script (grMuteCity_801F04B8)', () => {
  it('exposes the verbatim 132-entry command table', () => {
    expect(MUTE_CITY_SCRIPT).toHaveLength(132);
    expect(MUTE_CITY_SCRIPT[0]).toMatchObject({ frame: -1, cmd: 11, param: 2 });
    expect(MUTE_CITY_SCRIPT[MUTE_CITY_SCRIPT.length - 1]).toMatchObject({ frame: 9999, cmd: 0 });
    expect(MUTE_CITY_ANIM_FRAMES).toBe(3600);
  });
  it('starts on the pad plus the deck slot', () => {
    const runtime = runTo(0);
    expect(runtime.areas).toEqual([3, 4]);
    expect(runtime.deckOn).toBe(true);
    expect(runtime.railMode).toBe(0);
    expect(runtime.markerR).toBeCloseTo(0.932775, 6);
    expect(runtime.markerL).toBeCloseTo(0.932775, 6);
  });
  it('walks the area cycle: stops add road, the flight drops the deck', () => {
    // Frames below are the true effect frames: cmd-1 waits delay later groups,
    // so table neighbors execute as one cascade once the wait drains.
    expect(runTo(708).areas).toEqual([3, 4]);
    expect(runTo(708).railMode).toBe(0);
    expect(runTo(877).areas).toEqual([0, 3, 4, 7, 8]);
    expect(runTo(877).railMode).toBe(1);
    expect(runTo(980).areas).toEqual([0, 3, 4, 7, 8]);
    expect(runTo(1292).areas).toEqual([3, 4, 5]);
    expect(runTo(1292).railMode).toBe(0);
    expect(runTo(1694).areas).toEqual([1, 3, 4]);
    expect(runTo(1694).railMode).toBe(2);
    expect(runTo(2096).areas).toEqual([3, 4, 6]);
    expect(runTo(2273).deckOn).toBe(true);
    const flight = runTo(2537);
    expect(flight.areas).toEqual([3]);
    expect(flight.deckOn).toBe(false);
    expect(runTo(3000).deckOn).toBe(false);
    const resume = runTo(3290);
    expect(resume.areas).toEqual([3, 4]);
    expect(resume.deckOn).toBe(true);
    expect(resume.markerR).toBeCloseTo(0.86445, 6);
    expect(runTo(3390).areas).toEqual([2, 3, 4]);
    expect(runTo(3599).areas).toEqual([2, 3, 4]);
  });
  it('restarts the script at the animation loop boundary', () => {
    const runtime = runTo(3599);
    runtime.idx = 0; // stepMuteCity's wrap reset (the pending 340f wait drains first, like xC6)
    for (let f = 0; f <= 300; f++) stepMuteCityScript(runtime, MUTE_CITY_SCRIPT, f);
    expect(runtime.areas).toEqual([3, 4]);
    expect(runtime.deckOn).toBe(true);
    expect(runtime.markerR).toBeCloseTo(0.932775, 6);
  });
});

describe('Mute City spline math (baselib/spline.c)', () => {
  const line: { type: number; tension: number; points: Array<readonly [number, number, number]> } =
    { type: 3, tension: 0.5, points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] };
  it('hits the segment midpoint on symmetric control points', () => {
    const out: [number, number, number] = [0, 0, 0];
    // u * (4 - 1) = 0.5 -> idx 0, t 0.5.
    expect(muteCitySplinePoint(line, 1 / 6, out)).toBe(true);
    expect(out[0]).toBeCloseTo(1.5, 6);
    expect(out[1]).toBe(0);
  });
  it('rejects out-of-range parameters without writing', () => {
    const out: [number, number, number] = [7, 7, 7];
    expect(muteCitySplinePoint(line, -0.1, out)).toBe(false);
    expect(muteCitySplinePoint(line, 1.1, out)).toBe(false);
    expect(out).toEqual([7, 7, 7]);
  });
  it('bridges the start/finish seam through the 0.93/0.01 lerp', () => {
    const direct: [number, number, number] = [0, 0, 0];
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    muteCitySplineWrapped(line, 0.95, direct);
    muteCitySplinePoint(line, 0.93, a);
    muteCitySplinePoint(line, 0.01, b);
    const s = 0.02 / 0.07999999;
    expect(direct[0]).toBeCloseTo((b[0] - a[0]) * s + a[0], 9);
  });
});
