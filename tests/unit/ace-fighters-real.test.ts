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

describe('Toad/Meta Knight/Sonic registration', () => {
  it('reserves public-roster selectors 16-18, room entries and bounded extension assets', () => {
    expect(ROSTER_CHOICES[16]).toBe('Td'); expect(ROSTER_CHOICES[17]).toBe('Mk'); expect(ROSTER_CHOICES[18]).toBe('Sn');
    expect(ROSTER_CHOICES[19]).toBe('Rc'); expect(ROSTER_CHOICES[20]).toBe('Lz');
    for (const kind of ['Td', 'Mk', 'Sn', 'Rc', 'Lz'] as const) expect(ROOM_FIGHTERS).toContain(kind);
    for (const name of ['PlTd.dat', 'PlTdAJ.dat', 'PlTdNr.dat', 'EfTdData.dat', 'audio/us/toad.ssm', 'PlMk.dat', 'PlMkAJ.dat', 'PlMkNr.dat', 'EfMkData.dat', 'audio/us/metaknight.ssm', 'PlSn.dat', 'PlSnAJ.dat', 'PlSnNr.dat', 'EfSnData.dat', 'audio/us/sonic.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
    for (const name of ['PlRc.dat', 'PlRcAJ.dat', 'PlRcNr.dat', 'EfRcData.dat', 'audio/us/raichu.ssm', 'PlLz.dat', 'PlLzAJ.dat', 'PlLzNr.dat', 'EfLzData.dat', 'audio/us/lizardon.ssm']) { expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name); }
    for (const name of ['PlTdIce.dat', 'PlMkDark.dat', 'PlSnSw2.dat', 'PlKbCpSn.dat', 'PlRcCp.dat', 'PlLzSh.dat']) expect(ACE_ASSETS).not.toContain(name);
  });
  it('ships literal mexproj bone tables with every part owning a joint', () => {
    expect(MODDED_BONE_TABLES.Td.count).toBe(63); expect(MODDED_BONE_TABLES.Mk.count).toBe(84); expect(MODDED_BONE_TABLES.Sn.count).toBe(71);
    expect(MODDED_BONE_TABLES.Rc.count).toBe(53); expect(MODDED_BONE_TABLES.Lz.count).toBe(64);
    for (const table of Object.values(MODDED_BONE_TABLES)) {
      expect(table.map).toHaveLength(54); expect(table.virtualParts).toHaveLength(0); expect(table.jointCount).toBe(table.count);
    }
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE fighter wave integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (kind: 'Td' | 'Mk' | 'Sn' | 'Rc' | 'Lz', gap = 20) => {
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
  }, 60000);
  afterEach(() => rig?.dispose());

  it('loads all three with their skeletons, jabs and rollback-safe state', () => {
    for (const [kind, joints, jumps] of [['Td', 63, 2], ['Mk', 84, 4], ['Sn', 71, 2], ['Rc', 53, 2], ['Lz', 64, 3]] as const) {
      make(kind);
      expect(f().content.profile.boneCount).toBe(joints);
      expect(f().content.profile.attributes.maxJumps).toBe(jumps);
      expect(f().content.model.roots[0]!.joints.length).toBe(joints);
      step({ attack: true });
      expect(f().state).toBe('attack');
      const snapshot = game.captureState();
      for (let i = 0; i < 8; i++) step({ attack: true });
      game.restoreState(snapshot);
    }
  });
  it('loads wave-1 voice banks and remaps the dead FtSFX jump/ko ids', () => {
    for (const bankBase of [2562, 2133, 1709, 1978, 1632]) expect(base.sound.banks.some(b => b.base === bankBase)).toBe(true);
    // Sn keeps the shipped 540000 silent jump slots (only 5xxx ids remap); ko voices up.
    const expected = { Td: [2582, 2583, 2589], Mk: [2149, 2150, 2157], Sn: [540000, 540000, 1736] } as const;
    for (const [kind, ids] of Object.entries(expected)) {
      make(kind as 'Td' | 'Mk' | 'Sn');
      const sounds = f().content.specials.sounds;
      expect([sounds.jump, sounds.airJump, sounds.ko]).toEqual([...ids]);
      for (const id of ids) if (id !== 540000) expect(base.sound.sample(id)?.channels[0]?.length).toBeGreaterThan(0);
    }
  });
  it('voices wave-1 special starts with the mapped direct samples', () => {
    for (const [kind, voice] of [['Td', 2579], ['Mk', 2135], ['Sn', 1726]] as const) {
      make(kind);
      step({ special: true });
      expect(game.events.some(e => e.type === 'sound' && e.sound === voice)).toBe(true);
    }
  });
  it('Toad fires the Ice Ball off the script flag and damages the rival', () => {
    make('Td', 40);
    step({ special: true });
    expect(f().animation).toBe('SpecialN');
    let sawBall = false;
    for (let i = 0; i < 60; i++) { step(); sawBall ||= game.projectiles.items.some(p => p.kind === 'iceball'); }
    expect(sawBall).toBe(true);
    expect(other().percent).toBe(5);
  });
  it('Toad vaults with the root-motion recovery into landing lag', () => {
    make('Td');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 60; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(15);
  });
  it('Meta Knight air-jumps three times with his own clips', () => {
    make('Mk');
    expect(f().content.airJumps?.animations).toEqual(['JumpAerialF', 'JumpAerialF2', 'JumpAerialF3']);
    expect(f().content.clips.has('JumpAerialF3')).toBe(true);
  });
  it('Mach Tornado multihits a point-blank rival', () => {
    make('Mk', 8);
    step({ special: true });
    for (let i = 0; i < 50; i++) step({ special: true });
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Drill Rush travels on script root motion and exits helpless in the air', () => {
    make('Mk');
    const start = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 90; i++) step();
    expect(Math.abs(f().x - start)).toBeGreaterThan(25);
  });
  it('Shuttle Loop climbs and Dimensional Cape slides by stick direction', () => {
    make('Mk');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 70; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(20);
    for (let i = 0; i < 60; i++) step();
    const capeStart = f().x;
    step({ special: true, y: -1, x: 1, specialDirection: 'down' });
    for (let i = 0; i < 12; i++) step({ x: 1 });
    for (let i = 0; i < 120; i++) step();
    expect(f().special).toBeNull();
    expect(Math.abs(f().x - capeStart)).toBeGreaterThan(3);
  });
  it('Sonic homing attack rises, locks onto the rival, connects and falls free', () => {
    make('Sn', 14);
    step({ special: true });
    // SpecialNStart hangs, SpecialNCharge rises at attrs x24 until the x20 cap launches the search.
    let rose = 0, homing = false, hit = false;
    for (let i = 0; i < 70 && !hit; i++) {
      step(); rose = Math.max(rose, f().y);
      const state = f().special?.sonic?.state;
      if (state === 'NAttack') { homing = true; expect(Math.hypot(f().velocity.x, f().velocity.y)).toBeCloseTo(5, 3); }
      hit = other().percent > 0;
    }
    expect(rose).toBeGreaterThan(10); expect(homing).toBe(true); expect(hit).toBe(true);
    // SpecialNHit_Enter pops him up and the move ends in a normal Fall, never helpless.
    let helpless = false, fell = false;
    for (let i = 0; i < 80; i++) { step(); helpless ||= f().state === 'helpless'; fell ||= f().state === 'fall'; }
    expect(helpless).toBe(false); expect(fell).toBe(true);
  });
  it('Sonic homing attack with nothing in range dives forward and down', () => {
    make('Sn', 150);
    step({ special: true });
    let dove = false;
    for (let i = 0; i < 60; i++) { step(); if (f().special?.sonic?.state === 'NAttackMiss') { dove = true; expect(f().velocity.x).toBeGreaterThan(0); expect(f().velocity.y).toBeLessThan(0); break; } }
    expect(dove).toBe(true);
  });
  it('Sonic spin dash charges on its own, fires on a second B and banks a full charge', () => {
    make('Sn', 40);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 30 && f().special?.sonic?.state !== 'SHold'; i++) step();
    expect(f().animation).toBe('SpecialSHold');
    for (let i = 0; i < 20; i++) step();
    const charge = f().sonicCharge;
    expect(charge).toBeGreaterThan(15);
    step({ special: true });
    // SpecialSAttack: 4 + (6 - 4) · charge / 75, bleeding 7% a frame.
    expect(f().special?.sonic?.state).toBe('SAttack');
    const start = f().x;
    for (let i = 0; i < 45; i++) step();
    expect(f().x - start).toBeGreaterThan(20);
    expect(other().percent).toBeGreaterThan(0);
    // A full SHold banks the charge and leaves; the next side special fires instantly.
    make('Sn', 120);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 120 && f().special; i++) step();
    expect(f().sonicCharge).toBe(75);
    step({ special: true, x: 1, specialDirection: 'side' }); step();
    expect(f().animation).toBe('SpecialSFull');
    expect(f().sonicCharge).toBe(0);
  });
  it('Raichu reads Pikachu-layout attributes and his own jolt/thunder articles from PlRc', () => {
    make('Rc');
    const p = f().content.specials.parameters;
    if (p.kind !== 'Rc') throw new Error('Raichu parameters missing.');
    // ftDataRaichu keeps ftPikachuAttributes offsets for N/Hi/Lw (Quick Attack 5.9 + 4·stick, 4×8 thunder).
    expect(p.up).toMatchObject({ delay: 10, frames: 5, threshold: 0.5, slope: 4, landing: 24, angleDifference: 360 });
    expect(p.up.speed).toBeCloseTo(5.9, 5);
    expect(p.down).toMatchObject({ count: 4, delay: 8, speed: -5, height: 150 });
    // The compiled roll's own block (M343/M344/M349/M352 reads).
    expect(p.side).toMatchObject({ maxSteps: 4, damage: 8, damagePerStep: 2 });
    expect(p.side.rollSpeed).toBeCloseTo(1.7, 5); expect(p.side.speedPerStep).toBeCloseTo(0.66, 5); expect(p.side.terminal).toBeCloseTo(1.2, 5);
    const articles = f().content.specials.articles;
    expect(articles.pikachu!.thunder.hit!.damage).toBe(5);
    expect(articles.projectile!.speed).toBe(1); expect(articles.projectile!.lifetime).toBe(120);
    expect(articles.projectile!.bounce).toBeCloseTo(0.85, 5); expect(articles.projectile!.angle).toBeCloseTo(-0.4854, 3);
    // m-ex sounds: 5000 + n is script n of Raichu's own SEM bank (80 on the ACE disc's smash2.sem),
    // mirroring Pikachu's 240000 + n. Every scripted sound resolves to a raichu.ssm sample.
    expect(f().content.specials.soundBank).toBe(80);
    const scripted = [...f().content.timelines.values()].flatMap(t => t.events).filter(e => e.type === 'sound').map(e => (e as { sound: number }).sound).filter(id => id !== 540000);
    expect(scripted.filter(id => Math.floor(id / 10000) === 80).length).toBeGreaterThan(20);
    for (const id of scripted) { expect(id < 5000 || id >= 6000).toBe(true); expect(game.content.sound.cues(id).length).toBeGreaterThan(0); }
    expect(game.content.sound.cues(f().content.specials.sounds.ko)[0]!.sample).toBe(2001);
    // Vanilla ids keep resolving through the vanilla table.
    expect(game.content.sound.cues(240025)[0]!.sample).toBe(1002);
    // effBehaviorTable model 6 (the roll glow, script gfx 5006) rides its bone.
    expect(f().content.specials.mexEffects!.get(6)!.follow).toBe(true);
    expect(f().content.specials.mexEffects!.get(0)!.follow).toBe(false);
  });
  it('Raichu fires a bouncing jolt on the ftPk cmd0 frame', () => {
    make('Rc', 40);
    step({ special: true });
    let spawnedAt = -1, bounced = false, lastVy = 0;
    for (let i = 0; i < 110; i++) {
      step();
      const jolt = game.projectiles.items.find(p => p.kind === 'raichu-jolt');
      if (jolt && spawnedAt < 0) spawnedAt = i;
      if (jolt) { if (lastVy < 0 && jolt.vy > 0) bounced = true; lastVy = jolt.vy; }
    }
    expect(spawnedAt).toBeGreaterThanOrEqual(30); expect(spawnedAt).toBeLessThanOrEqual(33);
    expect(bounced).toBe(true);
    expect(other().percent).toBe(5);
  });
  it('Raichu Quick Attack zips once: PlRc x A8 = 360 makes the ftPk second-zip angle test unreachable', () => {
    make('Rc', 60);
    step({ special: true, specialDirection: 'up', y: 1 });
    for (let i = 0; i < 16; i++) step({ y: 1 });
    expect(f().special?.phase).toBe('travel'); expect(f().special?.pikachu?.zipCount).toBe(1); expect(f().y).toBeGreaterThan(15);
    expect(f().jumpsUsed).toBe(f().content.profile.attributes.maxJumps);
    // A sharply re-aimed stick (Pikachu's 38° would qualify) never grants a second zip.
    for (let i = 0; i < 15; i++) step({ x: 1 });
    expect(f().special?.pikachu?.zipCount).toBe(1);
    for (let i = 0; i < 80 && f().special; i++) step();
    expect(f().special).toBeNull();
    expect(['helpless', 'landing']).toContain(f().state);
  });
  it('Raichu Thunder drops four linked segments and bursts on self-contact', () => {
    make('Rc', 80);
    step({ special: true, specialDirection: 'down' });
    for (let i = 0; i < 23; i++) step();
    expect(game.projectiles.items.filter(p => p.kind === 'thunder')).toHaveLength(4);
    const state = game.captureState(), hash = game.stateHash();
    for (let i = 0; i < 4; i++) step();
    game.restoreState(state); expect(game.stateHash()).toBe(hash);
    let hit = false;
    for (let i = 0; i < 50; i++) { step(); if (f().special?.phase === 'hit') hit = true; }
    expect(hit).toBe(true);
    for (let i = 0; i < 90 && f().special; i++) step();
    expect(f().special).toBeNull();
    expect(game.projectiles.items.filter(p => p.kind === 'thunder')).toHaveLength(0);
  });
  it('Raichu roll builds speed from the hold script, stops on a fresh B press and hits for x30 + x34·steps', () => {
    make('Rc', 120);
    const p = f().content.specials.parameters;
    if (p.kind !== 'Rc') throw new Error('Raichu parameters missing.');
    step({ special: true, x: 1, specialDirection: 'side' });
    expect(f().animation).toBe('SpecialSStart');
    expect(f().velocity.x).toBeCloseTo(p.side.rollSpeed, 5);
    for (let i = 0; i < 20 && f().special?.phase === 'start'; i++) step();
    expect(f().animation).toBe('SpecialSHold');
    // The 14-frame hold clip loops on its action flag while its script cycles every 10 frames:
    // one step per script cmd0 at hold frames 0/10/20/30, capped at x2C = 4, never restarted.
    const holdSteps: number[] = [];
    for (let i = 0; i < 40 && f().special?.raichu?.steps !== 4; i++) { const before = f().special!.raichu!.steps; step(); if (f().special!.raichu!.steps !== before) holdSteps.push(Math.round(f().animationFrame)); }
    // Entry step, then one per 10-frame script cycle (frames read after each advance).
    expect(holdSteps.slice(1)).toEqual([11, 21, 31]);
    expect(f().animation).toBe('SpecialSHold');
    expect(f().special?.raichu?.steps).toBe(4);
    step();
    expect(f().special?.raichu?.steps).toBe(4);
    expect(f().velocity.x).toBeCloseTo(p.side.speedPerStep * 4, 5);
    const state = game.captureState(), hash = game.stateHash();
    step(); game.restoreState(state); expect(game.stateHash()).toBe(hash);
    expect(other().percent).toBe(0);
    step({ special: true });
    expect(f().animation).toBe('SpecialSEnd');
    for (let i = 0; i < 60 && f().special; i++) step();
    expect(f().special).toBeNull();
    // Held all the way into the rival: hitbox 0 carries 8 + 2·4.
    make('Rc', 120);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 90 && other().percent === 0; i++) step();
    expect(other().percent).toBe(p.side.damage + p.side.damagePerStep * 4);
  });
  it('Raichu air roll builds to x2C and launches the airborne roll with x44/x4C speeds', () => {
    make('Rc', 120);
    const p = f().content.specials.parameters;
    if (p.kind !== 'Rc') throw new Error('Raichu parameters missing.');
    f().y = 60; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().velocity = { x: 0, y: 0 };
    step({ special: true, x: 1, specialDirection: 'side' });
    let launched = false;
    for (let i = 0; i < 60 && !launched; i++) { step(); launched = f().special?.phase === 'travel'; }
    expect(launched).toBe(true);
    expect(f().animation).toBe('SpecialAirSTravel');
    expect(f().special?.raichu?.steps).toBe(4);
    expect(f().velocity.x).toBeCloseTo(p.side.launchX + p.side.launchXPerStep * 4, 4);
    expect(f().velocity.y).toBeCloseTo(p.side.launchY + p.side.launchYPerStep * 4, 4);
    step();
    expect(f().velocity.x).toBeCloseTo(p.side.launchX + p.side.launchXPerStep * 4 - p.side.airDecay, 4);
  });
  it('Charizard breathes fuel-scaled flames for at least 40 frames, sharing one burn per stream group', () => {
    make('Lz', 26);
    const p = f().content.specials.parameters;
    if (p.kind !== 'Lz') throw new Error('Charizard parameters missing.');
    // PlLz attrs: x14 40-frame minimum loop, x20/x28 pool caps, x24/x2C floors, 0.7/frame refill.
    expect(p.neutral).toMatchObject({ minFrames: 40, quakeFrames: 30, bone: 27 });
    expect(p.neutral.speedFuel).toMatchObject({ max: 360, min: 40 });
    expect(p.neutral.sizeFuel).toMatchObject({ max: 380, min: 60 });
    expect(f().lizardonFuel).toEqual({ speed: 360, size: 380 });
    step({ special: true });
    // SpecialNStart is 18 frames; SpecialN_Start_AnimCB enters the loop once it has played out.
    for (let i = 0; i < 18; i++) step();
    expect(f().special?.lizardon?.state).toBe('NLoop');
    // B released: the loop still runs its 40 frames (state_var4), draining both pools by one per
    // frame, and ends on the next one (which drains once more).
    for (let i = 0; i < 39; i++) step();
    expect(f().special?.lizardon?.state).toBe('NLoop');
    step();
    expect(f().special?.lizardon?.state).toBe('NEnd');
    expect(f().lizardonFuel.speed).toBeCloseTo(319, 3);
    expect(f().lizardonFuel.size).toBeCloseTo(339, 3);
    // Each flame is 2%; a victim is burned again only by flames spawned after the last burn.
    expect(other().percent).toBeGreaterThanOrEqual(8);
    expect(other().percent % 2).toBe(0);
    const flames = game.projectiles.items.filter((item) => item.kind === 'lizardon-flame');
    expect(flames.length).toBeGreaterThan(4);
    for (const flame of flames) expect(flame.hit.radius).toBeLessThan(f().content.specials.articles.lizardon!.flame.hit!.radius);
    // RefuelFire: the aerial end and everything after refill at 0.7 per frame.
    for (let i = 0; i < 60; i++) step();
    expect(f().special).toBeNull();
    expect(f().lizardonFuel.speed).toBeGreaterThan(319);
  });
  it('Charizard Fly rises on its animation with stick drift into a 30-frame special landing', () => {
    make('Lz');
    const p = f().content.specials.parameters;
    if (p.kind !== 'Lz') throw new Error('Charizard parameters missing.');
    // multi_jump_desc at attrs+0x7C: 12 turn frames, 0.5 impulse, jumps of 3 and 2.4.
    expect(f().content.airJumps).toMatchObject({ animations: ['JumpAerialF', 'JumpAerialF2'], vertical: [3, expect.closeTo(2.4, 5)], impulseX: 0.5, turnFrames: 12 });
    expect(p.up).toMatchObject({ landing: 30 });
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, drift = 0, landing = 0;
    for (let i = 0; i < 90; i++) {
      step({ x: 1 });
      peak = Math.max(peak, f().y); drift = Math.max(drift, f().special?.lizardon?.drift.x ?? 0);
      if (f().state === 'landing') landing = Math.max(landing, f().landingFrames);
    }
    expect(peak).toBeGreaterThan(40);
    expect(peak).toBeLessThan(55);
    // ftCommon_8007D3A8 caps the drift at aerial_drift_max × x74.
    expect(drift).toBeCloseTo(f().content.profile.attributes.airDriftMax * p.up.driftMax, 3);
    expect(landing).toBe(30);
  });
  it('Charizard rushes on root motion for x54 frames and hits for 16%', () => {
    make('Lz', 40);
    step({ special: true, x: 1, specialDirection: 'side' });
    let top = 0;
    for (let i = 0; i < 50 && f().special; i++) { step(); top = Math.max(top, Math.abs(f().velocity.x)); }
    expect(other().percent).toBe(16);
    expect(top).toBeGreaterThan(2.5);
    expect(f().special?.lizardon?.state).toBe('SEnd');
  });
  it('Rock Smash holds a rock and bursts five 3% fragments on the script flags', () => {
    make('Lz', 18);
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    expect(game.projectiles.items.filter((item) => item.kind === 'lizardon-rock')).toHaveLength(1);
    let bursts = 0;
    for (let i = 0; i < 70; i++) { step(); bursts += game.events.filter((e) => e.type === 'shot' && e.projectileKind === 'lizardon-burst').length; }
    expect(bursts).toBe(5);
    expect(other().percent).toBe(15);
    // The rock item dies with the motion (its anim callback checks the owner's state).
    expect(f().special).toBeNull();
    expect(game.projectiles.items.some((item) => item.kind === 'lizardon-rock')).toBe(false);
  });
  it('Sonic spin charge levels up on mashed B and runs at the level speed and damage', () => {
    make('Sn', 90);
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    // Mash B every 8 frames: level 0 after the x CC delay, +1 per x C8 cooldown.
    for (let i = 0; i < 48; i++) step({ y: -1, down: true, special: i % 8 === 7 });
    expect(f().special?.sonic?.level).toBe(1);
    step(); // letting go of down releases the run
    expect(f().special?.sonic?.state).toBe('LwRun');
    let top = 0;
    for (let i = 0; i < 40 && other().percent === 0; i++) { step(); top = Math.max(top, Math.abs(f().velocity.x)); }
    expect(top).toBeCloseTo(3.25, 3); // attrs xF4, the level-1 run speed
    expect(other().percent).toBe(6);  // x138 4 → x13C 8 scaled by level 1 of 2
  });
  it('Spring Jump leaves a spring that bounces the next fighter to land on it', () => {
    make('Sn');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, sawHelpless = false;
    const spring = () => game.projectiles.items.find(p => p.kind === 'sonic-spring');
    expect(spring()?.sonicSpring?.phase).toBe('idle');
    for (let i = 0; i < 60; i++) { step(); peak = Math.max(peak, f().y); sawHelpless ||= f().state === 'helpless'; }
    expect(peak).toBeGreaterThan(35);
    expect(sawHelpless).toBe(true);
    // Mario drops onto the idle spring: Spring_JumpedOn sends him up at the spring's strength.
    const at = spring()!;
    other().x = at.x; other().y = at.y + 2; other().grounded = false; other().floor = null; other().state = 'fall'; other().velocity = { x: 0, y: -1 };
    step();
    expect(other().state).toBe('airjump');
    expect(other().velocity.y).toBeGreaterThan(1);
  });

});
