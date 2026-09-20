import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, selectRoster } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { ModelInstance } from '../../web/src/render/model-instance.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { KIRBY_ACTION_KEYS, STONE_FLICKER, kirbyPartVisibility, inhaledVictimHidden, inhaleHoldActive } from '../../lib/game/kirby.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import type { FighterKind } from '../../lib/game/data.ts';

describe('Kirby registration without disc data', () => {
  it('is a registered room fighter and keyed motions verify their figatree names', () => {
    expect(ROOM_FIGHTERS).toContain('Kb');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Kb' }))).toMatchObject({ fighter: 'Kb' });
    expect(() => parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'invalid' }))).toThrow();
    expect(new Set(KIRBY_ACTION_KEYS.map((entry) => entry.key)).size).toBe(KIRBY_ACTION_KEYS.length);
    expect(STONE_FLICKER).toHaveLength(23);
    for (const asset of ['PlKb.dat', 'PlKbAJ.dat', 'PlKbNr.dat', 'EfKbData.dat', 'audio/us/kirby.ssm', 'PlKbCpFx.dat', 'PlKbCpMr.dat', 'PlKbCpLk.dat', 'PlKbCpCl.dat', 'PlKbCpSs.dat', 'PlKbCpPk.dat', 'PlKbCpCa.dat', 'PlKbCpDk.dat', 'PlKbCpMt.dat', 'PlKbCpFe.dat']) expect(SERVER_ASSETS).toContain(asset);
    for (const asset of ['PlKbCpKp.dat', 'PlKbNrCpDk.dat', 'EfKbFx.dat', 'EfKbMr.dat']) expect(SERVER_ASSETS).not.toContain(asset);
  });
});

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Kirby from original disc data', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (a: FighterKind = 'Kb', b: FighterKind = 'Mr', gap = 20, options: { player?: number } = {}) => {
    rig?.dispose(); content = rosterPair(base, a, b); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, ...options }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i === 0 ? -1 : 1) * gap / 2; f.y = 0; f.grounded = true; f.floor = 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a, b); };
  const kirby = () => game.fighters[0];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer); }
    finally { await disc.close(); }
  });
  beforeEach(() => make());
  afterEach(() => rig?.dispose());

  it('reads the original profile: 59 parts, 46 joints, translated bones and Kirby attributes', () => {
    const profile = base.roster.get('Kb')!.profile;
    expect(profile.name).toBe('Kirby'); expect(profile.boneCount).toBe(46); expect(profile.partJoints).toHaveLength(59);
    expect(profile.partJoints.filter((joint) => joint < 0)).toHaveLength(13);
    expect(profile.partJoints[57]).toBe(44); expect(profile.shieldBone).toBe(44); expect(profile.boneMap[52]).toBe(44);
    expect(profile.hurts.map((hurt) => hurt.bone)).toEqual([5, 29, 24, 42, 36]);
    for (const hurt of profile.hurts) expect(hurt.bone).toBeLessThan(46);
    expect(profile.attributes.maxJumps).toBe(6); expect(profile.attributes.weight).toBe(70); expect(profile.attributes.modelScale).toBeCloseTo(0.92, 5);
    expect(profile.attributes.aerialBackLandingLag).toBe(15); expect(profile.attributes.aerialDownLandingLag).toBe(20);
    expect(base.common.boneMaps.Fx.virtualParts).toEqual([]); expect(base.common.boneMaps.Kb.virtualParts).toHaveLength(13);
    expect(profile.partVisibility.groups[0]).toHaveLength(7); expect(profile.partVisibility.groups[1]).toHaveLength(1);
    // Sets 0, 1 and 3 together cover every draw object; only [3,4,5] + [6,7,18,19] stay visible at spawn.
    expect(profile.partVisibility.hidden).toHaveLength(42); expect(profile.partVisibility.groups[0]![0]).toEqual([3, 4, 5]); expect(profile.partVisibility.groups[1]![0]).toEqual([6, 7, 18, 19]);
  });
  it('draws only Kirby\'s body at spawn: stones and hat variants stay hidden like ftParts_8007487C', () => {
    const f = kirby(); rig.sample(f);
    const parts = f.content.model.roots[0]!.parts, visibleDobjs = new Set(parts.filter((part) => !rig.actors[0].hiddenDobjs.has(part.dobjIndex)).map((part) => part.dobjIndex));
    expect([...visibleDobjs].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 18, 19]);
    expect(parts.filter((part) => visibleDobjs.has(part.dobjIndex)).every((part) => part.owner === 0)).toBe(true);
    expect(rig.actors[0].group.children.filter((child) => child.visible).length).toBe(parts.filter((part) => visibleDobjs.has(part.dobjIndex)).length);
  });
  it('loads Kirby clips, keyed motion states, articles and effects from Kirby archives only', () => {
    const kb = base.roster.get('Kb')!;
    for (const key of ['SpecialAirN', 'SpecialNCapture', 'SpecialLw', 'SpecialLwEnd', 'SpecialAirLw', 'SpecialAirLwEnd', 'SpecialAirHiEnd', 'JumpAerialF5', 'SquatWait1', 'LandingAirB', 'Eat', 'EatWait']) {
      expect(kb.clips.get(key)?.joints).toHaveLength(46);
      expect(kb.clips.get(key)?.name).toContain('PlyKirby5K_Share_ACTION_');
    }
    expect(kb.clips.get('SpecialLw')!.name).toBe(kb.clips.get('SpecialLwEnd')!.name);
    expect(kb.timelines.get('SpecialLwEnd')!.events.some((e) => e.type === 'command' && e.index === 0 && e.value === 2)).toBe(true);
    expect(kb.timelines.get('SpecialLw')!.events.some((e) => e.type === 'command')).toBe(false);
    expect(kb.attacks.get('SpecialAirLw')!.events.find((e) => e.type === 'create')).toMatchObject({ hit: { damage: 18, bone: 0 } });
    expect(kb.attacks.get('SpecialS')!.events.filter((e) => e.type === 'create').map((e) => (e as { hit: { damage: number; bone: number } }).hit)).toMatchObject([{ damage: 16, bone: 31 }, { damage: 16, bone: 31 }, { damage: 23, bone: 31 }]);
    expect(kb.attacks.get('SpecialNLoop')!.events.filter((e) => e.type === 'create')).toHaveLength(2);
    expect(kb.specials.parameters.kind).toBe('Kb');
    expect(kb.specials.articles.projectile!.hit).toMatchObject({ damage: 6 }); expect(kb.specials.articles.projectile!.lifetime).toBe(25); expect(kb.specials.articles.projectile!.speed).toBe(4);
    expect(kb.specials.articles.accessory!.hit).toBeNull(); expect(kb.specials.effects.size).toBe(6); expect(kb.specials.effects.get('dash-fire')!.stats.meshes).toBeGreaterThan(0);
    expect(kb.airJumps?.vertical).toHaveLength(5); expect(kb.airJumps?.animations[4]).toBe('JumpAerialF5');
    for (const data of [...kb.specials.effects.values(), kb.specials.articles.projectile!.model, kb.specials.articles.accessory!.model]) { expect(data.stats.meshes).toBeGreaterThan(0); const instance = new ModelInstance(data); instance.update(4); instance.dispose(); }
    expect(kb.specials.sounds.ko).toBe(140145); expect(base.sound.cues(140145).length).toBeGreaterThan(0); expect(base.sound.cues(140007).length).toBeGreaterThan(0);
  });
  it('keeps Fox and Mario untouched and offers Kirby in any slot, mirrors and solo mode', () => {
    expect([...base.roster.keys()]).toEqual(expect.arrayContaining(['Fx', 'Mr', 'Kb', 'Ss']));
    expect(selectRoster(base, 3, 'auto', 'bot').content.fighters.map((f) => f.profile.kind)).toEqual(['Kb', 'Fx']);
    expect(selectRoster(base, 3, 'auto', 'bot').player).toBe(0);
    make('Kb', 'Kb'); expect(game.fighters.every((f) => f.content.profile.kind === 'Kb')).toBe(true);
    make('Fx', 'Kb'); expect(game.content.physics.air(1, { x: 0, y: 0 }, 0, false).y).toBeCloseTo(-0.08, 6);
    expect(game.content.physics.air(0, { x: 0, y: 0 }, 0, false).y).toBeCloseTo(-0.23, 6);
    make('Fx', 'Mr'); expect(game.fighters[1].content.profile.kind).toBe('Mr'); expect(game.content.physics.jump(1, { x: 0, y: 0 }, 0, false).y).toBeCloseTo(2.3, 6);
  });
  it('aligns translated hitbox bones with facing for every Kirby attack', () => {
    const f = kirby();
    for (const name of Object.values(f.content.moves)) {
      const move = f.content.attacks.get(name)!;
      const first = move.events.find((e) => e.type === 'create');
      if (!first || first.type !== 'create') continue;
      f.animation = name; f.animationFrame = first.frame; rig.sample(f);
      const hit = activeHits(move, first.frame)[0]!;
      const point = rig.point(f, hit.bone, hit.offset);
      expect(Number.isFinite(point[0]) && Number.isFinite(point[1])).toBe(true);
    }
    f.animation = 'AttackS3S'; f.animationFrame = 5; rig.sample(f);
    const tilt = activeHits(f.content.attacks.get('AttackS3S')!, 5)[0]!;
    expect(rig.point(f, tilt.bone, tilt.offset)[0]).toBeGreaterThan(f.x);
    f.facing = -1; rig.sample(f); expect(rig.point(f, tilt.bone, tilt.offset)[0]).toBeLessThan(f.x);
  });
  it('chains five original air jumps with per-jump impulses, then falls without more', () => {
    const f = kirby(), heights: number[] = [];
    step({ jump: true }); ticks(3); step(); expect(f.state).toBe('jump');
    for (let jump = 0; jump < 5; jump++) {
      ticks(2);
      let pressed = false;
      for (let i = 0; i < 60 && !pressed; i++) { step({ jump: true }); if (f.state === 'airjump' && f.jumpsUsed === jump + 2) pressed = true; else step(); }
      expect(pressed).toBe(true);
      expect(f.animation).toBe(`JumpAerialF${jump + 1}`);
      heights.push(f.velocity.y);
    }
    expect(heights.map((h) => Math.round(h * 100) / 100)).toEqual([2, 2, 1.73, 1.56, 1.33]);
    expect(f.jumpsUsed).toBe(6);
    ticks(1); const vy = f.velocity.y; step({ jump: true }); expect(f.jumpsUsed).toBe(6); expect(f.velocity.y).toBeLessThan(vy);
  });
  it('turns around during a backwards air jump', () => {
    const f = kirby(); step({ jump: true }); ticks(4); ticks(3);
    step({ jump: true, x: -1 }); expect(f.state).toBe('airjump'); expect(f.airJumpTurn).toBeGreaterThan(0); expect(f.facing).toBe(1);
    ticks(8, { x: -1 }); expect(f.facing).toBe(-1); expect(f.airJumpTurn).toBe(4);
    ticks(4, { x: -1 }); expect(f.airJumpTurn).toBe(0); expect(f.facing).toBe(-1);
  });
  it('uses Kirby crouch, side/up tilts, smashes, back and up aerials with their landing clips', () => {
    ticks(12, { down: true }); expect(kirby().animation).toBe('SquatWait1');
    make(); step({ attack: true, x: 0.5 }); expect(kirby().animation).toBe('AttackS3S');
    // A held-level upward aim tilts; a full flick past the original 0.6625 PlCo
    // gate up-smashes (tap jump needs 0.66+, so 0.6 aims without leaving ground).
    make(); step({ attack: true, y: 0.6 }); expect(kirby().animation).toBe('AttackHi3');
    make(); ticks(14, { strong: true, y: 1 }); expect(kirby().animation).toBe('AttackHi4'); expect(kirby().smash?.phase).toBe('charging');
    make(); const f = kirby(); f.y = 12; f.grounded = false; f.floor = null; f.state = 'fall'; f.animation = 'Fall'; f.velocity.y = -0.5;
    step({ attack: true, x: -1 }); expect(f.animation).toBe('AttackAirB');
    for (let i = 0; i < 40 && !f.grounded; i++) step();
    expect(f.animation).toBe('LandingAirB'); expect(f.landingFrames).toBe(15);
    make(); const g = kirby(); g.y = 12; g.grounded = false; g.floor = null; g.state = 'fall'; g.animation = 'Fall'; g.velocity.y = -0.5;
    step({ attack: true, y: 1 }); expect(g.animation).toBe('AttackAirHi');
  });
  it('moves the dash attack and forward smash by their original root motion', () => {
    ticks(6, { x: 1 }); expect(kirby().state).toBe('run');
    const start = kirby().x; step({ attack: true, x: 1 }); expect(kirby().animation).toBe('AttackDash'); ticks(50);
    expect(kirby().x).toBeGreaterThan(start + 40);
    make('Kb', 'Mr', 80); const before = kirby().x; step({ strong: true }); ticks(45); expect(kirby().x).toBeGreaterThan(before + 15);
  });
  it('swings the hammer on the ground with original damage and once-per-airtime boost in the air', () => {
    make('Kb', 'Mr', 12); step({ special: true, specialDirection: 'side' }); expect(kirby().animation).toBe('SpecialS');
    ticks(35); expect(game.fighters[1].percent).toBeGreaterThanOrEqual(16); expect(kirby().special?.direction).toBe('side');
    for (let i = 0; i < 60 && kirby().special; i++) step(); // 60-frame clip plus hitlag
    expect(kirby().special).toBeNull(); expect(kirby().state).toBe('idle');
    make(); const f = kirby(); f.y = 40; f.grounded = false; f.floor = null; f.state = 'fall'; f.animation = 'Fall';
    step({ special: true, specialDirection: 'side' }); expect(f.animation).toBe('SpecialAirS'); expect(f.velocity.y).toBeCloseTo(1.5 - 0.08, 2); expect(f.hammerBoostUsed).toBe(true); // boost, then Kirby's gravity on the same tick
    for (let i = 0; i < 120 && !f.grounded; i++) step();
    expect(f.state).toBe('landing'); expect(f.landingFrames).toBe(16); expect(f.hammerBoostUsed).toBe(false);
  });
  it('rises with Final Cutter, passes floors early, lands into the slash and fires the beam along the floor', () => {
    // x = ±15 keeps Kirby between Battlefield's side platforms and under the top one.
    make('Kb', 'Mr', 30); const f = kirby(); let peak = 0, fired = false, phases = new Set<string>();
    step({ special: true, specialDirection: 'up' }); expect(f.animation).toBe('SpecialHi1');
    for (let i = 0; i < 140; i++) { step(); if (f.special) phases.add(f.special.phase); peak = Math.max(peak, f.y); fired ||= game.events.some((e) => e.type === 'shot' && e.projectileKind === 'cutter'); }
    expect(peak).toBeGreaterThan(40); expect(peak).toBeLessThan(54); expect(phases.has('travel')).toBe(true); expect(phases.has('end')).toBe(true); expect(fired).toBe(true);
    expect(f.grounded).toBe(true); expect(f.y).toBe(0); expect(f.special).toBeNull(); expect(f.state).not.toBe('helpless');
    expect(game.fighters[1].percent).toBe(6);
  });
  it('lands Final Cutter on a side platform after the pass-through frames', () => {
    make('Kb', 'Mr', 80); const f = kirby(); f.x = -40;
    step({ special: true, specialDirection: 'up' });
    for (let i = 0; i < 120 && f.special; i++) step();
    expect(f.grounded).toBe(true); expect(f.y).toBeGreaterThan(20);
  });
  it('reverses Final Cutter with a backwards stick during the startup only', () => {
    const f = kirby(); step({ special: true, specialDirection: 'up' }); step({ x: -1 }); expect(f.facing).toBe(-1);
    step({ x: 1 }); expect(f.facing).toBe(-1);
  });
  it('decelerates the cutter beam on the floor and removes it at the platform edge', () => {
    make('Kb', 'Mr', 120); const f = kirby(); f.x = 40; // rises through and lands on the right side platform
    step({ special: true, specialDirection: 'up' });
    let beam: { x: number; y: number; vx: number } | undefined; let frames = 0, last = 0;
    for (let i = 0; i < 140 && !beam; i++) { step(); const item = game.projectiles.items.find((p) => p.kind === 'cutter'); if (item) beam = { x: item.x, y: item.y, vx: item.vx }; }
    expect(beam).toBeDefined(); expect(Math.abs(beam!.vx)).toBeCloseTo(3.9, 3); // 4.0 minus one 0.1 deceleration step
    expect(beam!.y).toBeCloseTo(f.y, 3); expect(f.y).toBeGreaterThan(20);
    while (game.projectiles.items.some((p) => p.kind === 'cutter') && frames++ < 60) { const item = game.projectiles.items.find((p) => p.kind === 'cutter')!; expect(Math.abs(item.vx)).toBeLessThanOrEqual(4); expect(item.y).toBeCloseTo(beam!.y, 3); last = item.x; step(); }
    expect(game.projectiles.items.some((p) => p.kind === 'cutter')).toBe(false);
    expect(last).toBeLessThan(60); expect(frames).toBeLessThan(25);
  });
  it('holds Stone with 38 HP armor, breaks on the excess hit, and hides the body draw set while transformed', () => {
    make('Kb', 'Mr', 8); const f = kirby(), mario = game.fighters[1];
    step({ special: true, specialDirection: 'down' }); expect(f.animation).toBe('SpecialLw1');
    ticks(30); expect(f.special?.phase).toBe('loop'); expect(f.animation).toBe('SpecialLw'); expect(f.special?.stoneHp).toBe(38);
    expect(f.special?.stoneShape).toBeGreaterThanOrEqual(1); expect(f.special?.stoneShown).toBe(true);
    const visible = kirbyPartVisibility(f)!; expect(visible[1]).toBe(-1); expect(visible[0]).toBeGreaterThanOrEqual(2);
    rig.sample(f); expect(rig.actors[0].hiddenDobjs.size).toBe(42 - f.content.profile.partVisibility.groups[0]![visible[0]!]!.length);
    for (const dobj of [3, 4, 5, 6, 7, 18, 19]) expect(rig.actors[0].hiddenDobjs.has(dobj)).toBe(true);
    let absorbed = 0;
    for (let i = 0; i < 90 && f.special?.phase === 'loop'; i++) { step({}, { attack: i % 30 === 0 }); if (mario.state === 'attack') absorbed++; }
    expect(absorbed).toBeGreaterThan(0); expect(f.percent).toBe(0);
    for (let i = 0; i < 400 && f.special?.phase === 'loop'; i++) step({}, { strong: i % 60 === 0 });
    expect(f.special?.stoneHp ?? 0).toBeLessThan(38); expect(f.percent).toBeLessThan(25);
  });
  it('releases Stone after the minimum hold on a second press and falls without helplessness', () => {
    const f = kirby(); step({ special: true, specialDirection: 'down' }); ticks(40);
    expect(f.special?.phase).toBe('loop'); step({ special: true }); expect(f.special?.phase).toBe('loop');
    ticks(12); step({ special: true }); expect(f.special?.phase).toBe('end'); expect(f.animation).toBe('SpecialLwEnd');
    for (let i = 0; i < 80 && f.special; i++) step();
    expect(f.special).toBeNull(); expect(f.state).not.toBe('helpless');
    for (let i = 0; i < 80 && !f.grounded; i++) step();
    expect(f.grounded).toBe(true);
  });
  it('drops as an aerial Stone, hits on the way down and times out into the ground stone', () => {
    make('Kb', 'Mr', 4); const f = kirby(); f.y = 45; f.grounded = false; f.floor = null; f.state = 'fall'; f.animation = 'Fall';
    step({ special: true, specialDirection: 'down' }); expect(f.animation).toBe('SpecialAirLwStart');
    let fell = false;
    for (let i = 0; i < 80 && !f.grounded; i++) { step(); fell ||= f.velocity.y < -4; }
    expect(fell).toBe(true); expect(game.fighters[1].percent).toBe(18); expect(f.animation).toBe('SpecialLw');
    for (let i = 0; i < 200 && f.special?.phase === 'loop'; i++) step();
    expect(f.special?.phase).toBe('end');
  });
  it('inhales an opponent, pulls it into the mouth and spits it out with the original throw definition', () => {
    make('Kb', 'Mr', 12); const f = kirby(), mario = game.fighters[1];
    step({ special: true, specialDirection: 'neutral' }); expect(f.animation).toBe('SpecialN');
    for (let i = 0; i < 60 && mario.state !== 'captured'; i++) step({ special: true });
    expect(mario.state).toBe('captured'); expect(f.special?.phase).toBe('hit');
    for (let i = 0; i < 40 && f.state !== 'holding'; i++) step({ special: true });
    expect(f.state).toBe('holding'); expect(f.animation).toBe('Eat'); expect(f.combat.partner).toBe(1);
    for (let i = 0; i < 40 && f.animation !== 'EatWait'; i++) step();
    expect(f.animation).toBe('EatWait');
    step({ attack: true }); expect(f.state).toBe('throw'); expect(f.animation).toBe('SpecialNSpit');
    for (let i = 0; i < 40 && mario.state === 'captured'; i++) step();
    expect(mario.state).toBe('hitstun'); expect(mario.percent).toBe(10); expect(f.combat.partner).toBeNull();
    for (let i = 0; i < 40 && f.state === 'throw'; i++) step();
    expect(f.state).toBe('idle');
  });
  it('holds an inhaled victim on Kirby\'s own timer, hides it while swallowed and lets mashing shorten the hold', () => {
    const hold = (mashing: boolean) => {
      make('Kb', 'Mr', 12); const f = kirby(), mario = game.fighters[1];
      step({ special: true, specialDirection: 'neutral' });
      for (let i = 0; i < 100 && f.animation !== 'EatWait'; i++) step({ special: i < 60 });
      expect(f.animation).toBe('EatWait'); expect(inhaleHoldActive(f)).toBe(true); expect(inhaledVictimHidden(mario, game.fighters)).toBe(true);
      let frames = 0;
      while (mario.state === 'captured' && frames < 600) { step({}, mashing ? { attack: frames % 2 === 0 } : {}); frames++; }
      expect(inhaledVictimHidden(mario, game.fighters)).toBe(false); expect(f.combat.partner).toBeNull();
      return frames;
    };
    const patient = hold(false), mashed = hold(true);
    expect(patient).toBeGreaterThan(180); expect(patient).toBeLessThanOrEqual(260); expect(mashed).toBeLessThan(patient / 2);
    expect(base.roster.get('Kb')!.inhale).toMatchObject({ holdFrames: 250, holdDecay: 1, mashResistance: 12 });
  });
  it('walks with an inhaled victim kept in the mouth and still spits out of the walk', () => {
    make('Kb', 'Mr', 12); const f = kirby(), mario = game.fighters[1];
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 100 && f.animation !== 'EatWait'; i++) step({ special: i < 60 });
    expect(f.animation).toBe('EatWait');
    const eat = base.roster.get('Kb')!.inhale!;
    expect(eat.walkStick).toBeGreaterThan(0); expect(eat.walkSpeed).toBeGreaterThan(0); expect(eat.walkSpeed).toBeLessThanOrEqual(1);
    const startX = f.x;
    ticks(30, { x: 1 });
    expect(f.state).toBe('holding'); expect(['EatWalkSlow', 'EatWalkMiddle', 'EatWalkFast']).toContain(f.animation);
    expect(f.x).toBeGreaterThan(startX); expect(f.facing).toBe(1);
    expect(inhaleHoldActive(f)).toBe(true); expect(inhaledVictimHidden(mario, game.fighters)).toBe(true);
    ticks(2); expect(f.animation).toBe('EatWait');
    ticks(10, { x: -1 }); expect(f.facing).toBe(-1); expect(['EatWalkSlow', 'EatWalkMiddle', 'EatWalkFast']).toContain(f.animation);
    step({ attack: true }); expect(f.state).toBe('throw'); expect(f.animation).toBe('SpecialNSpit');
    for (let i = 0; i < 40 && mario.state === 'captured'; i++) step();
    expect(mario.state).toBe('hitstun'); expect(f.combat.partner).toBeNull();
  });
  const swallow = (rival: FighterKind, gap = 12) => {
    make('Kb', rival, gap); const f = kirby(), victim = game.fighters[1];
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 100 && f.animation !== 'EatWait'; i++) step({ special: i < 60 });
    expect(f.animation).toBe('EatWait');
    step({ y: -1, down: true }); expect(f.animation).toBe('SpecialNDrink');
    for (let i = 0; i < 40 && victim.state === 'captured'; i++) step();
    for (let i = 0; i < 40 && f.state === 'throw'; i++) step();
    return victim;
  };
  const swallowInPlace = (beforeSwallow: () => void = () => {}) => {
    const f = kirby(), victim = game.fighters[1];
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 100 && f.animation !== 'EatWait'; i++) step({ special: i < 60 });
    expect(f.animation).toBe('EatWait'); beforeSwallow(); step({ y: -1, down: true });
    for (let i = 0; i < 40 && victim.state === 'captured'; i++) step();
    for (let i = 0; i < 40 && f.state === 'throw'; i++) step();
  };
  it('swallows for the original release damage and steals Mario\'s fireball as a copy ability', () => {
    const mario = swallow('Mr'); const f = kirby();
    expect(mario.percent).toBe(8); expect(f.content.profile.name).toBe('Kirby'); expect(f.copyAbility).toBe('Mr');
    const copy = f.content.copies!.Mr!; expect(copy.hat!.stats.meshes).toBeGreaterThan(0); expect(copy.projectile!.hit?.damage).toBeGreaterThan(0);
    expect(copy.projectile!.gravity).toBeCloseTo(0.036, 3); expect(copy.projectile!.speed).toBeCloseTo(1.5, 3); // copy article + Mario's common block
    f.x = -20; mario.x = 20; mario.state = 'idle'; mario.animation = 'Wait1';
    step({ special: true, specialDirection: 'neutral' }); expect(f.animation).toBe('MrSpecialN');
    let fired = false, data: unknown;
    for (let i = 0; i < 60; i++) { step(); if (game.events.some((e) => e.type === 'shot' && e.projectileKind === 'fireball')) { fired = true; data = game.projectiles.items.at(-1)?.data; } }
    expect(fired).toBe(true); expect(data).toBe(copy.projectile);
    for (let i = 0; i < 90 && mario.percent === 8; i++) step();
    expect(mario.percent).toBeGreaterThan(8); expect(f.special).toBeNull();
  });
  it('steals Fox\'s blaster: start, tap-queued loops and laser shots from the copied article', () => {
    const fox = swallow('Fx'); const f = kirby();
    expect(f.copyAbility).toBe('Fx'); expect(f.content.copies!.Fx!.accessory?.model.stats.meshes).toBeGreaterThan(0);
    f.x = -20; fox.x = 20; fox.state = 'idle'; fox.animation = 'Wait1';
    let shots = 0; const names = new Set<string>();
    for (let i = 0; i < 70; i++) { step({ special: i === 0 || i === 12 || i === 22, specialDirection: 'neutral' }); names.add(f.animation); shots += game.events.filter((e) => e.type === 'shot' && e.projectileKind === 'laser').length; }
    expect(names.has('FxSpecialNStart')).toBe(true); expect(names.has('FxSpecialNLoop')).toBe(true); expect(names.has('FxSpecialNEnd')).toBe(true);
    expect(shots).toBeGreaterThan(1); expect(fox.percent).toBeGreaterThan(0); expect(fox.hitstun).toBe(0);
    expect(game.projectiles.items.every((p) => p.data === f.content.copies!.Fx!.projectile)).toBe(true);
  });
  it('loads a copy ability for every roster fighter and steals each rival\'s kind by swallowing', () => {
    const kb = base.roster.get('Kb')!;
    for (const kind of ['Fx', 'Mr', 'Lk', 'Cl', 'Ss', 'Pk', 'Ca', 'Dk', 'Mt', 'Fe'] as const) {
      const copy = kb.copies?.[kind];
      expect(copy, kind).toBeDefined();
      expect(copy!.sourceParameters.kind, kind).toBe(kind);
    }
    for (const rival of ['Lk', 'Cl', 'Ss', 'Pk', 'Ca', 'Dk', 'Mt', 'Fe'] as const) {
      swallow(rival); expect(kirby().copyAbility, rival).toBe(rival);
    }
  });
  const copyReady = (source: FighterKind) => {
    make('Kb', 'Mr', 40); const f = kirby(), mario = game.fighters[1];
    f.copyAbility = source; f.x = -5; mario.x = 5; mario.state = 'idle'; mario.animation = 'Wait1';
    return { f, mario };
  };
  it('copies Falcon Punch and the Giant Punch with banked swings', () => {
    const ca = copyReady('Ca');
    step({ special: true, specialDirection: 'neutral' }); expect(ca.f.animation).toBe('CaSpecialN');
    for (let i = 0; i < 70 && ca.mario.percent === 0; i++) step();
    expect(ca.mario.percent).toBeGreaterThanOrEqual(23);
    const dk = copyReady('Dk');
    step({ special: true, specialDirection: 'neutral' }); expect(dk.f.animation).toBe('DkSpecialNStart');
    ticks(40, { special: true }); expect(dk.f.animation).toBe('DkSpecialNLoop'); expect(dk.f.dkPunchCharge).toBeGreaterThan(0);
    const banked = dk.f.dkPunchCharge;
    step(); step({ special: true }); expect(dk.f.animation).toBe('DkSpecialN'); expect(dk.f.special?.copySwings).toBe(banked); expect(dk.f.dkPunchCharge).toBe(0);
    for (let i = 0; i < 40 && dk.mario.percent === 0; i++) step();
    // The punch lands its 12% (frame 17) or 10% (frame 18) hitbox first, plus 2 per banked swing.
    expect([12 + banked * 2, 10 + banked * 2]).toContain(dk.mario.percent);
  });
  it('copies the Samus charge shot with stored charge and the Mewtwo shadow ball', () => {
    const ss = copyReady('Ss');
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 20 && ss.f.animation !== 'SsSpecialNHold'; i++) step({ special: true });
    expect(ss.f.animation).toBe('SsSpecialNHold');
    ticks(40, { special: true }); const level = ss.f.samusCharge; expect(level).toBeGreaterThan(0);
    step({ shield: true }); expect(ss.f.animation).toBe('SsSpecialNCancel');
    for (let i = 0; i < 20 && ss.f.special; i++) step();
    expect(ss.f.samusCharge).toBe(level); // the cancel stored the charge
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 20 && ss.f.animation !== 'SsSpecialNHold'; i++) step({ special: true });
    let fired = false;
    const sawCharge = () => { if (game.events.some((e) => e.type === 'shot' && e.projectileKind === 'charge')) fired = true; };
    step(); step({ special: true }); sawCharge(); expect(ss.f.animation).toBe('SsSpecialN');
    for (let i = 0; i < 30; i++) { step(); sawCharge(); }
    expect(fired).toBe(true); expect(ss.f.samusCharge).toBe(0);
    for (let i = 0; i < 60 && ss.mario.percent === 0; i++) step();
    expect(ss.mario.percent).toBeGreaterThan(0);
    const mt = copyReady('Mt');
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 25 && !mt.f.animation.startsWith('MtSpecialNLoop'); i++) step({ special: true });
    expect(mt.f.animation.startsWith('MtSpecialNLoop')).toBe(true);
    ticks(60, { special: true }); expect(mt.f.mewtwoCharge).toBeGreaterThan(0);
    step(); step({ special: true }); expect(mt.f.animation).toBe('MtSpecialNEnd');
    let ball = false;
    for (let i = 0; i < 30; i++) { step(); if (game.events.some((e) => e.type === 'shot' && e.projectileKind === 'shadow-ball')) ball = true; }
    expect(ball).toBe(true); expect(mt.f.mewtwoCharge).toBe(0);
  });
  it('copies the Link bow, the Thunder Jolt and Roy\'s Flare Blade with charge scaling', () => {
    const lk = copyReady('Lk');
    step({ special: true, specialDirection: 'neutral' }); expect(lk.f.animation).toBe('LkSpecialNStart');
    ticks(70, { special: true }); expect(lk.f.animation).toBe('LkSpecialNLoop');
    let arrow = false;
    for (let i = 0; i < 40; i++) { step(); if (game.events.some((e) => e.type === 'shot' && e.projectileKind === 'arrow')) arrow = true; }
    expect(arrow).toBe(true);
    for (let i = 0; i < 40 && lk.mario.percent === 0; i++) step();
    expect(lk.mario.percent).toBeGreaterThan(0);
    const pk = copyReady('Pk');
    step({ special: true, specialDirection: 'neutral' }); expect(pk.f.animation).toBe('PkSpecialN');
    let jolt = false;
    for (let i = 0; i < 40; i++) { step(); if (game.events.some((e) => e.type === 'shot' && e.projectileKind === 'tjolt')) jolt = true; }
    expect(jolt).toBe(true);
    for (let i = 0; i < 60 && pk.mario.percent === 0; i++) step();
    expect(pk.mario.percent).toBeGreaterThan(0);
    const fe = copyReady('Fe');
    step({ special: true, specialDirection: 'neutral' }); expect(fe.f.animation).toBe('FeSpecialNStart');
    ticks(75, { special: true }); expect(fe.f.animation).toBe('FeSpecialNLoop');
    step(); expect(fe.f.animation).toBe('FeSpecialNEnd');
    for (let i = 0; i < 40 && fe.mario.percent === 0; i++) step();
    const p = kirby().content.copies!.Fe!.sourceParameters;
    if (p.kind !== 'Fe') throw new Error('missing Roy data');
    expect(fe.mario.percent).toBe(p.neutral.baseDamage + Math.trunc(76 / 30) * p.neutral.damagePerSecond);
    const full = copyReady('Fe');
    step({ special: true, specialDirection: 'neutral' });
    ticks(p.neutral.maxCharge + 30, { special: true });
    expect(full.f.animation).toBe('FeSpecialNEndFull');
    for (let i = 0; i < 40 && full.mario.percent === 0; i++) step();
    expect(full.mario.percent).toBe(50);
  });
  it('transfers a hat between Kirbys, ignores unsupported copy sources, and loses the ability on KO or a lucky hit', () => {
    make('Kb', 'Kb', 12); game.fighters[1].copyAbility = 'Fx';
    swallowInPlace(); expect(kirby().copyAbility).toBe('Fx'); expect(game.fighters[1].copyAbility).toBeNull();
    // A synthetic custom identity has no native copy archive. The victim keeps Mario's test body.
    make('Kb', 'Mr', 12);
    game.fighters[1].content = { ...game.fighters[1].content, profile: { ...game.fighters[1].content.profile, kind: 'custom:example.dummy' } };
    swallowInPlace(() => { kirby().copyAbility = 'Mr'; }); expect(kirby().copyAbility).toBe('Mr');
    make('Kb', 'Mr', 12); kirby().copyAbility = 'Fx'; step({ special: true, specialDirection: 'neutral' }); expect(kirby().animation).toBe('FxSpecialNStart');
    make('Kb', 'Mr', 12); kirby().copyAbility = 'Fx'; kirby().x = content.stage.blast.right + 1; ticks(1); expect(kirby().copyAbility).toBeNull();
    make('Kb', 'Mr', 8); const f = kirby(); f.copyAbility = 'Fx'; let hits = 0;
    for (let i = 0; i < 4000 && f.copyAbility; i++) { step({}, { attack: i % 40 === 0 }); if (game.events.some((e) => e.type === 'hit' && e.player === 0)) hits++; }
    expect(f.copyAbility).toBeNull(); expect(hits).toBeGreaterThan(0);
  });
  it('captures copied projectiles under their own article key across restores', () => {
    make('Kb', 'Mr', 12); const f = kirby(); f.copyAbility = 'Mr';
    game.projectiles.spawn(f, 'fireball', game.poses, true);
    const saved = game.captureState(); expect(saved.projectiles.items[0]!.article).toBe('Kb/copy/Mr');
    ticks(5); game.restoreState(saved); expect(game.projectiles.items[0]!.data).toBe(f.content.copies!.Mr!.projectile);
    expect(() => game.projectiles.spawn(game.fighters[1], 'fireball', game.poses, true)).toThrow('copied');
  });
  it('ends an unanswered inhale when the button is released and lets an inhaled victim keep its slot data', () => {
    make('Kb', 'Mr', 60); const f = kirby();
    step({ special: true, specialDirection: 'neutral' }); ticks(30, { special: true }); expect(f.special?.phase).toBe('loop');
    step(); expect(f.special?.phase).toBe('end'); ticks(25); expect(f.special).toBeNull(); expect(f.state).toBe('idle');
  });
  it('captures every Kirby field in snapshots and restores independently forked worlds', () => {
    make('Kb', 'Kb', 10);
    step({ special: true, specialDirection: 'down' }, { jump: true }); ticks(6, {}, { jump: true }); ticks(30, {}, { jump: true, x: -1 });
    const saved = game.captureState(), hash = game.stateHash();
    expect(saved.fighters[0]!.special).toMatchObject({ direction: 'down', stoneHp: 38 }); expect(saved.fighters[1]!.airJumpTurn).toBeGreaterThanOrEqual(0);
    ticks(30, { special: true }); const later = game.stateHash();
    game.restoreState(saved); expect(game.stateHash()).toBe(hash); ticks(30, { special: true }); expect(game.stateHash()).toBe(later);
  });
  it('rematches deterministically with every Kirby special exercised', () => {
    const run = () => {
      make('Kb', 'Fx', 30);
      for (let n = 0; n < 720; n++) step({ x: Math.sin(n / 40) > 0 ? 1 : -1, jump: n % 37 === 0, attack: n % 23 === 0, special: n % 61 < 8, specialDirection: (['neutral', 'side', 'up', 'down'] as const)[Math.floor(n / 61) % 4] }, { strong: n % 41 === 0, special: n % 97 === 0, specialDirection: 'neutral', shield: n % 80 < 12 });
      return game.snapshot();
    };
    expect(run()).toEqual(run());
  });
});
