import { describe, expect, it } from 'vitest';
import {
  HILL_CAPTURE_DY, HILL_CAPTURE_FRAMES, HILL_HALF_WIDTH_MAX, HILL_HALF_WIDTH_MIN, HILL_POINT_EVERY, HILL_RELOCATE_EVERY,
  hillClaims, hillHalfWidth, hillLeader, hillRandomNext, hillTeamOfSlot, hillWinningTeam, makeHillState,
  relocateHillZones, scoreHillTick, stepHillCapture, validHillSetup, type HillState,
} from '../../lib/game/hill.ts';

/** Runs `frames` capture frames with the same occupants in both zones. */
function hold(hill: HillState, occupants: readonly (readonly number[])[], frames: number, teams = false, fighters = 4): void {
  for (let frame = 0; frame < frames; frame++) stepHillCapture(hill, teams, occupants, fighters);
}

const anchors = [{ x: -60, y: 0 }, { x: -20, y: 0 }, { x: 20, y: 5 }, { x: 60, y: 0 }];
function state(zones: 1 | 2 = 2, seed = 7): HillState {
  const hill = makeHillState(seed, anchors, zones, 20);
  hill.points = [0, 0, 0, 0];
  return hill;
}

describe('king of the hill rules', () => {
  it('validates setup shapes', () => {
    expect(validHillSetup({ zones: 1 })).toBe(true);
    expect(validHillSetup({ zones: 2 })).toBe(true);
    expect(validHillSetup(null)).toBe(false);
    expect(validHillSetup({ zones: 3 })).toBe(false);
    expect(validHillSetup({ zones: 2, teams: true })).toBe(false);
    expect(validHillSetup({ zones: 'A' })).toBe(false);
  });
  it('sizes zones from the blast span within fixed bounds', () => {
    expect(hillHalfWidth(-100, 100)).toBeCloseTo(200 / 14);
    expect(hillHalfWidth(0, 10)).toBe(HILL_HALF_WIDTH_MIN);
    expect(hillHalfWidth(-500, 500)).toBe(HILL_HALF_WIDTH_MAX);
    expect(() => hillHalfWidth(5, 5)).toThrow();
  });
  it('places distinct A/B anchors deterministically from the seed', () => {
    const first = state(2, 42), second = state(2, 42), other = state(2, 43);
    expect(first.zones.map(zone => zone.id)).toEqual(['A', 'B']);
    expect(first.zones).toEqual(second.zones);
    expect(first.rng).toBe(second.rng);
    expect(other.zones).not.toEqual(first.zones);
    const [ax, bx] = [first.zones[0]!, first.zones[1]!];
    expect(ax.x !== bx.x || ax.y !== bx.y).toBe(true);
    expect(first.tick).toBe(0); expect(first.relocateIn).toBe(HILL_RELOCATE_EVERY);
    expect(first.holders).toEqual([null, null]);
    const solo = state(1, 42);
    expect(solo.zones.map(zone => zone.id)).toEqual(['A']);
  });
  it('threads the placement RNG without repeats in a row', () => {
    let rng = 123456;
    const seen = new Set<string>();
    for (let round = 0; round < 20; round++) {
      const [roll, next] = hillRandomNext(rng);
      expect(roll).toBeGreaterThanOrEqual(0); expect(roll).toBeLessThan(1);
      rng = next; seen.add(roll.toFixed(6));
    }
    expect(seen.size).toBeGreaterThan(15);
  });
  it('captures a zone after standing in it long enough', () => {
    const hill = state();
    hold(hill, [[0], []], HILL_CAPTURE_FRAMES - 1);
    // One frame short: still unclaimed, and the meters say how close it is.
    expect(hill.holders).toEqual([null, null]);
    expect(hillClaims(hill, 0)).toEqual([{ slot: 0, progress: HILL_CAPTURE_FRAMES - 1 }]);
    hold(hill, [[0], []], 1);
    expect(hill.holders).toEqual([0, null]);
    // Taking it clears every meter in that zone: the next steal starts from zero.
    expect(hillClaims(hill, 0)).toEqual([]);
    // The owner's own meter never fills again while they hold the zone.
    hold(hill, [[0], []], 30);
    expect(hill.holders).toEqual([0, null]);
    expect(hillClaims(hill, 0)).toEqual([]);
  });
  it('fills one meter per fighter at once, and drains whoever steps out', () => {
    const hill = state();
    hold(hill, [[0, 1, 3], []], 40);
    // Three racers in the same circle, each on their own meter.
    expect(hillClaims(hill, 0)).toEqual([{ slot: 0, progress: 40 }, { slot: 1, progress: 40 }, { slot: 3, progress: 40 }]);
    // Slot 1 leaves: theirs drains while the others keep climbing.
    hold(hill, [[0, 3], []], 10);
    expect(hillClaims(hill, 0)).toEqual([{ slot: 0, progress: 50 }, { slot: 3, progress: 50 }, { slot: 1, progress: 30 }]);
    hold(hill, [[], []], 50);
    expect(hillClaims(hill, 0)).toEqual([]);
    expect(hill.holders).toEqual([null, null]);
  });
  it('gives the zone to whoever fills first, ties to the lowest slot', () => {
    const hill = state();
    // Slot 2 starts with a head start, so it wins the race from inside the crowd.
    hold(hill, [[2], []], 30);
    hold(hill, [[1, 2], []], HILL_CAPTURE_FRAMES - 30);
    expect(hill.holders).toEqual([2, null]);
    expect(hillClaims(hill, 0)).toEqual([]);
    // A dead heat resolves deterministically (lowest slot) for rollback.
    const tie = state();
    hold(tie, [[1, 3], []], HILL_CAPTURE_FRAMES);
    expect(tie.holders).toEqual([1, null]);
  });
  it('lets a rival take a held zone by filling their own meter', () => {
    const hill = state();
    hold(hill, [[0], []], HILL_CAPTURE_FRAMES);
    expect(hill.holders).toEqual([0, null]);
    // The owner standing there does not block anyone: defending means knocking
    // the rival out of the circle.
    hold(hill, [[0, 1], []], HILL_CAPTURE_FRAMES);
    expect(hill.holders).toEqual([1, null]);
  });
  it('pays the owner every tick, even with nobody standing on the zone', () => {
    const hill = state();
    hold(hill, [[0], [3]], HILL_CAPTURE_FRAMES);
    expect(hill.holders).toEqual([0, 3]);
    scoreHillTick(hill, false, [[], []]);
    expect(hill.points).toEqual([1, 0, 0, 1]);
    // A rival inside does not stop the owner's income; only a capture does.
    scoreHillTick(hill, false, [[1], []]);
    expect(hill.points).toEqual([2, 0, 0, 2]);
  });
  it('captures and scores by side in team mode', () => {
    const hill = state();
    // Slots 0 and 2 are RED, 1 and 3 BLUE: the first RED meter to fill takes it for RED.
    hold(hill, [[0, 2], [1]], HILL_CAPTURE_FRAMES, true);
    expect(hill.holders).toEqual([0, 1]);
    scoreHillTick(hill, true, [[0, 2], [1]]);
    expect(hill.teamPoints).toEqual([1, 1]);
    // Individual credit only goes to the owning team's fighters present.
    expect(hill.points).toEqual([1, 1, 1, 0]);
    // Teammates of the owner never build progress on their own zone.
    hold(hill, [[0, 2], []], 30, true);
    expect(hillClaims(hill, 0)).toEqual([]);
    // A rival from the other team still has to fill a full meter to flip it.
    hold(hill, [[1], []], HILL_CAPTURE_FRAMES, true);
    expect(hill.holders).toEqual([1, 1]);
  });
  it('relocates zones on their clock and clears holders', () => {
    const hill = state(2, 9);
    const before = hill.zones.map(zone => `${zone.x},${zone.y}`).join('|');
    hill.holders = [0, 1]; hill.capture = [[40, 0, 0, 0], []]; hill.tick = 37; hill.relocateIn = 1;
    relocateHillZones(hill, anchors);
    expect(hill.holders).toEqual([null, null]);
    expect(hill.capture).toEqual([[], []]);
    expect(hill.tick).toBe(0); expect(hill.relocateIn).toBe(HILL_RELOCATE_EVERY);
    expect(hill.relocations).toBe(1);
    // Four anchors and two zones: relocation must actually move somewhere.
    expect(hill.zones.map(zone => `${zone.x},${zone.y}`).join('|') === before).toBe(false);
  });
  it('ranks free-for-all and team winners with deterministic tiebreaks', () => {
    const hill = state();
    hill.points = [5, 5, 3, 1];
    // Full tie on points breaks on damage, then slot.
    expect(hillLeader(hill, false, [0, 1, 2, 3], [40, 20, 0, 0])).toBe(1);
    hill.points = [5, 5, 3, 1];
    expect(hillLeader(hill, false, [0, 1], [10, 10])).toBe(null);
    // Teams: RED 7 vs BLUE 5 crowns RED's top contributor (slot 2 over slot 0).
    hill.teamPoints = [7, 5]; hill.points = [2, 4, 6, 1];
    expect(hillWinningTeam(hill)).toBe(0);
    expect(hillLeader(hill, true, [0, 1, 2, 3], [0, 0, 0, 0])).toBe(2);
    // Tied teams draw, even with personal points on the board.
    hill.teamPoints = [4, 4];
    expect(hillWinningTeam(hill)).toBe(null);
    expect(hillLeader(hill, true, [0, 1, 2, 3], [0, 0, 0, 0])).toBe(null);
    expect(hillLeader(hill, false, [], [])).toBe(null);
  });
  it('assigns alternating RED/BLUE teams by slot and documents capture constants', () => {
    expect([0, 1, 2, 3, 7].map(hillTeamOfSlot)).toEqual([0, 1, 0, 1, 1]);
    expect(HILL_POINT_EVERY).toBe(60); expect(HILL_RELOCATE_EVERY).toBe(1200);
    expect(HILL_CAPTURE_DY).toBe(14); expect(HILL_CAPTURE_FRAMES).toBe(90);
  });
});
