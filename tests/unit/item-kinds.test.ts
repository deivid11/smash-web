import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMMON_ITEM_NAMES, ITEM_SPAWN_NAMES, MATCH_ITEM_NAMES, MATCH_ITEM_LABELS, itemKind } from '../../lib/game/item-kinds.ts';

const decomp = (path: string) => readFileSync(new URL(`../../third_party/melee/${path}`, import.meta.url), 'utf8');

describe('common item kind table provenance', () => {
  it('matches the pinned ItemKind enum order (It_Kind_Capsule…It_Kind_EvYoshiEgg)', () => {
    const source = decomp('src/melee/it/forward.h');
    const body = source.slice(source.indexOf('typedef enum ItemKind'), source.indexOf('It_Kind_Kuriboh'));
    const entries = [...body.matchAll(/It_Kind_([A-Za-z0-9_]+)[,\s]/g)].map((match) => match[1]!.replaceAll('_', ''));
    expect(entries).toHaveLength(COMMON_ITEM_NAMES.length);
    expect(entries).toEqual([...COMMON_ITEM_NAMES]);
  });
  it('matches the pinned db_ItemNames debug strings for the 35 match items', () => {
    const source = decomp('src/melee/db/dbitem.static.h');
    const body = source.slice(source.indexOf('db_ItemNames'), source.indexOf('db_PokemonNames'));
    const names = [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]!.trim().replaceAll(' ', ''));
    expect(names).toHaveLength(MATCH_ITEM_NAMES.length);
    expect(names).toEqual([...MATCH_ITEM_NAMES]);
  });
  it('keeps the documented boundary ids and a label for every match item', () => {
    expect(MATCH_ITEM_NAMES).toHaveLength(0x23);
    expect(ITEM_SPAWN_NAMES).toHaveLength(8);
    expect(itemKind('Capsule')).toBe(0);
    expect(itemKind('BombHei')).toBe(6);
    expect(itemKind('MBall')).toBe(0x22);
    expect(itemKind('LGunRay')).toBe(0x23);
    expect(itemKind('EvYoshiEgg')).toBe(0x2a);
    for (const name of MATCH_ITEM_NAMES) expect(MATCH_ITEM_LABELS[name]).toBeTruthy();
  });
});
