import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc, verifyAceDisc } from '../../lib/disc.ts';
import { mergeModdedSource } from '../../lib/hsd/modded-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { MODDED_BONE_TABLES } from '../../lib/game/modded-bones.ts';
import { ROOM_FIGHTERS } from '../../lib/net/protocol.ts';
import { ACE_ASSETS, SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Chun-Li registration', () => {
  it('reserves public-roster selector 52, room entry and bounded extension assets', () => {
    expect(ROSTER_CHOICES[52]).toBe('Cn');
    expect(ROOM_FIGHTERS).toContain('Cn');
    for (const name of ['PlCn.dat', 'PlCnAJ.dat', 'PlCnNr.dat', 'audio/us/chun-li.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
    // No effect bank on disc; the common bank covers her VFX.
    expect(ACE_ASSETS).not.toContain('EfCnData.dat');
  });
  it('ships the literal ACE 2.0 bone table with every part owning a joint', () => {
    expect(MODDED_BONE_TABLES.Cn.count).toBe(118);
    expect(MODDED_BONE_TABLES.Cn.map).toHaveLength(54);
    expect(MODDED_BONE_TABLES.Cn.virtualParts).toHaveLength(0);
    expect(MODDED_BONE_TABLES.Cn.jointCount).toBe(118);
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE wave-6 integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (kind: 'Cn', gap = 20) => {
    rig?.dispose(); const content = rosterPair(base, kind, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const f = () => game.fighters[0];
  const other = () => game.fighters[1]!;
  beforeAll(async () => {
    const vanilla = await openDisc(iso!), ace = await openDisc(aceIso!);
    try {
      const merged = mergeModdedSource({ reader: vanilla, info: await verifyMeleeDisc(vanilla) }, { reader: ace, info: await verifyAceDisc(ace) });
      base = await loadGameContent(new HsdAssetSession(merged.reader, { files: merged.files }), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
    } finally { await vanilla.close(); await ace.close(); }
  }, 120000);
  afterEach(() => rig?.dispose());

  it('loads with skeleton, jab, voice and rollback-safe state', () => {
    make('Cn');
    expect(f().content.profile.boneCount).toBe(118);
    expect(f().content.model.roots[0]!.joints.length).toBe(118);
    expect(base.sound.banks.some(b => b.base === 2497)).toBe(true);
    step({ attack: true });
    expect(f().state).toBe('attack');
    const snapshot = game.captureState();
    for (let i = 0; i < 8; i++) step({ attack: true });
    game.restoreState(snapshot);
  });
  it('fires the 8% Kikoken and holds the rapid legs', () => {
    make('Cn', 40);
    step({ special: true });
    let sawKiko = false;
    for (let i = 0; i < 70; i++) { step(); sawKiko ||= game.projectiles.items.some(p => p.kind === 'chunli-kiko'); }
    expect(sawKiko).toBe(true);
    expect(other().percent).toBe(8);
    // Stationary 24-hit Lightning Legs grind while held.
    make('Cn', 8);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 25; i++) step({ special: true, x: 1 });
    for (let i = 0; i < 60; i++) step();
    expect(other().percent).toBeGreaterThan(0);
  });
  it('rises on the Bird Kick root motion and advances the Tensho kicks', () => {
    make('Cn');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(25);
    // The 25-unit root dash meets its frame-22 hits around gap 30.
    make('Cn', 30);
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 80; i++) step();
    expect(other().percent).toBeGreaterThan(0);
  });
});
