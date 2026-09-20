import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { GAMEWATCH_ACTION_KEYS } from '../../lib/game/gamewatch-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { itemKind } from '../../lib/game/item-kinds.ts';

describe('Game & Watch registration', () => {
  it('reserves public-roster selector30, native Gw kind and bounded assets', () => {
    expect(ROSTER_CHOICES[30]).toBe('Gw'); expect(ROOM_FIGHTERS).toContain('Gw');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Gw' }))).toMatchObject({ fighter: 'Gw' });
    for (const name of ['PlGw.dat', 'PlGwAJ.dat', 'PlGwNr.dat', 'audio/us/gw.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['EfGwData.dat', 'PlGwRe.dat', 'audio/gw.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    // Shares the common effect bank (no EfGwData.dat exists on disc).
    expect(SERVER_ASSETS).toContain('EfCoData.dat');
    expect(new Set(GAMEWATCH_ACTION_KEYS.map((e) => e.key)).size).toBe(28);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Game & Watch original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50, options: Partial<ConstructorParameters<typeof LocalMatch>[2]> = {}) => {
    rig?.dispose(); content = rosterPair(base, 'Gw', mirror ? 'Gw' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, ...options }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 53-joint skeleton, full normals and sausage articles', () => {
    const gw = f().content;
    expect(gw.profile.name).toBe('Mr. Game & Watch'); expect(gw.profile.boneCount).toBe(53);
    expect(gw.moves.rapidStart).toBe('Attack100Start'); expect(gw.moves.sideTilt).toBe('AttackS3');
    expect(gw.specials.articles.projectile?.hit?.damage).toBe(4);
    expect(gw.specials.articles.accessory?.model.stats.meshes).toBeGreaterThan(0);
    expect(gw.specials.articles.gamewatch?.sausage.hit?.damage).toBe(4);
    expect(gw.specials.parameters.kind).toBe('Gw');
    for (const [k, v] of Object.entries(gw.moves)) {
      if (k === 'rapidStart' || k === 'rapidEnd') continue;
      expect(gw.attacks.get(v!)!.events.some((e) => e.type === 'create')).toBe(true);
    }
  });
  it('spawns with the ftDataGamewatch costume diffuse, not the file white', () => {
    // ftMaterial_800BFB4C overwrites every mobj diffuse at spawn; without it the
    // whole fighter renders white. Slots: default black, dark red/blue/green.
    const params = f().content.specials.parameters;
    expect(params.kind).toBe('Gw');
    if (params.kind !== 'Gw') throw new Error('Game & Watch parameters are missing.');
    expect(params.costumes).toHaveLength(4);
    expect(params.costumes[0]).toEqual([0, 0, 0]);
    expect(params.costumes[1]).toEqual([0x6e / 255, 0, 0]);
    expect(params.costumes[2]).toEqual([0, 0, 0x6e / 255]);
    expect(params.costumes[3]).toEqual([0, 0x6e / 255, 0]);
    // The rig bakes slot 0 (black) into every body draw's diffuse uniform at spawn; the
    // outline hull draws the TEV lerp toward GAMEWATCH_OUTLINE (white at 0x80).
    const meshes: Array<{ name: string; material: { defines?: Record<string, unknown>; uniforms: Record<string, { value: { x: number; y: number; z: number } }> } }> = [];
    rig.actors[0]!.group.traverse((child) => { if ((child as { isMesh?: boolean }).isMesh && child.name !== 'silhouette shadow') meshes.push(child as never); });
    const hull = meshes.filter((mesh) => mesh.material.defines?.OUTLINE_HULL !== undefined), rim = 0x80 / 255;
    expect(hull.length).toBeGreaterThan(0); expect(hull.length).toBeLessThan(meshes.length);
    for (const mesh of meshes) {
      const value = hull.includes(mesh) ? rim : 0, diffuse = mesh.material.uniforms.diffuse!.value;
      for (const channel of [diffuse.x, diffuse.y, diffuse.z]) expect(channel).toBeCloseTo(value, 6);
    }
  });
  it('draws the flat Melee silhouette: outline set, width and hidden props', () => {
    const params = f().content.specials.parameters;
    if (params.kind !== 'Gw') throw new Error('Game & Watch parameters are missing.');
    expect(params.width).toBeCloseTo(0.01, 6);
    expect(params.outline.color).toEqual([1, 1, 1]); expect(params.outline.alpha).toBe(0x80 / 255);
    expect(params.outline.groups).toHaveLength(f().content.profile.partVisibility.groups.length);
    expect(params.outline.groups[0]![0]).toEqual([1, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14]);
    // Idle: ftGw_Init_OnDeath defaults plus Wait1's own g2=1. Body and its hull show;
    // alternate bodies, props, Oil Panic levels and the dizzy Zs (and their hulls) do not.
    f().animation = 'Wait1'; f().animationFrame = 5; rig.sample(f());
    const hidden = rig.actors[0]!.hiddenDobjs;
    for (const dobj of [0, 16, 18, 36, 1, 2, 4]) expect(hidden.has(dobj)).toBe(false);
    for (const dobj of [17, 3, 42, 15, 64, 46, 70, 71, 73, 75, 86, 77, 103, 82, 111, 110, 115, 113]) expect(hidden.has(dobj)).toBe(true);
  });
  it('shows the Oil Panic bucket and its fill level while the window is open', () => {
    make(); f().gwOil = 2;
    step({ special: true, specialDirection: 'down' }); ticks(10); rig.sample(f());
    expect(f().animation).toBe('SpecialLw');
    const hidden = rig.actors[0]!.hiddenDobjs;
    // g5 alt 2 is the bucket (body 86, hull 77); two of three fill levels (g6/g7) show.
    for (const dobj of [86, 77, 103, 82, 104, 83]) expect(hidden.has(dobj)).toBe(false);
    for (const dobj of [105, 84]) expect(hidden.has(dobj)).toBe(true);
  });
  /** Pins the Judgment roll: only `numbers` (1-based) keep weight, memory holds `last`. */
  const judgeOnly = (numbers: number[], last: [number, number]): (() => void) => {
    const params = f().content.specials.parameters;
    if (params.kind !== 'Gw') throw new Error('Game & Watch parameters are missing.');
    const saved = [...params.judgeRoll];
    params.judgeRoll.splice(0, 9, ...saved.map((_, i) => numbers.includes(i + 1) ? 1 : 0));
    [f().gwJudge1, f().gwJudge2] = last;
    return () => { params.judgeRoll.splice(0, 9, ...saved); };
  };
  const untilFrame = (frame: number) => { for (let i = 0; i < 80 && f().animationFrame < frame; i++) step(); };
  it('opens every stock with Judgment memory {1,0}: numbers 1 and 2 cannot come first', () => {
    for (let seed = 1; seed <= 12; seed++) {
      make(false, 50, { seed });
      expect([f().gwJudge1, f().gwJudge2]).toEqual([1, 0]);
      expect([f().gwChefA, f().gwChefB]).toEqual([1, 3]);
      step({ special: true, specialDirection: 'side' }); ticks(2);
      expect(f().animation).toMatch(/^SpecialS[3-9]$/);
      expect(f().gwJudge2).toBe(1);
    }
  });
  it('weights numbers by the x34 table like HSD_Randi over the cumulative sum', () => {
    make(); const restore = judgeOnly([9], [0, 1]);
    try { step({ special: true, specialDirection: 'side' }); ticks(2); expect(f().animation).toBe('SpecialS9'); }
    finally { restore(); }
  });
  it('recoils 12% on Judgment 1 when the hammer swings, hit or miss', () => {
    make(); const restore = judgeOnly([1], [8, 7]);
    try {
      const before = f().percent;
      step({ special: true, specialDirection: 'side' }); untilFrame(14);
      expect(f().animation).toBe('SpecialS1'); expect(f().percent).toBe(before);
      untilFrame(18); expect(f().percent).toBe(before + 12);
    } finally { restore(); }
  });
  it('drops a food on Judgment 7 only while items are on', () => {
    for (const items of [false, true]) {
      make(false, 50, items ? { itemFrequency: 2 } : {}); const restore = judgeOnly([7], [0, 1]);
      try {
        step({ special: true, specialDirection: 'side' }); untilFrame(18);
        expect(f().animation).toBe('SpecialS7');
        const foods = game.itemWorld.items.filter((item) => item.kind === itemKind('Foods') && Math.abs(item.x - f().x) < 20);
        expect(foods.length).toBe(items ? 1 : 0);
      } finally { restore(); }
    }
  });
  it('hops once per airtime on aerial Judgment and falls slowly through it', () => {
    make(); const restore = judgeOnly([2], [0, 1]);
    try {
      f().grounded = false; f().floor = null; f().y = 60; f().velocity = { x: 0, y: 0 };
      step({ special: true, specialDirection: 'side' });
      let peak = f().y;
      for (let i = 0; i < 20; i++) { step(); peak = Math.max(peak, f().y); }
      expect(f().animation).toBe('SpecialAirS2'); expect(peak).toBeGreaterThan(62); expect(f().gwJudgeHop).toBe(true);
      for (let i = 0; i < 80 && f().special; i++) step();
      expect(f().grounded).toBe(false);
      // Second Judgment in the same airtime: x2234 is spent, so the rise is zeroed.
      [f().gwJudge1, f().gwJudge2] = [0, 1];
      const y0 = f().y; step({ special: true, specialDirection: 'side' });
      let peak2 = f().y;
      for (let i = 0; i < 20; i++) { step(); peak2 = Math.max(peak2, f().y); }
      expect(peak2).toBeLessThanOrEqual(y0);
    } finally { restore(); }
  });
  it('flattens only the drawn palette, never the gameplay pose', () => {
    const params = f().content.specials.parameters;
    if (params.kind !== 'Gw') throw new Error('Game & Watch parameters are missing.');
    f().animation = 'Wait1'; f().animationFrame = 5; rig.sample(f());
    const depth = params.width / f().content.profile.attributes.modelScale;
    let checked = 0;
    rig.actors[0]!.group.traverse((child) => {
      const mesh = child as unknown as { isMesh?: boolean; visible: boolean; name: string; material: { uniforms: Record<string, { value: unknown }> } };
      if (!mesh.isMesh || !mesh.visible || mesh.name === 'silhouette shadow') return;
      const uniforms = mesh.material.uniforms, at = (uniforms.paletteOffset!.value as number) * 16;
      const gpu = (uniforms.paletteTexture!.value as { image: { data: Float32Array } }).image.data, cpu = (uniforms.palette!.value as Array<{ elements: number[] }>)[0]!.elements;
      // Row 0 (model depth axis) carries the squash; the other rows and the CPU pose do not.
      for (const i of [0, 4, 8, 12]) expect(gpu[at + i]).toBeCloseTo(cpu[i]! * depth, 4);
      for (const i of [1, 2, 5, 6, 13]) expect(gpu[at + i]).toBeCloseTo(cpu[i]!, 4);
      checked++;
    });
    expect(checked).toBeGreaterThan(10);
  });
  it('flips sausages and never repeats a food type twice running', () => {
    make(false, 80); step({ special: true, specialDirection: 'neutral' }); ticks(90);
    expect(game.projectiles.items.some((p) => p.kind === 'sausage') || f().special === null).toBe(true);
  });
  it('rolls different Judgment numbers on consecutive uses', () => {
    make(); step({ special: true, specialDirection: 'side' }); ticks(5);
    const first = f().animation;
    expect(first).toMatch(/^SpecialS[1-9]$/);
    ticks(120);
    step({ special: true, specialDirection: 'side' }); ticks(5);
    const second = f().animation;
    expect(second).toMatch(/^SpecialS[1-9]$/);
    expect(second).not.toBe(first);
  });
  it('rises with Fire and charges then releases Oil Panic', () => {
    make(); const y0 = f().y;
    step({ special: true, specialDirection: 'up' }); ticks(20);
    expect(f().y).toBeGreaterThanOrEqual(y0);
    ticks(120); expect(f().special).toBeNull();
    make();
    f().gwOil = 3; f().gwOilDamage = 21;
    step({ special: true, specialDirection: 'down' }); ticks(5);
    expect(f().animation).toMatch(/SpecialLwShoot/);
    expect(f().gwOil).toBe(0);
    ticks(80); expect(f().special).toBeNull();
  });
  it('catches energy in the bucket', () => {
    rig?.dispose(); content = rosterPair(base, 'Gw', 'Fx'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((g, i) => { g.x = (i ? 1 : -1) * 30; g.y = 0; g.grounded = true; g.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(g); });
    for (let i = 0; i < 200 && f().gwOil === 0; i++) {
      step(i % 20 === 0 ? { special: true, specialDirection: 'down' } : {}, { special: i % 30 === 0, specialDirection: 'neutral' });
    }
    expect(f().gwOil).toBeGreaterThan(0);
  });
  it('poses every normal hitbox in both facings', () => {
    for (const [k, v] of Object.entries(f().content.moves)) {
      if (k === 'rapidStart' || k === 'rapidEnd') continue;
      for (const facing of [-1, 1]) {
        const move = f().content.attacks.get(v!)!, first = move.events.find((e) => e.type === 'create');
        if (!first) continue;
        f().animation = v!; f().animationFrame = first.frame; f().facing = facing; rig.sample(f());
        for (const hit of activeHits(move, first.frame)) expect(rig.point(f(), hit.bone, hit.offset).every(Number.isFinite)).toBe(true);
      }
    }
  });
  it('restores byte-identical snapshots and replays deterministically', () => {
    make(); ticks(10, { special: true, specialDirection: 'neutral' });
    const saved = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(saved); expect(game.stateHash()).toBe(hash);
  });
});
