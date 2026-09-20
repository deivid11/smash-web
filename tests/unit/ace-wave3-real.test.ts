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
import { reflector } from '../../lib/game/specials.ts';

describe('Blastoise/Lucas/Metal/Ninten/Daisy registration', () => {
  it('reserves public-roster selectors 37-41, room entries and bounded extension assets', () => {
    expect(ROSTER_CHOICES[37]).toBe('Bl'); expect(ROSTER_CHOICES[38]).toBe('Lc'); expect(ROSTER_CHOICES[39]).toBe('Nm');
    expect(ROSTER_CHOICES[40]).toBe('Nt'); expect(ROSTER_CHOICES[41]).toBe('Da');
    for (const kind of ['Bl', 'Lc', 'Nm', 'Nt', 'Da'] as const) expect(ROOM_FIGHTERS).toContain(kind);
    for (const name of ['PlBl.dat', 'PlBlAJ.dat', 'PlBlNr.dat', 'EfBlData.dat', 'audio/us/blastoise.ssm',
      'PlLc.dat', 'PlLcAJ.dat', 'PlLcNr.dat', 'EfLcData.dat', 'audio/us/lucas.ssm',
      'PlNm.dat', 'PlNmAJ.dat', 'PlNmNr.dat', 'EfNmData.dat', 'audio/us/metal_sonic.ssm',
      'PlNt.dat', 'PlNtAJ.dat', 'PlNtNr.dat', 'EfNtData.dat', 'audio/us/ninten.ssm',
      'PlDa.dat', 'PlDaAJ.dat', 'PlDaNr.dat', 'audio/us/daisy.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
    // Daisy shares Peach's vanilla effect bank (no extension Ef needed).
    expect(ACE_ASSETS).not.toContain('EfPeData.dat');
  });
  it('ships literal ACE 2.0 bone tables with every part owning a joint', () => {
    expect(MODDED_BONE_TABLES.Bl.count).toBe(76); expect(MODDED_BONE_TABLES.Lc.count).toBe(66);
    expect(MODDED_BONE_TABLES.Nm.count).toBe(73); expect(MODDED_BONE_TABLES.Nt.count).toBe(66);
    expect(MODDED_BONE_TABLES.Da.count).toBe(114);
    for (const table of [MODDED_BONE_TABLES.Bl, MODDED_BONE_TABLES.Lc, MODDED_BONE_TABLES.Nm, MODDED_BONE_TABLES.Nt, MODDED_BONE_TABLES.Da]) {
      expect(table.map).toHaveLength(54); expect(table.virtualParts).toHaveLength(0); expect(table.jointCount).toBe(table.count);
    }
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE wave-3 integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (kind: 'Bl' | 'Lc' | 'Nm' | 'Nt' | 'Da', gap = 20) => {
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

  it('loads all five with skeletons, jabs, voices and rollback-safe state', () => {
    for (const [kind, joints] of [['Bl', 76], ['Lc', 66], ['Nm', 73], ['Nt', 66], ['Da', 114]] as const) {
      make(kind);
      expect(f().content.profile.boneCount).toBe(joints);
      expect(f().content.model.roots[0]!.joints.length).toBe(joints);
      expect(base.sound.banks.some(b => b.base === ({ Bl: 2471, Lc: 1670, Nm: 2320, Nt: 2281, Da: 1948 } as const)[kind])).toBe(true);
      step({ attack: true });
      expect(f().state).toBe('attack');
      const snapshot = game.captureState();
      for (let i = 0; i < 8; i++) step({ attack: true });
      game.restoreState(snapshot);
    }
  });
  it('Blastoise sprays water, bashes and pumps', () => {
    make('Bl', 40);
    step({ special: true });
    let sawWater = false;
    for (let i = 0; i < 60; i++) { step(); sawWater ||= game.projectiles.items.some(p => p.kind === 'blastoise-water'); }
    expect(sawWater).toBe(true);
    expect(other().percent).toBe(12);
    make('Bl');
    const start = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 45; i++) step();
    expect(Math.abs(f().x - start)).toBeGreaterThan(25);
    expect(other().percent).toBeGreaterThan(0);
    make('Bl');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless'; }
    expect(peak).toBeGreaterThan(25);
    expect(helpless).toBe(true);
  });
  it('Blastoise ice-hits seal the victim in a block instead of launching them', () => {
    make('Bl');
    step({ special: true, x: 1, specialDirection: 'side' });
    let froze = -1;
    for (let i = 1; i <= 60 && froze < 0; i++) { step(); if (other().state === 'frozen') froze = i; }
    expect(froze).toBeGreaterThan(0);
    // ftCo_DamageIce_Init: the mash-out timer is the hit's own damage x the common scale.
    expect(other().ice!.timer).toBeCloseTo(9 * base.combat.ice.timerScale, 4);
    expect(other().hitstun).toBe(0);
    let thawed = -1;
    for (let i = 1; i <= 240 && thawed < 0; i++) { step(); if (other().state !== 'frozen') thawed = i; }
    expect(thawed).toBeGreaterThan(90); expect(other().ice).toBeNull();
  });
  it('Lucas freezes, fires and rockets; magnet holds', () => {
    make('Lc', 40);
    step({ special: true });
    for (let i = 0; i < 5; i++) step({ special: true });
    step({});
    let sawFreeze = false;
    for (let i = 0; i < 70; i++) { step(); sawFreeze ||= game.projectiles.items.some(p => p.kind === 'lucas-freeze'); }
    expect(sawFreeze).toBe(true);
    make('Lc', 20);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 60; i++) step();
    expect(other().percent).toBe(3);
    make('Lc');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless' || f().state === 'landing'; }
    expect(peak).toBeGreaterThan(25);
    expect(helpless).toBe(true);
    make('Lc');
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 20; i++) step({ special: true });
    expect(f().special?.direction).toBe('down');
  });
  it('reads the real PSI attribute block and PSI effect models for both Ness clones', () => {
    // PlLc/PlNt keep a genuine ftNessAttributes block 0x18 bytes past ftData x4: Melee's own
    // PK Fire trajectories (grounded -0.0628 rad, aerial -0.6632) instead of invented flat shots.
    for (const kind of ['Lc', 'Nt'] as const) {
      make(kind);
      const p = f().content.specials.parameters;
      if (p.kind !== 'Lc' && p.kind !== 'Nt') throw new Error('wrong parameters');
      expect(p.side.shotAngle).toBeCloseTo(-0.06283, 4);
      expect(p.side.airAngle).toBeCloseTo(-0.66323, 4);
      expect(p.side.shotSpeed).toBeGreaterThan(0);
      expect(p.up.landing).toBe(15);
      // Their effect banks carry Ness's own three PSI model descriptors at 0-2.
      const effects = f().content.specials.effects;
      for (const name of ['pk-thunder-aura', 'pk-thunder-2-aura', 'psi-magnet']) {
        expect(effects.get(name)?.stats.meshes ?? 0).toBeGreaterThan(0);
      }
    }
  });
  it('Metal Sonic reads the Fox block and PlNm rodata the original code does', () => {
    make('Nm');
    const p = f().content.specials.parameters;
    if (p.kind !== 'Nm') throw new Error('expected Metal Sonic');
    expect([p.neutral.weakFrom, p.neutral.weakTo, p.neutral.strongFrom, p.neutral.strongTo]).toEqual([10, 14, 15, 141]);
    expect([p.neutral.strongSpeed, p.neutral.weakSpeed, p.neutral.weakLife, p.neutral.selfDamage, p.neutral.landing, p.neutral.bone]).toEqual([7, 5, 8, 8, 15, 22]);
    expect(p.side.frames).toEqual([120, 105, 90, 75, 60, 45, 30, 15]);
    expect(p.side.speeds).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
    expect([p.side.gravityDelay, p.side.divisor, p.side.landing, p.side.airCancelLanding]).toEqual([15, 1.5, 20, 10]);
    expect([p.up.travel, p.up.boundFrames, p.up.landing, p.up.groundLanding]).toEqual([20, 15, 18, 20]);
    expect(p.up.speed).toBeCloseTo(3.8, 5);
    expect([p.down.releaseLag, p.down.gravityDelay, p.down.divisor]).toEqual([18, 4, 2]);
    expect([p.down.reflect.radius, p.down.reflect.maxDamage, p.down.reflect.damageMultiplier]).toEqual([8.5, 50, 1.5]);
    const shot = f().content.specials.articles.metal!.shot;
    expect([shot.lifetime, shot.hit!.damage]).toEqual([35, 7]);
  });
  it('Metal Sonic hovers on neutral B: a tap fires the weak shot, a release the strong one', () => {
    const shotAfter = (ticks: number, input: Partial<PlayerInput> = {}) => {
      let shot: { vx: number; life: number } | undefined, landed = 0;
      for (let i = 0; i < ticks; i++) {
        step(input); const item = game.projectiles.items.find(p => p.kind === 'metal-shot');
        if (item && !shot) shot = { vx: item.vx, life: item.life };
        if (!landed && f().state === 'landing') landed = f().landingFrames;
      }
      return { shot, landed };
    };
    // From the ground the hover never clears the End's fall: the landing on End frame 4 (M346's
    // LandingFallSpecial) resets accessory4_cb before the weak shot's callback runs.
    make('Nm', 120);
    step({ special: true });
    expect(f().special?.metal?.motion).toBe('SpecialAirNStart');
    step();
    expect(f().grounded).toBe(false);
    expect(f().jumpsUsed).toBe(1);
    const ground = shotAfter(30);
    expect(ground.shot).toBe(undefined);
    expect(ground.landed).toBe(15);
    // In the air the tap ends at frame 10 and fires the weak shot on End frame 4.
    make('Nm', 120);
    step({ jump: true });
    for (let i = 0; i < 8; i++) step();
    step({ special: true });
    const air = shotAfter(20);
    expect(air.shot?.vx).toBe(5);
    expect(air.shot!.life).toBeLessThanOrEqual(8);
    // A release inside [15, 141] fires the strong shot (x0 lifetime) and recoils.
    make('Nm', 120);
    step({ special: true });
    for (let i = 0; i < 30; i++) step({ special: true });
    expect(f().y).toBeGreaterThan(2);
    const strong = shotAfter(12);
    expect(strong.shot?.vx).toBe(7);
    expect(strong.shot!.life).toBeGreaterThan(30);
    for (let i = 0; i < 40; i++) step();
    expect(f().special).toBe(null);
    expect(f().state).not.toBe('helpless');
  });
  it('Metal Sonic charges neutral B into the burst, paying 8% for it', () => {
    make('Nm', 8);
    step({ special: true });
    let loopAt = -1;
    for (let i = 0; i < 160 && loopAt < 0; i++) { step({ special: true }); if (f().special?.metal?.motion === 'SpecialAirNLoop') loopAt = i; }
    expect(loopAt).toBeGreaterThan(140);
    let landed = 0;
    for (let i = 0; i < 40; i++) { step({ special: true }); if (!landed && f().state === 'landing') landed = f().landingFrames; }
    expect(f().percent).toBe(8);
    expect(other().percent).toBe(24);
    // The burst falls at 0.17 from the hover height and lands into M345_Coll's lag.
    expect(landed).toBe(15);
  });
  it('Metal Sonic charges the spin dash on side B and dashes at the rung speed', () => {
    make('Nm', 40);
    step({ special: true, x: 1, specialDirection: 'side' });
    expect(f().special?.metal?.motion).toBe('SpecialSStart');
    for (let i = 0; i < 40; i++) step({ special: true });
    step();
    // Released at frame 41: the [30, 45) rung, 3 units a frame.
    expect(f().special?.metal?.motion).toBe('SpecialS');
    expect(f().velocity.x).toBe(3);
    let landing = 0;
    for (let i = 0; i < 40 && !landing; i++) { step(); if (f().state === 'landing') landing = f().landingFrames; }
    expect(landing).toBe(20);
    expect(other().percent).toBe(14);
    // Holding B freezes the charge at frame 120; shield cancels it on the ground.
    make('Nm', 120);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 130; i++) step({ special: true });
    expect(f().animationFrame).toBe(120);
    step({ special: true, shield: true });
    expect(f().special).toBe(null);
  });
  it('Metal Sonic holds still, then fires the firefox up into special fall', () => {
    make('Nm');
    step({ special: true, y: 1, specialDirection: 'up' });
    expect(f().special?.metal?.motion).toBe('SpecialHiHold');
    let launch = 0, peak = 0, helpless = false;
    for (let i = 0; i < 120; i++) {
      step();
      if (!launch && f().special?.metal?.motion === 'SpecialAirHi') { launch = i; expect(f().velocity.y).toBeCloseTo(3.8, 4); }
      peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless';
    }
    expect(launch).toBe(42);
    expect(peak).toBeGreaterThan(50);
    expect(helpless).toBe(true);
    // A sideways stick at the hold's end travels along the floor, then lands in the x20 lag.
    make('Nm', 120);
    step({ special: true, y: 1, specialDirection: 'up' });
    for (let i = 0; i < 43; i++) step({ x: 1 });
    expect(f().special?.metal?.motion).toBe('SpecialHi');
    expect(f().grounded).toBe(true);
    let landing = 0;
    for (let i = 0; i < 30 && !landing; i++) { step(); if (f().state === 'landing') landing = f().landingFrames; }
    expect(landing).toBe(20);
  });
  it('Metal Sonic spins the reflector gyro until B is released past the lag', () => {
    make('Nm', 8);
    step({ special: true, y: -1, specialDirection: 'down' });
    expect(f().special?.metal?.motion).toBe('SpecialLwStart');
    for (let i = 0; i < 8; i++) step({ special: true });
    expect(f().special?.metal?.motion).toBe('SpecialLwLoop');
    expect(reflector(f())?.radius).toBe(8.5);
    for (let i = 0; i < 30; i++) step({ special: true });
    expect(other().percent).toBeGreaterThan(0);
    step();
    expect(f().special?.metal?.motion).toBe('SpecialLwEnd');
    expect(reflector(f())).toBe(null);
    for (let i = 0; i < 25; i++) step();
    expect(f().special).toBe(null);
    // A reflected fireball turns the gyro into SpecialLwHit and changes hands.
    make('Nm', 60);
    step({ special: true, y: -1, specialDirection: 'down' });
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) { step({ special: true }, i === 9 ? { special: true } : {}); hit = f().special?.metal?.motion === 'SpecialLwHit'; }
    expect(hit).toBe(true);
    expect(game.projectiles.items.find(p => p.kind === 'fireball')?.owner).toBe(0);
  });
  it('Ninten hypnotizes (no damage), slingshots and rockets; magnet holds', () => {
    make('Nt');
    step({ special: true });
    for (let i = 0; i < 20; i++) step({ special: true });
    expect(f().special?.direction).toBe('neutral');
    make('Nt', 20);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 60; i++) step();
    expect(other().percent).toBe(3);
    make('Nt');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless' || f().state === 'landing'; }
    expect(peak).toBeGreaterThan(25);
    expect(helpless).toBe(true);
  });
  it('Daisy runs the Peach kit on her own attributes and articles', () => {
    make('Da');
    const p = f().content.specials.parameters;
    if (p.kind !== 'Da') throw new Error('wrong parameters');
    expect(p.float.duration).toBe(70);
    expect(p.bomber.velX).toBeCloseTo(4.7, 5);
    expect(p.bomber.endVelY).toBeCloseTo(1.8, 5);
    const articles = f().content.specials.articles.peach!;
    expect(articles.explosion.hit).not.toBeNull();
    expect(articles.turnip.faces.some(face => face.damage > 0)).toBe(true);
    // Toad plays the figatrees named SpecialLw*, the turnip pull the one named SpecialN.
    expect(f().content.timelines.get('SpecialN')!.events.some(e => e.type === 'command' && e.index === 1)).toBe(true);
  });
  it('Daisy Bomber launches, detects Mario and detonates the explosion rebound', () => {
    make('Da', 40);
    step({ special: true, x: 1, specialDirection: 'side' });
    let launched = false, rebounded = false;
    for (let i = 0; i < 60 && !rebounded; i++) { step(); launched ||= f().animation === 'SpecialSJump'; rebounded = f().animation === 'SpecialAirSEnd1'; }
    expect(launched).toBe(true);
    expect(rebounded).toBe(true);
    expect(game.projectiles.items.some(p => p.kind === 'peach-blast') || other().percent > 0).toBe(true);
    let hit = other().percent > 0;
    for (let i = 0; i < 20 && !hit; i++) { step(); hit = other().percent > 0; }
    expect(hit).toBe(true);
    for (let i = 0; i < 120 && f().special; i++) step();
    expect(f().state).not.toBe('helpless'); // AirSEnd drops into an ordinary Fall.
  });
  it('Daisy Bomber whiffs into AirSEnd0 without an explosion', () => {
    make('Da', 400);
    const start = f().x;
    step({ special: true, x: 1, specialDirection: 'side' });
    let whiff = false;
    for (let i = 0; i < 90 && !whiff; i++) { step(); whiff = f().animation === 'SpecialAirSEnd0' || f().animation === 'SpecialSEnd'; }
    expect(whiff).toBe(true);
    expect(f().x - start).toBeGreaterThan(25);
    expect(game.projectiles.items.some(p => p.kind === 'peach-blast')).toBe(false);
  });
  it('Daisy counters with Toad on B and plucks a turnip on down-B', () => {
    make('Da', 9);
    step({ special: true, specialDirection: 'neutral' });
    step({ special: true });
    for (let i = 0; i < 12 && f().special?.phase === 'start'; i++) step({}, { attack: i === 0 });
    expect(f().animation).toMatch(/SpecialNHit/);
    let spores = 0;
    for (let i = 0; i < 40; i++) { step(); spores += game.events.filter(e => e.type === 'shot' && e.projectileKind === 'toad-spore').length; }
    expect(spores).toBe(7);
    expect(f().content.specials.articles.peach!.toad.toadHit.roots.length).toBeGreaterThan(0);
    make('Da', 60);
    step({ special: true, specialDirection: 'down' });
    for (let i = 0; i < 80 && f().peachTurnip === null; i++) step();
    expect(f().peachTurnip).not.toBeNull();
  });
  it('Daisy floats for her 70 frames and opens the parasol', () => {
    make('Da');
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 60;
    f().jumpsUsed = f().content.profile.attributes.maxJumps; f().velocity.y = -0.5;
    for (let i = 0; i < 5; i++) step({ jump: true });
    expect(f().animation).toBe('Fuwafuwa');
    let frames = 0;
    for (let i = 0; i < 100 && f().animation === 'Fuwafuwa'; i++) { step({ jump: true }); frames++; }
    expect(frames).toBeGreaterThan(60); expect(frames).toBeLessThan(75);
    make('Da');
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 40;
    step({ special: true, specialDirection: 'up' });
    let open = false;
    for (let i = 0; i < 80 && !open; i++) { step(); open = f().animation === 'ItemParasolOpen'; }
    expect(open).toBe(true);
  });
});
