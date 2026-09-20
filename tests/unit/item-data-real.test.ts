import { beforeAll, describe, expect, it } from 'vitest';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { parseItemsData, type ItemsData } from '../../lib/game/item-data.ts';
import { ITEM_COMMON } from '../../lib/game/item-common.ts';
import { COMMON_ITEM_NAMES, MATCH_ITEM_NAMES, itemKind } from '../../lib/game/item-kinds.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('ItCo.dat common item archive', () => {
  let items: ItemsData;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { items = parseItemsData(await new HsdAssetSession(disc, await verifyMeleeDisc(disc)).archive('ItCo.dat')); }
    finally { await disc.close(); }
  }, 30000);
  it('reads the same itPublicData scalars the Link-bomb path pins', () => {
    expect(items.common.reflectedLife).toBe(ITEM_COMMON.reflectedLife);
    expect(items.common.shieldBounceX).toBe(ITEM_COMMON.shieldBounceX);
    expect(items.common.shieldBounceY).toBe(ITEM_COMMON.shieldBounceY);
    expect(items.common.shieldBounceLift).toBe(ITEM_COMMON.shieldBounceLift);
    expect(items.common.explosionLife).toBe(ITEM_COMMON.explosionLife);
    expect(items.common.lifetime).toBeGreaterThan(60);
    for (const { min, max } of items.common.spawnIntervals) { expect(min).toBeGreaterThan(0); expect(max).toBeGreaterThanOrEqual(min); }
  });
  it('parses an article for every common item kind', () => {
    for (const name of COMMON_ITEM_NAMES) expect(items.kinds.has(itemKind(name)), name).toBe(true);
    expect(items.kinds.size).toBe(COMMON_ITEM_NAMES.length);
  });
  it('classifies the original heavy/swingable/shootable items', () => {
    for (const name of ['Box', 'Taru', 'TaruCann'] as const) expect(items.kind(itemKind(name)).attributes.heavy, name).toBe(true);
    for (const name of ['BombHei', 'Dosei', 'MBall'] as const) {
      const attributes = items.kind(itemKind(name)).attributes;
      expect(attributes.heavy, name).toBe(false); expect(attributes.actionClass, name).toBe(0);
    }
    // Foods authors action class 5: consumed on use rather than thrown/swung/shot.
    expect(items.kind(itemKind('Foods')).attributes.actionClass).toBe(5);
    for (const name of ['Bat', 'Sword', 'Parasol', 'StarRod', 'LipStick', 'Harisen'] as const) expect(items.kind(itemKind(name)).attributes.actionClass, name).toBe(2);
    for (const name of ['LGun', 'SScope', 'FFlower'] as const) expect(items.kind(itemKind(name)).attributes.actionClass, name).toBe(3);
  });
  it('exposes usable physics attributes and destroy effects', () => {
    for (const [kind, data] of items.kinds) {
      expect(data.attributes.scale, data.name).toBeGreaterThan(0);
      expect(data.attributes.terminal, data.name).toBeGreaterThanOrEqual(0);
      // Foods is the one kind with no state array/base model; its food models live elsewhere in ItCo.
      if (data.name !== 'Foods') expect(data.states.length, data.name).toBeGreaterThan(0);
      expect(data.states.length, data.name).toBeLessThanOrEqual(8);
      expect(kind).toBe(data.kind);
    }
    expect(items.kind(itemKind('BombHei')).attributes.gravity).toBeGreaterThan(0);
  });
  it('parses hitbox-bearing animation scripts across the common table', () => {
    let hits = 0;
    for (const data of items.kinds.values()) for (const state of data.states) for (const event of state.script?.events ?? []) {
      if (event.type === 'create') { hits++; expect(event.hit.damage).toBeLessThanOrEqual(500); }
    }
    // Item sounds mostly come from the per-kind C callbacks, not the .dat scripts.
    expect(hits).toBeGreaterThan(10);
    const explosion = items.kind(itemKind('BombHei')).states.some((state) => state.script?.events.some((event) => event.type === 'create'));
    expect(explosion).toBe(true);
  });
  it('loads and memoizes per-state item models with real geometry', () => {
    for (const name of ['Capsule', 'Dosei', 'Sword'] as const) {
      const model = items.stateModel(itemKind(name), 0);
      expect(model.stats.meshes, name).toBeGreaterThan(0);
      expect(items.stateModel(itemKind(name), 0), name).toBe(model);
    }
    const sword = items.kind(itemKind('Sword'));
    expect(sword.model.boneAttachId).toBeGreaterThanOrEqual(0);
    expect(sword.model.boneCount).toBeGreaterThan(0);
  });
  it('keeps every spawnable match item below the item-owned spawn boundary', () => {
    expect(MATCH_ITEM_NAMES.every((name) => itemKind(name) < 0x23)).toBe(true);
  });
});
