import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchOptions } from '../../lib/game/match.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { combatFloors, generateRun } from '../../lib/game/roguelike/generator.ts';
import { floorSetupFor, applyFloorToMatch } from '../../lib/game/roguelike/apply.ts';
import { emptyBoonState } from '../../lib/game/roguelike/boons.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { activeSeats, type PlayerControllerMode } from '../../lib/game/setup.ts';

const iso = process.env.MELEE_DISC_PATH;

// Prototype boon glue in lib/game/match.ts, proven against original disc data:
// neutral mods behave exactly like versus, while Rift Descent mods scale damage,
// poison, heal and stick speed. Versus behavior is covered by the sibling
// gameplay/combat suites; these cases pin the prototype layer only.
describe.skipIf(!iso)('roguelike prototype mods on original match data', () => {
  let content: GameContent;
  const rigs: GameRigs[] = [];
  const make = (options: MatchOptions = {}): LocalMatch => {
    const rig = new GameRigs(content);
    rigs.push(rig);
    const match = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, seed: 4242, ...options });
    match.start();
    return match;
  };
  const faceOff = (match: LocalMatch, gap = 8): void => {
    match.fighters.forEach((fighter, slot) => {
      fighter.x = slot === 0 ? -gap / 2 : gap / 2;
      fighter.y = 0;
      fighter.floor = 1;
      fighter.grounded = true;
      fighter.velocity = { x: 0, y: 0 };
      match.poses.sample(fighter);
    });
  };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const info = await verifyMeleeDisc(disc);
      const wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
      content = await loadGameContent(new HsdAssetSession(disc, info), wasm);
    } finally {
      await disc.close();
    }
  });
  afterAll(() => {
    for (const rig of rigs.splice(0)) rig.dispose();
  });

  it('scales the first landed hit by dealt x taken and applies venom', () => {
    const plain = make();
    faceOff(plain);
    const buffed = make();
    faceOff(buffed);
    buffed.fighters[0]!.rogue = { ...buffed.fighters[0]!.rogue, damageDealtMul: 1.5, venomTicks: 450 };
    const firstHitPercent = (match: LocalMatch): number => {
      for (let frame = 0; frame < 400; frame++) {
        const attack = frame % 15 === 0;
        match.step([{ ...neutralInput(), attack }, neutralInput()]);
        const percent = match.fighters[1]!.percent;
        if (percent > 0) return percent;
      }
      throw new Error('No hit landed within the frame budget.');
    };
    const base = firstHitPercent(plain);
    const scaled = firstHitPercent(buffed);
    expect(scaled / base).toBeCloseTo(1.5, 1);
    expect(buffed.fighters[1]!.poison).not.toBeNull();
    expect(plain.fighters[1]!.poison).toBeNull();
  });

  it('ticks prototype venom as percent-only damage that clears on expiry', () => {
    const match = make();
    faceOff(match);
    match.fighters[1]!.poison = { ticks: 151, amount: 1 };
    for (let frame = 0; frame < 151; frame++) match.step([neutralInput(), neutralInput()]);
    expect(match.fighters[1]!.percent).toBe(2);
    expect(match.fighters[1]!.poison).toBeNull();
    expect(match.fighters[1]!.stocks).toBe(3);
  });

  it('heals vampiric holders when a rival is KO’d', () => {
    const match = make();
    faceOff(match);
    match.fighters[0]!.rogue = { ...match.fighters[0]!.rogue, lifesteal: 10 };
    match.fighters[0]!.percent = 50;
    match.fighters[1]!.x = match.content.stage.blast.right + 10;
    for (let frame = 0; frame < 10; frame++) match.step([neutralInput(), neutralInput()]);
    expect(match.fighters[1]!.stocks).toBe(2);
    expect(match.fighters[0]!.percent).toBe(40);
  });

  it('boots a generated crowd floor with handicaps on real data', () => {
    const floor = ['RIFT-E14', 'RIFT-A', 'RIFT-B', 'RIFT-C', 'RIFT-D', 'RIFT-E']
      .flatMap((seed) => combatFloors(generateRun(seed, { difficulty: 'flame', playerFighter: 'Fx' })))
      .find((entry) => entry.modifier?.id === 'horde' || entry.modifier?.id === 'swarm');
    expect(floor, 'the probe seeds must hold a crowd floor').toBeDefined();
    // Base-disc content only: ACE rivals field their stand-ins, like a source without the extension disc.
    const setup = floorSetupFor(floor!, emptyBoonState(), 'Fx', { available: (kind) => content.roster.has(kind) });
    expect(setup.seats.filter((seat) => seat.control === 'cpu')).toHaveLength(floor!.enemies.length);
    const active = activeSeats(setup.seats);
    const selected = rosterPlayers(content, active.map((seat) => seat.fighter));
    const rig = new GameRigs(selected);
    rigs.push(rig);
    const match = new LocalMatch(selected, rig, {
      opponent: 'human', countdown: 0, seed: 99,
      controllers: active.map((seat): PlayerControllerMode => (seat.control === 'cpu' ? 'cpu' : 'human')),
      seatIds: active.map((seat) => seat.slot),
      cpuLevels: active.map((seat) => seat.level),
      stocks: setup.stocks, seconds: setup.seconds,
    });
    match.start();
    applyFloorToMatch(match, setup, { ...floor!, rift: false });
    expect(match.fighters).toHaveLength(8);
    expect(match.fighters[0]!.stocks).toBe(setup.stocks);
    for (let index = 1; index < match.fighters.length; index++) {
      expect(match.fighters[index]!.percent).toBe(40);
    }
    // Seven CPU brains step without errors.
    for (let frame = 0; frame < 30; frame++) {
      match.step(match.fighters.map(() => neutralInput()));
    }
    expect(match.phase).toBe('playing');
  });
  it('launches harder with launch power and crits on real hits', () => {
    const plain = make();
    faceOff(plain);
    const buffed = make();
    faceOff(buffed);
    buffed.fighters[0]!.rogue = { ...buffed.fighters[0]!.rogue, knockbackMul: 1.6, critChance: 1, critMul: 2 };
    const firstHit = (match: LocalMatch): { percent: number; speed: number; crit: boolean } => {
      for (let frame = 0; frame < 400; frame++) {
        const attack = frame % 15 === 0;
        match.step([{ ...neutralInput(), attack }, neutralInput()]);
        const victim = match.fighters[1]!;
        if (victim.percent > 0) return { percent: victim.percent, speed: Math.hypot(victim.knockback.x, victim.knockback.y), crit: match.events.some((event) => event.type === 'rogue' && event.rogue === 'crit') };
      }
      throw new Error('No hit landed within the frame budget.');
    };
    const base = firstHit(plain);
    const hit = firstHit(buffed);
    expect(base.crit).toBe(false);
    expect(hit.crit).toBe(true);
    expect(hit.percent / base.percent).toBeCloseTo(2, 1);
    expect(hit.speed).toBeGreaterThan(base.speed);
  });

  it('keeps the stock on a Last Stand KO', () => {
    const match = make();
    faceOff(match);
    match.fighters[1]!.rogue = { ...match.fighters[1]!.rogue, lastStand: 1 };
    match.fighters[1]!.x = match.content.stage.blast.right + 10;
    for (let frame = 0; frame < 10; frame++) match.step([neutralInput(), neutralInput()]);
    expect(match.fighters[1]!.stocks).toBe(3);
    expect(match.fighters[1]!.rogue.lastStand).toBe(0);
    expect(match.fighters[1]!.falls).toBe(1);
  });

  it('grants an extra midair jump to winged holders', () => {
    const jumps = (extra: number): number => {
      const match = make();
      faceOff(match);
      match.fighters[0]!.rogue = { ...match.fighters[0]!.rogue, extraJumps: extra };
      let most = 0;
      for (let frame = 0; frame < 90; frame++) {
        // Press/release pairs so every press is a fresh jump edge.
        const jump = frame % 10 < 2;
        match.step([{ ...neutralInput(), jump }, neutralInput()]);
        most = Math.max(most, match.fighters[0]!.jumpsUsed);
      }
      return most;
    };
    expect(jumps(1)).toBe(jumps(0) + 1);
  });

  it('runs every newly pooled original fighter and a boosted boss floor as CPUs', () => {
    for (const kind of ['Fc', 'Dr', 'Gn', 'Pc', 'Ms', 'Lg', 'Ys', 'Pp', 'Zd', 'Sk', 'Gw'] as const) {
      const selected = rosterPlayers(content, ['Fx', kind]);
      const rig = new GameRigs(selected);
      rigs.push(rig);
      const match = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 7, controllers: ['cpu', 'cpu'], cpuLevels: [9, 9] });
      match.start();
      match.fighters[1]!.rogue = { ...match.fighters[1]!.rogue, damageDealtMul: 2, damageTakenMul: 0.5, knockbackTakenMul: 0.5, lastStand: 1 };
      for (let frame = 0; frame < 240; frame++) match.step([neutralInput(), neutralInput()]);
      expect(match.phase, kind).toBe('playing');
    }
    const plan = generateRun('RIFT-GIGA', { playerFighter: 'Fx' });
    const boss = plan.map[39]![0]!.floor!;
    const setup = floorSetupFor(boss, emptyBoonState(), 'Fx', { available: (kind) => content.roster.has(kind) });
    const active = activeSeats(setup.seats);
    const selected = rosterPlayers(content, active.map((seat) => seat.fighter));
    const rig = new GameRigs(selected);
    rigs.push(rig);
    const match = new LocalMatch(selected, rig, {
      opponent: 'human', countdown: 0, seed: 11,
      controllers: active.map((seat): PlayerControllerMode => (seat.control === 'cpu' ? 'cpu' : 'human')),
      seatIds: active.map((seat) => seat.slot), cpuLevels: active.map((seat) => seat.level), stocks: setup.stocks, seconds: setup.seconds,
    });
    match.start();
    applyFloorToMatch(match, setup, boss);
    expect(match.fighters[1]!.content.profile.kind).toBe(content.roster.has('Gk') ? 'Gk' : 'Kp');
    expect(match.fighters[1]!.stocks).toBe(4);
    expect(match.fighters[1]!.rogue.damageTakenMul).toBeLessThan(0.5);
    for (let frame = 0; frame < 120; frame++) match.step(match.fighters.map(() => neutralInput()));
    expect(match.phase).toBe('playing');
  });
  it('scales full-tilt dash/run travel for speed holders and slows undertow victims', () => {
    // Speed boons scale the self-movement step (never the stored velocity or the
    // clamped stick), so full tilt — keyboard, level-9 CPUs — really moves faster.
    // Start far apart: a fresh dash reaches full speed at once, so an 8-unit gap would
    // push into the rival (body separation) inside the measured window.
    const plain = make();
    faceOff(plain, 60);
    const swift = make();
    faceOff(swift, 60);
    swift.fighters[0]!.rogue = { ...swift.fighters[0]!.rogue, speedMul: 1.3 };
    const slowed = make();
    faceOff(slowed, 60);
    slowed.fighters[0]!.hex = { doomTicks: 0, doomAmount: 0, doomBy: -1, weakTicks: 0, weakMul: 1, chillTicks: 600, chillMul: 0.6, retaliateTicks: 0 };
    const runFrames = (count: number): void => {
      for (let frame = 0; frame < count; frame++) {
        for (const match of [plain, swift, slowed]) match.step([{ ...neutralInput(), x: 1 }, neutralInput()]);
      }
    };
    // Settle into the run first (dash start-up frames carry their own motion), then compare steady travel.
    runFrames(8);
    const start = new Map([plain, swift, slowed].map((match) => [match, match.fighters[0]!.x]));
    runFrames(8);
    for (const match of [plain, swift, slowed]) {
      expect(match.fighters[0]!.grounded).toBe(true);
      expect(match.fighters[0]!.state).toBe('run');
    }
    const travel = (match: LocalMatch): number => match.fighters[0]!.x - start.get(match)!;
    expect(travel(swift) / travel(plain)).toBeCloseTo(1.3, 1);
    expect(travel(slowed) / travel(plain)).toBeCloseTo(0.6, 1);
    // Stored velocity is the original curve: nothing compounds frame to frame.
    expect(swift.fighters[0]!.velocity.x).toBeCloseTo(plain.fighters[0]!.velocity.x, 4);
  });
  it('keeps allied Rift rivals from striking each other while free-for-all rivals still connect', () => {
    const selected = rosterPlayers(content, ['Fx', 'Mr', 'Kb']);
    const trial = (team: number): number => {
      const rig = new GameRigs(selected);
      rigs.push(rig);
      const match = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 5, controllers: ['human', 'human', 'human'] });
      match.start();
      match.fighters.forEach((fighter, slot) => {
        fighter.x = slot === 0 ? -60 : slot === 1 ? 0 : 7;
        fighter.y = 0; fighter.floor = 1; fighter.grounded = true; fighter.velocity = { x: 0, y: 0 };
        fighter.facing = slot === 2 ? -1 : 1;
        if (slot > 0) fighter.rogue = { ...fighter.rogue, team };
        match.poses.sample(fighter);
      });
      for (let frame = 0; frame < 240; frame++) match.step([neutralInput(), { ...neutralInput(), attack: frame % 12 === 0 }, neutralInput()]);
      return match.fighters[2]!.percent;
    };
    expect(trial(2)).toBe(0);
    expect(trial(0)).toBeGreaterThan(0);
    // Allied CPUs hunt only the champion: over a long fight neither takes damage from the other.
    const rig = new GameRigs(selected);
    rigs.push(rig);
    const hunt = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 9, controllers: ['human', 'cpu', 'cpu'], cpuLevels: [1, 9, 9], stocks: 9 });
    hunt.start();
    hunt.fighters.slice(1).forEach((fighter) => { fighter.rogue = { ...fighter.rogue, team: 2 }; });
    for (let frame = 0; frame < 1500; frame++) hunt.step(hunt.fighters.map(() => neutralInput()));
    expect(hunt.fighters[1]!.percent + hunt.fighters[2]!.percent).toBe(0);
    expect(hunt.fighters[0]!.percent > 0 || hunt.fighters[0]!.stocks < 9).toBe(true);
  });
  it('ends a 1-vs-2 floor as a loss the moment the champion is out of stocks', () => {
    const selected = rosterPlayers(content, ['Fx', 'Mr', 'Kb']);
    const rig = new GameRigs(selected);
    rigs.push(rig);
    const match = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 21, controllers: ['human', 'cpu', 'cpu'], cpuLevels: [1, 9, 9], stocks: 2 });
    match.start();
    const [champion, ...rivals] = match.fighters;
    champion!.rogue = { ...champion!.rogue, essential: true };
    champion!.stocks = 1;
    champion!.x = match.content.stage.blast.right + 20;
    for (let frame = 0; frame < 30 && match.phase !== 'ended'; frame++) match.step(match.fighters.map(() => neutralInput()));
    expect(champion!.stocks).toBe(0);
    expect(match.phase).toBe('ended');
    expect(match.winner).not.toBe(0);
    expect(rivals.every((rival) => rival.stocks > 0)).toBe(true);
    // Without the champion flag a free-for-all keeps going between the survivors (versus rules unchanged).
    const versus = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 21, controllers: ['human', 'cpu', 'cpu'], cpuLevels: [1, 9, 9], stocks: 2 });
    versus.start();
    versus.fighters[0]!.stocks = 1;
    versus.fighters[0]!.x = versus.content.stage.blast.right + 20;
    for (let frame = 0; frame < 30; frame++) versus.step(versus.fighters.map(() => neutralInput()));
    expect(versus.fighters[0]!.stocks).toBe(0);
    expect(versus.phase).toBe('playing');
  });
});
