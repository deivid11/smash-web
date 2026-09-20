import { describe, expect, it } from 'vitest';
import {
  BLESSINGS, buyRank, emptyMeta, metaBonuses, MIRROR, mirrorTotal, nextRankCost, offerBlessings, recordRunInMeta,
  refundMirror, shardsForRun,
} from '../../lib/game/roguelike/meta.ts';

describe('mirror of the rift + blessings (meta progression)', () => {
  it('buys ranks with shards, caps them and refunds everything', () => {
    let meta = { ...emptyMeta(), shards: 500 };
    expect(nextRankCost(meta, 'greed')).toBe(20);
    meta = buyRank(meta, 'greed');
    meta = buyRank(meta, 'greed');
    meta = buyRank(meta, 'greed');
    expect(meta.ranks.greed).toBe(3);
    expect(meta.shards).toBe(500 - 20 - 45 - 90);
    expect(nextRankCost(meta, 'greed')).toBeNull();
    expect(() => buyRank(meta, 'greed')).toThrow();
    expect(() => buyRank({ ...meta, shards: 0 }, 'defiance')).toThrow();
    const refunded = refundMirror(meta);
    expect(refunded.shards).toBe(500);
    expect(refunded.ranks.greed).toBe(0);
    for (const def of MIRROR) expect(def.costs.length).toBeGreaterThan(0);
  });
  it('turns ranks into run bonuses', () => {
    const meta = emptyMeta();
    expect(metaBonuses(meta)).toEqual({ lives: 0, defiances: 0, coins: 0, rerolls: 0, pockets: 0, luck: 0, takenMul: 1 });
    meta.ranks = { resilience: 2, defiance: 1, greed: 1, authority: 3, pockets: 1, favor: 2, skin: 1, satchel: 0 };
    expect(metaBonuses(meta)).toEqual({ lives: 2, defiances: 1, coins: 50, rerolls: 3, pockets: 1, luck: 0.2, takenMul: 0.95 });
    expect(mirrorTotal('favor', 3)).toBe(30);
  });
  it('pays shards for every run, more for depth, bosses, wins and heat', () => {
    expect(shardsForRun({ cleared: 0, bossesDown: 0, victory: false, heat: 0 })).toBe(0);
    const shallow = shardsForRun({ cleared: 3, bossesDown: 0, victory: false, heat: 0 });
    const deep = shardsForRun({ cleared: 10, bossesDown: 3, victory: true, heat: 0 });
    const hot = shardsForRun({ cleared: 10, bossesDown: 3, victory: true, heat: 4 });
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
    expect(hot).toBe(deep * 2);
    const { meta, earned, keys } = recordRunInMeta(emptyMeta(), { fighter: 'Fx', cleared: 10, bossesDown: 3, elitesDown: 1, fightsWon: 7, eventsVisited: 2, coinsSpent: 100, victory: true, heat: 2, boonIds: [], relics: [] });
    expect(meta.shards).toBe(earned);
    expect(keys).toBe(1 + 2 + 3 + 10);
    expect(meta.keys).toBe(16);
    expect(meta).toMatchObject({ runs: 1, wins: 1, bestHeatWin: 2 });
  });
  it('offers three distinct deterministic blessings', () => {
    const offer = offerBlessings(123);
    expect(offer).toEqual(offerBlessings(123));
    expect(new Set(offer).size).toBe(3);
    for (const id of offer) expect(BLESSINGS.some((entry) => entry.id === id)).toBe(true);
  });
});
