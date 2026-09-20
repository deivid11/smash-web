import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { matchSpawnPoints } from '../../lib/game/spawns.ts';
import { MeleePhysics, instantiateGameplay } from '../../lib/game/physics.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { PLAYER_PRESENTATIONS } from '../../lib/game/player-colors.ts';
import type { CommonGameplayData, FighterProfile, StageGameplayData } from '../../lib/game/data.ts';
import type { GameContent } from '../../lib/game/load.ts';

const stage = (): StageGameplayData => ({scale: 1, mainLeft: -80, mainRight: 80, blast: {left: -220, right: 220, top: 180, bottom: -110}, ledges: [],
  spawns: [[-30, 15, 0], [30, 15, 0], [-15, 35, 0], [15, 35, 0]],
  floors: [{id: 0, a: [-80, 0], b: [0, 0], oneWay: false}, {id: 1, a: [0, 0], b: [80, 0], oneWay: false}, {id: 2, a: [-20, 30], b: [20, 30], oneWay: true}]});

describe('shared prototype capacity and standalone private C ABI', () => {
  it('matches the eight-slot C define, TS bound and complete unique player palette', () => {
    const core = readFileSync(new URL('../../engine/gameplay/core.c', import.meta.url), 'utf8');
    expect(Number(core.match(/#define CORE_MAX_FIGHTERS (\d+)/)?.[1])).toBe(MAX_MATCH_PLAYERS);
    expect(MIN_MATCH_PLAYERS).toBe(2); expect(MAX_MATCH_PLAYERS).toBe(8);
    expect(PLAYER_PRESENTATIONS).toHaveLength(MAX_MATCH_PLAYERS); expect(new Set(PLAYER_PRESENTATIONS.map(player => player.color)).size).toBe(MAX_MATCH_PLAYERS);
  });
  it('provides eight distinct C fighter slots and rejects the ninth and negative boundary', async () => {
    const instance = await instantiateGameplay(readFileSync(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url)));
    const wasm = instance.exports as unknown as MeleePhysics['wasm'];
    const pointers = Array.from({length: MAX_MATCH_PLAYERS}, (_, slot) => wasm.core_attrs_ptr(slot));
    expect(pointers.every(pointer => pointer > 0)).toBe(true); expect(new Set(pointers).size).toBe(MAX_MATCH_PLAYERS);
    expect(wasm.core_attrs_ptr(MAX_MATCH_PLAYERS)).toBe(0); expect(wasm.core_attrs_ptr(-1)).toBe(0);
    for (let slot = 0; slot < MAX_MATCH_PLAYERS; slot++) wasm.core_set_velocity(slot, slot + 0.25, -slot - 0.5, 0);
    for (let slot = 0; slot < MAX_MATCH_PLAYERS; slot++) { expect(wasm.core_velocity(slot, 0)).toBe(slot + 0.25); expect(wasm.core_velocity(slot, 1)).toBe(-slot - 0.5); }
    expect(() => wasm.core_set_velocity(MAX_MATCH_PLAYERS, 0, 0, 1)).toThrow(); expect(() => wasm.core_velocity(-1, 0)).toThrow();
  });
  it('rejects a ninth profile or rig before allocating its gameplay resources', async () => {
    const profile = {words: new Uint32Array(0x9c / 4)} as FighterProfile, profiles = Array.from({length: MAX_MATCH_PLAYERS + 1}, () => profile);
    const instance = await instantiateGameplay(readFileSync(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url)));
    expect(() => new MeleePhysics(instance, {words: []} as unknown as CommonGameplayData, profiles)).toThrow('ABI');
    expect(() => rosterPlayers({} as GameContent, Array.from({length: MAX_MATCH_PLAYERS + 1}, () => 'Fx'))).toThrow('Select');
    expect(() => new GameRigs({fighters: profiles} as unknown as GameContent)).toThrow('rig count');
  });
});

describe('native and extended prototype spawn layouts', () => {
  it.each([2, 3, 4])('preserves the original point table for %i fighters without mutating it', count => {
    const data = stage(), original = structuredClone(data.spawns), spawns = matchSpawnPoints(data, count);
    expect(spawns).toEqual(original.slice(0, count)); spawns[0]![0] += 100;
    expect(data.spawns).toEqual(original);
  });
  it.each([5, 6, 7, 8])('places %i distinct grounded slots across merged real floor segments, inside the blast boundaries', count => {
    const data = stage(), original = structuredClone(data.spawns), positions = matchSpawnPoints(data, count);
    expect(positions).toHaveLength(count); expect(new Set(positions.map(point => point.join(':'))).size).toBe(count);
    for (const [slot, point] of positions.entries()) {
      expect(point[0]).toBeGreaterThan(data.mainLeft); expect(point[0]).toBeLessThan(data.mainRight); expect(point[1]).toBe(0);
      expect(data.floors.some(floor => !floor.oneWay && point[0] >= floor.a[0] && point[0] <= floor.b[0] && point[1] === floor.a[1])).toBe(true);
      if (slot > 0) expect(point[0] - positions[slot - 1]![0]).toBeGreaterThanOrEqual(12);
    }
    expect(matchSpawnPoints({...data, floors: [...data.floors].reverse()}, count)).toEqual(positions);
    expect(data.spawns).toEqual(original); expect(data.spawns).toHaveLength(4);
  });
  it('slides seats off a floor gap onto real segments and still refuses a floorless stage', () => {
    const data = stage(); data.floors[0]!.b[0] = -5; data.floors[1]!.a[0] = 5;
    const positions = matchSpawnPoints(data, 8);
    expect(positions).toHaveLength(8);
    // Every point sits on an actual solid segment: nothing spawns over the gap or in the air.
    for (const point of positions) expect(data.floors.some(floor => !floor.oneWay && point[0] >= Math.min(floor.a[0], floor.b[0]) && point[0] <= Math.max(floor.a[0], floor.b[0]) && point[1] === floor.a[1])).toBe(true);
    expect(() => matchSpawnPoints({...data, floors: []}, 8)).toThrow('solid floor');
    for (const count of [1, 9, NaN, 5.5]) expect(() => matchSpawnPoints(stage(), count)).toThrow('player count');
  });
});
