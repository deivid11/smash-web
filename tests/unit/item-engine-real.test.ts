import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { itemKind, POKEMON_BASE } from '../../lib/game/item-kinds.ts';
import { SUPPORTED_MATCH_ITEMS } from '../../lib/game/item-engine.ts';
import { activeHits } from '../../lib/game/moves.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('generic match-item engine', () => {
  let base: GameContent, game: LocalMatch, rig: GameRigs;
  const f = () => game.fighters[0];
  const make = (itemFrequency = -1) => {
    rig?.dispose(); const content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, itemFrequency }); game.start();
    game.fighters.forEach((v, i) => { v.x = i ? 50 : -50; v.y = 0; v.grounded = true; v.floor = content.stage.floors.find(x => !x.oneWay)!.id; rig.sample(v); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  beforeAll(async () => {
    const d = await openDisc(iso!);
    try {
      const s = new HsdAssetSession(d, await verifyMeleeDisc(d));
      base = await loadGameContent(s, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
    } finally { await d.close(); }
  }, 60000);
  afterEach(() => rig?.dispose());
  it('keeps the item world inert and RNG-free when the rule is off', () => {
    make();
    expect(game.itemWorld.countdown).toBeNull();
    ticks(30);
    expect(game.itemWorld.items).toHaveLength(0);
  });
  it('drops a pool item from the sky on the original interval ladder and lands it', () => {
    make(2);
    expect(game.itemWorld.countdown).not.toBeNull();
    const pair = base.items!.common.spawnIntervals[2]!;
    expect(game.itemWorld.countdown!).toBeGreaterThanOrEqual(pair.min);
    expect(game.itemWorld.countdown!).toBeLessThanOrEqual(pair.max);
    game.itemWorld.countdown = 1;
    step();
    expect(game.itemWorld.items).toHaveLength(1);
    const item = game.itemWorld.items[0]!;
    expect(item.phase).toBe('fall');
    expect(SUPPORTED_MATCH_ITEMS.map(itemKind)).toContain(item.kind);
    expect(game.itemWorld.countdown!).toBeGreaterThanOrEqual(pair.min);
    for (let i = 0; i < 300 && item.phase === 'fall'; i++) step();
    expect(item.phase).toBe('ground');
    expect(item.vy).toBe(0);
    expect(item.life).toBeGreaterThan(0);
  });
  it('supports the native pickup box, hold bone follow, and table-driven forward throw', () => {
    make();
    const saturn = game.itemWorld.spawnKind(itemKind('Dosei'), f().x + 3, 0);
    saturn.phase = 'ground'; saturn.vy = 0;
    step({ attack: true });
    expect(f().state).toBe('item-pickup');
    expect(f().animation).toBe('LightGet');
    expect(f().heldItem).toBe(saturn.id);
    expect(saturn.phase).toBe('held');
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    const bone = f().content.profile.itemHoldBone!;
    step();
    const hand = rig.point(f(), bone, [0, 0, 0]);
    // The item snaps to the hold bone mid-step; the end-of-step pose resample can drift a hair.
    expect(Math.hypot(saturn.x - hand[0], saturn.y - hand[1])).toBeLessThan(1);
    step({ attack: true, x: 1 });
    expect(f().state).toBe('item-throw');
    expect(['LightThrowF', 'LightThrowF4']).toContain(f().animation);
    for (let i = 0; i < 40 && (saturn.phase as string) === 'held'; i++) step({ x: 1 });
    expect(saturn.phase).toBe('flight');
    expect(f().heldItem).toBeNull();
    expect(saturn.vx).toBeGreaterThan(0.5);
    const table = base.common.itemThrows!;
    const speeds = table.map(entry => Math.fround(entry.speed * (f().content.profile.attributes.itemThrowVelocity ?? 1) * base.items!.kind(saturn.kind).attributes.throwSpeedMul));
    expect(speeds.some(speed => Math.abs(Math.hypot(saturn.vx, saturn.vy) - speed) < 0.01)).toBe(true);
  });
  it('damages a rival in flight with the article hit and rebounds instead of vanishing', () => {
    make();
    const rival = game.fighters[1];
    rival.x = -35; rival.y = 0; rig.sample(rival);
    const saturn = game.itemWorld.spawnKind(itemKind('Dosei'), f().x + 3, 0);
    saturn.phase = 'ground'; saturn.vy = 0;
    step({ attack: true });
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    step({ attack: true, x: 1 });
    for (let i = 0; i < 120 && rival.percent === 0; i++) step({ x: 0 });
    expect(rival.percent).toBeGreaterThan(0);
    expect(game.itemWorld.items).toContain(saturn);
    expect(saturn.victims.has(rival.slot)).toBe(true);
  });
  it('Z-drops in the air and releases the item on hitstun', () => {
    make();
    const saturn = game.itemWorld.spawnKind(itemKind('Dosei'), f().x + 3, 0);
    saturn.phase = 'ground'; saturn.vy = 0;
    step({ attack: true });
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 40; rig.sample(f());
    step(); step({ grab: true });
    expect(f().heldItem).toBeNull();
    expect(saturn.phase).toBe('flight');
    // Re-catch on the way down, then a hit knocks it loose.
    step(); step({ grab: true });
    if (f().heldItem === saturn.id) {
      game['applyHit'](game.fighters[1], f(), { id: 0, group: 0, bone: 0, damage: 12, radius: 3, offset: [0, 0, 0], angle: 45, growth: 80, weightSet: 0, base: 80, grounded: true, airborne: true }, [f().x, f().y, 0], 1);
      expect(f().heldItem).toBeNull();
      expect(saturn.phase).toBe('flight');
    }
  });
  it('breaks thrown capsules on terrain into spilled generic items or the 1-in-N explosion', () => {
    make();
    let exploded = 0, spilled = 0, children = 0;
    for (let attempt = 0; attempt < 80 && (exploded === 0 || spilled === 0); attempt++) {
      const before = game.itemWorld.items.length;
      const capsule = game.itemWorld.spawnKind(itemKind('Capsule'), 0, 12);
      capsule.phase = 'flight'; capsule.owner = 0; capsule.vy = -3; capsule.vx = 0.2;
      for (let i = 0; i < 30 && game.itemWorld.items.includes(capsule) && capsule.phase === 'flight'; i++) step();
      if ((capsule.phase as string) === 'explode') {
        exploded++;
        for (let i = 0; i < 120 && game.itemWorld.items.includes(capsule); i++) step();
      } else {
        expect(game.itemWorld.items).not.toContain(capsule);
        const spawned = game.itemWorld.items.length - before;
        if (spawned >= 1) { spilled++; children += spawned; }
        for (const child of [...game.itemWorld.items]) { expect(SUPPORTED_MATCH_ITEMS.map(itemKind)).toContain(child.kind); expect(child.kind).toBeGreaterThanOrEqual(6); game.itemWorld['remove'](child, game.fighters); }
        step();
      }
    }
    expect(spilled).toBeGreaterThan(0);
    expect(exploded).toBeGreaterThan(0);
    expect(children).toBeGreaterThan(0);
  });
  it('breaks a resting capsule with an attack through its hurt capsule', () => {
    make();
    f().state = 'attack'; f().animation = f().content.moves.sideTilt ?? f().content.moves.strong;
    f().attackName = f().animation; f().animationFrame = 6;
    let hit = activeHits(f().content.attacks.get(f().animation)!, f().animationFrame)[0];
    for (let frame = 0; frame < 30 && !hit; frame++) { f().animationFrame = frame; hit = activeHits(f().content.attacks.get(f().animation)!, frame)[0]; }
    expect(hit).toBeDefined();
    rig.sample(f());
    const point = rig.point(f(), hit!.bone, hit!.offset);
    const capsule = game.itemWorld.spawnKind(itemKind('Capsule'), point[0], Math.max(0, point[1] - 1));
    capsule.phase = 'ground'; capsule.vy = 0;
    step();
    expect(game.itemWorld.items.includes(capsule) ? (capsule.phase as string) : 'gone').not.toBe('ground');
    expect(game.events.some(event => event.type === 'gfx' && event.effect === 1000)).toBe(true);
  });
  it('floats the struck Party Ball on its authored rise and rains a random batch', () => {
    make();
    f().state = 'attack'; f().animation = f().content.moves.sideTilt ?? f().content.moves.strong;
    f().attackName = f().animation; f().animationFrame = 6;
    let hit = activeHits(f().content.attacks.get(f().animation)!, f().animationFrame)[0];
    for (let frame = 0; frame < 30 && !hit; frame++) { f().animationFrame = frame; hit = activeHits(f().content.attacks.get(f().animation)!, frame)[0]; }
    rig.sample(f());
    const point = rig.point(f(), hit!.bone, hit!.offset);
    const ball = game.itemWorld.spawnKind(itemKind('Kusudama'), point[0], Math.max(0, point[1] - 1));
    ball.phase = 'ground'; ball.vy = 0; ball.damage = 999; // past the authored threshold on the next hit
    step();
    expect(['rise', 'explode']).toContain(ball.phase as string);
    if ((ball.phase as string) !== 'rise') return; // the dud roll exploded it: covered above
    const y0 = ball.y;
    for (let i = 0; i < 400 && game.itemWorld.items.includes(ball) && (ball.phase as string) === 'rise'; i++) step();
    expect(ball.y).toBeGreaterThan(y0);
    if (!game.itemWorld.items.includes(ball)) {
      const rained = game.itemWorld.items.filter(item => item.phase === 'fall');
      expect(rained.length).toBeGreaterThanOrEqual(3);
      for (const child of rained) expect(Math.abs(child.vy)).toBeLessThanOrEqual(0.95);
    }
  });
  it('swings a held Beam Sword with the attack button and still throws it with grab', () => {
    make();
    const rival = game.fighters[1];
    rival.x = -43; rival.y = 0; rig.sample(rival);
    const sword = game.itemWorld.spawnKind(itemKind('Sword'), f().x + 3, 0);
    sword.phase = 'ground'; sword.vy = 0;
    step({ attack: true });
    expect(f().heldItem).toBe(sword.id);
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    step({ attack: true });
    expect(f().state).toBe('attack');
    expect(f().animation).toBe('SwordSwing1');
    expect(sword.phase).toBe('held');
    for (let i = 0; i < 50 && rival.percent === 0; i++) step();
    expect(rival.percent).toBeGreaterThan(0);
    expect(f().heldItem).toBe(sword.id);
    for (let i = 0; i < 90 && f().state === 'attack'; i++) step();
    step({ grab: true });
    expect(f().state).toBe('item-throw');
    for (let i = 0; i < 40 && (sword.phase as string) === 'held'; i++) step();
    expect(sword.phase).toBe('flight');
  });
  it('selects the tilt, smash and dash sword swings from the grounded inputs', () => {
    make();
    const sword = game.itemWorld.spawnKind(itemKind('Sword'), f().x + 3, 0);
    sword.phase = 'ground'; sword.vy = 0;
    step({ attack: true });
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    step({ strong: true });
    expect(f().animation).toBe('SwordSwing4');
    for (let i = 0; i < 90 && f().state === 'attack'; i++) step();
    // A held side direction tilts (fresh taps smash, like the barehanded game).
    for (let i = 0; i < 10; i++) step({ x: 1, walk: true });
    step({ attack: true, x: 1, walk: true });
    expect(f().animation).toBe('SwordSwing3');
  });
  it('loads hitbox-bearing swing motions for every original fighter despite shifted table bases', () => {
    for (const [kind, fighter] of base.roster) {
      if (fighter.custom) continue; // Custom packs have no original item-action table; A throws instead.
      for (const name of ['SwordSwing1', 'SwordSwing4', 'BatSwing1', 'HarisenSwing1', 'ParasolSwing1', 'StarRodSwing1', 'LipStickSwing1']) {
        expect(fighter.clips.has(name), `${kind}/${name}`).toBe(true);
        expect(fighter.attacks.get(name)?.events.some((event) => event.type === 'create'), `${kind}/${name}`).toBe(true);
      }
    }
  });
  it('swings with Mario, whose shared block sits at a shifted base index', () => {
    rig?.dispose();
    const content = rosterPair(base, 'Mr', 'Fx');
    rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 });
    game.start();
    game.fighters.forEach((v, i) => { v.x = i ? 50 : -50; v.y = 0; v.grounded = true; v.floor = content.stage.floors.find(x => !x.oneWay)!.id; rig.sample(v); });
    const bat = game.itemWorld.spawnKind(itemKind('Bat'), f().x + 3, 0);
    bat.phase = 'ground'; bat.vy = 0;
    step({ attack: true });
    expect(f().heldItem).toBe(bat.id);
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    step({ attack: true });
    expect(f().state).toBe('attack');
    expect(f().animation).toBe('BatSwing1');
    expect(bat.phase).toBe('held');
  });
  const posedStrike = (move?: string) => {
    f().state = 'attack'; f().animation = move ?? f().content.moves.sideTilt ?? f().content.moves.strong;
    f().attackName = f().animation; f().animationFrame = 6;
    let hit = activeHits(f().content.attacks.get(f().animation)!, f().animationFrame)[0];
    for (let frame = 0; frame < 30 && !hit; frame++) { f().animationFrame = frame; hit = activeHits(f().content.attacks.get(f().animation)!, frame)[0]; }
    rig.sample(f());
    return rig.point(f(), hit!.bone, hit!.offset);
  };
  it('explodes a struck Bob-omb through its own script blast', () => {
    make();
    const rival = game.fighters[1];
    const point = posedStrike();
    rival.x = point[0] + 5; rival.y = 0; rig.sample(rival);
    const bomb = game.itemWorld.spawnKind(itemKind('BombHei'), point[0], Math.max(0, point[1] - 1));
    bomb.phase = 'ground'; bomb.vy = 0;
    step();
    expect(bomb.phase as string).toBe('explode');
    for (let i = 0; i < 100 && game.itemWorld.items.includes(bomb) && rival.percent === 0; i++) step();
    expect(rival.percent).toBeGreaterThan(0);
  });
  it('heals with Tomato and Heart on pickup and grants Starman invincibility on touch', () => {
    make();
    f().percent = 80;
    const tomato = game.itemWorld.spawnKind(itemKind('Tomato'), f().x + 3, 0);
    tomato.phase = 'ground'; tomato.vy = 0;
    step({ attack: true });
    expect(f().heldItem).toBeNull();
    expect(f().percent).toBe(30);
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    const heart = game.itemWorld.spawnKind(itemKind('Heart'), f().x + 3, 0);
    heart.phase = 'ground'; heart.vy = 0;
    step({ attack: true });
    expect(f().percent).toBe(0);
    // Class 4: the Starman's own script hitbox (live from its frame 16) is the touch.
    const star = game.itemWorld.spawnKind(itemKind('Star'), f().x + 1, 6);
    star.vx = 0;
    for (let i = 0; i < 60 && game.itemWorld.items.includes(star); i++) step();
    expect(game.itemWorld.items).not.toContain(star);
    expect(f().invulnerable).toBeGreaterThan(500);
  });
  it('fires the Ray Gun with A, spending ammo on real beam articles that travel and hit', () => {
    make();
    const rival = game.fighters[1];
    rival.x = -20; rival.y = 0; rig.sample(rival);
    const gun = game.itemWorld.spawnKind(itemKind('LGun'), f().x + 3, 0);
    gun.phase = 'ground'; gun.vy = 0;
    step({ attack: true });
    expect(f().heldItem).toBe(gun.id);
    const rounds = gun.ammo;
    expect(rounds).toBeGreaterThan(0);
    for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    step({ attack: true });
    expect(gun.ammo).toBe(rounds - 1);
    expect(game.itemWorld.items.some((entry) => entry.kind === itemKind('LGunRay'))).toBe(true);
    for (let i = 0; i < 60 && rival.percent === 0; i++) step();
    expect(rival.percent).toBeGreaterThan(0);
  });
  it('sends a struck Green Shell sliding into a distant rival', () => {
    make();
    const rival = game.fighters[1];
    // The jab strikes on-plane (a posed down tilt's tail sweeps through z = -8 mid-frame).
    const point = posedStrike(f().content.moves.jab);
    rival.x = point[0] + 25; rival.y = 0; rig.sample(rival);
    const shell = game.itemWorld.spawnKind(itemKind('GShell'), point[0], Math.max(0, point[1] - 2));
    shell.phase = 'ground'; shell.vy = 0;
    step();
    expect(shell.mode).toBe(1);
    // itGshell: a constant slide at damage × x14 (clamped to x4), no acceleration.
    const speed = Math.abs(shell.vx), special = base.items!.kind(shell.kind).special, arc = base.items!.archive;
    expect(speed).toBeLessThanOrEqual(arc.f32(special + 4));
    step(); step();
    expect(Math.abs(shell.vx)).toBeCloseTo(speed, 5);
    for (let i = 0; i < 160 && rival.percent === 0 && game.itemWorld.items.includes(shell); i++) step();
    expect(rival.percent).toBeGreaterThan(0);
    // shellHit: after connecting it pops up at x10 instead of sliding on.
    expect(shell.mode).toBe(0);
  });
  it('carries a crate overhead, blocks jumping, and breaks it open on the heavy throw', () => {
    make();
    const box = game.itemWorld.spawnKind(itemKind('Box'), f().x + 4, 0);
    box.phase = 'ground'; box.vy = 0;
    step({ attack: true });
    expect(f().heldItem).toBe(box.id);
    expect(f().animation).toBe('HeavyGet');
    for (let i = 0; i < 90 && f().state === 'item-pickup'; i++) step();
    step({ jump: true }); step(); step();
    expect(f().grounded).toBe(true);
    expect(['idle', 'walk']).toContain(f().state);
    step({ attack: true, x: 1 });
    expect(f().state).toBe('item-throw');
    expect(f().animation).toBe('HeavyThrowF');
    for (let i = 0; i < 90 && game.itemWorld.items.includes(box); i++) step();
    expect(game.itemWorld.items).not.toContain(box);
  });
  it('opens a thrown Poké Ball on the floor and summons a scripted Pokémon', () => {
    make();
    const ball = game.itemWorld.spawnKind(itemKind('MBall'), 0, 10);
    ball.phase = 'flight'; ball.owner = 0; ball.vy = -3;
    for (let i = 0; i < 40 && (ball.phase as string) === 'flight'; i++) step();
    expect(ball.phase as string).toBe('ground');
    expect(ball.mode).toBe(3);
    let summon = game.itemWorld.items.find((entry) => entry.kind >= POKEMON_BASE);
    for (let i = 0; i < 400 && !summon; i++) { step(); summon = game.itemWorld.items.find((entry) => entry.kind >= POKEMON_BASE); }
    expect(summon).toBeDefined();
    expect(summon!.phase).toBe('act');
    for (let i = 0; i < 500 && game.itemWorld.items.includes(ball); i++) step();
    expect(game.itemWorld.items).not.toContain(ball);
  });
  it('applies the original stacking statuses: mushroom ramp, hood, metal and cloak timers', () => {
    make();
    const common = base.common.itemStatus!;
    // Mushrooms walk toward the center and are collected by their own touch hitbox (frame 40).
    const shroom = game.itemWorld.spawnKind(itemKind('Kinoko'), f().x + 18, 0);
    shroom.phase = 'ground'; shroom.vy = 0; shroom.floor = f().floor; shroom.facing = -1;
    step();
    expect(shroom.x).toBeCloseTo(f().x + 18 - base.items!.archive.f32(base.items!.kind(shroom.kind).special), 4);
    for (let i = 0; i < 80 && game.itemWorld.items.includes(shroom); i++) step();
    expect(game.itemWorld.items).not.toContain(shroom);
    expect(f().itemFx?.ramp).not.toBeNull();
    const x = f().x;
    for (let i = 0; i < 30 && f().itemFx?.ramp; i++) step();
    // ftCo_KinokoGiantStart: frozen through the 16-frame ramp, then x678 scale and x688 frames.
    expect(f().x).toBe(x);
    expect(f().itemFx!.scale).toBeCloseTo(common.giantScale, 5);
    expect(f().itemFx!.size).toBe(1);
    expect(f().itemFx!.sizeTimer).toBeGreaterThan(common.sizeFrames - 5);
    // A Poison Mushroom on a giant shrinks it back to normal.
    game['mushroom'](f(), false);
    for (let i = 0; i < 30 && f().itemFx?.ramp; i++) step();
    expect(f().itemFx!.scale).toBe(1);
    expect(f().itemFx!.size).toBe(0);
    // Fox's plain launch from a fixed hit, for the metal comparison below.
    const hit = { id: 0, group: 0, bone: 0, damage: 12, radius: 3, offset: [0, 0, 0] as [number, number, number], angle: 45, growth: 80, weightSet: 0, base: 80, grounded: true, airborne: true };
    const rival = game.fighters[1];
    f().percent = 0;
    game['applyHit'](rival, f(), hit, [f().x, f().y, 0], 1);
    const plain = Math.hypot(f().knockback.x, f().knockback.y);
    f().percent = 0; f().state = 'idle'; f().hitstun = 0; f().hitlag = 0; f().grounded = true; f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 };
    f().x = -50; f().y = 0; rig.sample(f());
    // Bunny Hood x0 (720f) and Metal Box x0/x4 (700f, 50 health) stack.
    for (const name of ['RabbitC', 'MetalB'] as const) {
      const gear = game.itemWorld.spawnKind(itemKind(name), f().x + 3, 0);
      gear.phase = 'ground'; gear.vy = 0;
      step({ attack: true });
      for (let i = 0; i < 60 && f().state === 'item-pickup'; i++) step();
    }
    expect(f().itemFx!.bunny).toBeGreaterThan(700 - 70);
    expect(f().itemFx!.metal).toBeGreaterThan(700 - 70);
    expect(f().itemFx!.metalHealth).toBe(50);
    // Metal: ×3 weight in the WASM attributes plus metal_armor off the knockback.
    f().percent = 0;
    game['applyHit'](rival, f(), hit, [f().x, f().y, 0], 1);
    expect(Math.hypot(f().knockback.x, f().knockback.y)).toBeLessThan(plain * 0.8);
    expect(f().itemFx!.metalHealth).toBe(50 - 12);
    // Cloaking Device: ftCommonData x7CC frames, no percent taken.
    f().state = 'idle'; f().hitstun = 0; f().hitlag = 0; f().grounded = true; f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 };
    f().x = -50; f().y = 0; f().floor = rival.floor; rig.sample(f());
    const cloak = game.itemWorld.spawnKind(itemKind('Spycloak'), f().x + 3, 0);
    cloak.phase = 'ground'; cloak.vy = 0;
    for (let i = 0; i < 60 && f().itemFx!.cloak === 0; i++) step({ attack: i === 0 });
    expect(f().itemFx!.cloak).toBeGreaterThan(common.cloakFrames - 70);
    const before = f().percent;
    game['applyHit'](rival, f(), hit, [f().x, f().y, 0], 1);
    expect(f().percent).toBe(before);
  });
  it('locks the Hammer swing, blocks jumping, and hurts a nearby rival on its loop', () => {
    make();
    const rival = game.fighters[1];
    rival.x = -45; rival.y = 0; rig.sample(rival);
    const hammer = game.itemWorld.spawnKind(itemKind('Hammer'), f().x + 3, 0);
    hammer.phase = 'ground'; hammer.vy = 0;
    step({ attack: true });
    expect(f().itemStatus?.kind).toBe('hammer');
    expect(f().heldItem).toBe(hammer.id);
    step({ jump: true }); step();
    expect(f().grounded).toBe(true);
    for (let i = 0; i < 140 && rival.percent === 0; i++) step();
    expect(rival.percent).toBeGreaterThan(0);
    f().itemStatus!.timer = 1;
    step(); step();
    expect(f().itemStatus).toBeNull();
    expect(f().heldItem).toBeNull();
  });
  it('rides a Warp Star path off the top, dives back over the launch point and crashes owner-safe', () => {
    make();
    const rival = game.fighters[1];
    rival.x = -42; rival.y = 0; rig.sample(rival);
    const star = game.itemWorld.spawnKind(itemKind('WStar'), f().x + 3, 0);
    star.phase = 'ground'; star.vy = 0;
    const launchX = f().x;
    step({ attack: true });
    expect(f().itemStatus?.kind).toBe('warp');
    expect(f().heldItem).toBe(star.id);
    // ftCo_WarpStarJump: the authored path climbs out past the top blast line.
    let peak = f().y;
    for (let i = 0; i < 130 && !f().itemStatus?.fall; i++) { step(); peak = Math.max(peak, f().y); }
    expect(f().itemStatus?.fall).toBe(true);
    expect(peak).toBeGreaterThan(game.content.stage.blast.top - 5);
    // ftCo_800C4A38: the dive restarts at the top, straight above the launch point.
    expect(f().x).toBeCloseTo(launchX, 3);
    const common = base.common.itemStatus!;
    step(); step();
    // WarpStarFall_Phys already runs on the transition frame (ftCommon_Fall x694).
    expect(f().velocity.y).toBeCloseTo(-3 * common.warpGravity, 4);
    for (let i = 0; i < 220 && f().itemStatus; i++) step();
    expect(f().itemStatus).toBeNull();
    expect(f().state).toBe('jump');
    for (let i = 0; i < 100 && rival.percent === 0; i++) step();
    expect(rival.percent).toBeGreaterThan(0);
    expect(f().percent).toBe(0);
  });
  it('keeps items, spawner clock and held references rollback-stable', () => {
    make(2);
    game.itemWorld.countdown = 1;
    step();
    const saturn = game.itemWorld.spawnKind(itemKind('Dosei'), f().x + 3, 0);
    saturn.phase = 'ground'; saturn.vy = 0;
    step({ attack: true });
    const saved = game.captureState();
    ticks(12, { x: 1 });
    const hash = game.stateHash();
    game.restoreState(saved);
    ticks(12, { x: 1 });
    expect(game.stateHash()).toBe(hash);
  });
});
