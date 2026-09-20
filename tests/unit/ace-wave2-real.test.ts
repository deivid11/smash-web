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

describe('Wolf/Diddy/Dedede/Wario/Shadow registration', () => {
  it('reserves public-roster selectors 32-36, room entries and bounded extension assets', () => {
    expect(ROSTER_CHOICES[32]).toBe('Wf'); expect(ROSTER_CHOICES[33]).toBe('Dd'); expect(ROSTER_CHOICES[34]).toBe('De');
    expect(ROSTER_CHOICES[35]).toBe('Wr'); expect(ROSTER_CHOICES[36]).toBe('Sh');
    for (const kind of ['Wf', 'Dd', 'De', 'Wr', 'Sh'] as const) expect(ROOM_FIGHTERS).toContain(kind);
    for (const name of ['PlWf.dat', 'PlWfAJ.dat', 'PlWfNr.dat', 'EfWfData.dat', 'audio/us/wolf.ssm',
      'PlDd.dat', 'PlDdAJ.dat', 'PlDdNr.dat', 'EfDdData.dat', 'audio/us/diddy.ssm',
      'PlDe.dat', 'PlDeAJ.dat', 'PlDeNr.dat', 'EfDeData.dat', 'audio/us/dedede.ssm',
      'PlWr.dat', 'PlWrAJ.dat', 'PlWrNr.dat', 'EfWrData.dat', 'audio/us/wario.ssm',
      'PlSh.dat', 'PlShAJ.dat', 'PlShNr.dat', 'EfShData.dat', 'audio/us/shadow.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
  });
  it('ships literal mexproj bone tables with every part owning a joint', () => {
    expect(MODDED_BONE_TABLES.Wf.count).toBe(74); expect(MODDED_BONE_TABLES.Dd.count).toBe(73);
    expect(MODDED_BONE_TABLES.De.count).toBe(67); expect(MODDED_BONE_TABLES.Wr.count).toBe(63);
    expect(MODDED_BONE_TABLES.Sh.count).toBe(71);
    for (const table of [MODDED_BONE_TABLES.Wf, MODDED_BONE_TABLES.Dd, MODDED_BONE_TABLES.De, MODDED_BONE_TABLES.Wr, MODDED_BONE_TABLES.Sh]) {
      expect(table.map).toHaveLength(54); expect(table.virtualParts).toHaveLength(0); expect(table.jointCount).toBe(table.count);
    }
  });
  it('maps voice banks for all five (announcer stays generic)', () => {
    // Voice SSMs ride the extension disc; SEM banks carry no scripts in the 2.0
    // ISO, so in-match voices play as direct samples (see play-audio fallback).
    expect(ACE_ASSETS).toContain('audio/us/wolf.ssm');
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE wave-2 integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (kind: 'Wf' | 'Dd' | 'De' | 'Wr' | 'Sh', gap = 20) => {
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
  }, 90000);
  afterEach(() => rig?.dispose());

  it('loads all five with skeletons, jabs, voices and rollback-safe state', () => {
    for (const [kind, joints, jumps] of [['Wf', 74, 2], ['Dd', 73, 2], ['De', 67, 5], ['Wr', 63, 2], ['Sh', 71, 2]] as const) {
      make(kind);
      expect(f().content.profile.boneCount).toBe(joints);
      expect(f().content.profile.attributes.maxJumps).toBe(jumps);
      expect(f().content.model.roots[0]!.joints.length).toBe(joints);
      expect(base.sound.banks.some(b => b.base === ({ Wf: 1566, Dd: 1601, De: 1812, Wr: 1916, Sh: 2523 } as const)[kind])).toBe(true);
      step({ attack: true });
      expect(f().state).toBe('attack');
      const snapshot = game.captureState();
      for (let i = 0; i < 8; i++) step({ attack: true });
      game.restoreState(snapshot);
    }
  });
  it('Wolf fires the gun laser on its script flag (PlWf fn_0281c / itFunction:0)', () => {
    make('Wf', 40);
    const p = f().content.specials.parameters;
    if (p.kind !== 'Wf') throw new Error('Wolf parameters missing');
    // The block PlWf's OnLoad copies over special_attributes (not ftDataWolf).
    expect([p.neutral.laserSpeed, p.neutral.laserLife, p.side.landing, p.up.speed, p.up.travel, p.up.landing, p.down.releaseLag]).toEqual([Math.fround(2.3), 25, 20, Math.fround(3.2), 30, 18, 18]);
    expect([p.down.reflect.radius, p.down.reflect.speedMultiplier, p.down.reflect.damageMultiplier, p.down.reflect.maxDamage]).toEqual([8.5, 1, 1.5, 50]);
    step({ special: true });
    expect(f().animation).toBe('SpecialNStart');
    let firedAt = -1, laser: { x: number; vx: number; life: number } | undefined;
    for (let i = 1; i < 60; i++) {
      step();
      const shot = game.projectiles.items.find(q => q.kind === 'wolf-laser');
      if (shot && firedAt < 0) { firedAt = i; laser = { x: shot.x, vx: shot.vx, life: shot.life }; }
    }
    // Script frame 14 sets cmd var 1; the laser leaves the gun muzzle ahead of Wolf at 2.3/frame.
    expect(firedAt).toBe(14);
    expect(laser!.vx).toBeCloseTo(2.3, 5);
    expect(laser!.x).toBeGreaterThan(f().x + 5);
    expect(other().percent).toBe(3);
    expect(f().state).toBe('idle');
  });
  it('Wolf Flash bursts on its TransN, cuts on B and falls special unless the slash hits', () => {
    make('Wf', 120);
    const x0 = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 20; i++) step();
    expect(f().special?.wolf?.motion).toBe('SpecialAirS');
    step(); step();
    // 72 forward and 24 up over the dash's two frames, airborne into the end slash.
    expect(f().special?.wolf?.motion).toBe('SpecialAirSEnd');
    expect(f().x - x0).toBeGreaterThan(70);
    expect(f().y).toBeGreaterThan(20);
    let landing = 0;
    for (let i = 0; i < 60 && !landing; i++) { step(); if (f().state === 'landing') landing = f().landingFrames; }
    expect(landing).toBe(20);
    // In the air, B cuts the dash after one frame of it.
    make('Wf', 120);
    step({ jump: true }); for (let i = 0; i < 12; i++) step();
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 20; i++) step();
    const dashX = f().x;
    step({ special: true });
    expect(f().special?.wolf?.motion).toBe('SpecialAirSEnd');
    expect(f().x - dashX).toBeLessThan(40);
    // A connected slash (ptr_03bac) gives the double jump back and ends in a plain fall.
    make('Wf', 120);
    const start = f().x, pin = () => { other().x = start + 75; other().y = 18; other().grounded = false; other().floor = null; other().velocity = { x: 0, y: 0 }; };
    step({ special: true, x: 1, specialDirection: 'side' });
    let hitJumps = -1;
    for (let i = 0; i < 26 && hitJumps < 0; i++) { pin(); step(); if (f().special?.wolf?.hit) hitJumps = f().jumpsUsed; }
    expect(other().percent).toBe(18);
    expect(hitJumps).toBe(1);
    for (let i = 0; i < 60 && f().special; i++) step();
    expect(f().state === 'fall' || f().state === 'landing' || f().state === 'idle').toBe(true);
  });
  it('Fire Wolf aims, decelerates and ends helpless (Fox Firefox with Wolf numbers)', () => {
    make('Wf', 120);
    step({ special: true, y: 1, specialDirection: 'up' });
    for (let i = 0; i < 26; i++) step({ x: 0.7, y: 0.7 });
    expect(f().special?.wolf?.motion).toBe('SpecialAirHi');
    expect(f().velocity.x).toBeCloseTo(3.2 * Math.SQRT1_2, 3);
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless'; }
    expect(peak).toBeGreaterThan(40);
    expect(helpless).toBe(true);
    // A sideways stick on the ground travels along the floor into SpecialHiLanding.
    make('Wf', 120);
    step({ special: true, y: 1, specialDirection: 'up' });
    for (let i = 0; i < 26; i++) step({ x: 1 });
    expect(f().special?.wolf?.motion).toBe('SpecialHi');
    expect(f().grounded).toBe(true);
    for (let i = 0; i < 32; i++) step();
    expect(f().special?.wolf?.motion).toBe('SpecialHiLanding');
  });
  it('the reflector turns, jump-cancels, releases after its lag and reflects shots', () => {
    make('Wf', 50);
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    for (let i = 0; i < 6; i++) step({ special: true });
    expect(f().special?.wolf?.motion).toBe('SpecialLwLoop');
    step({ special: true, x: -1 });
    expect(f().special?.wolf?.motion).toBe('SpecialLwTurn');
    expect(f().facing).toBe(-1);
    for (let i = 0; i < 4; i++) step({ special: true });
    expect(f().special?.wolf?.motion).toBe('SpecialLwLoop');
    step({ special: true, jump: true });
    expect(f().special).toBeFalsy();
    // Tapped: the loop holds for the x98 release lag, then SpecialLwEnd.
    make('Wf', 50);
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    let ended = -1;
    for (let i = 1; i < 40 && ended < 0; i++) { step(); if (f().special?.wolf?.motion === 'SpecialLwEnd') ended = i; }
    expect(ended).toBe(4 + 18);
    // Mario's fireball comes back owned by Wolf at the reflector's x1.0 speed.
    make('Wf', 50);
    step({ special: true, y: -1, down: true, specialDirection: 'down' }, { special: true });
    let reflected = false;
    for (let i = 0; i < 60 && !reflected; i++) { step({ special: true }); reflected = f().special?.wolf?.motion === 'SpecialLwHit'; }
    expect(reflected).toBe(true);
    const shot = game.projectiles.items.find(q => q.kind === 'fireball')!;
    expect(shot.owner).toBe(0);
    expect(shot.vx).toBeGreaterThan(0);
  });
  it('Diddy fires the peanut, dashes and rocketbarrels', () => {
    make('Dd', 40);
    step({ special: true });
    for (let i = 0; i < 5; i++) step({ special: true });
    step({});
    let sawPeanut = false;
    for (let i = 0; i < 70; i++) { step(); sawPeanut ||= game.projectiles.items.some(p => p.kind === 'diddy-peanut'); }
    expect(sawPeanut).toBe(true);
    // Gun_Shoot's uncharged peanut: 3% (the full kit is pinned in tests/unit/diddy-real.test.ts).
    expect(other().percent).toBe(3);
    make('Dd', 90);
    const start = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 40; i++) step();
    expect(Math.abs(f().x - start)).toBeGreaterThan(25);
    make('Dd');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless' || f().state === 'landing'; }
    expect(peak).toBeGreaterThan(25);
    expect(helpless).toBe(true);
  });
  it('Dedede inhales up close, tosses Gordos and hammers', () => {
    // Inhale is a capture (no direct damage in the prototype); it holds the loop.
    make('De', 8);
    step({ special: true });
    for (let i = 0; i < 30; i++) step({ special: true });
    expect(f().animation).toBe('SpecialNLoop');
    make('De', 20);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 60; i++) step();
    expect(other().percent).toBe(18);
    expect(f().content.airJumps?.animations).toEqual(['JumpAerialF2', 'JumpAerialF3', 'JumpAerialF4', 'JumpAerialF5']);
    make('De');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(25);
  });
  it('Wario chomps up close, bashes and corkscrews', () => {
    make('Wr', 8);
    step({ special: true });
    for (let i = 0; i < 40; i++) step({ special: true });
    expect(other().percent).toBeGreaterThan(0);
    make('Wr', 130); // Clear of Mario: the bash stops dead on contact (warioBashDetect).
    const start = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 30; i++) step();
    expect(Math.abs(f().x - start)).toBeGreaterThan(15);
    make('Wr');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless' || f().state === 'landing'; }
    expect(peak).toBeGreaterThan(25);
    expect(helpless).toBe(true);
  });
  it('Wario Shoulder Bash follows PlWr: detect-only dash, 13% contact hit, original whiff distance', () => {
    const p = (make('Wr', 40), f().content.specials.parameters);
    if (p.kind !== 'Wr') throw new Error('wrong parameters');
    expect(p.side.dashVel).toBeCloseTo(2.5, 5); expect(p.side.reboundY).toBeCloseTo(2.5, 5); expect(p.side.fallLanding).toBe(16);
    // The start clips only carry zero-damage element-11 boxes; the damage lives in SpecialS.
    for (const name of ['SpecialSStart', 'SpecialAirSStart']) for (const e of f().content.timelines.get(name)!.events) if (e.type === 'create') expect(e.hit.damage).toBe(0);
    step({ special: true, x: 1, specialDirection: 'side' });
    let contact = false;
    for (let i = 0; i < 70 && !(contact && other().percent > 0); i++) { step(); contact ||= f().animation === 'SpecialS'; }
    expect(contact).toBe(true);
    expect(other().percent).toBe(13);
    // Whiff: 24 frames at x24 then the 1.2 slide, about 80 units (not a stage-length dash).
    make('Wr', 130);
    const start = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 80 && f().special; i++) step();
    expect(f().x - start).toBeGreaterThan(70); expect(f().x - start).toBeLessThan(90);
    expect(other().percent).toBe(0);
  });
  it('Shadow homing hops, spin dashes and chaos-controls on the Sonic source with Mewtwo\'s Teleport', () => {
    make('Sh', 14);
    const p = f().content.specials.parameters;
    if (p.kind !== 'Sh' || !p.chaos) throw new Error('Shadow kit parameters missing.');
    // ftDataShadow: Sonic's homing offsets (40-frame charge), the spin dash moved to 0xA8, Chaos
    // Control at 0x68 (ftMt_SpecialHi's layout: /2 dividers, 8 zoom frames, 2.08·stick + 3.2).
    expect(p.neutral).toMatchObject({ chargeMaxFrames: 40, homingFrames: 17 });
    expect(p.side).toMatchObject({ holdMinFrames: 10, maxCharge: 75, minSpeed: 4, maxSpeed: 6, endAnimSpeed: 1, cancelOnPress: true });
    expect(p.chaos).toMatchObject({ velDivX: 2, velDivY: 2, duration: 8, turnFrames: 6, landing: 20 });
    expect(p.chaos.momentum).toBeCloseTo(2.08, 5); expect(p.chaos.momentumAdd).toBeCloseTo(3.2, 5);
    expect(p.down).toMatchObject({ maxLevel: 2, maxChargeFrames: 0, releaseWindow: 20, levelCooldown: 10, firstLevelDelay: 10 });
    step({ special: true });
    for (let i = 0; i < 70; i++) step();
    expect(other().percent).toBeGreaterThan(0);

    make('Sh', 40);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 30 && f().special?.sonic?.state !== 'SHold'; i++) step();
    expect(f().special?.sonic?.state).toBe('SHold');
    // SpecialSHold_IASA: after x8C frames a fresh B press launches at 4 + 2·charge/75.
    for (let i = 0; i < 20; i++) step();
    step({ special: true });
    expect(f().special?.sonic?.state).toBe('SAttack');
    expect(Math.abs(f().velocity.x)).toBeGreaterThan(4);
    const start = f().x;
    for (let i = 0; i < 45; i++) step();
    expect(f().x - start).toBeGreaterThan(20);
    expect(other().percent).toBeGreaterThan(0);

    make('Sh');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, zoom = 0, hidden = 0, landing = 0;
    for (let i = 0; i < 160; i++) {
      step({ y: 1 });
      peak = Math.max(peak, f().y);
      if (f().special?.sonic?.state === 'HiLost') { zoom = Math.max(zoom, Math.hypot(f().velocity.x, f().velocity.y)); hidden++; expect(f().invulnerable).toBeGreaterThan(0); }
      if (f().state === 'landing') landing = Math.max(landing, f().landingFrames);
    }
    expect(zoom).toBeCloseTo(5.28, 3);
    expect(hidden).toBe(8);
    expect(peak).toBeGreaterThan(45);
    expect(peak).toBeLessThan(65);
    expect(landing).toBe(20);
  });
});
