import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput } from '../../lib/game/match.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import type { MeleePhysics } from '../../lib/game/physics.ts';
import {
  createOnettRuntime, onettAwningTouch, onettBuildingHit, onettCarHitReact,
  parseOnettData, stepOnettAwnings, stepOnettBuilding, stepOnettCars,
  type OnettData, type OnettFighterInfo,
} from '../../lib/game/onett.ts';

function cannedPhysics(values: number[]): MeleePhysics {
  let index = 0;
  return { random: () => values[(index++) % values.length]! } as unknown as MeleePhysics;
}
function syntheticData(): OnettData {
  return {
    scale: 0.9,
    tuning: {
      awningInitial: -1.5, maxVelocity: 2, velThreshold: 0.2, posThreshold: 0.2,
      damping: 0.05, springForce: 0.5, springConstant: 0.02, maxDisplacement: 7, awningDelta: -2,
      waitA: 600, waitB: 1200, delayLong: 300, delayShort: 600,
      buildHits: 5, rebuildHits: 7, rubbleMin: 300, rubbleMax: 500,
      waitCar: 450, stillWait: 400, rankDelayLast: 16, rankDelayMid: 30,
      speedBase: 3, speedRange: 2, spinRate: 24, warnFrames: 60,
    },
    hits: [
      { damage: 30, angle: 20, growth: 60, base: 50, size: 9, offsetY: 4, element: 0, soundKind: 2, soundSeverity: 2 },
      { damage: 30, angle: 25, growth: 90, base: 50, size: 9, offsetY: 4, element: 0, soundKind: 2, soundSeverity: 2 },
      { damage: 30, angle: 170, growth: 90, base: 50, size: 9, offsetY: 4, element: 0, soundKind: 2, soundSeverity: 2 },
      { damage: 30, angle: 290, growth: 90, base: 0, size: 9, offsetY: 6, element: 0, soundKind: 2, soundSeverity: 2 },
    ],
    buildingClipEnds: [null, 100, null, 140, 120, 110],
  };
}
const noFighters: OnettFighterInfo[] = [];

describe('Onett car machines (grOnett_801E43E0)', () => {
  it('parks both cars, waits out the original timers, then crosses', () => {
    // discard, A pick 0, B pick 1, A speed, B speed
    const physics = cannedPhysics([0.1, 0.1, 0.3, 0.5, 0.5]);
    const data = syntheticData();
    const rt = createOnettRuntime(physics);
    const sounds: number[] = [];
    let warned = 0;
    expect(rt.a.state).toBe(0); expect(rt.b.state).toBe(0);
    stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(rt.a.car).toBe(0); expect(rt.a.x).toBe(726); expect(rt.a.state).toBe(1); expect(rt.a.timer).toBe(450);
    expect(rt.b.car).toBe(1); expect(rt.b.x).toBe(-642); expect(rt.b.state).toBe(1);
    for (let i = 0; i < 450; i++) stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(rt.a.state).toBe(1); expect(rt.a.timer).toBe(0);
    stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(rt.a.state).toBe(2); expect(rt.a.timer).toBe(400);
    expect(rt.a.speed).toBeCloseTo(-4, 5); // -(2*0.5+3)
    expect(rt.b.speed).toBeCloseTo(4, 5);
    for (let i = 0; i < 400; i++) stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(rt.a.state).toBe(2); expect(rt.a.timer).toBe(0);
    stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(rt.a.state).toBe(5); expect(rt.a.visible).toBe(true);
    const x0 = rt.a.x;
    stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(rt.a.x).toBeLessThan(x0);
    // Engine sound + warning as the nose reaches x = 580.
    while (rt.a.x > 580) stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(warned).toBe(1);
    expect(sounds).toContain(0x5F377); // car 0's engine cue (the LTR car adds its own)
    // Despawn parks the machine back at rest.
    while (rt.a.state !== 0) stepOnettCars(rt, data, physics, noFighters, sounds, () => { warned += 1; });
    expect(rt.a.visible).toBe(false);
  });
  it('crosses immediately for a lone low fighter, delays for a losing one', () => {
    const data = syntheticData();
    const immediate = createOnettRuntime(cannedPhysics([0.1, 0.1, 0.3]));
    immediate.a.state = 2; immediate.a.timer = 400; immediate.a.speed = -4;
    const sounds: number[] = [];
    stepOnettCars(immediate, data, cannedPhysics([0.1]), [{ low: true, rank: 0, count: 1 }], sounds, () => {});
    expect(immediate.a.state).toBe(5); expect(immediate.a.visible).toBe(true);
    const delayed = createOnettRuntime(cannedPhysics([0.1, 0.1, 0.3]));
    delayed.a.state = 2; delayed.a.timer = 400; delayed.a.speed = -4;
    stepOnettCars(delayed, data, cannedPhysics([0.1]),
      [{ low: false, rank: 0, count: 2 }, { low: true, rank: 1, count: 2 }], sounds, () => {});
    expect(delayed.a.state).toBe(3); expect(delayed.a.timer).toBe(16);
  });
  it('reproduces identical crossings from identical RNG (rollback-safe)', () => {
    const run = () => {
      const physics = cannedPhysics([0.7, 0.2, 0.9, 0.4, 0.15, 0.8, 0.33]);
      const data = syntheticData();
      const rt = createOnettRuntime(physics);
      const sounds: number[] = [];
      for (let i = 0; i < 2000; i++) stepOnettCars(rt, data, physics, noFighters, sounds, () => {});
      return { rt, sounds };
    };
    const first = run(), second = run();
    expect(second.rt).toEqual(first.rt);
    expect(second.sounds).toEqual(first.sounds);
  });
  it('spins and speeds the car on dealing damage (grOnett_801E5030)', () => {
    const rt = createOnettRuntime(cannedPhysics([0.1]));
    rt.a.state = 5; rt.a.speed = -4;
    const sounds: number[] = [];
    onettCarHitReact(rt, cannedPhysics([0.9, 0.5, 0.1]), sounds);
    expect(rt.a.state).toBe(4);
    expect(rt.a.speed).toBeGreaterThan(-4);
    expect(sounds).toEqual([0x5F37D]);
    sounds.length = 0;
    onettCarHitReact(rt, cannedPhysics([0.1]), sounds);
    expect(rt.a.state).toBe(4);
    expect(sounds).toEqual([0x5F37C]);
  });
});

