import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc, verifyAceDisc, ACE_20 } from '../../lib/disc.ts';
import { mergeModdedSource } from '../../lib/hsd/modded-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { ZERO_ACTION_KEYS } from '../../lib/game/zero-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { ACE_ASSETS, SERVER_ASSETS, parseSourceManifest } from '../../lib/hsd/source-protocol.ts';

describe('Zero registration', () => {
  it('reserves public-roster selector 15, Zx kind, room protocol entry and bounded extension assets', () => {
    expect(ROSTER_CHOICES[15]).toBe('Zx'); expect(ROOM_FIGHTERS).toContain('Zx');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Zx' }))).toMatchObject({ fighter: 'Zx' });
    // Zero rides the extension allowlist, never the vanilla server asset list.
    for (const name of ['PlZx.dat', 'PlZxAJ.dat', 'PlZxNr.dat', 'EfZxData.dat', 'audio/us/zero.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
    expect(ACE_ASSETS).toContain('PlZxBu.dat');
    expect(new Set(ZERO_ACTION_KEYS.map(entry => entry.key)).size).toBe(ZERO_ACTION_KEYS.length);
  });
  it('rejects a manifest that lists extension assets without a registered modded disc', () => {
    const base = { version: 1, mode: 'server', gameId: 'GALE01', revision: 2, title: 't', discSize: 1000, executableSha1: '08e0bf20134dfcb260699671004527b2d6bb1a45' };
    const vanillaFiles = SERVER_ASSETS.map((path, index) => ({ path, offset: index, size: 1 }));
    expect(() => parseSourceManifest({ ...base, files: [...vanillaFiles, { path: 'PlZx.dat', offset: 900, size: 1 }] })).toThrow();
    expect(() => parseSourceManifest({ ...base, modded: { id: 'other-mod', executableSha1: ACE_20.mainDolSha1, discSize: 10 }, files: vanillaFiles })).toThrow();
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('Zero ACE extension disc integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Zx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const f = () => game.fighters[0];
  const air = (y = 80) => { f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = y; };
  beforeAll(async () => {
    const vanilla = await openDisc(iso!), ace = await openDisc(aceIso!);
    try {
      const merged = mergeModdedSource({ reader: vanilla, info: await verifyMeleeDisc(vanilla) }, { reader: ace, info: await verifyAceDisc(ace) });
      base = await loadGameContent(new HsdAssetSession(merged.reader, { files: merged.files }), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
    } finally { await vanilla.close(); await ace.close(); }
  }, 60000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the Link5K skeleton, both buster articles and the keyed specials', () => {
    const zx = f().content, p = zx.specials.parameters;
    expect(zx.profile.name).toBe('Zero'); expect(zx.profile.boneCount).toBe(75);
    expect(zx.model.roots[0]!.joints.length).toBe(75);
    if (p.kind !== 'Zx') throw new Error('wrong parameters');
    expect(zx.specials.articles.zero?.shot.hit?.damage).toBe(5);
    expect(zx.specials.articles.zero?.charged.hit?.damage).toBe(10);
    for (const key of ['SpecialNStart', 'SpecialAirNEnd', 'SpecialS2', 'SpecialHi', 'SpecialAirLw', 'SpecialLwLand']) expect(zx.clips.has(key)).toBe(true);
  });
  it('jabs with the original three-hit chain scripts', () => {
    step({ attack: true });
    expect(f().state).toBe('attack'); expect(f().animation).toBe('Attack11');
    expect(f().content.attacks.get('Attack11')!.events.some(e => e.type === 'create')).toBe(true);
  });
  it('charges the Z-Buster and fires the small shot on early release', () => {
    step({ special: true });
    expect(f().animation).toBe('SpecialNStart');
    for (let i = 0; i < 70; i++) step({ special: true });
    expect(f().animation).toBe('SpecialNLoop');
    step(); step();
    expect(game.projectiles.items.some(p => p.kind === 'buster')).toBe(true);
  });
  it('fires the charged shot after a full charge and damages the rival', () => {
    step({ special: true });
    for (let i = 0; i < 150; i++) step({ special: true });
    step(); step();
    expect(game.projectiles.items.some(p => p.kind === 'buster-charged')).toBe(true);
    for (let i = 0; i < 40; i++) step();
    expect(game.fighters[1]!.percent).toBe(10);
  });
  it('rises with Ryuenjin into helpless freefall', () => {
    step({ special: true, y: 1, specialDirection: 'up' });
    expect(f().animation.endsWith('Hi')).toBe(true);
    let peak = 0;
    for (let i = 0; i < 70; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(10);
    expect(['helpless', 'fall', 'landing', 'idle']).toContain(f().state);
  });
  it('dashes with Hienkyaku and chains the follow-up on a second press', () => {
    const startX = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    expect(f().animation).toBe('SpecialS1');
    for (let i = 0; i < 6; i++) step();
    step({ special: true });
    expect(f().animation).toBe('SpecialS2');
    for (let i = 0; i < 40; i++) step();
    expect(f().x).toBeGreaterThan(startX + 10);
  });
  it('dives with aerial Sentsuizan into the landing slash', () => {
    air();
    step({ special: true, y: -1, specialDirection: 'down' });
    expect(f().animation).toBe('SpecialAirLw');
    const names = new Set<string>();
    for (let i = 0; i < 90; i++) { step(); names.add(f().animation); }
    expect(names.has('SpecialLwLand')).toBe(true);
    expect(f().grounded).toBe(true);
  });
  it('loads the zero.ssm voice bank and remaps the dead FtSFX jump/ko ids', () => {
    expect(base.sound.banks.some(b => b.base === 2393)).toBe(true);
    const sounds = f().content.specials.sounds;
    expect(sounds.jump).toBe(2410); expect(sounds.airJump).toBe(2411); expect(sounds.ko).toBe(2414);
    for (const id of [sounds.jump, sounds.airJump, sounds.ko]) expect(base.sound.sample(id)?.channels[0]?.length).toBeGreaterThan(0);
  });
  it('voices the Z-Buster start with the mapped direct sample', () => {
    step({ special: true });
    expect(game.events.some(e => e.type === 'sound' && e.sound === 2406)).toBe(true);
  });
  it('captures and restores rollback state mid-special with a live buster shot', () => {
    step({ special: true });
    for (let i = 0; i < 70; i++) step({ special: true });
    step(); step();
    const snapshot = game.captureState();
    for (let i = 0; i < 12; i++) step({ attack: true });
    game.restoreState(snapshot);
    expect(game.projectiles.items.every(p => ['buster', 'buster-charged'].includes(p.kind))).toBe(true);
  });
});
