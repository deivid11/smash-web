import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { itemKind, POKEMON_BASE } from '../../lib/game/item-kinds.ts';
import { PK } from '../../lib/game/item-pokemon.ts';
import type { MatchItem } from '../../lib/game/item-engine.ts';

// Each Pokémon against the behavior its it/kinds/it*.c state table codes (see
// lib/game/item-pokemon.ts); tuning values are read back from the same ItCo attribute blocks.
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Poké Ball Pokémon (decomp state tables)', () => {
  let base: GameContent, game: LocalMatch, rig: GameRigs;
  const f = () => game.fighters[0]!;
  const rival = () => game.fighters[1]!;
  const make = () => {
    rig?.dispose(); const content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, itemFrequency: -1 }); game.start();
    game.fighters.forEach((v, i) => { v.x = i ? 40 : -40; v.y = 0; v.grounded = true; v.floor = content.stage.floors.find(x => !x.oneWay)!.id; rig.sample(v); });
    step();
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const special = (slot: number, offset: number, int = false) => {
    const data = base.items!, block = data.pokemon.get(slot)!.special;
    return int ? data.archive.u32(block + offset) | 0 : data.archive.f32(block + offset);
  };
  const summon = (slot: number, x = 0, owner: number | null = 0) => game.itemWorld.summonPokemon(slot, x, 0, owner)!;
  const alive = (item: MatchItem) => game.itemWorld.items.includes(item);
  const children = (slot: number) => game.itemWorld.items.filter((item) => item.kind === POKEMON_BASE + slot);
  const run = (frames: number, until?: () => boolean) => { for (let i = 0; i < frames && !until?.(); i++) step(); };
  beforeAll(async () => {
    const d = await openDisc(iso!);
    try {
      const s = new HsdAssetSession(d, await verifyMeleeDisc(d));
      base = await loadGameContent(s, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
    } finally { await d.close(); }
  }, 60000);
  afterEach(() => rig?.dispose());

  it('rolls the ball weights, never repeating either of the last two releases', () => {
    make();
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      const pokemon = game.itemWorld.summonPokemon(null, 0, 0, 0)!;
      const slot = pokemon.kind - POKEMON_BASE;
      if (seen.length) expect(slot).not.toBe(seen.at(-1));
      if (seen.length > 1) expect(slot).not.toBe(seen.at(-2));
      // Ditto's ball weight is 0: only a legendary latch or a real weight can come out.
      expect(slot).not.toBe(PK.Metamon);
      seen.push(slot);
      game.itemWorld.items.splice(0);
    }
    expect(new Set(seen).size).toBeGreaterThan(10);
  });

  it('materializes out of the ball: pops up, grows from x0 to its item scale and lands', () => {
    make();
    const goldeen = summon(PK.Tosakinto);
    expect(goldeen.pk!.scale).toBeCloseTo(special(PK.Tosakinto, 0), 4);
    expect(goldeen.vy).toBeCloseTo(2.5, 4);
    step();
    expect(goldeen.y).toBeGreaterThan(0);
    run(120, () => !goldeen.pk!.air);
    expect(goldeen.pk!.scale).toBeCloseTo(base.items!.pokemon.get(PK.Tosakinto)!.attributes.scale, 4);
    // Landing starts the flop cycle: the random ±x8 hop.
    expect(Math.abs(goldeen.pk!.v[1]!)).toBeCloseTo(special(PK.Tosakinto, 8), 4);
  });

  it('Snorlax leaps off the top, hides x10 frames, then falls from the top line at xC scale', () => {
    make();
    const snorlax = summon(PK.Kabigon);
    run(400, () => snorlax.pk!.hidden);
    expect(snorlax.pk!.hidden).toBe(true);
    expect(snorlax.y).toBeGreaterThan(game.content.stage.blast.top);
    let hiddenFrames = 0;
    run(200, () => { if (snorlax.pk!.hidden) hiddenFrames++; return !snorlax.pk!.hidden; });
    expect(hiddenFrames).toBeGreaterThanOrEqual(special(PK.Kabigon, 0x10));
    expect(snorlax.pk!.scale).toBe(special(PK.Kabigon, 0xc));
    expect(snorlax.vy).toBeCloseTo(special(PK.Kabigon, 8), 4);
    expect(snorlax.x).toBeCloseTo(0, 3);
    // The giant body slams whoever stands under it.
    rival().x = 0;
    run(120, () => rival().percent > 0);
    expect(rival().percent).toBeGreaterThan(0);
    run(200, () => !alive(snorlax));
    expect(alive(snorlax)).toBe(false);
  });

  it('Blastoise fires Hydro Pumps from alternating cannons and recoils backwards', () => {
    make();
    const blastoise = summon(PK.Kamex, -20);
    expect(blastoise.facing).toBe(1);
    run(200, () => children(PK.Water).length > 0);
    const [first] = children(PK.Water);
    expect(first!.vx).toBeCloseTo(special(PK.Kamex, 0x14), 4);
    expect(blastoise.vx).toBeLessThan(0);
    run(40, () => children(PK.Water).length > 1);
    const depths = new Set(children(PK.Water).map((water) => Math.sign(water.pk!.z)));
    expect(depths.size).toBe(2);
    run(200, () => rival().percent > 0);
    expect(rival().percent).toBeGreaterThan(0);
  });

  it('Chikorita throws exactly two leaves per loop for x4+1 loops, then leaves', () => {
    make();
    const chikorita = summon(PK.Chicorita);
    let leaves = 0;
    const ids = new Set<number>();
    run(1200, () => {
      for (const leaf of children(PK.Leaf)) if (!ids.has(leaf.id)) { ids.add(leaf.id); leaves++; expect(Math.abs(leaf.vx)).toBeCloseTo(special(PK.Chicorita, 0x10), 4); }
      return !alive(chikorita);
    });
    expect(alive(chikorita)).toBe(false);
    expect(leaves).toBe(2 * (special(PK.Chicorita, 4, true) + 1));
  });

  it('Charizard breathes downward flames to both sides, one every x14 frames while var0 is up', () => {
    make();
    summon(PK.Lizardon);
    const sides = new Set<number>(), seen = new Set<number>();
    run(600, () => {
      for (let slot = PK.Flame1; slot < PK.Flame1 + 4; slot++) for (const flame of children(slot)) {
        if (seen.has(flame.id)) continue;
        seen.add(flame.id); sides.add(Math.sign(flame.vx));
        expect(flame.vy).toBeLessThan(0);
      }
      return sides.size === 2 && seen.size > 8;
    });
    expect(sides).toEqual(new Set([1, -1]));
  });

  it('Weezing hovers in place once its fall window ends and puffs gas while var0 is up', () => {
    make();
    const weezing = summon(PK.Matadogas);
    run(80, () => weezing.pk!.st === 1);
    expect(weezing.pk!.st).toBe(1);
    const y = weezing.y;
    run(120, () => children(PK.Gas1).length + children(PK.Gas2).length > 0);
    expect(children(PK.Gas1).length + children(PK.Gas2).length).toBeGreaterThan(0);
    expect(weezing.y).toBe(y);
  });

  it('Electrode arms late in its fuse, can be grabbed, and blows up in the holder’s hand', () => {
    make();
    const electrode = summon(PK.Marumine, f().x + 4, 1);
    let armedAt = -1;
    run(600, () => { if (electrode.pk!.grab && armedAt < 0) armedAt = electrode.pk!.frame; return electrode.pk!.grab; });
    expect(electrode.pk!.st).toBe(5);
    expect(armedAt).toBeGreaterThanOrEqual(0xb4 - special(PK.Marumine, 8, true) - 2);
    step({ attack: true });
    expect(f().heldItem).toBe(electrode.id);
    run(200, () => electrode.pk!.st === 6);
    expect(electrode.pk!.st).toBe(6);
    expect(f().heldItem).toBeNull();
    rival().x = f().x + 8;
    run(10, () => rival().percent > 0);
    // The holder owns it now: the blast hits the rival and spares its owner.
    expect(rival().percent).toBeGreaterThan(0);
    expect(f().percent).toBe(0);
  });

  it('Chansey lays eggs and is knocked out past her xC damage threshold', () => {
    make();
    const chansey = summon(PK.Lucky, f().x + 6, 1);
    run(200, () => chansey.pk!.hurt && chansey.pk!.st >= 2);
    expect(chansey.pk!.hurt).toBe(true);
    run(200, () => game.itemWorld.items.some((item) => item.kind === POKEMON_BASE + PK.LuckyEgg || item.kind === itemKind('Egg')));
    expect(game.itemWorld.items.some((item) => item.kind === POKEMON_BASE + PK.LuckyEgg || item.kind === itemKind('Egg'))).toBe(true);
    f().facing = 1;
    // Clear her eggs first: A next to a loose item picks it up instead of attacking.
    const clearEggs = () => { for (const egg of game.itemWorld.items.filter((item) => item.kind === POKEMON_BASE + PK.LuckyEgg || item.kind === itemKind('Egg'))) game.itemWorld.items.splice(game.itemWorld.items.indexOf(egg), 1); };
    for (let i = 0; i < 12 && chansey.pk!.st !== 6; i++) { clearEggs(); f().x = chansey.x - 6; step({ attack: true }); run(30); }
    expect(chansey.pk!.taken).toBeGreaterThanOrEqual(special(PK.Lucky, 0xc));
    expect(chansey.pk!.st).toBe(6);
    expect(Math.hypot(chansey.vx, chansey.vy)).toBeGreaterThan(0);
  });

  it('Staryu locks on to the lowest-percent opponent and fires its x44..x40 star volley', () => {
    make();
    rival().percent = 10;
    const staryu = summon(PK.Hitodeman, -60);
    expect(staryu.pk!.target).toBe(1);
    const stars = new Set<number>();
    run(900, () => { for (const star of children(PK.Star)) stars.add(star.id); return !alive(staryu); });
    expect(alive(staryu)).toBe(false);
    expect(stars.size).toBeGreaterThanOrEqual(special(PK.Hitodeman, 0x44, true));
    expect(stars.size).toBeLessThan(special(PK.Hitodeman, 0x40, true));
  });

  it('Lugia glides into the background and fires Aeroblast beams that close in on the stage plane', () => {
    make();
    const lugia = summon(PK.Lugia);
    run(900, () => lugia.pk!.st === 5);
    expect(lugia.pk!.st).toBe(5);
    expect(lugia.pk!.z).toBeLessThan(-100);
    // The x18 descent solve settles (sqrt(8·x18·d + x18²) - x18)/2 above the release height.
    expect(lugia.y).toBeGreaterThan(0);
    expect(lugia.y).toBeLessThan(20);
    let beam: MatchItem | undefined;
    run(200, () => (beam = children(PK.Aero1)[0]) !== undefined);
    expect(beam).toBeDefined();
    const vz = beam!.pk!.vz;
    step();
    expect(beam!.pk!.vz).toBeCloseTo(vz * special(PK.Aero1, 4), 3);
  });

  it('Marill walks at xC per frame along its release facing', () => {
    make();
    const marill = summon(PK.Maril, -20);
    run(200, () => marill.pk!.st === 1);
    expect(marill.pk!.st).toBe(1);
    step();
    const x = marill.x;
    run(10);
    expect(Math.abs(marill.x - x)).toBeCloseTo(10 * special(PK.Maril, 0xc), 0);
    expect(Math.sign(marill.x - x)).toBe(marill.facing);
  });

  it('Porygon2 lunges along its release facing on root motion, then vanishes', () => {
    make();
    const porygon = summon(PK.Porygon2, -20);
    const x = porygon.x;
    let farthest = 0;
    run(400, () => { farthest = Math.max(farthest, (porygon.x - x) * porygon.facing); return !alive(porygon); });
    expect(alive(porygon)).toBe(false);
    expect(farthest).toBeGreaterThan(5);
  });

  it('Mew greets, then flies off above the top blast line', () => {
    make();
    const mew = summon(PK.Mew);
    run(600, () => !alive(mew));
    expect(alive(mew)).toBe(false);
    expect(mew.y).toBeGreaterThan(game.content.stage.blast.top);
  });

  it('Togepi resolves Metronome into one weighted outcome state after its idle loops', () => {
    make();
    const togepi = summon(PK.Togepy);
    run(600, () => togepi.pk!.st >= 2);
    expect(togepi.pk!.st).toBeGreaterThanOrEqual(2);
    expect(togepi.pk!.st).toBeLessThanOrEqual(6);
  });

  it('Wobbuffet swings when struck and its armed counter damages the attacker', () => {
    make();
    const wobbuffet = summon(PK.Sonans, f().x + 7, 1);
    run(200, () => wobbuffet.pk!.hurt);
    expect(wobbuffet.pk!.hurt).toBe(true);
    f().facing = 1;
    for (let i = 0; i < 6 && !wobbuffet.pk!.var0; i++) { step({ attack: true }); run(20); }
    expect(wobbuffet.pk!.var0).toBe(1);
    expect(wobbuffet.pk!.v[2]!).toBeGreaterThan(0);
    // The counter answers with the blow's damage × x4 (capped at xC) through hitbox 0.
    run(200, () => f().percent > 0);
    expect(f().percent).toBeGreaterThan(0);
  });

  it('never lets a Pokémon or its projectiles hit the one who threw the ball', () => {
    make();
    for (const slot of [PK.Kamex, PK.Lizardon, PK.Chicorita, PK.Thunder, PK.Fushigibana, PK.Marumine, PK.Togepy]) {
      game.itemWorld.items.splice(0);
      f().percent = 0; rival().percent = 0; f().x = -12; rival().x = 12;
      game.itemWorld.summonPokemon(slot, 0, 0, 0);
      run(700);
      expect(f().percent, `slot ${slot}`).toBe(0);
    }
  });

  it('rolls back a mid-attack Pokémon exactly', () => {
    make();
    summon(PK.Lizardon);
    run(120);
    const snapshot = game.captureState();
    run(40);
    const after = JSON.stringify(game.itemWorld.captureState(), (_k, v) => (v instanceof Set ? [...v] : v));
    game.restoreState(snapshot);
    run(40);
    expect(JSON.stringify(game.itemWorld.captureState(), (_k, v) => (v instanceof Set ? [...v] : v))).toBe(after);
  });
});
