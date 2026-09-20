import { afterEach, describe, expect, it } from 'vitest';
import {
  applyLoadoutBuild, aspectById, ASPECTS, championPerks, emptyStats, MASTERY_REWARDS, MASTERY_XP, masteryProgress, masteryRank,
  masteryXpForRun, mergeStats, relicById, relicLevel, RELIC_LEVEL_XP, RELICS, relicValue, relicXpForRun, type RunSummary,
} from '../../lib/game/roguelike/unlocks.ts';
import {
  buyRank, championRecord, chooseAspect, emptyMeta, loadMeta, recordRunInMeta, refundMirror, relicSlots, saveMeta,
  toggleLoadoutRelic, unlockRelicWithKeys,
} from '../../lib/game/roguelike/meta.ts';
import { computeBoonState, emptyBoonState } from '../../lib/game/roguelike/boons.ts';

const summary = (patch: Partial<RunSummary> = {}): RunSummary => ({
  fighter: 'Fx', cleared: 4, bossesDown: 1, elitesDown: 1, fightsWon: 3, eventsVisited: 1, coinsSpent: 120,
  victory: false, heat: 0, boonIds: ['ember-fury'], relics: ['lucky-coin'], ...patch,
});

describe('permanent unlocks: relics, aspects, champion mastery', () => {
  const storage = new Map<string, string>();
  const original = globalThis.localStorage;
  afterEach(() => { storage.clear(); Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true }); });

  it('declares relics with three levels, starters and unlock paths', () => {
    expect(new Set(RELICS.map((relic) => relic.id)).size).toBe(RELICS.length);
    expect(RELICS.filter((relic) => relic.starter).map((relic) => relic.id)).toEqual(['spiked-collar', 'lucky-coin']);
    for (const relic of RELICS) {
      expect(relic.levels).toHaveLength(3);
      if (!relic.starter) {
        expect(relic.condition, relic.id).toBeDefined();
        expect(relic.keyCost).toBeGreaterThan(0);
      }
      expect(relicValue(relic.id, 3)).toBeGreaterThanOrEqual(relicValue(relic.id, 1));
    }
    expect(() => relicById('nope')).toThrow();
    expect(relicLevel(0)).toBe(1);
    expect(relicLevel(RELIC_LEVEL_XP[0])).toBe(2);
    expect(relicLevel(RELIC_LEVEL_XP[1])).toBe(3);
    expect(relicXpForRun({ fightsWon: 5, bossesDown: 2 })).toBe(9);
  });

  it('merges lifetime stats and meets achievement conditions', () => {
    let stats = emptyStats();
    stats = mergeStats(stats, summary({ boonIds: ['volt-arc', 'volt-static', 'volt-clap', 'duo-surge', 'chaos-glass'], victory: true, heat: 2 }));
    expect(stats).toMatchObject({ runs: 1, wins: 1, bossesDown: 1, elitesDown: 1, duoRuns: 1, maxPatronBoons: 3, chaosPacts: 1, bestHeatWin: 2, coinsSpent: 120 });
    expect(relicById('thunder-idol').condition!.met(stats)).toBe(true);
    expect(relicById('compass').condition!.met(stats)).toBe(true);
    expect(relicById('chaos-shard').condition!.met(stats)).toBe(true);
    expect(relicById('phoenix-heart').condition!.met(stats)).toBe(true);
    expect(relicById('blood-vial').condition!.met(stats)).toBe(false);
  });

  it('ranks champions, scales aspects and grants perks', () => {
    expect(masteryRank(0)).toBe(1);
    expect(masteryRank(MASTERY_XP[1]!)).toBe(2);
    expect(masteryRank(99999)).toBe(MASTERY_XP.length);
    expect(masteryProgress(100)).toEqual({ rank: 2, into: 20, span: 120 });
    expect(masteryProgress(99999).span).toBeNull();
    expect(masteryXpForRun({ cleared: 10, bossesDown: 3, elitesDown: 2, victory: true, heat: 2 })).toBe(Math.round((100 + 90 + 20 + 120) * 1.5));
    expect(championPerks(1)).toEqual({ rerolls: 0, coins: 0, lives: 0, aspectLevel: 1 });
    expect(championPerks(8)).toEqual({ rerolls: 1, coins: 40, lives: 1, aspectLevel: 3 });
    expect(ASPECTS.map((aspect) => aspect.rank)).toEqual([1, 2, 4, 6]);
    for (const reward of MASTERY_REWARDS) expect(reward.rank).toBeGreaterThan(1);
    expect(() => aspectById('nope')).toThrow();
  });

  it('folds relic and aspect build effects into the capped build', () => {
    const state = emptyBoonState();
    applyLoadoutBuild(state, [{ id: 'spiked-collar', level: 3 }, { id: 'hunter-eye', level: 1 }, { id: 'thunder-idol', level: 2 }, { id: 'hourglass', level: 2 }, { id: 'lucky-coin', level: 3 }], { id: 'vanguard', level: 2 });
    expect(state.player.damageTakenMul).toBeCloseTo(0.86, 6);
    expect(state.player.critChance).toBeCloseTo(0.05, 6);
    expect(state.player.chainDamage).toBe(3);
    expect(state.clockBonus).toBe(40);
    expect(state.scorePerFloor).toBe(100);
    expect(state.player.damageDealtMul).toBeCloseTo(1.12, 6);
    expect(state.player.knockbackMul).toBeCloseTo(1.06, 6);
    const reaper = computeBoonState([], (build) => applyLoadoutBuild(build, [], { id: 'reaper', level: 3 }));
    expect(reaper.player.executeMul).toBeCloseTo(1.3, 6);
    expect(reaper.player.lifesteal).toBe(5);
    expect(reaper.playerStartPercent).toBe(10);
  });

  it('unlocks with keys, equips within satchel slots and gates aspects by rank', () => {
    let meta = { ...emptyMeta(), keys: 10 };
    expect(relicSlots(meta)).toBe(1);
    meta = toggleLoadoutRelic(meta, 'lucky-coin');
    expect(meta.loadout).toEqual(['lucky-coin']);
    expect(() => toggleLoadoutRelic(meta, 'spiked-collar')).toThrow();
    expect(() => toggleLoadoutRelic(meta, 'ledger')).toThrow();
    meta = unlockRelicWithKeys(meta, 'hunter-eye');
    expect(meta.keys).toBe(7);
    expect(() => unlockRelicWithKeys(meta, 'hunter-eye')).toThrow();
    expect(() => unlockRelicWithKeys({ ...meta, keys: 0 }, 'ledger')).toThrow();
    meta = buyRank({ ...meta, shards: 500 }, 'satchel');
    expect(relicSlots(meta)).toBe(2);
    meta = toggleLoadoutRelic(meta, 'hunter-eye');
    expect(meta.loadout).toEqual(['lucky-coin', 'hunter-eye']);
    expect(refundMirror(meta).loadout).toEqual(['lucky-coin']);
    meta = toggleLoadoutRelic(meta, 'lucky-coin');
    expect(meta.loadout).toEqual(['hunter-eye']);
    expect(() => chooseAspect(meta, 'Fx', 'bastion')).toThrow();
    meta = { ...meta, champions: { Fx: { ...championRecord(meta, 'Fx'), xp: MASTERY_XP[3]! } } };
    meta = chooseAspect(meta, 'Fx', 'bastion');
    expect(championRecord(meta, 'Fx').aspect).toBe('bastion');
    expect(championRecord(meta, 'Kb').aspect).toBe('vanguard');
  });

  it('reports mastery, relic XP, keys and achievement unlocks after a run', () => {
    const start = { ...emptyMeta(), relicXp: { 'lucky-coin': 6 } };
    const report = recordRunInMeta(start, summary({ fightsWon: 4, bossesDown: 1, relics: ['lucky-coin'] }));
    expect(report.keys).toBe(1);
    expect(report.relics).toEqual([{ id: 'lucky-coin', xp: 6, levelBefore: 1, levelAfter: 2 }]);
    expect(report.meta.relicXp['lucky-coin']).toBe(12);
    expect(report.unlocked).toContain('hunter-eye');
    expect(report.meta.unlocked).toContain('hunter-eye');
    expect(report.mastery).toMatchObject({ fighter: 'Fx', before: 0, rankBefore: 1 });
    expect(report.meta.champions.Fx!.runs).toBe(1);
    // Already-unlocked relics are never reported twice.
    expect(recordRunInMeta(report.meta, summary()).unlocked).not.toContain('hunter-eye');
  });

  it('persists and migrates saves from before the unlock layer', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
    });
    storage.set('smash-roguelike-meta', JSON.stringify({ shards: 40, ranks: { greed: 1 }, runs: 3, wins: 1, bestHeatWin: 0 }));
    const legacy = loadMeta();
    expect(legacy).toMatchObject({ shards: 40, runs: 3, keys: 0, loadout: [] });
    expect(legacy.ranks.satchel).toBe(0);
    expect(legacy.unlocked).toEqual(['spiked-collar', 'lucky-coin']);
    expect(legacy.stats.runs).toBe(3);
    const saved = { ...legacy, keys: 4, loadout: ['lucky-coin' as const, 'ledger' as const], unlocked: [...legacy.unlocked, 'nope' as never], champions: { Fx: { xp: 300, runs: 2, wins: 0, aspect: 'tempest' as const } } };
    saveMeta(saved);
    const loaded = loadMeta();
    expect(loaded.keys).toBe(4);
    expect(loaded.unlocked).toEqual(['spiked-collar', 'lucky-coin']);
    expect(loaded.loadout).toEqual(['lucky-coin']);
    expect(loaded.champions.Fx).toEqual({ xp: 300, runs: 2, wins: 0, aspect: 'tempest' });
  });
});
