import { describe, expect, it } from 'vitest';
import {
  ACE_ENEMY_FALLBACKS, ACT_SIZE, actOf, BOSS_LANE, combatFloors, floorVersus, foeScaling, generateRun, isBossRow, LANES, nodeAt, reachableLanes,
} from '../../lib/game/roguelike/generator.ts';
import { EVENT_IDS } from '../../lib/game/roguelike/events.ts';
import { BOSSES } from '../../lib/game/roguelike/bosses.ts';

const SEEDS = ['RIFT-A', 'RIFT-B', 'RIFT-C', 'RIFT-D', 'RIFT-E'];

describe('descent map generation (50 floors, 5 acts)', () => {
  it('is deterministic per seed and options', () => {
    const first = generateRun('RIFT-MAP', { difficulty: 'flame', playerFighter: 'Kb', heat: 2 });
    expect(first.length).toBe(50);
    expect(generateRun('rift-map', { difficulty: 'flame', playerFighter: 'Kb', heat: 2 })).toEqual(first);
    expect(generateRun('RIFT-MAP2', { playerFighter: 'Kb' })).not.toEqual(first);
    expect(() => generateRun('X', { length: 9 as never })).toThrow();
    expect(() => generateRun('X', { heat: 6 as never })).toThrow();
  });

  it('places an act boss alone in the center lane every ten floors', () => {
    const plan = generateRun('RIFT-BOSS');
    expect(plan.map).toHaveLength(50);
    const bossRows = plan.map.flatMap((_, row) => (isBossRow(row, plan.length) ? [row] : []));
    expect(bossRows).toEqual([9, 19, 29, 39, 49]);
    plan.map.forEach((nodes, row) => {
      if (!isBossRow(row, plan.length)) { expect(nodes).toHaveLength(LANES); return; }
      expect(nodes).toHaveLength(1);
      const floor = nodes[0]!.floor!;
      expect(nodes[0]).toMatchObject({ kind: 'boss', lane: BOSS_LANE, reward: 'boon' });
      const boss = BOSSES[actOf(row)]!;
      expect(floor.boss).toBe(boss.id);
      expect(floor.enemies).toHaveLength(boss.slots.length);
      expect(floor.enemies.every((enemy) => enemy.boss)).toBe(true);
      expect(floor.affixes).toHaveLength(boss.affixCount);
      expect(floor.enemies.map((enemy) => enemy.stocks)).toEqual(boss.slots.map((slot) => slot.stocks));
      expect(floor.timeSeconds).toBeGreaterThanOrEqual(240);
    });
    const giga = plan.map[39]![0]!.floor!.enemies[0]!;
    expect(giga).toMatchObject({ fighter: 'Gk', fallback: 'Kp', giga: true, stocks: 4 });
    expect(plan.map[49]![0]!.floor!.enemies[0]!).toMatchObject({ fighter: 'Gk', stocks: 5 });
  });

  it('keeps pacing rules: fights every row, no early elites or rests, no shop before a boss', () => {
    for (const seed of SEEDS) {
      const plan = generateRun(seed);
      expect(plan.map[0]!.every((node) => node.kind === 'battle')).toBe(true);
      const treasuresPerAct = new Map<number, number>();
      plan.map.forEach((nodes, row) => {
        expect(nodes.some((node) => node.kind === 'battle' || node.kind === 'elite' || node.kind === 'boss'), `${seed} row ${row}`).toBe(true);
        if (row < 2) expect(nodes.some((node) => node.kind === 'elite' || node.kind === 'rest')).toBe(false);
        if (row + 1 < plan.length && isBossRow(row + 1, plan.length)) expect(nodes.some((node) => node.kind === 'shop')).toBe(false);
        for (const kind of ['rest', 'shop', 'treasure'] as const) expect(nodes.filter((node) => node.kind === kind).length).toBeLessThanOrEqual(1);
        treasuresPerAct.set(actOf(row), (treasuresPerAct.get(actOf(row)) ?? 0) + nodes.filter((node) => node.kind === 'treasure').length);
        for (const node of nodes) {
          if (node.kind === 'battle' || node.kind === 'elite' || node.kind === 'boss') {
            expect(node.floor).not.toBeNull();
            expect(node.floor!.act).toBe(actOf(row));
            if (node.reward === 'boon') expect(node.patron).not.toBeNull();
          } else {
            expect(node.floor).toBeNull();
          }
          if (node.kind === 'event') expect(EVENT_IDS).toContain(node.event);
        }
      });
      for (const count of treasuresPerAct.values()) expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('connects every room with non-crossing edges to neighbouring lanes', () => {
    for (const seed of SEEDS) {
      const plan = generateRun(seed);
      for (let row = 0; row < plan.length - 1; row++) {
        const nodes = plan.map[row]!;
        const below = plan.map[row + 1]!;
        for (const node of nodes) {
          expect(node.next.length).toBeGreaterThan(0);
          for (const lane of node.next) {
            expect(below.some((entry) => entry.lane === lane)).toBe(true);
            if (below.length > 1 && nodes.length > 1) expect(Math.abs(lane - node.lane)).toBeLessThanOrEqual(1);
          }
        }
        for (const target of below) expect(nodes.some((node) => node.next.includes(target.lane)), `${seed} row ${row + 1} lane ${target.lane} unreachable`).toBe(true);
        for (const a of nodes) for (const b of nodes) {
          if (a.lane < b.lane) expect(a.next.some((x) => b.next.some((y) => x > y)), `${seed} row ${row} crossing`).toBe(false);
        }
      }
      expect(plan.map[plan.length - 1]![0]!.next).toEqual([]);
    }
  });

  it('walks reachable lanes from the previous choice', () => {
    const plan = generateRun('RIFT-WALK');
    expect(reachableLanes(plan, 0, null)).toEqual([0, 1, 2]);
    expect(reachableLanes(plan, 1, 0)).toEqual(nodeAt(plan, 0, 0).next);
    expect(reachableLanes(plan, ACT_SIZE - 1, 1)).toEqual([BOSS_LANE]);
    expect(reachableLanes(plan, ACT_SIZE, BOSS_LANE)).toEqual([0, 1, 2]);
    expect(() => nodeAt(plan, ACT_SIZE - 1, 0)).toThrow();
  });

  it('makes every act harder: levels, crowds, gifts and foe scaling', () => {
    const plan = generateRun('RIFT-CURVE', { difficulty: 'flame' });
    const actStats = [0, 1, 2, 3, 4].map((act) => {
      const floors = combatFloors(plan).filter((floor) => floor.act === act && floor.kind === 'battle' && !floor.modifier);
      const enemies = floors.flatMap((floor) => floor.enemies);
      return {
        level: enemies.reduce((sum, enemy) => sum + enemy.level, 0) / Math.max(1, enemies.length),
        crowd: enemies.length / Math.max(1, floors.length),
        gifts: floors.reduce((sum, floor) => sum + floor.affixes.length, 0) / Math.max(1, floors.length),
      };
    });
    for (let act = 1; act < 5; act++) {
      expect(actStats[act]!.level).toBeGreaterThanOrEqual(actStats[act - 1]!.level - 0.01);
      expect(actStats[act]!.crowd).toBeGreaterThanOrEqual(actStats[act - 1]!.crowd - 0.3);
    }
    expect(actStats[4]!.level).toBeGreaterThanOrEqual(8.5);
    expect(actStats[4]!.crowd).toBeGreaterThanOrEqual(3);
    expect(actStats[4]!.gifts).toBeGreaterThan(actStats[0]!.gifts);
    let previous = foeScaling(0, 50, 'battle', 0);
    for (let row = 1; row < 50; row++) {
      const next = foeScaling(row, 50, 'battle', 0);
      expect(next.damage).toBeGreaterThan(previous.damage);
      expect(next.taken).toBeLessThanOrEqual(previous.taken);
      expect(next.knockbackTaken).toBeLessThanOrEqual(previous.knockbackTaken);
      previous = next;
    }
    expect(previous.damage).toBeGreaterThan(2.2);
    expect(previous.taken).toBeLessThan(0.6);
    for (const floor of combatFloors(generateRun('RIFT-CURVE', { difficulty: 'inferno', heat: 5 }))) {
      expect(floor.enemies.length).toBeGreaterThanOrEqual(1);
      expect(floor.enemies.length).toBeLessThanOrEqual(7);
      if (!floor.boss) expect(floor.enemies.some((enemy) => enemy.fighter === 'Fx')).toBe(false);
      for (const enemy of floor.enemies) {
        expect(enemy.level).toBeGreaterThanOrEqual(1);
        expect(enemy.level).toBeLessThanOrEqual(9);
      }
      if (floor.modifier?.id === 'swarm') expect(floor.enemies).toHaveLength(7);
      if (floor.kind === 'boss') expect(floor.rift).toBe(false);
    }
  });

  it('draws ACE champions as rivals with stand-ins and labels every floor format', () => {
    const counts = { ace: 0, team: 0, ffa: 0 };
    for (const seed of ['RIFT-ACE-1', 'RIFT-ACE-2', 'RIFT-ACE-3']) for (const floor of combatFloors(generateRun(seed))) {
      for (const enemy of floor.enemies) {
        if (enemy.fighter === 'Gk' || !(enemy.fighter in ACE_ENEMY_FALLBACKS)) continue;
        counts.ace++;
        expect(enemy.fallback).toBe(ACE_ENEMY_FALLBACKS[enemy.fighter]);
      }
      if (floor.enemies.length === 1) expect(floor.format).toBe('duel');
      else if (floor.boss) expect(floor.format).toBe('team');
      else if (floor.modifier?.id === 'swarm' || floor.modifier?.id === 'horde') expect(floor.format).toBe('ffa');
      if (floor.format !== 'duel') counts[floor.format]++;
    }
    expect(counts.ace).toBeGreaterThan(10);
    expect(counts.team).toBeGreaterThan(0);
    expect(counts.ffa).toBeGreaterThan(0);
    const duel = combatFloors(generateRun('RIFT-ACE-1')).find((floor) => floor.format === 'duel')!;
    expect(floorVersus(duel)).toEqual({ format: 'duel', foes: 1 });
    // The Echo mirror (or a gauntlet twin) turns a duel into an allied 2v1.
    expect(floorVersus(duel, 1)).toEqual({ format: 'team', foes: 2 });
    expect(floorVersus({ ...duel, format: 'ffa' }, 1).format).toBe('ffa');
  });
});
