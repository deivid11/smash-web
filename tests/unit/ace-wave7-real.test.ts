import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc, verifyAceDisc } from '../../lib/disc.ts';
import { mergeModdedSource } from '../../lib/hsd/modded-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { GK_ACTION_KEYS } from '../../lib/game/gk-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { ACE_ASSETS, SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Giga Bowser registration', () => {
  it('reserves public-roster selector 53, room entry and bounded extension assets', () => {
    expect(ROSTER_CHOICES[53]).toBe('Gk'); expect(ROOM_FIGHTERS).toContain('Gk');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Gk' }))).toMatchObject({ fighter: 'Gk' });
    for (const name of ['PlGk.dat', 'PlGkAJ.dat', 'PlGkNr.dat', 'audio/us/gkoopa.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
    // No effect bank on disc; Bowser's EfKpData.dat covers his VFX.
    expect(ACE_ASSETS).not.toContain('EfGkData.dat');
    expect(new Set(GK_ACTION_KEYS.map((e) => e.key)).size).toBe(21);
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE wave-7 Giga Bowser integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Gk', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const f = () => game.fighters[0];
  const other = () => game.fighters[1]!;
  const air = (y = 80) => { f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = y; };
  beforeAll(async () => {
    const vanilla = await openDisc(iso!), ace = await openDisc(aceIso!);
    try {
      const merged = mergeModdedSource({ reader: vanilla, info: await verifyMeleeDisc(vanilla) }, { reader: ace, info: await verifyAceDisc(ace) });
      base = await loadGameContent(new HsdAssetSession(merged.reader, { files: merged.files }), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
    } finally { await vanilla.close(); await ace.close(); }
  }, 120000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 76-joint Koopa-family skeleton, flame article and all normal hitboxes', () => {
    const gk = f().content, p = gk.specials.parameters;
    expect(gk.profile.name).toBe('Giga Bowser'); expect(gk.profile.boneCount).toBe(76);
    expect(gk.model.roots[0]!.joints.length).toBe(76);
    if (p.kind !== 'Gk') throw new Error('wrong parameters');
    expect(p.breath.maxStrength).toBeGreaterThan(p.breath.minStrength);
    expect(p.klaw.biteDamage).toBeGreaterThanOrEqual(1); expect(p.fortress.rise).toBeGreaterThan(0);
    expect(p.bomb.diveSpeed).toBeLessThan(0);
    expect(gk.specials.articles.projectile?.hit).toBeTruthy();
    expect(base.sound.banks.some((b) => b.base === 566)).toBe(true);
    for (const clip of gk.clips.values()) expect(clip.joints.length).toBeLessThanOrEqual(76);
    for (const name of Object.values(gk.moves)) {
      if (name.startsWith('Attack100')) continue;
      expect(gk.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
    }
  });
  it('breathes decaying fire and recovers the pool afterwards', () => {
    // Giga Bowser breathes at 1.5x scale: point-blank flames land the same
    // frame they spawn (single-hit removal), so visible concurrency is read
    // at range while the close-range burn proves the hits.
    make(24);
    step({ special: true, specialDirection: 'neutral' });
    let burnt = false, shots = 0;
    for (let i = 0; i < 90; i++) { step({ special: true }); shots += game.events.filter((e) => e.type === 'shot').length; burnt ||= other().percent > 0; }
    expect(shots).toBeGreaterThanOrEqual(5);
    expect(burnt).toBe(true);
    make(60);
    step({ special: true, specialDirection: 'neutral' });
    let flames = 0, lowest = f().koopaBreath;
    for (let i = 0; i < 120; i++) { step({ special: true }); flames = Math.max(flames, game.projectiles.items.filter((item) => item.kind === 'koopa-flame').length); lowest = Math.min(lowest, f().koopaBreath); }
    expect(flames).toBeGreaterThan(1);
    expect(lowest).toBeLessThan(360);
    for (let i = 0; i < 200 && f().state === 'special'; i++) step();
    for (let i = 0; i < 90; i++) step();
    expect(f().koopaBreath).toBeGreaterThan(lowest);
  });
  it('command-grabs with the Klaw, cycles the bite loop and tosses forward', () => {
    make(14);
    step({ special: true, specialDirection: 'side' });
    let caught = false;
    for (let i = 0; i < 40 && !caught; i++) { step(); caught = other().state === 'captured'; }
    expect(caught).toBe(true);
    expect(f().animation).toMatch(/SpecialSHit0/);
    // The 4% SpecialSHit bite hitbox is original data, but the shared
    // capture-sync anchor holds the victim inside Giga Bowser's 1.5x-scaled
    // mouth arc, so live bites whiff on the giant rig (explicit prototype
    // gap); the loop itself must still cycle on script ends.
    expect(f().content.timelines.get('SpecialSHit0')!.events.some((e) => e.type === 'create')).toBe(true);
    let bites = 0;
    for (let i = 0; i < 160; i++) { step(); bites = Math.max(bites, f().special?.koopa?.bites ?? 0); }
    expect(bites).toBeGreaterThan(0);
    step({ x: 1 });
    expect(f().state).toBe('throw');
    for (let i = 0; i < 60 && other().state === 'captured'; i++) step({ x: 1 });
    expect(other().state).not.toBe('captured');
  });
  it('spins the grounded Fortress and rises with the aerial one', () => {
    make(18);
    step({ special: true, specialDirection: 'up' });
    let hit = false;
    for (let i = 0; i < 80 && !hit; i++) { step({ x: 1 }); hit = other().percent > 0; }
    expect(hit).toBe(true);
    make(); air();
    step({ special: true, specialDirection: 'up' });
    expect(f().velocity.y).toBeGreaterThan(1.5);
    for (let i = 0; i < 200 && f().state === 'special'; i++) step();
    expect(['helpless', 'landing', 'fall']).toContain(f().state);
  });
  it('plunges the aerial Bomb into the crash landing and restores snapshots', () => {
    air(70);
    step({ special: true, specialDirection: 'down' });
    let diving = false;
    for (let i = 0; i < 60 && !diving; i++) { step(); diving = f().velocity.y <= -7; }
    expect(diving).toBe(true);
    for (let i = 0; i < 90 && f().special; i++) step();
    for (let i = 0; i < 90 && f().state !== 'idle'; i++) step();
    expect(f().state).toBe('idle');
    make();
    for (let i = 0; i < 10; i++) step({ special: true, specialDirection: 'neutral' });
    const snap = game.captureState(), hash = game.stateHash();
    for (let i = 0; i < 10; i++) step();
    game.restoreState(snap); expect(game.stateHash()).toBe(hash);
  });
});