describe('Onett building machine (grOnett_801E3DA0)', () => {
  it('wobbles, collapses, phases the rooftop out, then rebuilds', () => {
    const data = syntheticData();
    const rt = createOnettRuntime(cannedPhysics([0.1]));
    const sounds: number[] = [];
    expect(stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds)).toBe(false);
    for (let i = 0; i < 4; i++) onettBuildingHit(rt, data);
    stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds);
    expect(rt.building.state).toBe(1);
    for (let i = 0; i < 100; i++) stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds);
    expect(rt.building.state).toBe(0); // wobble anim ends back at rest
    onettBuildingHit(rt, data);
    stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds);
    expect(rt.building.state).toBe(2); // fifth hit starts the collapse
    for (let i = 0; i < 140; i++) stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds);
    expect(rt.building.state).toBe(3);
    expect(sounds).toContain(0x5F373);
    onettBuildingHit(rt, data); onettBuildingHit(rt, data);
    stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds);
    expect(rt.building.state).toBe(5); // seventh hit brings it down
    expect(stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds)).toBe(true);
    while (rt.building.state === 5) stepOnettBuilding(rt, data, cannedPhysics([0.9]), sounds);
    expect(rt.building.state).toBe(6);
    expect(rt.building.hits).toBe(0);
    while (rt.building.state === 6) stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds);
    expect(rt.building.state).toBe(7);
    expect(rt.building.timer).toBe(0x3c);
    while (rt.building.state === 7) stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds);
    expect(rt.building.state).toBe(0);
    expect(stepOnettBuilding(rt, data, cannedPhysics([0.1]), sounds)).toBe(false);
  });
  it('ignores hits mid-collapse and mid-wobble states', () => {
    const data = syntheticData();
    const rt = createOnettRuntime(cannedPhysics([0.1]));
    rt.building.state = 5; rt.building.next = 5;
    onettBuildingHit(rt, data);
    expect(rt.building.next).toBe(5);
    rt.building.state = 4; rt.building.next = 4;
    onettBuildingHit(rt, data);
    expect(rt.building.next).toBe(4);
  });
});

