import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc, verifyAceDisc } from '../../lib/disc.ts';
import { mergeModdedSource } from '../../lib/hsd/modded-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadJointAnimation } from '../../lib/hsd/animation.ts';
import { loadGameContent, fighterAssetNames, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { MODDED_BONE_TABLES } from '../../lib/game/modded-bones.ts';
import { costumeModelFile, fighterCostumes } from '../../lib/game/costumes.ts';
import { WOLF_ACTION_KEYS, WFU_ACTION_KEYS } from '../../lib/game/wolf-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { ACE_ASSETS, SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

type Wave8 = 'Ts' | 'Bf' | 'WfU';
const SELECTORS: Array<[number, Wave8]> = [[55, 'Ts'], [56, 'Bf'], [57, 'WfU']];

describe('ACE wave-8 registration', () => {
  it('appends public-roster selectors 54-56 and room entries', () => {
    for (const [index, kind] of SELECTORS) {
      expect(ROSTER_CHOICES[index - 1]).toBe(kind);
      expect(ROOM_FIGHTERS).toContain(kind);
      expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: kind }))).toMatchObject({ fighter: kind });
    }
  });
  it('exposes every resolved file, each through exactly one allowlist', () => {
    for (const [, kind] of SELECTORS) {
      for (const costume of fighterCostumes(kind).keys()) {
        const name = costumeModelFile(kind, costume);
        expect(ACE_ASSETS.includes(name as never) || SERVER_ASSETS.includes(name as never)).toBe(true);
      }
      for (const name of fighterAssetNames(kind)) expect(ACE_ASSETS.includes(name as never) || SERVER_ASSETS.includes(name as never)).toBe(true);
    }
    // Blood Falcon's moveset is vanilla Captain Falcon; only his models/effects are ACE files.
    expect(fighterAssetNames('Bf')).toEqual(['PlCa.dat', 'PlBfNr.dat', 'PlCaAJ.dat', 'EfBfData.dat']);
    expect(ACE_ASSETS).not.toContain('PlCa.dat');
    expect(costumeModelFile('WfU', 0)).toBe('PlWfNr_001.dat');
    // The ACE CSS's second Giga Bowser (PlGkp.dat) is a byte-identical duplicate of Gk;
    // only its three recolors are kept, as Gk skins.
    expect(ROSTER_CHOICES).not.toContain('Gkp' as never);
    expect(ACE_ASSETS).not.toContain('PlGkp.dat');
    expect(fighterCostumes('Gk')).toEqual(['Nr', 'Re', 'Ye', 'Wh']);
    expect(costumeModelFile('Gk', 1)).toBe('PlGkRe.dat');
  });
  it('shifts the Wolf SSBU keys one index past Wolf', () => {
    expect(WFU_ACTION_KEYS.find((e) => e.key === 'SpecialS')!.index).toBe(WOLF_ACTION_KEYS.find((e) => e.key === 'SpecialS')!.index + 1);
    expect(new Set(WFU_ACTION_KEYS.map((e) => e.key)).size).toBe(WOLF_ACTION_KEYS.length);
  });
  it('ships the literal mexproj 033 Tails bone table', () => {
    expect(MODDED_BONE_TABLES.Ts.count).toBe(72);
    expect(MODDED_BONE_TABLES.Ts.map).toHaveLength(54);
    expect(MODDED_BONE_TABLES.Ts.virtualParts).toHaveLength(0);
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE wave-8 integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (kind: Wave8, gap = 20) => {
    rig?.dispose(); const content = rosterPair(base, kind, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
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
  }, 180000);
  afterEach(() => rig?.dispose());

  it.each([['Ts', 72], ['Bf', 63], ['WfU', 74]] as const)('%s loads with its skeleton, jabs and survives rollback', (kind, bones) => {
    make(kind, 8);
    expect(f().content.profile.boneCount).toBe(bones);
    expect(f().content.model.roots[0]!.joints.length).toBe(bones);
    step({ attack: true });
    expect(f().state).toBe('attack');
    const snapshot = game.captureState();
    for (let i = 0; i < 30; i++) step();
    expect(other().percent).toBeGreaterThan(0);
    game.restoreState(snapshot);
    expect(other().percent).toBe(0);
  });
  it('loads the tails and wolf_001 voice banks', () => {
    expect(base.sound.banks.some((b) => b.base === 1854)).toBe(true);
    expect(base.sound.banks.some((b) => b.base === 2694)).toBe(true);
  });
  it('Tails reads his real ftDataTails block, with Sonic\'s spin charge shifted by +0x40', () => {
    make('Ts');
    const p = f().content.specials.parameters;
    if (p.kind !== 'Ts') throw new Error('wrong parameters');
    expect(p.up.landFuel).toBe(110); expect(p.up.burn).toBe(2); expect(p.up.maxRise).toBeCloseTo(1.25, 5);
    expect(p.side.loops).toBe(5); expect(p.side.maxSpeed).toBeCloseTo(0.8, 5);
    expect(p.down.runSpeed.map((v) => Math.round(v * 100) / 100)).toEqual([1.65, 2.25, 3]);
    expect(p.down.runLife).toBe(100);
    const shot = f().content.specials.articles.tails!.shot;
    expect(shot.speed).toBeCloseTo(0.65, 5); expect(shot.flightLife).toBe(52); expect(shot.hit).not.toBeNull();
  });
  it('Tails neutral: tail swipe plus one floating shot at a time (PlTs ft_var1)', () => {
    make('Ts', 120);
    step({ special: true });
    let shots = 0;
    for (let i = 0; i < 40; i++) { step(); shots = game.projectiles.items.filter((p) => p.kind === 'tails-shot').length; }
    expect(shots).toBe(1);
    for (let i = 0; i < 30 && f().special; i++) step();
    // A second press while the shot lives is refused (SpecialN_Enter checks ft_var1).
    step({ special: true });
    expect(f().special).toBeNull();
    expect(game.projectiles.items.filter((p) => p.kind === 'tails-shot').length).toBe(1);
    make('Ts', 16);
    step({ special: true });
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) { step(); hit = other().percent > 0; }
    expect(hit).toBe(true);
  });
  it('Tails side: a stick-steered spin capped at 0.8 that ends on release', () => {
    make('Ts', 140);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 40; i++) step({ special: true, x: 1 });
    expect(f().animation).toMatch(/^SpecialSLoop/);
    expect(f().velocity.x).toBeCloseTo(0.8, 5);
    step({ x: 1 });
    expect(f().animation).toBe('SpecialSEnd');
    make('Ts', 30);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 70; i++) step({ special: true, x: 1 });
    for (let i = 0; i < 50; i++) step();
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Tails up: grounded helicopter lifts off, burns 2 fuel a frame, exhausts, refuels on landing', () => {
    make('Ts', 100);
    step({ special: true, y: 1, specialDirection: 'up' });
    let lifted = false, exhausted = false, peak = 0;
    for (let i = 0; i < 90; i++) { step({ special: true }); lifted ||= f().animation === 'SpecialHiLoop' && !f().grounded; exhausted ||= f().animation === 'SpecialHiExhaust'; peak = Math.max(peak, f().y); }
    expect(lifted).toBe(true); expect(exhausted).toBe(true);
    expect(f().tailsFuelUsed).toBeGreaterThanOrEqual(110);
    expect(peak).toBeGreaterThan(50);
    for (let i = 0; i < 200 && f().state !== 'idle'; i++) step();
    expect(f().tailsFuelUsed).toBe(0);
  });
  it('Tails down: Sonic\'s spin charge on his values (tapped level 1 runs at 2.25)', () => {
    make('Ts', 140);
    for (let i = 0; i < 40; i++) step({ down: true, y: -1, ...(i === 0 || (i > 6 && i < 36 && i % 6 === 0) ? { special: true, specialDirection: 'down' as const } : {}) });
    let run = 0;
    for (let i = 0; i < 20; i++) { step(); if (f().animation === 'SpecialLwRun') run = Math.max(run, Math.abs(f().velocity.x)); }
    expect(run).toBeCloseTo(2.25, 3);
  });
  it('Blood Falcon punches like Falcon and dives into helpless', () => {
    make('Bf', 8);
    step({ special: true });
    for (let i = 0; i < 90; i++) step();
    expect(other().percent).toBeGreaterThan(15);
    make('Bf', 80);
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 60; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(20);
  });
  it('Wolf SSBU fires the laser and flashes on real root motion', () => {
    make('WfU', 40);
    step({ special: true });
    let sawLaser = false;
    for (let i = 0; i < 50; i++) { step(); sawLaser ||= game.projectiles.items.some((p) => p.kind === 'wolf-laser'); }
    expect(sawLaser).toBe(true);
    make('WfU', 120);
    const x0 = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 22; i++) step();
    // PlWfU runs PlWf's compiled kit: the same 72-forward, 24-up burst into the end slash.
    expect(f().special?.wolf?.motion).toBe('SpecialAirSEnd');
    expect(f().x - x0).toBeGreaterThan(70);
  });
  it.each(['Wf', 'WfU'] as const)('%s flies Up-B inside the Fire Wolf flame (EfWfData model 4)', (kind) => {
    // efSync 0x138C's joint animation opens one m-ex track with op 0; only that non-pose track
    // may be dropped, the flame's scale pulses and spin must survive.
    const content = rosterPair(base, kind, 'Mr'), flame = content.fighters[0]!.specials.effects.get('firefox-launch');
    expect(flame).toBeDefined();
    const clip = loadJointAnimation(flame!.archive, flame!.roots[0]!.animationPointer)!;
    expect(clip.endFrame).toBe(64);
    expect(clip.joints.flatMap(joint => joint.tracks.map(track => track.type))).toEqual(expect.arrayContaining([3, 8, 9, 10]));
    rig?.dispose(); rig = new GameRigs(content); game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    step({ special: true, y: 1, specialDirection: 'up' });
    let travelled = false;
    for (let i = 0; i < 40; i++) { step(); travelled ||= f().special?.direction === 'up' && f().special?.phase === 'travel'; }
    expect(travelled).toBe(true);
  });
});
