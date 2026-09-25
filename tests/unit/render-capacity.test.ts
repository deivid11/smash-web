import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { PLAYER_PRESENTATIONS } from '../../lib/game/player-colors.ts';
import { PlayRenderer } from '../../web/src/render/play-renderer.ts';
import { PlayEffects } from '../../web/src/render/play-effects.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import type { FighterContent, GameContent } from '../../lib/game/load.ts';
import type { LocalMatch, MatchFighter } from '../../lib/game/match.ts';

// Only GPU/asset model construction is stubbed. The renderer's real pool,
// update/reset/disposal code, Three meshes/materials, and DefenseVisuals run.
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return {...actual, WebGLRenderer: class {
    domElement = {id: '', setAttribute: vi.fn(), remove: vi.fn()};
    setPixelRatio = vi.fn(); setClearColor = vi.fn(); setSize = vi.fn(); setRenderTarget = vi.fn(); render = vi.fn(); compile = vi.fn(); dispose = vi.fn();
    // The post chain (web/src/render/post-processing.ts) measures the drawing
    // buffer and shares the frame's draw counters; both are no-ops here.
    getDrawingBufferSize = (target: {set(x: number, y: number): void}) => { target.set(1280, 720); return target; };
    info = {autoReset: true, reset: vi.fn()};
    // The off-screen magnifier (web/src/render/magnifier.ts) draws over the finished frame.
    autoClear = true; clear = vi.fn(); getRenderTarget = () => null; getPixelRatio = () => 1; getClearAlpha = () => 1;
    getClearColor = (target: unknown) => target;
  }};
});
vi.mock('../../web/src/render/model-instance.ts', async () => {
  const three = await import('three');
  return {ModelInstance: class {
    group = new three.Group(); tint = new three.Vector3(1, 1, 1); rotationOverrides = new Map(); hiddenDobjs = new Set();
    poseVersion=0; setAnimation() {this.poseVersion++;} update() {this.poseVersion++;} prepare() {} applyBillboards() {} dispose() { this.group.removeFromParent(); }
    hideObjects() {} clearJointPlacementOverrides() {} clearJointFrameOverrides() {} setJointTranslationOverride() {} setJointFrameOverride() {} setJointVisibilityOverride() {} setObjectOffset() {}
    isStatic() { return false; }
    jointPoint(_bone: number, offset: [number, number, number]) { return this.group.position.clone().add(new three.Vector3(...offset)); }
  }};
});
function content(count: number): GameContent {
  const fighter = {profile: {kind: 'Fx', motionRoot: 0, boneMap: Array(54).fill(0), shieldBone: 0, attributes: {modelScale: 1, shieldSize: 8}}, model: {}, clips: new Map([['Wait1', {}]]), specials: {articles: {ghost: {model: {roots: [{name: 'illusion'}]}}}}} as unknown as FighterContent;
  return {fighters: Array.from({length: count}, () => fighter), stageModel: {}, stage: {scale: 1}, combat: {shield: {minimumScale: 0.1, maximum: 60, sizeScale: 1}}} as unknown as GameContent;
}
function match(data: GameContent, state: MatchFighter['state']): LocalMatch {
  return {content: data, frame: 0, phase: 'playing', projectiles: {items: []}, options: {player: 0}, controllerKinds: data.fighters.map(() => 'human'), fighters: data.fighters.map((content, slot) => ({slot, content, x: slot * 20, y: 0, grounded: true,
    state, stateFrame: 0, animation: 'Wait1', animationFrame: 0, facing: 1, special: null, smash: null, hitlag: 0, invulnerable: 0, combat: {shield: 60, flash: 0}}))} as unknown as LocalMatch;
}
beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('eight-player supplemental rendering pools', () => {
  it('captures Stadium once per even simulation frame and refreshes corrected boundaries',()=>{
    const data=content(2),container={clientWidth:1000,clientHeight:700,prepend:vi.fn()} as unknown as HTMLElement;
    const renderer=new PlayRenderer(container,data),world=match(data,'idle');
    Object.assign(renderer,{stadiumScreen:{target:new THREE.WebGLRenderTarget(16,16),root:1,parts:[6]}});
    Object.assign(world,{restoreRevision:0});world.frame=2;
    renderer.render(world);renderer.render(world);renderer.render(world);
    expect(renderer.presentationSnapshot().stadiumCaptures).toBe(1);
    world.frame=3;renderer.render(world);expect(renderer.presentationSnapshot().stadiumCaptures).toBe(1);
    world.frame=4;renderer.render(world);expect(renderer.presentationSnapshot().stadiumCaptures).toBe(2);
    Object.assign(world,{restoreRevision:1});renderer.render(world);expect(renderer.presentationSnapshot().stadiumCaptures).toBe(3);
    renderer.render(world,0,true);expect(renderer.presentationSnapshot().stadiumCaptures).toBe(3);
    renderer.dispose();
  });
  it('allocates all eight palette-matched respawn rings and shield surfaces, then hides unused rematch slots', () => {
    const data = content(MAX_MATCH_PLAYERS), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data), world = match(data, 'respawn');
    const rings = renderer.scene.children.filter((object): object is THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => object instanceof THREE.Mesh && object.geometry instanceof THREE.RingGeometry);
    expect(rings).toHaveLength(MAX_MATCH_PLAYERS); expect(rings.map(ring => ring.material.color.getHex())).toEqual(PLAYER_PRESENTATIONS.map(player => player.color));
    renderer.render(world); expect(rings.every(ring => ring.visible)).toBe(true);
    rings.forEach((ring, slot) => expect(ring.position.x).toBe(slot * 20));
    world.fighters.forEach(f => { f.state = 'shield'; }); renderer.render(world);
    const shields = renderer.scene.children.filter(object => object.name === 'Prototype shield surface');
    expect(shields).toHaveLength(MAX_MATCH_PLAYERS); expect(shields.every(shield => shield.visible)).toBe(true); expect(rings.every(ring => !ring.visible)).toBe(true);
    const small = content(2); renderer.setFighters(small); renderer.render(match(small, 'respawn'));
    expect(renderer.rigs.actors).toHaveLength(2); expect(rings.map(ring => ring.visible)).toEqual(Array.from({length: MAX_MATCH_PLAYERS}, (_, slot) => slot < 2));
    expect(shields.every(shield => !shield.visible)).toBe(true); renderer.reset(); expect(rings.every(ring => !ring.visible)).toBe(true);
    const releases = rings.map(ring => ({geometry: vi.spyOn(ring.geometry, 'dispose'), material: vi.spyOn(ring.material, 'dispose')}));
    renderer.dispose(); releases.forEach(release => { expect(release.geometry).toHaveBeenCalledOnce(); expect(release.material).toHaveBeenCalledOnce(); });
  });
  it('colors respawn rings by sparse seat identity, never by compacted dense input slot', () => {
    const data = content(2), renderer = new PlayRenderer({clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement, data), world = match(data, 'respawn');
    world.fighters.forEach((fighter, slot) => Object.assign(fighter, {seatId: [1, 7][slot]})); renderer.render(world);
    const rings = renderer.scene.children.filter((object): object is THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => object instanceof THREE.Mesh && object.geometry instanceof THREE.RingGeometry);
    expect(rings.slice(0, 2).map(ring => ring.material.color.getHex())).toEqual([PLAYER_PRESENTATIONS[1].color, PLAYER_PRESENTATIONS[7].color]);
    expect(rings.map(ring => ring.visible)).toEqual(Array.from({length: MAX_MATCH_PLAYERS}, (_, slot) => slot < 2)); renderer.dispose();
  });
  it('frames crowded matches around the primary local human instead of the whole arena', () => {
    const data = content(MAX_MATCH_PLAYERS), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data), world = match(data, 'idle');
    // Slots stand at x = 0..140; fitting all would sit near x = 70, while the
    // focus shot stays centered on slot 0 at a watchable distance.
    renderer.render(world);
    expect(renderer.camera.position.x).toBe(0);
    expect(renderer.camera.position.z).toBeLessThanOrEqual(240);
    expect(renderer.camera.position.z).toBeGreaterThanOrEqual(110);
    expect(renderer.presentationSnapshot().camMode).toBe('focus');
    expect(renderer.presentationSnapshot().camFocus).toBe(0);
    expect(renderer.presentationSnapshot().camFallback).toBe(false);
    renderer.dispose();
  });
  it('falls back to any alive human when the configured slot is not one', () => {
    const data = content(MAX_MATCH_PLAYERS), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data), world = match(data, 'idle');
    Object.assign(world, { options: { player: 7 }, controllerKinds: world.controllerKinds.map((_kind, slot) => slot === 3 ? 'human' : 'cpu') });
    world.fighters.forEach((fighter, slot) => Object.assign(fighter, { x: slot === 3 ? 0 : 200 + slot * 20 }));
    renderer.render(world);
    const snapshot = renderer.presentationSnapshot();
    expect(snapshot.camMode).toBe('focus');
    expect(snapshot.camFocus).toBe(3);
    expect(snapshot.camFallback).toBe(true);
    expect(snapshot.camDetail).toBe('P4* p7=C/idle');
    expect(renderer.camera.position.x).toBe(0);
    renderer.dispose();
  });
  it('tracks all eight Illusion ghost owners, suppresses duplicate samples and retains the existing global effect ceiling', () => {
    const data = content(MAX_MATCH_PLAYERS), rigs = new GameRigs(data), scene = new THREE.Scene(), world = match(data, 'special');
    const effects = new PlayEffects(scene, data, rigs, new THREE.PerspectiveCamera());
    expect((effects as unknown as {lastGhost: number[]}).lastGhost).toEqual(Array(MAX_MATCH_PLAYERS).fill(-1));
    world.fighters.forEach(fighter => { fighter.special = {direction: 'side', phase: 'travel', age: 0, serial: 1} as MatchFighter['special']; fighter.stateFrame = 1; });
    effects.update(world); expect(effects.stats.transients).toBe(MAX_MATCH_PLAYERS);
    effects.update(world); expect(effects.stats.transients).toBe(MAX_MATCH_PLAYERS);
    for (let frame = 2; frame < 8; frame++) { world.fighters.forEach(fighter => { fighter.stateFrame = frame; }); effects.update(world); }
    expect(effects.stats.transients).toBe(24); // Not multiplied by the larger fighter count.
    effects.reset(); expect(scene.children).toHaveLength(0); expect((effects as unknown as {lastGhost: number[]}).lastGhost).toEqual(Array(MAX_MATCH_PLAYERS).fill(-1));
    effects.dispose(); rigs.dispose();
  });
  it('skips static stage updates after the first pose', () => {
    const data = content(2), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data), world = match(data, 'idle');
    // Static stages pose once (flag cached at setStage); animated stages update per frame.
    Object.assign(renderer, { stageStatic: true, stagePrimed: false });
    const update = vi.spyOn(renderer.stage, 'update');
    world.frame = 1; renderer.render(world); expect(update).toHaveBeenCalledTimes(1);
    world.frame = 2; renderer.render(world); expect(update).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });
  it('bounds live hit sparks by reusing pooled resources', () => {
    const data = content(2), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data), world = match(data, 'idle');
    const events = Array.from({ length: 30 }, (_, index) => ({ type: 'shield' as const, player: 0, x: index, y: 0 }));
    renderer.events(events, world);
    expect(renderer.scene.children.filter(object => object instanceof THREE.LineSegments).length).toBeLessThanOrEqual(24);
    renderer.reset();
    expect(renderer.scene.children.filter(object => object instanceof THREE.LineSegments)).toHaveLength(0);
    renderer.dispose();
  });
});
