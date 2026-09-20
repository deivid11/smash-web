import { describe, expect, it } from 'vitest';
import { CPU_LEVELS, CPU_LEVEL_NAMES, clampCpuLevel, cpuLevelTuning, createCpuBrain, DEFAULT_CPU_LEVEL, isCpuLevel } from '../../lib/game/cpu.ts';
import { defaultSeats } from '../../lib/game/setup.ts';
import { parseClientMessage, ROOM_PROTOCOL } from '../../lib/net/protocol.ts';

describe('CPU level ladder (original level tables on a prototype brain)', () => {
  it('exposes nine named levels with a default of five and rejects everything else', () => {
    expect(CPU_LEVELS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]); expect(DEFAULT_CPU_LEVEL).toBe(5);
    for (const level of CPU_LEVELS) { expect(isCpuLevel(level)).toBe(true); expect(CPU_LEVEL_NAMES[level]).toBeTruthy(); }
    for (const bad of [0, 10, 1.5, '5', null, undefined, NaN]) { expect(isCpuLevel(bad)).toBe(false); expect(clampCpuLevel(bad)).toBe(5); }
    expect(defaultSeats().every(seat => seat.level === 5)).toBe(true);
  });
  it('scales every original table monotonically from level 1 to level 9', () => {
    const rows = CPU_LEVELS.map(level => cpuLevelTuning(level));
    for (let index = 1; index < rows.length; index++) {
      const lower = rows[index - 1]!, higher = rows[index]!;
      expect(higher.preAttackWait[1]).toBeLessThanOrEqual(lower.preAttackWait[1]);
      expect(higher.dodgeWindow === 0 ? -1 : higher.dodgeWindow).toBeLessThanOrEqual(lower.dodgeWindow === -1 ? Infinity : lower.dodgeWindow);
      expect(higher.shieldMultiplier).toBeLessThan(lower.shieldMultiplier);
      expect(higher.stickClamp).toBeGreaterThan(lower.stickClamp);
      expect(higher.recoveryStick).toBeGreaterThan(lower.recoveryStick);
      expect(higher.dropWait).toBeLessThanOrEqual(lower.dropWait);
      expect(higher.specialCooldown[1]).toBeLessThan(lower.specialCooldown[1]);
      expect(higher.projectileLookahead[1]).toBeLessThanOrEqual(lower.projectileLookahead[1]);
    }
    // ftCo_800B63D8 / ftCo_800A5ACC / ftCo_800B9F90 / ftCo_800B9704 endpoints.
    expect(rows[0]).toMatchObject({ preAttackWait: [5, 39], dodgeWindow: -1, shieldMultiplier: 8, attackBlock: [300, 180], jumpChase: false, shieldGrab: false });
    expect(rows[8]).toMatchObject({ preAttackWait: [0, 0], dodgeWindow: 0, shieldMultiplier: 0, attackBlock: null, stickClamp: 1, jumpChase: true, shieldGrab: true });
    expect(cpuLevelTuning(9).specialCooldown).toEqual([25, 40]); expect(cpuLevelTuning(1).specialCooldown).toEqual([145, 280]);
    expect(cpuLevelTuning(3).jumpChase).toBe(false); expect(cpuLevelTuning(4).jumpChase).toBe(true);
    expect(cpuLevelTuning(5).shieldGrab).toBe(false); expect(cpuLevelTuning(6).shieldGrab).toBe(true);
  });
  it('creates plain snapshot-safe brains', () => {
    const brain = createCpuBrain(7);
    expect(structuredClone(brain)).toEqual(brain); expect(brain.level).toBe(7); expect(brain.script).toEqual([]);
  });
  it('carries the level in v5+ room CPU commands only within bounds', () => {
    expect(ROOM_PROTOCOL).toBe(10);
    expect(parseClientMessage(JSON.stringify({ type: 'cpu', token: 'abc', slot: 2, fighter: 'Kb', level: 9 }))).toMatchObject({ type: 'cpu', slot: 2, level: 9 });
    expect(parseClientMessage(JSON.stringify({ type: 'cpu', token: 'abc', slot: 2, fighter: null }))).toMatchObject({ type: 'cpu', fighter: null });
    for (const level of [0, 10, 2.5, '9']) expect(() => parseClientMessage(JSON.stringify({ type: 'cpu', token: 'abc', slot: 2, fighter: 'Kb', level }))).toThrow();
    expect(parseClientMessage(JSON.stringify({ type: 'cpu', token: 'abc', slot: 2, fighter: 'Kb', level: 5, costume: 3 }))).toMatchObject({ type: 'cpu', costume: 3 });
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 'abc', fighter: 'Mr', costume: 2 }))).toMatchObject({ type: 'choose', costume: 2 });
    for (const costume of [-1, 12, 1.5, '2']) expect(() => parseClientMessage(JSON.stringify({ type: 'choose', token: 'abc', fighter: 'Mr', costume }))).toThrow();
  });
});
