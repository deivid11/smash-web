import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc, verifyAceDisc } from '../../lib/disc.ts';
import { mergeModdedSource } from '../../lib/hsd/modded-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

/** Diddy Kong re-ported from PlDd's compiled ftFunction/itFunction (lib/game/diddy.ts). */
const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso || !aceIso)('Diddy Kong (PlDd compiled kit)', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap: number, opponent: 'Mr' | 'Fx' = 'Mr') => {
    rig?.dispose(); const content = rosterPair(base, 'Dd', opponent); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const diddy = () => game.fighters[0]!;
  const rival = () => game.fighters[1]!;
  const motion = () => diddy().special?.diddy?.motion;
  beforeAll(async () => {
    const vanilla = await openDisc(iso!), ace = await openDisc(aceIso!);
    try {
      const merged = mergeModdedSource({ reader: vanilla, info: await verifyMeleeDisc(vanilla) }, { reader: ace, info: await verifyAceDisc(ace) });
      base = await loadGameContent(new HsdAssetSession(merged.reader, { files: merged.files }), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
    } finally { await vanilla.close(); await ace.close(); }
  }, 120000);
  afterEach(() => rig?.dispose());

  it('reads the ftDataDiddy x4 block OnLoad copies, the articles and the SEM route', () => {
    make(40);
    const p = diddy().content.specials.parameters;
    if (p.kind !== 'Dd') throw new Error('Diddy parameters missing');
    const f = Math.fround;
    expect([p.neutral.speed, p.neutral.damage, p.neutral.base, p.neutral.growth, p.neutral.recoil]).toEqual([[f(2.2), f(5.7)], [3, 12], [10, 40], [50, 100], [0, f(1.4)]]);
    expect([p.side.jump, p.side.landing, p.side.escapeMax, p.side.kickOff, p.side.jumpOff]).toEqual([[2, f(1.7)], 30, 125, [f(-0.8), f(2.2)], [0, 2]]);
    expect([p.up.chargeMax, p.up.speed, p.up.angleSpan, p.up.flightDamage, p.up.flightBase, p.up.trailPeriod, p.up.trailEffect, p.up.trailBone, p.up.landing]).toEqual([45, [3.5, f(4.15)], 30, [3, 8], [50, 85], 4, 219, 19, 30]);
    expect([p.down.tossSpeed, p.down.voice]).toEqual([f(1.7), 0x13a1]);
    // OnFrame's xFC table retimes AttackAirB/S4S/Lw3, ThrowF and the smash item throws.
    expect(p.animRates).toHaveLength(23);
    expect(p.animRates[0]).toEqual({ state: 67, frame: 0, rate: 0.5 });
    const a = diddy().content.specials.articles.diddy!;
    expect([a.blast?.damage, a.blast?.element, a.banana.hit?.damage, a.banana.gravity]).toEqual([8, 1, 3, f(0.06)]);
    expect(diddy().content.specials.soundBank).toBeDefined();
    // The banana trip needs every rival's own MissFoot → DownBoundU → DownStandU.
    for (const name of ['MissFoot', 'DownBoundU', 'DownStandU']) expect(rival().content.clips.has(name)).toBe(true);
  });

  it('Peanut Popgun: the gun comes out on cmd0, a tap shoots a 3% peanut at 45°, the charge scales it', () => {
    make(40);
    step({ special: true });
    for (let i = 0; i < 3; i++) step();
    expect(diddy().special?.diddy?.gun).toBe(0);
    let peanut: { vx: number; vy: number; damage: number } | undefined;
    for (let i = 0; i < 20 && !peanut; i++) { step(); const q = game.projectiles.items.find(p => p.kind === 'diddy-peanut'); if (q) peanut = { vx: q.vx, vy: q.vy, damage: q.hit.damage }; }
    expect(motion()).toBe('SpecialNShoot');
    expect(peanut!.damage).toBe(3);
    expect(peanut!.vx).toBeCloseTo(2.2 * Math.cos(Math.PI / 4), 3);
    for (let i = 0; i < 40; i++) step();
    expect(rival().percent).toBe(3);
    expect(diddy().state).toBe('idle');
    // 80 charged frames of the 160 (NCharge 60 + NDanger 100): 3 + 9 · 0.5.
    make(40);
    step({ special: true });
    let shot: { damage: number; base: number } | undefined;
    for (let i = 0; i < 13 + 80; i++) step({ special: true });
    for (let i = 0; i < 4 && !shot; i++) { step(); const q = game.projectiles.items.find(p => p.kind === 'diddy-peanut'); if (q) shot = { damage: q.hit.damage, base: q.hit.base }; }
    expect(shot).toEqual({ damage: 7, base: 25 });
    // The recoil pushes him back on the ground.
    expect(diddy().velocity.x).toBeLessThan(0);
  });

  it('Peanut Popgun: holding past Danger blows the gun up (5% on the ground) with an 8% fire box', () => {
    make(10);
    step({ special: true });
    for (let i = 0; i < 200; i++) step({ special: true });
    expect(motion()).toBe('SpecialNBlow');
    expect(diddy().percent).toBe(5);
    expect(rival().percent).toBe(8);
    for (let i = 0; i < 120; i++) step();
    expect(diddy().state).toBe('idle');
  });

  it('Monkey Flip grabs, clings and kicks off (3% + the 10% throw), launching the captive forward', () => {
    make(16);
    step({ special: true, x: 1, specialDirection: 'side' });
    let clung = -1;
    for (let i = 1; i < 30 && clung < 0; i++) { step(); if (motion() === 'SpecialSStick') clung = i; }
    expect(clung).toBeGreaterThan(0);
    expect(rival().state).toBe('captured');
    expect(rival().grounded).toBe(true);
    // Diddy rides the captive (his XRotN glued to its XRotN), every velocity killed.
    expect(Math.abs(diddy().x - rival().x)).toBeLessThan(3);
    const snapshot = game.captureState();
    step({ attack: true });
    expect(motion()).toBe('SpecialSStickAttack');
    let released = false;
    for (let i = 0; i < 30 && !released; i++) { step(); released = rival().state === 'hitstun'; }
    expect(released).toBe(true);
    expect(rival().percent).toBe(13);
    expect(rival().knockback.x).toBeGreaterThan(0);
    expect(diddy().velocity).toEqual({ x: Math.fround(-0.8), y: Math.fround(2.2) });
    // Rollback restores the cling.
    game.restoreState(snapshot);
    expect(motion()).toBe('SpecialSStick');
    expect(rival().state).toBe('captured');
  });

  it('Monkey Flip: jumping off spikes the captive, waiting lets it mash out and both take 4%', () => {
    make(16);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 20; i++) step();
    expect(motion()).toBe('SpecialSStick');
    step({ jump: true });
    expect(motion()).toBe('SpecialSStickJump');
    for (let i = 0; i < 30; i++) step();
    // SStickJump's 3% box, then the 6% throw at 270°.
    expect(rival().percent).toBe(9);
    expect(motion()).toBe('SpecialSStickJump2');
    make(16);
    step({ special: true, x: 1, specialDirection: 'side' });
    let escaped = -1;
    for (let i = 0; i < 200 && escaped < 0; i++) { step(); if (rival().state === 'hitstun') escaped = i; }
    expect(escaped).toBeGreaterThan(60);
    expect([diddy().percent, rival().percent]).toEqual([4, 4]);
    expect(diddy().state).toBe('hitstun');
  });

  it('Monkey Flip without a catch: A/B kicks, and the landing is the x44 special landing', () => {
    make(90);
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 16; i++) step();
    expect(motion()).toBe('SpecialAirSJump');
    step({ special: true });
    expect(motion()).toBe('SpecialAirSKick');
    let landing = 0;
    for (let i = 0; i < 60 && !landing; i++) { step(); if (diddy().state === 'landing') landing = diddy().landingFrames; }
    expect(landing).toBe(30);
  });

  it('Rocketbarrel Boost: the charge picks the launch speed, the stick tilt its angle, then special fall', () => {
    make(90);
    step({ special: true, y: 1, specialDirection: 'up' });
    let launched = -1, vy = 0;
    for (let i = 0; i < 30 && launched < 0; i++) { step(); if (motion() === 'SpecialAirHiJump') { launched = i; vy = diddy().velocity.y; } }
    // Released at once: 3.5 straight up, minus this frame's gravity.
    expect(vy).toBeGreaterThan(3.3); expect(vy).toBeLessThan(3.5);
    let peak = 0, helpless = false;
    for (let i = 0; i < 90; i++) { step(); peak = Math.max(peak, diddy().y); helpless ||= diddy().state === 'helpless'; }
    expect(peak).toBeGreaterThan(45);
    expect(helpless).toBe(true);
    // Charged 45 frames with the stick right: 4.15 at 90° − 60° · 0.47.
    make(90);
    step({ special: true, y: 1, specialDirection: 'up' });
    let v = { x: 0, y: 0 };
    for (let i = 0; i < 70 && motion() !== 'SpecialAirHiJump'; i++) { step({ special: true, x: 1 }); v = diddy().velocity; }
    v = diddy().velocity;
    expect(motion()).toBe('SpecialAirHiJump');
    expect(diddy().special!.diddy!.hiCharge).toBe(45);
    // ftCommon_8007D174 caps the steered speed at air_drift_max on the flight's first Phys.
    expect(v.x).toBeCloseTo(diddy().content.profile.attributes.airDriftMax, 5);
    expect(v.y).toBeGreaterThan(3.5);
  });

  it('Rocketbarrel Boost crashes into a ceiling: mirrored ×0.8, 5% and SpecialAirHiDamage', () => {
    make(90);
    step({ special: true, y: 1, specialDirection: 'up' });
    for (let i = 0; i < 20 && motion() !== 'SpecialAirHiJump'; i++) step();
    step();
    const d = diddy();
    d.envContact = { wall: 0, ceiling: true };
    step();
    expect(motion()).toBe('SpecialAirHiDamage');
    expect(d.percent).toBe(5);
    // Mirrored down at 0.8 of its speed, then SpecialAirHiDamage_Phys's ftCommon_Fall caps it.
    expect(d.velocity.y).toBe(-d.content.profile.attributes.terminal);
  });

  it('Banana Peel tosses one banana behind him; a rival running over it trips', () => {
    make(30);
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    for (let i = 0; i < 4; i++) step();
    const banana = () => game.projectiles.items.find(p => p.kind === 'diddy-banana');
    expect(banana()?.banana?.state).toBe(3);
    for (let i = 0; i < 16; i++) step();
    expect(banana()?.banana?.state).toBe(0);
    expect(banana()!.vx).toBeLessThan(0);
    for (let i = 0; i < 90; i++) step();
    expect(banana()?.banana?.state).toBe(1);
    // A second Banana Peel spawns nothing while this one is out.
    step({ special: true, y: -1, down: true, specialDirection: 'down' });
    for (let i = 0; i < 50; i++) step();
    expect(game.projectiles.items.filter(p => p.kind === 'diddy-banana')).toHaveLength(1);
    let tripped = false;
    for (let i = 0; i < 120 && !tripped; i++) { step({}, { x: -1 }); tripped = rival().animation === 'MissFoot'; }
    expect(tripped).toBe(true);
    expect(rival().state).toBe('hitstun');
    expect(banana()?.banana?.state).toBe(5);
    let stood = false;
    for (let i = 0; i < 120 && !stood; i++) { step(); stood = rival().state === 'idle'; }
    expect(stood).toBe(true);
    expect(banana()).toBeUndefined();
  });

  it('OnFrame retimes the down tilt from the xFC table', () => {
    make(40);
    for (let i = 0; i < 8; i++) step({ down: true, y: -1 });
    step({ attack: true, down: true, y: -1 });
    step({ down: true, y: -1 });
    expect(diddy().animation).toBe('AttackLw3');
    expect(diddy().animationRate).toBe(0.25);
  });
});
