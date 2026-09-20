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

describe('Fay/BSonic/DrLuigi/Knuckles/Lucina registration', () => {
  it('reserves public-roster selectors 42-46, room entries and bounded extension assets', () => {
    expect(ROSTER_CHOICES[42]).toBe('Fy'); expect(ROSTER_CHOICES[43]).toBe('Sc'); expect(ROSTER_CHOICES[44]).toBe('Dl');
    expect(ROSTER_CHOICES[45]).toBe('Kx'); expect(ROSTER_CHOICES[46]).toBe('Lu');
    for (const kind of ['Fy', 'Sc', 'Dl', 'Kx', 'Lu'] as const) expect(ROOM_FIGHTERS).toContain(kind);
    for (const name of ['PlFy.dat', 'PlFyAJ.dat', 'PlFyNr.dat', 'audio/us/fay.ssm',
      'PlSc.dat', 'PlScAJ.dat', 'PlScNr.dat', 'EfScData.dat', 'audio/us/bmsonic.ssm',
      'PlDl.dat', 'PlDlAJ.dat', 'PlDlNr.dat', 'audio/us/drluigi.ssm',
      'PlKx.dat', 'PlKxAJ.dat', 'PlKxNr.dat', 'EfKxData.dat', 'audio/us/knuckles.ssm',
      'PlLu.dat', 'PlLuAJ.dat', 'PlLuNr.dat', 'audio/us/lucina.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
    // Fay, DrLuigi and Lucina share vanilla effect banks (no extension Ef).
    for (const name of ['EfFxData.dat', 'EfLgData.dat', 'EfMsData.dat']) expect(SERVER_ASSETS).toContain(name);
  });
  it('ships literal ACE 2.0 bone tables with every part owning a joint', () => {
    expect(MODDED_BONE_TABLES.Fy.count).toBe(73); expect(MODDED_BONE_TABLES.Sc.count).toBe(68);
    expect(MODDED_BONE_TABLES.Dl.count).toBe(61); expect(MODDED_BONE_TABLES.Kx.count).toBe(71);
    expect(MODDED_BONE_TABLES.Lu.count).toBe(90);
    for (const table of [MODDED_BONE_TABLES.Fy, MODDED_BONE_TABLES.Sc, MODDED_BONE_TABLES.Dl, MODDED_BONE_TABLES.Kx, MODDED_BONE_TABLES.Lu]) {
      expect(table.map).toHaveLength(54); expect(table.virtualParts).toHaveLength(0); expect(table.jointCount).toBe(table.count);
    }
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('ACE wave-4 integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (kind: 'Fy' | 'Sc' | 'Dl' | 'Kx' | 'Lu', gap = 20) => {
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

  it('starts Black Sonic and Knuckles on their own spawn-time part visibility', () => {
    // sc-full.asm 0x104-0x190: ftParts_80074A4C hides groups 1, 2, 4, 5, 7, 8 and 9 before any script.
    make('Sc'); rig.sample(f());
    const hidden = rig.actors[0]!.hiddenDobjs;
    expect(hidden.has(17)).toBe(true); // group 9, the Spin Dash ball (a 9.6 sphere)
    for (const dobj of [0, 2, 5, 7, 11, 14]) expect(hidden.has(dobj)).toBe(false); // body + group 3/6 overlays
    for (const dobj of [9, 10, 12, 13, 15, 16]) expect(hidden.has(dobj)).toBe(true);
    // The Spin Dash script turns group 9 back on, so the ball still shows where it belongs.
    step({ special: true, down: true, specialDirection: 'down' });
    let ball = false;
    for (let i = 0; i < 40 && !ball; i++) { step({ down: true }); rig.sample(f()); ball = !rig.actors[0]!.hiddenDobjs.has(17); }
    expect(ball).toBe(true);
    // Sonic-family spawn routine: group 3 (the second hand set) starts on -1, i.e. hidden.
    make('Kx'); rig.sample(f());
    for (const dobj of [47, 43, 44, 48, 42]) expect(rig.actors[0]!.hiddenDobjs.has(dobj)).toBe(true);
    expect(rig.actors[0]!.hiddenDobjs.has(45)).toBe(false);
  });
  it('loads all five with skeletons, jabs, voices and rollback-safe state', () => {
    for (const [kind, joints] of [['Fy', 73], ['Sc', 68], ['Dl', 61], ['Kx', 71], ['Lu', 90]] as const) {
      make(kind);
      expect(f().content.profile.boneCount).toBe(joints);
      expect(f().content.model.roots[0]!.joints.length).toBe(joints);
      expect(base.sound.banks.some(b => b.base === ({ Fy: 2083, Sc: 2173, Dl: 2246, Kx: 2360, Lu: 2430 } as const)[kind])).toBe(true);
      step({ attack: true });
      expect(f().state).toBe('attack');
      const snapshot = game.captureState();
      for (let i = 0; i < 8; i++) step({ attack: true });
      game.restoreState(snapshot);
    }
  });
  it('Fay blasts, snipes, rises and reflects', () => {
    make('Fy', 40);
    step({ special: true });
    let sawLaser = false;
    for (let i = 0; i < 60; i++) { step(); sawLaser ||= game.projectiles.items.some(p => p.kind === 'fay-laser'); }
    expect(sawLaser).toBe(true);
    expect(other().percent).toBe(3);
    make('Fy', 20);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 40; i++) step();
    expect(other().percent).toBe(15);
    make('Fy');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(25);
    make('Fy', 8);
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 30; i++) step({ special: true });
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Black Sonic runs his decoded PlSc code: homing attack, dash, spring jump, spin dash', () => {
    make('Sc', 20);
    // ftDataBSonic special_attributes: only the Spin Dash reads them (level cap, speed, damage).
    const p = f().content.specials.parameters;
    if (p.kind !== 'Sc') throw new Error('Black Sonic parameters missing.');
    expect(p.down).toEqual({ maxLevel: 5, rollSpeed: Math.fround(1.9), rollSpeedPerLevel: Math.fround(0.3), damage: 8, damagePerLevel: 2 });
    const spring = f().content.specials.articles.bsonic!.spring;
    expect([spring.gravity, spring.terminal, spring.bounce]).toEqual([Math.fround(0.036), Math.fround(1.65), Math.fround(0.85)]);
    expect(spring.airHit).toMatchObject({ damage: 6, angle: 60, growth: 60, base: 40 });

    // Homing attack: the 26-frame start rises on root motion, then SpecialN locks onto the rival's
    // hip (within 45) and flies at 3; the 8% hit bounces him into SpecialNEnd, which falls (not helpless).
    step({ special: true });
    for (let i = 0; i < 26; i++) step();
    expect(f().special?.bsonic?.state).toBe('N');
    expect(f().special?.bsonic?.targetSlot).toBe(1);
    expect(Math.hypot(f().velocity.x, f().velocity.y)).toBeCloseTo(3, 4);
    for (let i = 0; i < 20 && other().percent === 0; i++) step();
    expect(other().percent).toBe(8);
    expect(f().special?.bsonic?.state).toBe('NEnd');
    expect(f().velocity.y).toBeCloseTo(2 * Math.sin(0.85), 4);
    for (let i = 0; i < 30 && f().special; i++) step();
    expect(f().state).toBe('fall');
    // ft_var50: no second homing attack before he lands.
    step({ special: true });
    expect(f().special).toBeNull();

    // Side dash: 13-frame start, 2.6465 a frame; at the script's flag2 (frame 21) without the stick
    // held forward it brakes (SpecialSCancel). ft_var49 then blocks it until the next landing.
    make('Sc', 40);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 13; i++) step();
    expect(f().animation).toBe('SpecialS');
    expect(f().velocity.x).toBeCloseTo(2.6465, 4);
    for (let i = 0; i < 30 && f().special?.bsonic?.state === 'S'; i++) step();
    expect(f().special?.bsonic?.state).toBe('SCancel');
    expect(other().percent).toBe(8);
    for (let i = 0; i < 30 && f().special; i++) step();
    step({ special: true, x: 1, specialDirection: 'side' });
    expect(f().special).toBeNull();

    // Spring jump: grounded frames 0-3, flag1 launches at 3.75 and the throw flag leaves the
    // grounded spring at his feet; the played-out flight falls (not helpless) with every jump spent.
    make('Sc', 80);
    step({ special: true, y: 1, specialDirection: 'up' });
    for (let i = 0; i < 4; i++) step();
    expect(f().velocity.y).toBeCloseTo(3.75, 4);
    const item = game.projectiles.items.find(q => q.kind === 'bsonic-spring')!;
    expect(item.bsonicSpring?.phase).toBe('idle');
    expect([item.x, item.y]).toEqual([-40, 0]);
    const snapshot = game.captureState();
    let peak = 0;
    for (let i = 0; i < 44 && f().special; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(60);
    expect(f().state).toBe('fall');
    expect(f().jumpsUsed).toBe(f().content.profile.attributes.maxJumps);
    // ptr_02f08: after the spring jump the fall only acts on A, B or the C-stick (no air dodge).
    step({ shield: true });
    expect(f().state).toBe('fall');
    // Landing back on his own spring relaunches SpecialHi without a second spring.
    for (let i = 0; i < 60 && f().state !== 'special'; i++) step();
    expect(f().special?.bsonic?.springOut).toBe(true);
    expect(game.projectiles.items.filter(q => q.kind === 'bsonic-spring')).toHaveLength(1);
    // Anyone else stomping it leaves in JumpF with self_vel.y + 4.5.
    const rival = other();
    Object.assign(rival, { x: -40, y: 12, grounded: false, floor: null, state: 'fall', animation: 'Fall', velocity: { x: 0, y: -2 } });
    let bounced = false;
    for (let i = 0; i < 10 && !bounced; i++) { step(); bounced = rival.state === 'jump' && rival.velocity.y > 1; }
    expect(bounced).toBe(true);
    // Rollback restores the article and its own velocity.
    game.restoreState(snapshot);
    const restored = game.projectiles.items.find(q => q.kind === 'bsonic-spring')!;
    expect(restored.bsonicSpring).toEqual({ phase: 'idle', vx: 0, vy: 0 });
    expect(f().special?.bsonic?.state).toBe('Hi');

    // Spin dash: a B tap after the hold's flag1 (frame 8) charges a level; letting go of down rolls
    // at 1.9 + 0.3·level with hitbox 0 at 8 + 2·level.
    make('Sc', 60);
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    for (let i = 0; i < 21; i++) step({ y: -1, down: true });
    step({ y: -1, down: true, special: true });
    expect(f().special?.bsonic?.level).toBe(1);
    step();
    expect(f().special?.bsonic?.state).toBe('LwLoop');
    expect(f().velocity.x).toBeCloseTo(2.2, 4);
    for (let i = 0; i < 40 && other().percent === 0; i++) step();
    expect(other().percent).toBe(10);
  });
  it('Dr. Luigi pills, missiles (misfire capable), punches and cyclones', () => {
    make('Dl', 40);
    step({ special: true });
    let sawPill = false;
    for (let i = 0; i < 70; i++) { step(); sawPill ||= game.projectiles.items.some(p => p.kind === 'fireball'); }
    expect(sawPill).toBe(true);
    expect(other().percent).toBe(8);
    // Grounded missile at gap 20: the deterministic-seed misfire (25%, 6 hits
    // from frame 4) arms ~14 units out and meets the rival there; point-blank
    // starts tunnel past before arming. (Non-misfire ground Fly has no hits.)
    make('Dl', 20);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 25; i++) step({ special: true, x: 1 });
    for (let i = 0; i < 50; i++) step();
    expect(other().percent).toBeGreaterThan(0);
    make('Dl');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(25);
    // Cyclone: DrLuigi's mash window opens at frame 0 (Luigi's opens at 6),
    // so a grounded tap self-launches into a whiffed hop; mashed from the air
    // the 13-hit AirLw connects instead.
    make('Dl', 8);
    step({ jump: true });
    for (let i = 0; i < 14 && f().grounded; i++) step();
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 35; i++) step(i % 4 === 0 ? { special: true, y: -1 } : {});
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Knuckles runs the Sonic m-ex kit: dive punch, ground dash, glide, spring and spin charge', () => {
    // His ftDataKx homing radius is 0: the neutral always takes SpecialNAttackMiss's dive.
    make('Kx', 30);
    step({ special: true });
    let dove = false;
    for (let i = 0; i < 70 && other().percent === 0; i++) { step(); dove ||= f().special?.sonic?.state === 'NAttackMiss'; }
    expect(dove).toBe(true); expect(other().percent).toBeGreaterThan(0);
    // Grounded side special: SpecialSStart_Enter's x98 dash bleeding xA8 a frame.
    make('Kx', 20);
    step({ special: true, x: 1, specialDirection: 'side' });
    expect(f().animation).toBe('SpecialS');
    expect(f().velocity.x).toBeCloseTo(1.7 * (1 - 0.03), 3); // entry speed, first frame's xA8 already applied
    const start = f().x;
    for (let i = 0; i < 40 && f().special; i++) step();
    expect(f().x - start).toBeGreaterThan(15);
    // Aerial side special: the glide, once per airtime.
    make('Kx', 60);
    step({ jump: true }); for (let i = 0; i < 4; i++) step();
    step({ jump: true }); for (let i = 0; i < 12; i++) step();
    step({ special: true, x: 1, specialDirection: 'side' });
    expect(f().special?.sonic?.state).toBe('Glide');
    let sink = 0;
    for (let i = 0; i < 8; i++) { step(); sink = Math.min(sink, f().velocity.y); }
    expect(sink).toBeGreaterThanOrEqual(-0.25 - 1e-6); // xA4 glide fall cap
    expect(f().glideUsed).toBe(true);
    // Up special: the same spring article as Sonic's.
    make('Kx');
    step({ special: true, y: 1, specialDirection: 'up' });
    expect(game.projectiles.items.some(p => p.kind === 'sonic-spring')).toBe(true);
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(25);
    // Down special: the spin charge run.
    make('Kx', 60);
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    for (let i = 0; i < 16; i++) step({ y: -1, down: true, special: i % 8 === 7 });
    step();
    expect(f().special?.sonic?.state).toBe('LwRun');
    for (let i = 0; i < 45 && other().percent === 0; i++) step();
    expect(other().percent).toBeGreaterThan(0);
  });
  it('Lucina shield-breaks, dances, slashes and counters', () => {
    make('Lu', 8);
    step({ special: true });
    for (let i = 0; i < 10; i++) step({ special: true });
    step({});
    for (let i = 0; i < 30; i++) step();
    expect(f().special === null || f().state !== 'ko').toBe(true);
    make('Lu', 8);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 8; i++) step({ special: true, x: 1 });
    step({ attack: true });
    for (let i = 0; i < 40; i++) step();
    expect(other().percent).toBeGreaterThan(0);
    make('Lu');
    step({ special: true, y: 1, specialDirection: 'up' });
    let peak = 0;
    for (let i = 0; i < 80; i++) { step(); peak = Math.max(peak, f().y); }
    expect(peak).toBeGreaterThan(20);
    // Counter: hold Lw, let the rival jab into the sphere.
    make('Lu', 10);
    step({ special: true, y: -1, specialDirection: 'down' });
    for (let i = 0; i < 6; i++) step({ special: true, y: -1 });
    step({ attack: false }, { attack: true });
    for (let i = 0; i < 30; i++) step();
    expect(other().percent).toBeGreaterThan(0);
  });
});
