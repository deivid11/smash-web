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

describe('LucasTDX/ShadowMewtwo/LuigiBoo/MetalMario/SkullKid registration', () => {
  it('reserves public-roster selectors 47-51, room entries and bounded extension assets', () => {
    expect(ROSTER_CHOICES[47]).toBe('Lc2'); expect(ROSTER_CHOICES[48]).toBe('Sm'); expect(ROSTER_CHOICES[49]).toBe('Lb');
    expect(ROSTER_CHOICES[50]).toBe('MM'); expect(ROSTER_CHOICES[51]).toBe('Sd');
    for (const kind of ['Lc2', 'Sm', 'Lb', 'MM', 'Sd'] as const) expect(ROOM_FIGHTERS).toContain(kind);
    for (const name of ['PlLc2.dat', 'PlLc2AJ.dat', 'PlLc2Nr.dat', 'EfLc2Data.dat', 'audio/us/lucas_001.ssm',
      'PlSm.dat', 'PlSmAJ.dat', 'PlSmNr.dat', 'audio/us/smewtwo.ssm',
      'PlLb.dat', 'PlLbAJ.dat', 'PlLbNr.dat', 'audio/us/luigiandboo.ssm',
      'PlMM.dat', 'PlMMNr.dat', 'PlMMAJ.dat',
      'PlSd.dat', 'PlSdAJ.dat', 'PlSdNr.dat', 'audio/us/skullkid.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
    // Sm/Lb/MM share vanilla Mewtwo/Luigi/Mario banks; Sd falls back to common.
    for (const name of ['EfMtData.dat', 'EfLgData.dat', 'EfMrData.dat', 'EfCoData.dat']) expect(SERVER_ASSETS).toContain(name);
    expect(ACE_ASSETS).not.toContain('EfSmData.dat');
  });
  it('ships literal ACE 2.0 bone tables with every part owning a joint', () => {
    expect(MODDED_BONE_TABLES.Lc2.count).toBe(63); expect(MODDED_BONE_TABLES.Sm.count).toBe(68);
    expect(MODDED_BONE_TABLES.Lb.count).toBe(61); expect(MODDED_BONE_TABLES.MM.count).toBe(61);
    expect(MODDED_BONE_TABLES.Sd.count).toBe(63);
    for (const table of [MODDED_BONE_TABLES.Lc2, MODDED_BONE_TABLES.Sm, MODDED_BONE_TABLES.Lb, MODDED_BONE_TABLES.MM, MODDED_BONE_TABLES.Sd]) {
      expect(table.map).toHaveLength(54); expect(table.virtualParts).toHaveLength(0); expect(table.jointCount).toBe(table.count);
    }
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE wave-5 integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (kind: 'Lc2' | 'Sm' | 'Lb' | 'MM' | 'Sd', gap = 20) => {
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
    for (const [kind, joints] of [['Lc2', 63], ['Sm', 68], ['Lb', 61], ['MM', 61], ['Sd', 63]] as const) {
      make(kind);
      expect(f().content.profile.boneCount).toBe(joints);
      expect(f().content.model.roots[0]!.joints.length).toBe(joints);
      expect(base.sound.banks.some(b => b.base === ({ Lc2: 2730, Sm: 2014, Lb: 2206, MM: 783, Sd: 2048 } as const)[kind])).toBe(true);
      step({ attack: true });
      expect(f().state).toBe('attack');
      const snapshot = game.captureState();
      for (let i = 0; i < 8; i++) step({ attack: true });
      game.restoreState(snapshot);
    }
  });
  it('Lucas TDX freezes, fires and rockets; magnet holds', () => {
    make('Lc2', 40);
    step({ special: true });
    for (let i = 0; i < 5; i++) step({ special: true });
    step({});
    let sawFreeze = false;
    for (let i = 0; i < 70; i++) { step(); sawFreeze ||= game.projectiles.items.some(p => p.kind === 'lucas-freeze'); }
    expect(sawFreeze).toBe(true);
    make('Lc2', 20);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 100; i++) step();
    expect(other().percent).toBe(3);
    make('Lc2');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless' || f().state === 'landing'; }
    expect(peak).toBeGreaterThan(25);
    expect(helpless).toBe(true);
    make('Lc2');
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 20; i++) step({ special: true });
    expect(f().special?.direction).toBe('down');
  });
  it('reads Lucas TDX PSI parameters straight from PlLc2 instead of inventing them', () => {
    // Unlike the Wave-3 clones, PlLc2's ftNessAttributes block sits exactly at ftData x4 and is
    // clean end to end: PK Fire 3.0 flat, PK Thunder landing lag 17, Ness's TransN magnet bubble.
    make('Lc2');
    const p = f().content.specials.parameters;
    if (p.kind !== 'Lc') throw new Error('wrong parameters');
    expect(p.side.shotSpeed).toBeCloseTo(3, 5); expect(p.side.airSpeed).toBeCloseTo(3, 5);
    expect(p.side.shotAngle).toBeCloseTo(0, 5); expect(p.up.landing).toBe(17);
    expect(p.down.absorb.radius).toBeCloseTo(8.5, 5); expect(p.down.absorb.offset).toEqual([0, 6.5, 0]);
    expect(p.down.healMul).toBeCloseTo(1, 5);
    const effects = f().content.specials.effects;
    for (const name of ['pk-thunder-aura', 'pk-thunder-2-aura', 'psi-magnet']) {
      expect(effects.get(name)?.stats.meshes ?? 0).toBeGreaterThan(0);
    }
  });
  it('Shadow Mewtwo balls, confuses, teleports and disables up close', () => {
    make('Sm', 40);
    step({ special: true });
    for (let i = 0; i < 40; i++) step();
    step({ special: true });
    let sawBall = false;
    for (let i = 0; i < 70; i++) { step(); sawBall ||= game.projectiles.items.some(p => p.kind === 'shadow-ball'); }
    expect(sawBall).toBe(true);
    expect(other().percent).toBe(1);
    make('Sm');
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 70; i++) step();
    expect(f().special === null || f().state !== 'ko').toBe(true);
    make('Sm');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 40; i++) { step(); peak = Math.max(peak, Math.hypot(f().x, f().y)); }
    expect(peak).toBeGreaterThan(20);
    make('Sm', 8);
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 40; i++) step();
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Luigi & Boo pills, missiles, punches and cyclones', () => {
    make('Lb', 40);
    step({ special: true });
    let sawPill = false;
    for (let i = 0; i < 70; i++) { step(); sawPill ||= game.projectiles.items.some(p => p.kind === 'fireball'); }
    expect(sawPill).toBe(true);
    expect(other().percent).toBe(6);
    // Proven recipe: jump, air side at gap 20, hold 10, release — the
    // deterministic-seed misfire meets the rival mid-flight (grounded non-
    // misfire Fly carries no hitbox, so gap-8 ground taps stay RNG dependent).
    make('Lb', 20);
    step({ jump: true });
    for (let i = 0; i < 12 && f().grounded; i++) step();
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 10; i++) step({ special: true, x: 1 });
    for (let i = 0; i < 50; i++) step();
    expect(other().percent).toBeGreaterThan(0);
    make('Lb');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(25);
    make('Lb', 8);
    step({ jump: true });
    for (let i = 0; i < 14 && f().grounded; i++) step();
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 35; i++) step(i % 4 === 0 ? { special: true, y: -1 } : {});
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Metal Mario fireballs, bashes, punches and spins', () => {
    make('MM', 40);
    step({ special: true });
    let sawFire = false;
    for (let i = 0; i < 70; i++) { step(); sawFire ||= game.projectiles.items.some(p => p.kind === 'fireball'); }
    expect(sawFire).toBe(true);
    expect(other().percent).toBe(15);
    make('MM', 8);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 40; i++) step();
    expect(other().percent).toBeGreaterThan(0);
    make('MM');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(25);
    make('MM', 8);
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 40; i++) step();
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Skull Kid pulls, throws and detonates his bomb (hitless), then waits out the cooldown', () => {
    make('Sd', 40);
    const bomb = () => game.projectiles.items.find(p => p.kind === 'skull-bomb');
    step({ special: true });
    for (let i = 0; i < 30; i++) step();
    // fn_03e88: the pull (script flag 24 at frame 17) puts the bomb in his hand and spends the ammo.
    expect(bomb()?.skull?.state).toBe(1); expect(f().skullkid.ammo).toBe(0);
    // B with the bomb in hand does nothing (SpecialN only resets the facing).
    step({ special: true }); step();
    expect(f().special).toBeNull();
    step({ attack: true, x: 0.3 });
    for (let i = 0; i < 45 && bomb()?.skull?.state !== 4; i++) step();
    expect(bomb()?.skull?.state).toBe(4);
    step({ special: true });
    expect(f().animation).toBe('SpecialNHold');
    for (let i = 0; i < 25; i++) step();
    expect(bomb()).toBeUndefined();
    expect(other().percent).toBe(0);
    for (let i = 0; i < 300; i++) step();
    expect(f().skullkid.ammo).toBe(1);
  });
  it('Skull Kid spins, warps, cone-teleports, poses and floats as the compiled kit does', () => {
    // SpecialS: the three script hits (frames 35/40/45), then sub_037f4's intangible warp.
    make('Sd', 8);
    step({ special: true, x: 1, specialDirection: 'side' });
    let warped = false, intangible = false;
    // Point-blank, the hits' hitlag stretches the spin past its 50 frames.
    for (let i = 0; i < 100; i++) { step(); warped ||= f().special?.skullkid?.state === 'SideWarp'; if (f().special?.skullkid?.state === 'SideWarp' && f().special!.skullkid!.warp < 15) intangible ||= f().invulnerable > 0; }
    expect(other().percent).toBeGreaterThan(0); expect(warped).toBe(true); expect(intangible).toBe(true);
    // SpecialHi: the neutral stick launches at the upward cone's x2FFC edge into special fall.
    make('Sd');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0, helpless = false;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); helpless ||= f().state === 'helpless'; if (f().special?.skullkid?.state === 'UpWarp') expect(f().velocity.x).toBeCloseTo(1.5 * Math.cos(1.23), 3); }
    expect(peak).toBeGreaterThan(25); expect(helpless).toBe(true);
    // SpecialLw: a 60-frame pose with no hitbox.
    make('Sd', 8);
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 70; i++) step();
    expect(other().percent).toBe(0); expect(f().state).toBe('idle');
    // enterfloat: holding jump through the apex hovers in SpecialHi, once per airtime.
    make('Sd');
    let floated = 0;
    for (let i = 0; i < 90; i++) { step({ jump: true }); if (f().animation === 'SpecialHi') floated++; }
    expect(floated).toBeGreaterThan(50); expect(floated).toBeLessThanOrEqual(60);
    expect(f().skullkid.floatUsed).toBe(true);
  });
});
