import { describe, expect, it } from 'vitest';
import { applyRiftRemix, planRiftRemixForStage } from '../../lib/game/roguelike/procedural-stage.ts';
import { MAX_FLOOR_SLOPE, type StageGameplayData } from '../../lib/game/data.ts';

const baseStage = (): StageGameplayData => ({
  scale: 1,
  floors: [
    { id: 0, a: [-40, 0], b: [40, 0], oneWay: false },
    { id: 1, a: [-20, 12], b: [-5, 12], oneWay: true },
    { id: 2, a: [5, 12], b: [20, 12], oneWay: true },
  ],
  blast: { left: -100, right: 100, top: 80, bottom: -60 },
  spawns: [[-10, 1, 0], [10, 1, 0]],
  mainLeft: -40,
  mainRight: 40,
  ledges: [{ id: 0, floor: 0, x: -40, y: 0, facing: 1 }],
});

describe('rift platform remixes (solid geometry untouched)', () => {
  it('plans deterministically and bounds every shift', () => {
    const stage = baseStage();
    const first = planRiftRemixForStage('battlefield', 777, stage);
    const second = planRiftRemixForStage('battlefield', 777, stage);
    expect(first).toEqual(second);
    expect(first.baseStage).toBe('battlefield');
    for (const shift of Object.values(first.shifts)) {
      expect(Math.abs(shift)).toBeLessThanOrEqual(2.5 + 1e-6);
    }
    expect(Object.keys(first.shifts).map(Number).sort()).toEqual([1, 2]);
  });
  it('keeps solid floors, blast, spawns and ledges identical', () => {
    const stage = baseStage();
    const remix = planRiftRemixForStage('battlefield', 1234, stage);
    const next = applyRiftRemix(stage, remix);
    expect(next.blast).toEqual(stage.blast);
    expect(next.spawns).toEqual(stage.spawns);
    expect(next.ledges).toEqual(stage.ledges);
    expect(next.scale).toBe(stage.scale);
    expect(next.floors.filter((floor) => !floor.oneWay)).toEqual(stage.floors.filter((floor) => !floor.oneWay));
    for (const floor of next.floors) {
      const run = Math.abs(floor.a[0] - floor.b[0]);
      const rise = Math.abs(floor.a[1] - floor.b[1]);
      if (rise > 0.01) expect(rise / Math.max(run, 0.001)).toBeLessThanOrEqual(MAX_FLOOR_SLOPE);
      expect(floor.a[1]).toBeGreaterThan(stage.blast.bottom + 1);
      expect(floor.a[1]).toBeLessThan(stage.blast.top - 1);
    }
  });
});
