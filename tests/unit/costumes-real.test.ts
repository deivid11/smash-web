import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { verifyAceDisc } from '../../lib/disc.ts';
import { mergeModdedSource } from '../../lib/hsd/modded-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { ACE_ASSETS, ACE_COSTUME_ASSETS, COSTUME_ASSETS, SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { clampCostumeIndex, costumeCount, costumeModelFile, costumeName, fighterCostumes, nanaCostumeFile, nanaCostumeKey, portraitFor, portraitKey } from '../../lib/game/costumes.ts';
import { loadCostumeModel, loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { selectLineup } from '../../lib/game/roster.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import type { HsdModel } from '../../lib/hsd/model.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  Fx: 4, Mr: 5, Kb: 6, Ss: 5, Pk: 4, Mt: 4, Fe: 5, Lk: 5, Ca: 6, Dk: 5, Cl: 5, Pr: 5,
  Ns: 4, Kp: 4, Pe: 5, Fc: 4, Dr: 5, Gn: 5, Pc: 4, Ms: 5, Lg: 4, Pp: 4,
  Zd: 5, Sk: 5, Gw: 1, Ys: 6,
};
describe('Costume registration', () => {
  it('lists every original costume once, default first', () => {
    expect(COSTUME_ASSETS).toHaveLength(97);
    expect(new Set(COSTUME_ASSETS).size).toBe(97);
    for (const name of COSTUME_ASSETS) {
      expect(name).toMatch(/^Pl[A-Z][a-z](Re|Bu|Gr|Ye|Bk|Wh|La|Or|Pi|Aq|Gy)\.dat$/);
      expect(SERVER_ASSETS).toContain(name);
    }
    for (const [kind, count] of Object.entries(EXPECTED_COUNTS)) {
      expect(fighterCostumes(kind as never)).toHaveLength(count);
      expect(fighterCostumes(kind as never)[0]).toBe('Nr');
      expect(costumeCount(kind as never)).toBe(count);
    }
  });
  it('names, clamps and keys costumes without touching simulation', () => {
    expect(costumeName('Mr', 1)).toBe('Blue');
    expect(costumeName('Ys', 5)).toBe('Aqua');
    expect(costumeName('Gw', 0)).toBe('Default');
    expect(clampCostumeIndex('Mr', 99)).toBe(4);
    expect(clampCostumeIndex('Mr', -3)).toBe(0);
    expect(clampCostumeIndex('Gw', 1)).toBe(0);
    expect(costumeModelFile('Zd', 2)).toBe('PlZdBu.dat');
    expect(costumeModelFile('Mr', 0)).toBe('PlMrNr.dat');
    expect(nanaCostumeFile(0)).toBe('PlNnNr.dat');
    expect(nanaCostumeFile(3)).toBe('PlNnYe.dat');
    expect(nanaCostumeKey(1)).toBe('Pp:nana:1');
    for (const name of ['PlNnAq.dat', 'PlNnWh.dat', 'PlNnYe.dat']) expect(COSTUME_ASSETS).toContain(name);
    for (const name of ['PlNnNr.dat', 'PlNnAq.dat', 'PlNnWh.dat', 'PlNnYe.dat']) expect(SERVER_ASSETS).toContain(name);
    expect(portraitKey('Mr', 0)).toBe('Mr');
    expect(portraitKey('Mr', 2)).toBe('Mr:2');
    const portraits = { Mr: 'nr', 'Mr:2': 'gr' };
    expect(portraitFor(portraits, 'Mr', 2)).toBe('gr');
    expect(portraitFor(portraits, 'Mr', 3)).toBe('nr');
    expect(portraitFor(portraits, 'Mr', 0)).toBe('nr');
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Costumes from original disc data', () => {
  let base: GameContent, rig: GameRigs | undefined;
  const models = new Map<string, HsdModel>();
  const make = (a: 'Gw' | 'Mr' | 'Zd', b: 'Gw' | 'Mr' | 'Zd', costumes: number[] = [0, 0]) => {
    rig?.dispose();
    const kinds = [a, b] as const;
    const picks = kinds.map((kind, i) => ({ fighter: kind, costume: costumes[i] ?? 0 }));
    const content = selectLineup(rosterPair(base, a, b), picks, models);
    rig = new GameRigs(content);
    return new LocalMatch(content, rig, { opponent: 'human', countdown: 0 });
  };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      base = await loadGameContent(session, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
      // Every shipped costume model parses against its fighter's skeleton.
      for (const [kind, count] of Object.entries(EXPECTED_COUNTS)) {
        const profile = base.roster.get(kind as never)!.profile;
        for (let index = 1; index < count; index++) {
          const model = await loadCostumeModel(session, base.roster.get(kind as never)!, index);
          expect(model.roots[0]!.joints.length).toBe(profile.boneCount);
          models.set(`${kind}:${index}`, model);
        }
      }
      expect(models.size).toBe(94);
    } finally { await disc.close(); }
  }, 120000);
  it('applies per-slot skins, including mirrors in different costumes', () => {
    const content = selectLineup(rosterPair(base, 'Mr', 'Mr'), [{ fighter: 'Mr', costume: 1 }, { fighter: 'Mr', costume: 3 }], models);
    expect(content.fighters[0]).not.toBe(content.fighters[1]);
    expect(content.fighters[0]!.model).not.toBe(content.fighters[1]!.model);
    expect(content.fighters[0]!.costume).toBe(1);
    expect(content.fighters[1]!.costume).toBe(3);
    // Same clips, profile and physics: skins are visual-only.
    expect(content.fighters[0]!.clips).toBe(content.fighters[1]!.clips);
    expect(content.fighters[0]!.profile).toBe(content.fighters[1]!.profile);
    const plain = selectLineup(rosterPair(base, 'Mr', 'Mr'), [{ fighter: 'Mr', costume: 0 }, { fighter: 'Mr', costume: 99 }], models);
    expect(plain.fighters[0]).toBe(base.roster.get('Mr'));
  });
  it('rejects unloaded skins and wires the Zelda/Sheik pair', () => {
    expect(() => selectLineup(rosterPair(base, 'Mr', 'Mr'), [{ fighter: 'Mr', costume: 1 }, { fighter: 'Mr', costume: 0 }], new Map())).toThrow('not loaded');
    const pair = selectLineup(rosterPair(base, 'Zd', 'Mr'), [{ fighter: 'Zd', costume: 2 }, { fighter: 'Mr', costume: 0 }], models);
    expect(pair.fighters[0]!.transformModel).toBe(models.get('Sk:2'));
    const single = selectLineup(rosterPair(base, 'Gw', 'Mr'), [{ fighter: 'Gw', costume: 0 }, { fighter: 'Mr', costume: 0 }], models);
    expect(single.fighters[0]).toBe(base.roster.get('Gw'));
  });
  const step = (game: LocalMatch, a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  it('battles in costume deterministically with snapshot restore', () => {
    const game = make('Mr', 'Mr', [1, 3]);
    game.start();
    for (let n = 0; n < 30; n++) step(game, n === 5 ? { special: true, specialDirection: 'neutral' } : {});
    const before = game.captureState();
    const first = game.fighters[0]!;
    expect(first.content.costume).toBe(1);
    expect(first.content.profile.kind).toBe('Mr');
    for (let n = 0; n < 30; n++) step(game);
    const divergedHash = game.stateHash();
    // Rollback to the costumed state keeps the skin model, and replaying the
    // same inputs reproduces the same hash (skins never enter the sim).
    game.restoreState(before);
    expect(game.fighters[0]!.content.costume).toBe(1);
    expect(game.fighters[0]!.content.model).toBe(models.get('Mr:1'));
    expect(game.fighters[1]!.content.model).toBe(models.get('Mr:3'));
    for (let n = 0; n < 30; n++) step(game);
    expect(game.stateHash()).toBe(divergedHash);
  });
  it('keeps the skin across Zelda/Sheik transforms and rollback', () => {
    const game = make('Zd', 'Mr', [2, 0]);
    game.start();
    const zelda = game.fighters[0]!;
    expect(zelda.content.costume).toBe(2);
    game.transformFighter(zelda, 'Sk');
    expect(zelda.content.profile.kind).toBe('Sk');
    expect(zelda.content.costume).toBe(2);
    expect(zelda.content.model).toBe(models.get('Sk:2'));
    const transformed = game.captureState();
    game.transformFighter(zelda, 'Zd');
    expect(zelda.content.profile.kind).toBe('Zd');
    expect(zelda.content.model).toBe(models.get('Zd:2'));
    // Rollback across the transform restores the paired skin, not the default.
    game.restoreState(transformed);
    expect(game.fighters[0]!.content.profile.kind).toBe('Sk');
    expect(game.fighters[0]!.content.model).toBe(models.get('Sk:2'));
    expect(game.fighters[0]!.content.costume).toBe(2);
  });
});
const ACE_EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  Zx: 6, Td: 5, Mk: 6, Sn: 7, Rc: 6, Lz: 6, Wf: 6, Dd: 6, De: 9, Wr: 8,
  Sh: 7, Bl: 6, Lc: 7, Nm: 6, Nt: 6, Da: 9, Fy: 4, Sc: 6, Dl: 6, Kx: 11,
  Lu: 7, Lc2: 7, Sm: 7, Lb: 5, MM: 9, Sd: 5,
  Ts: 7, Bf: 5, WfU: 6, Gk: 4,
};
const aceIso = process.env.MELEE_ACE_ISO;
describe('ACE costume registration', () => {
  it('lists every ACE 2.0 skin once, default first, outside the vanilla set', () => {
    expect(ACE_COSTUME_ASSETS).toHaveLength(165);
    expect(new Set(ACE_COSTUME_ASSETS).size).toBe(165);
    for (const name of ACE_COSTUME_ASSETS) {
      expect(ACE_ASSETS).toContain(name);
      expect(SERVER_ASSETS).not.toContain(name);
      expect(COSTUME_ASSETS).not.toContain(name);
    }
    for (const [kind, count] of Object.entries(ACE_EXPECTED_COUNTS)) {
      expect(fighterCostumes(kind as never)).toHaveLength(count);
      expect(fighterCostumes(kind as never)[0]).toBe('Nr');
      expect(costumeCount(kind as never)).toBe(count);
    }
  });
});
describe.skipIf(!iso || !aceIso)('ACE 2.0 costumes from the extension disc', () => {
  let base: GameContent, rig: GameRigs | undefined;
  const models = new Map<string, HsdModel>();
  beforeAll(async () => {
    const vanilla = await openDisc(iso!), ace = await openDisc(aceIso!);
    try {
      const merged = mergeModdedSource({ reader: vanilla, info: await verifyMeleeDisc(vanilla) }, { reader: ace, info: await verifyAceDisc(ace) });
      const session = new HsdAssetSession(merged.reader, { files: merged.files });
      base = await loadGameContent(session, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
      // Every ACE skin parses against its fighter's (possibly modded) skeleton.
      for (const [kind, count] of Object.entries(ACE_EXPECTED_COUNTS)) {
        const entry = base.roster.get(kind as never);
        if (!entry) throw new Error(`ACE fighter ${kind} is not loaded.`);
        for (let index = 1; index < count; index++) {
          const model = await loadCostumeModel(session, entry, index);
          expect(model.roots[0]!.joints.length).toBe(entry.profile.boneCount);
          models.set(`${kind}:${index}`, model);
        }
      }
      expect(models.size).toBe(165);
    } finally { await vanilla.close(); await ace.close(); }
  }, 180000);
  it('battles a modded skin deterministically with snapshot restore', () => {
    rig?.dispose();
    const content = selectLineup(rosterPair(base, 'Zx', 'Mr'), [{ fighter: 'Zx', costume: 4 }, { fighter: 'Mr', costume: 0 }], models);
    expect(content.fighters[0]!.costume).toBe(4);
    expect(costumeName('Zx', 4)).toBe('White');
    rig = new GameRigs(content);
    const game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 });
    game.start();
    const step = (a: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, neutralInput()]);
    for (let n = 0; n < 30; n++) step(n === 5 ? { special: true, specialDirection: 'neutral' } : {});
    const before = game.captureState();
    for (let n = 0; n < 30; n++) step();
    const divergedHash = game.stateHash();
    game.restoreState(before);
    expect(game.fighters[0]!.content.model).toBe(models.get('Zx:4'));
    for (let n = 0; n < 30; n++) step();
    expect(game.stateHash()).toBe(divergedHash);
  });
  it('keeps vanilla and ACE skins independent on the same roster', () => {
    expect(costumeModelFile('Zx', 1)).toBe('PlZxBu.dat');
    expect(costumeModelFile('Kx', 10)).toBe('PlKxWr.dat');
    expect(costumeName('Sh', 3)).toBe('Yellow');
    expect(portraitKey('Dd', 2)).toBe('Dd:2');
  });
});
