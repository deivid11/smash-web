/** ItemKind ids for the ItCo common article/logic table (43 entries, indices 0x00–0x2A).
 * Order mirrors third_party/melee/src/melee/it/forward.h (It_Kind_Capsule…It_Kind_EvYoshiEgg);
 * the first 35 names are third_party/melee/src/melee/db/dbitem.static.h db_ItemNames trimmed,
 * the item-owned spawns keep their enum-derived names. tests/unit/item-kinds.test.ts re-derives
 * both lists from the pinned decomp headers so silent drift fails loudly. */
export const MATCH_ITEM_NAMES = ['Capsule', 'Box', 'Taru', 'Egg', 'Kusudama', 'TaruCann', 'BombHei', 'Dosei', 'Heart', 'Tomato',
  'Star', 'Bat', 'Sword', 'Parasol', 'GShell', 'RShell', 'LGun', 'Freeze', 'Foods', 'MSBomb',
  'Flipper', 'SScope', 'StarRod', 'LipStick', 'Harisen', 'FFlower', 'Kinoko', 'DKinoko', 'Hammer', 'WStar',
  'ScBall', 'RabbitC', 'MetalB', 'Spycloak', 'MBall'] as const;
/** 0x23–0x2A: spawns owned by an item (beams, the hammer head, Lip's Stick spores…). */
export const ITEM_SPAWN_NAMES = ['LGunRay', 'StarRodStar', 'LipStickSpore', 'SScopeBeam', 'LGunBeam', 'HammerHead', 'FFlowerFlame', 'EvYoshiEgg'] as const;
export const COMMON_ITEM_NAMES = [...MATCH_ITEM_NAMES, ...ITEM_SPAWN_NAMES] as const;
export type CommonItemName = (typeof COMMON_ITEM_NAMES)[number];
export function itemKind(name: CommonItemName): number {
  const kind = COMMON_ITEM_NAMES.indexOf(name);
  if (kind < 0) throw new Error(`Unknown common item ${name}.`);
  return kind;
}
/** Poké Ball Pokémon article slots (itPublicData xC, order = It_PKind enum minus Random;
 * names from db_PokemonNames). Slots 30-46 hold their projectiles (leaves, gas, flames…). */
export const POKEMON_NAMES = ['Tosakinto', 'Chicorita', 'Kabigon', 'Kamex', 'Matadogas', 'Lizardon', 'Fire', 'Thunder', 'Freezer', 'Sonans',
  'Hassam', 'Unknown', 'Entei', 'Raikou', 'Suikun', 'Kireihana', 'Marumine', 'Lugia', 'Houou', 'Metamon',
  'Pippi', 'Togepy', 'Mew', 'Cerebi', 'Hitodeman', 'Lucky', 'Porygon2', 'Hinoarashi', 'Maril', 'Fushigibana'] as const;
/** MatchItem.kind values >= POKEMON_BASE address the Pokémon article table (kind - base = slot). */
export const POKEMON_BASE = 0x100;
/** English display names for the 35 spawnable match items, in kind order. */
export const MATCH_ITEM_LABELS: Readonly<Record<(typeof MATCH_ITEM_NAMES)[number], string>> = Object.freeze({
  Capsule: 'Capsule', Box: 'Crate', Taru: 'Barrel', Egg: 'Egg', Kusudama: 'Party Ball', TaruCann: 'Barrel Cannon',
  BombHei: 'Bob-omb', Dosei: 'Mr. Saturn', Heart: 'Heart Container', Tomato: 'Maxim Tomato', Star: 'Super Star',
  Bat: 'Home-Run Bat', Sword: 'Beam Sword', Parasol: 'Parasol', GShell: 'Green Shell', RShell: 'Red Shell',
  LGun: 'Ray Gun', Freeze: 'Freezie', Foods: 'Food', MSBomb: 'Motion-Sensor Bomb', Flipper: 'Flipper',
  SScope: 'Super Scope', StarRod: 'Star Rod', LipStick: "Lip's Stick", Harisen: 'Fan', FFlower: 'Fire Flower',
  Kinoko: 'Super Mushroom', DKinoko: 'Poison Mushroom', Hammer: 'Hammer', WStar: 'Warp Star', ScBall: 'Screw Attack',
  RabbitC: 'Bunny Hood', MetalB: 'Metal Box', Spycloak: 'Cloaking Device', MBall: 'Poké Ball',
});