describe('Onett awning springs (grOnett_801E5214)', () => {
  it('dips on contact, sounds once, and settles without blowing up', () => {
    const data = syntheticData();
    const rt = createOnettRuntime(cannedPhysics([0.1]));
    const sounds: number[] = [];
    onettAwningTouch(rt, data, 0);
    expect(rt.awnings[0]!.flag).toBe(1);
    expect(rt.awnings[0]!.initial).toBe(-1.5);
    expect(rt.awnings[0]!.counter).toBe(1);
    stepOnettAwnings(rt, data, sounds);
    expect(sounds).toEqual([0x5F375]);
    expect(rt.awnings[0]!.cooldown).toBe(9);
    expect(rt.awnings[0]!.counter).toBe(0);
    for (let i = 0; i < 600; i++) {
      stepOnettAwnings(rt, data, sounds);
      expect(Number.isFinite(rt.awnings[0]!.velocity)).toBe(true);
      expect(Number.isFinite(rt.awnings[1]!.velocity)).toBe(true);
    }
    expect(Math.abs(rt.awnings[0]!.velocity)).toBeLessThan(0.5);
    expect(sounds).toHaveLength(1); // cooldown + settled spring stay silent
  });
});

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Onett original ISO data', () => {
  let data: OnettData;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      data = parseOnettData((await session.model('GrOt.dat')).archive);
    } finally { await disc.close(); }
  });
  it('carries the exact car hits and stage tuning', () => {
    expect(data.hits.map((hit) => hit.damage)).toEqual([30, 30, 30, 30]);
    expect(data.hits.map((hit) => hit.angle)).toEqual([20, 25, 170, 290]);
    expect(data.hits.map((hit) => hit.growth)).toEqual([60, 90, 90, 90]);
    expect(data.hits.map((hit) => hit.base)).toEqual([50, 50, 50, 0]);
    for (const hit of data.hits) {
      expect(hit.size).toBeCloseTo(9, 2);
      expect(hit.element).toBe(0);
      expect(hit.soundKind).toBe(2); expect(hit.soundSeverity).toBe(2);
    }
    expect(data.hits[3]!.offsetY).toBeCloseTo(6, 2);
    expect(data.scale).toBeCloseTo(0.9, 5);
    expect(data.tuning.waitCar).toBe(450); expect(data.tuning.stillWait).toBe(400);
    expect(data.tuning.rankDelayLast).toBe(16); expect(data.tuning.rankDelayMid).toBe(30);
    expect(data.tuning.speedBase).toBe(3); expect(data.tuning.speedRange).toBe(2);
    expect(data.tuning.spinRate).toBe(24); expect(data.tuning.warnFrames).toBe(60);
    expect(data.tuning.buildHits).toBe(5); expect(data.tuning.rebuildHits).toBe(7);
    expect(data.tuning.rubbleMin).toBe(300); expect(data.tuning.rubbleMax).toBe(500);
    expect(data.buildingClipEnds.filter((end) => end !== null && end > 0).length).toBeGreaterThanOrEqual(4);
  });
});

