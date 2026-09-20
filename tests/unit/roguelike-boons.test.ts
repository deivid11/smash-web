import { describe, expect, it } from 'vitest';
import {
  BOON_POOL, boonById, boonEligible, boonValue, computeBoonState, describeBoon, emptyBoonState, maxLevelOf,
  offerBoons, offerPoms, offerRemovals, shopPrice, takeCard, type OwnedBoon,
} from '../../lib/game/roguelike/boons.ts';
import { DOOR_PATRONS, PATRONS } from '../../lib/game/roguelike/patrons.ts';
import { NEUTRAL_ROGUE_MODS } from '../../lib/game/roguelike/sim.ts';

const own = (id: string, rarity: OwnedBoon['rarity'] = 'common', level = 1): OwnedBoon => ({ id, rarity, level });

describe('rift boons (patrons, rarity, levels, duos)', () => {
  it('declares unique, well-formed boons for every patron', () => {
    const ids = BOON_POOL.map((boon) => boon.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const patron of DOOR_PATRONS) {
      expect(BOON_POOL.filter((boon) => boon.patron === patron && !boon.duo).length, patron).toBeGreaterThanOrEqual(4);
    }
    for (const boon of BOON_POOL) {
      expect(PATRONS[boon.patron]).toBeDefined();
      expect(boon.gains.length, boon.id).toBeGreaterThan(0);
      if (boon.duo) {
        expect(boon.duo).toContain(boon.patron);
        expect(boon.kind).toBe('duo');
      }
      for (const required of boon.requires ?? []) expect(() => boonById(required)).not.toThrow();
    }
    expect(() => boonById('nope')).toThrow();
  });

  it('scales magnitude by rarity and level, never for fixed boons', () => {
    const fury = boonById('ember-fury');
    expect(boonValue(fury, 'common', 1)).toBe(10);
    expect(boonValue(fury, 'rare', 1)).toBe(15);
    expect(boonValue(fury, 'epic', 1)).toBe(20);
    expect(boonValue(fury, 'common', 3)).toBe(20);
    expect(boonValue(boonById('gale-wings'), 'epic', 1)).toBe(1);
    expect(describeBoon(fury, 'rare', 2).gains[0]).toBe('+22.5% damage on your hits');
    expect(describeBoon(boonById('gale-time'), 'common', 1).gains[1]).toBe('+200 score per cleared floor');
  });

  it('computes a neutral build from nothing and stacks multiplicatively with caps', () => {
    const empty = computeBoonState([]);
    expect(empty).toEqual(emptyBoonState());
    expect(empty.player).toEqual(NEUTRAL_ROGUE_MODS);
    const build = computeBoonState([own('ember-fury', 'epic'), own('blood-pact', 'rare', 2), own('hunt-aim', 'common', 5), own('tide-riptide'), own('volt-arc'), own('gale-wings', 'rare')]);
    expect(build.player.damageDealtMul).toBeCloseTo(1.2 * 1.563, 6);
    expect(build.player.damageTakenMul).toBeCloseTo(1.1, 6);
    expect(build.player.critChance).toBeCloseTo(0.24, 6);
    expect(build.player.knockbackMul).toBeCloseTo(1.1, 6);
    expect(build.player.chainDamage).toBe(3);
    expect(build.player.extraJumps).toBe(1);
    const stacked = computeBoonState([own('ember-fury', 'epic', 5), own('blood-pact', 'epic', 5), own('chaos-glass', 'epic', 5), own('chaos-frenzy', 'epic', 5)]);
    expect(stacked.player.damageDealtMul).toBe(3);
    expect(stacked.enemyDamageMul).toBeCloseTo(1.15, 6);
  });

  it('gates requirements and duos on owned patrons', () => {
    expect(boonEligible(boonById('volt-conduit'), [])).toBe(false);
    expect(boonEligible(boonById('volt-conduit'), [own('volt-arc')])).toBe(true);
    expect(boonEligible(boonById('volt-arc'), [own('volt-arc')])).toBe(false);
    const surge = boonById('duo-surge');
    expect(boonEligible(surge, [own('volt-arc')])).toBe(false);
    expect(boonEligible(surge, [own('volt-arc'), own('tide-anchor')])).toBe(true);
  });

  it('offers deterministic, distinct, eligible cards from the door patron', () => {
    const context = { seed: 1234, key: 5, owned: [], patron: 'ember' as const };
    const first = offerBoons(context);
    expect(first).toEqual(offerBoons(context));
    expect(first).toHaveLength(3);
    expect(new Set(first.map((card) => card.id)).size).toBe(3);
    for (const card of first) {
      expect(card.type).toBe('boon');
      const boon = boonById(card.id);
      expect(boon.patron).toBe('ember');
      expect(boonEligible(boon, [])).toBe(true);
    }
    const epic = offerBoons({ ...context, key: 6, minRarity: 'epic' });
    expect(epic.every((card) => card.type === 'boon' && (card.rarity === 'epic' || card.rarity === 'legendary'))).toBe(true);
    // An exhausted patron tops up from other door patrons.
    const owned = BOON_POOL.filter((boon) => boon.patron === 'gale').map((boon) => own(boon.id));
    const topped = offerBoons({ seed: 9, key: 1, owned, patron: 'gale' });
    expect(topped).toHaveLength(3);
    expect(topped.every((card) => boonById(card.id).patron !== 'gale' || !!boonById(card.id).duo)).toBe(true);
  });

  it('eventually offers duo boons once two patrons are owned', () => {
    const owned = [own('volt-arc'), own('tide-anchor')];
    const duos = new Set<string>();
    for (let key = 0; key < 60; key++) {
      for (const card of offerBoons({ seed: 77, key, owned, patron: 'volt' })) if (boonById(card.id).duo) duos.add(card.id);
    }
    expect(duos.has('duo-surge')).toBe(true);
  });

  it('upgrades with poms, removes, and rejects stale picks', () => {
    const owned = [own('ember-fury'), own('gale-wings', 'rare')];
    const poms = offerPoms(3, 1, owned);
    expect(poms).toEqual([{ type: 'pom', id: 'ember-fury', levels: 1 }]);
    const upgraded = takeCard(owned, poms[0]!);
    expect(upgraded[0]!.level).toBe(2);
    const maxed = takeCard(upgraded, { type: 'pom', id: 'ember-fury', levels: 10 });
    expect(maxed[0]!.level).toBe(maxLevelOf(boonById('ember-fury')));
    expect(() => takeCard(maxed, { type: 'pom', id: 'ember-fury', levels: 1 })).toThrow();
    expect(() => takeCard(owned, { type: 'boon', id: 'ember-fury', rarity: 'rare' })).toThrow();
    expect(offerRemovals(owned)).toHaveLength(2);
    expect(takeCard(owned, { type: 'remove', id: 'gale-wings' })).toEqual([own('ember-fury')]);
    expect(() => takeCard(owned, { type: 'remove', id: 'volt-arc' })).toThrow();
    expect(shopPrice({ type: 'boon', id: 'ember-fury', rarity: 'epic' })).toBeGreaterThan(shopPrice({ type: 'boon', id: 'ember-fury', rarity: 'common' }));
  });

  it('never shows a number past the lane cap, and duo multipliers ignore pick order', () => {
    expect(boonValue(boonById('ember-brand'), 'epic', 5)).toBe(20);
    expect(boonValue(boonById('tide-anchor'), 'epic', 5)).toBe(40);
    expect(boonValue(boonById('volt-static'), 'epic', 5)).toBe(60);
    for (const boon of BOON_POOL) {
      if (boon.cap === undefined) continue;
      expect(boonValue(boon, 'epic', maxLevelOf(boon))).toBeLessThanOrEqual(boon.cap);
    }
    const first = computeBoonState([own('duo-boiling-blood', 'legendary'), own('blood-rage')]).player.rageCap;
    const last = computeBoonState([own('blood-rage'), own('duo-boiling-blood', 'legendary')]).player.rageCap;
    expect(first).toBeCloseTo(0.6, 6);
    expect(last).toBeCloseTo(first, 6);
  });
});
