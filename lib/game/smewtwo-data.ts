import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import type { SpecialAssets } from './special-data.ts';
import { loadModel } from '../hsd/model.ts';
import { itemHit } from './special-data.ts';

/** Shadow Mewtwo (ACE 2.0 m-ex fighter, PlSm, mexproj 039). Mewtwo-family kit;
 * orchestration is shared with Mewtwo ([lib/game/mewtwo.ts](../../lib/game/mewtwo.ts)).
 * The NLoop scripts carry adjusted-hitbox opcodes past the vanilla id range, so
 * charge loops reuse the Start clips; the air cancel reuses AirNEnd. */
export function parseShadowMewtwoArticles(metadata: HsdArchive): SpecialAssets['articles'] {
  const table = metadata.pointer(metadata.symbol('ftDataShadowMewtwo') + 0x48);
  const read = (slot: number, state: number, name: string) => {
    const article = metadata.pointer(table + slot * 4), common = metadata.pointer(article), special = metadata.pointer(article + 4), states = metadata.pointer(article + 12) + state * 16;
    if (!common || !special) throw new Error(`Original ${name} article is incomplete.`);
    const joint = metadata.pointer(metadata.pointer(article + 16));
    const model = joint ? loadModel(metadata, { offset: joint, name, animation: metadata.pointer(states), materialAnimation: metadata.pointer(states + 4) })
      : { archive: metadata, roots: [], fogEntries: [], warnings: ['Native particle-only article; no substitute model is drawn.'], stats: { joints: 0, meshes: 0, vertices: 0, triangles: 0, textures: 0 } };
    return { model, hit: metadata.pointer(states + 12) ? itemHit(metadata, metadata.pointer(states + 12)) : null,
      speed: 0, angle: 0, lifetime: metadata.f32(special), gravity: metadata.f32(common + 16), terminal: metadata.f32(common + 20),
      bounce: metadata.f32(common + 0x58), minSpeed: 0, scale: metadata.f32(common + 0x60), sound: metadata.u32(common + 0x78), rayScale: 1, deceleration: 0 };
  };
  // Disable ships hitless in every state (gaze stun pending); the Lw melee hits
  // still land, and the engine skips the null-hit spawn (see mewtwo.ts).
  const disable = read(0, 0, 'shadow-mewtwo-disable');
  // Only charge level 0 carries a hitbox; every level reuses it (no scaling).
  const one = read(1, 1, 'shadow-ball-0');
  if (!one.hit) throw new Error('Missing Shadow Mewtwo Shadow Ball hitbox.');
  // The level-1 special block is not Mewtwo DatAttrs (min/max inverted, wobble
  // garbage), so flight is authored Mewtwo-like; gravity/terminal/lifetime stay
  // verbatim from the common block.
  const charges = Array.from({ length: 8 }, () => ({ ...one, model: one.model, speed: 2.2 }));
  const wobblePeriod = 12;
  return { projectile: charges[0]!, accessory: disable, mewtwo: { charges, disable, wobblePeriod } };
}

/** Mewtwo-identical key names onto Sm indices; Loop/Full reuse Start, the
 * missing air cancel reuses AirNEnd. */
export const SM_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 245, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoop', index: 245, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoopFull', index: 245, figatree: 'SpecialNStart' },
  { key: 'SpecialNLoopFull', index: 245, figatree: 'SpecialNStart' },
  { key: 'SpecialNCancel', index: 248, figatree: 'SpecialNCancel' },
  { key: 'SpecialNEnd', index: 249, figatree: 'SpecialNEnd' },
  { key: 'SpecialAirNStart', index: 250, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoop', index: 250, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoopFull', index: 250, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNLoopFull', index: 250, figatree: 'SpecialAirNStart' },
  { key: 'SpecialAirNCancel', index: 254, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialAirNEnd', index: 254, figatree: 'SpecialAirNEnd' },
  { key: 'SpecialS', index: 255, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 256, figatree: 'SpecialAirS' },
  { key: 'SpecialHiStart', index: 257, figatree: 'SpecialHiStart' },
  { key: 'SpecialHi', index: 258, figatree: 'SpecialHi' },
  { key: 'SpecialHiLost', index: 259, figatree: 'SpecialHiLost' },
  { key: 'SpecialAirHiStart', index: 260, figatree: 'SpecialAirHiStart' },
  { key: 'SpecialAirHi', index: 261, figatree: 'SpecialAirHi' },
  { key: 'SpecialLw', index: 262, figatree: 'SpecialLw' },
  { key: 'SpecialAirLw', index: 263, figatree: 'SpecialAirLw' },
];

export const SM_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
