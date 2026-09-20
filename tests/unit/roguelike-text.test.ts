import { describe, expect, it } from 'vitest';
import { BOON_POOL, RARITIES } from '../../lib/game/roguelike/boons.ts';
import { CONSUMABLES } from '../../lib/game/roguelike/consumables.ts';
import { AFFIX_POOL, affixById } from '../../lib/game/roguelike/affixes.ts';
import { EVENTS } from '../../lib/game/roguelike/events.ts';
import { FLOOR_MODIFIERS } from '../../lib/game/roguelike/generator.ts';
import { BLESSINGS, MIRROR } from '../../lib/game/roguelike/meta.ts';
import { PATRONS } from '../../lib/game/roguelike/patrons.ts';
import { ASPECTS, MASTERY_REWARDS, RELICS } from '../../lib/game/roguelike/unlocks.ts';
import { BOSSES, TREASURES } from '../../lib/game/roguelike/bosses.ts';
import {
  affixText, aspectText, blessingText, bossText, treasureText, boonRarityText, masteryRewardText, relicText, boonText, consumableText, eventOptionText, eventText, mirrorText, modText,
  patronText, ROGUE_TEXT, toastText,
} from '../../web/src/play/roguelike-text.ts';

describe('rogue localization (EN complete, ES complete)', () => {
  it('ships a non-empty Spanish string for every English key', () => {
    const keys = Object.keys(ROGUE_TEXT.en) as Array<keyof typeof ROGUE_TEXT.en>;
    expect(keys.length).toBeGreaterThan(80);
    for (const key of keys) {
      expect(ROGUE_TEXT.en[key].length, `en.${key}`).toBeGreaterThan(0);
      expect(ROGUE_TEXT.es[key]?.length, `es.${key}`).toBeGreaterThan(0);
    }
  });
  it('translates every boon with matching structure and filled values', () => {
    for (const boon of BOON_POOL) {
      for (const rarity of RARITIES) {
        const es = boonText(boon, rarity, 2, 'es');
        const en = boonText(boon, rarity, 2, 'en');
        expect(es.name, boon.id).not.toBe(boon.name);
        expect(es.gains, boon.id).toHaveLength(boon.gains.length);
        expect(es.costs, boon.id).toHaveLength(boon.costs.length);
        expect(en.name).toBe(boon.name);
        for (const line of [...es.gains, ...en.gains, ...es.costs, ...en.costs]) expect(line, boon.id).not.toMatch(/\{v/);
      }
      expect(boonRarityText('epic', 'es')).toBe('ÉPICO');
    }
  });
  it('translates patrons, events, blessings, mirror, modifiers, pockets and affixes', () => {
    for (const patron of Object.values(PATRONS)) expect(patronText(patron, 'es').title.length).toBeGreaterThan(0);
    for (const event of Object.values(EVENTS)) {
      expect(eventText(event, 'es').title).not.toBe(event.title);
      for (const option of event.options) expect(eventOptionText(event, option, 'es').label).not.toBe(option.label);
    }
    for (const blessing of BLESSINGS) expect(blessingText(blessing, 'es').name).not.toBe(blessing.name);
    for (const def of MIRROR) {
      expect(mirrorText(def, 1, 'es').name).not.toBe(def.name);
      expect(mirrorText(def, 2, 'en').detail).not.toMatch(/\{n\}/);
    }
    expect(Object.keys(FLOOR_MODIFIERS)).toEqual(['frenzy', 'showdown', 'endurance', 'gauntlet', 'horde', 'swarm']);
    expect(modText({ id: 'swarm', ...FLOOR_MODIFIERS.swarm }, 'es').label).toBe('ENJAMBRE');
    for (const item of CONSUMABLES) expect(consumableText(item, 'es').name).not.toBe(item.name);
    for (const id of AFFIX_POOL) {
      const affix = affixById(id);
      expect(affixText(affix, 'es').detail).not.toBe(affixText(affix, 'en').detail);
    }
    for (const relic of RELICS) {
      const es = relicText(relic, 'es');
      expect(es.name, relic.id).not.toBe(relic.name);
      expect(es.levels, relic.id).toHaveLength(3);
      if (relic.condition) expect(es.condition, relic.id).not.toBe(relic.condition.text);
    }
    for (const aspect of ASPECTS) expect(aspectText(aspect, 'es').name).not.toBe(aspect.name);
    for (const boss of BOSSES) expect(bossText(boss, 'es').title).not.toBe(boss.title);
    for (const treasure of TREASURES) expect(treasureText(treasure, 'es').name).not.toBe(treasure.name);
    for (const reward of MASTERY_REWARDS) expect(masteryRewardText(reward, 'es')).not.toBe(reward.text);
    const names = { boon: (id: string) => id, pocket: (id: string) => id };
    expect(toastText('coins:120', 'en', names)).toBe('🪙 +120');
    expect(toastText(null, 'en', names)).toBeNull();
  });
});