describe.skipIf(!iso)('Onett full-match integration', () => {
  let base: GameContent;
  let rig: GameRigs;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)),
        new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'onett');
    } finally { await disc.close(); }
    rig = new GameRigs(base);
  }, 120000);
  const startOnett = () => {
    const content = rosterPair(base, 'Fx', 'Mr');
    const game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, seed: 7 });
    game.start();
    return game;
  };
  const streetFloorAt = (game: LocalMatch, x: number) => {
    const floors = game.content.stage.floors.filter((floor) => x >= floor.a[0] && x <= floor.b[0] && floor.a[1] < 8);
    return floors.sort((a, b) => b.a[1] - a.a[1])[0];
  };
  it('loads the SFX bank, full collision and hazard data', () => {
    expect(base.onettData).toBeDefined();
    expect(base.stage.floors.map((floor) => floor.id)).toEqual(Array.from({ length: 48 }, (_, id) => id));
    expect(base.sound.cues(0x5F370).length).toBeGreaterThan(0);
    expect(base.sound.sample(1385)).not.toBeNull();
  });
  it('runs a fighter over for 30% with the original knockback data', () => {
    const game = startOnett();
    const victim = game.fighters[1]!;
    const floor = streetFloorAt(game, 0)!;
    victim.x = 0; victim.y = floor.a[1]; victim.grounded = true; victim.floor = floor.id;
    victim.state = 'idle'; victim.invulnerable = 0;
    const rt = game.onett!;
    rt.a.state = 5; rt.a.car = 0; rt.a.x = 0; rt.a.speed = -4; rt.a.sub = 4; rt.a.visible = true;
    game.step([neutralInput(), neutralInput()]);
    expect(victim.percent).toBe(30);
    expect(victim.state).toBe('hitstun');
    expect(game.events.some((event) => event.type === 'hit' && event.player === victim.slot)).toBe(true);
    // Dealing damage kicks the car into its spin/speed-up reaction.
    expect([4, 6].includes(rt.a.state as number)).toBe(true);
  });
  it('leaves the left-to-right car harmless and shields hold', () => {
    const game = startOnett();
    const victim = game.fighters[1]!;
    const floor = streetFloorAt(game, 0)!;
    victim.x = 0; victim.y = floor.a[1]; victim.grounded = true; victim.floor = floor.id;
    victim.state = 'shield'; victim.animation = 'Guard'; victim.combat.shield = 60; victim.invulnerable = 0;
    const holdShield = [neutralInput(), { ...neutralInput(), shield: true }];
    const rt = game.onett!;
    rt.b.state = 5; rt.b.car = 1; rt.b.x = 0; rt.b.speed = 4; rt.b.sub = 4; rt.b.visible = true;
    game.step(holdShield);
    expect(victim.percent).toBe(0);
    expect(victim.state).toBe('shield');
    rt.a.state = 5; rt.a.car = 2; rt.a.x = 0; rt.a.speed = -4; rt.a.sub = 4; rt.a.visible = true;
    game.step(holdShield);
    expect(victim.percent).toBe(0);
    expect(victim.combat.shield).toBeLessThan(60);
    expect(game.events.some((event) => event.type === 'shield' && event.player === victim.slot)).toBe(true);
  });
  it('raises the crossing warning with the engine sound', () => {
    const game = startOnett();
    const rt = game.onett!;
    rt.a.state = 5; rt.a.car = 0; rt.a.x = 584; rt.a.speed = -4; rt.a.sub = 0; rt.a.visible = true;
    game.step([neutralInput(), neutralInput()]);
    expect(rt.warning).toBe(60);
    expect(game.snapshot().onett?.warning).toBe(60);
    expect(game.events.some((event) => event.type === 'sound' && event.sound === 0x5F377)).toBe(true);
  });
  it('phases the rooftop out while collapsed and restores it after', () => {
    const game = startOnett();
    const active = () => (game as unknown as { activeFloors(): Array<{ id: number }> }).activeFloors().map((floor) => floor.id);
    expect(active()).toContain(46); expect(active()).toContain(47);
    // Park both cars for the duration (live crossings would launch the striker).
    game.onett!.a.state = 1; game.onett!.a.timer = 99999; game.onett!.a.visible = false;
    game.onett!.b.state = 1; game.onett!.b.timer = 99999; game.onett!.b.visible = false;
    game.fighters[1]!.x = -150;
    // Strikes on the live rooftop feed the building machine through the real
    // strike scan: stand Fox on the roof and swing down-tilt at the line.
    const attacker = game.fighters[0]!;
    attacker.x = 8; attacker.y = 35.55; attacker.grounded = true; attacker.floor = 46;
    attacker.hitlag = 0; attacker.invulnerable = 0;
    const tilt = attacker.content.moves.downTilt;
    const move = attacker.content.attacks.get(tilt)!;
    let firstActive = -1;
    for (let frame = 0; frame < 60; frame++) {
      if (activeHits(move, frame).length > 0) { firstActive = frame; break; }
    }
    expect(firstActive).toBeGreaterThanOrEqual(0);
    attacker.attackName = tilt; attacker.animation = tilt;
    const swing = () => {
      attacker.state = 'attack'; attacker.animationFrame = firstActive;
      attacker.x = 8; attacker.y = 35.55; attacker.grounded = true; attacker.floor = 46;
      attacker.hitlag = 0;
    };
    // Strikes register through the real scan (each one also plays the wobble,
    // which ignores further hits until it ends); top up directly to the
    // collapse thresholds, exactly like further strikes would.
    for (let i = 0; i < 600 && game.onett!.building.hits < 2; i++) {
      if (game.onett!.building.state === 0) swing();
      game.step([neutralInput(), neutralInput()]);
    }
    expect(game.onett!.building.hits).toBeGreaterThanOrEqual(2);
    while (game.onett!.building.hits < 5) onettBuildingHit(game.onett!, base.onettData!);
    for (let i = 0; i < 600 && game.onett!.building.state !== 3; i++) game.step([neutralInput(), neutralInput()]);
    expect(game.onett!.building.state).toBe(3);
    while (game.onett!.building.hits < 7) onettBuildingHit(game.onett!, base.onettData!);
    for (let i = 0; i < 600 && game.onett!.building.state !== 5; i++) game.step([neutralInput(), neutralInput()]);
    expect(game.onett!.building.state).toBe(5);
    expect(active()).not.toContain(46); expect(active()).not.toContain(47);
  });
  it('captures, restores and hashes hazard state deterministically', () => {
    const game = startOnett();
    for (let i = 0; i < 100; i++) game.step([neutralInput(), neutralInput()]);
    const state = game.captureState();
    expect(state.onett).toBeDefined();
    const hash = game.stateHash();
    for (let i = 0; i < 40; i++) game.step([neutralInput(), neutralInput()]);
    expect(game.stateHash()).not.toBe(hash);
    game.restoreState(state);
    expect(game.stateHash()).toBe(hash);
    expect(game.onett!.a.x).toBe(state.onett!.a.x);
  });
});
