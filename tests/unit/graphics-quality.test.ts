import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GRAPHICS_PRESETS, GRAPHICS_QUALITIES, GRAPHICS_STORAGE_KEY, isGraphicsQuality, loadGraphicsQuality, saveGraphicsQuality } from '../../web/src/render/graphics-quality.ts';
import { PlayRenderer } from '../../web/src/render/play-renderer.ts';
import type { GameContent } from '../../lib/game/load.ts';
import type { LocalMatch, MatchFighter } from '../../lib/game/match.ts';

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return {...actual, WebGLRenderer: class {
    domElement = {id: '', setAttribute: vi.fn(), remove: vi.fn()};
    setPixelRatio = vi.fn(); setClearColor = vi.fn(); setSize = vi.fn(); setRenderTarget = vi.fn(); render = vi.fn(); compile = vi.fn(); dispose = vi.fn();
    // The post chain (web/src/render/post-processing.ts) measures the drawing
    // buffer and shares the frame's draw counters; both are no-ops here.
    getDrawingBufferSize = (target: {set(x: number, y: number): void}) => { target.set(1280, 720); return target; };
    info = {autoReset: true, reset: vi.fn()};
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
  const fighter = {profile: {kind: 'Fx', motionRoot: 0, boneMap: Array(54).fill(0), shieldBone: 0, attributes: {modelScale: 1, shieldSize: 8}}, model: {}, clips: new Map([['Wait1', {}]]), specials: {articles: {ghost: {model: {roots: [{name: 'x'}]}}}}, timelines: new Map()};
  return {fighters: Array.from({length: count}, () => fighter), stageModel: {}, stage: {scale: 1}, combat: {shield: {minimumScale: 0.1, maximum: 60, sizeScale: 1}}} as unknown as GameContent;
}
function match(data: GameContent, state: MatchFighter['state']): LocalMatch {
  return {content: data, frame: 0, phase: 'playing', projectiles: {items: []}, restoreRevision: 0, options: {player: 0}, controllerKinds: data.fighters.map(() => 'human'), fighters: data.fighters.map((content, slot) => ({slot, content, x: slot * 20, y: 0, grounded: true,
    state, stateFrame: 0, animation: 'Wait1', animationFrame: 0, facing: 1, special: null, smash: null, hitlag: 0, invulnerable: 0, combat: {shield: 60, flash: 0}}))} as unknown as LocalMatch;
}
class MemoryStorage { private map = new Map<string, string>(); getItem(k: string) { return this.map.get(k) ?? null; } setItem(k: string, v: string) { this.map.set(k, v); } removeItem(k: string) { this.map.delete(k); } }
beforeEach(() => { vi.stubGlobal('devicePixelRatio', 1); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => vi.unstubAllGlobals());

describe('graphics quality presets', () => {
  it('orders render cost from low to extra high without touching simulation inputs', () => {
    for (const ratio of [1, 1.5, 2, 3]) {
      const ratios = GRAPHICS_QUALITIES.map(q => GRAPHICS_PRESETS[q].pixelRatio(ratio));
      for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeGreaterThanOrEqual(ratios[i - 1]!);
      expect(ratios[0]!).toBeLessThan(ratios.at(-1)!);
    }
    const intervals = GRAPHICS_QUALITIES.map(q => GRAPHICS_PRESETS[q].stadiumInterval);
    expect(intervals).toEqual([...intervals].sort((a, b) => b - a));
    expect(GRAPHICS_PRESETS.high.pixelRatio(2)).toBe(2); expect(GRAPHICS_PRESETS.high.stadiumInterval).toBe(2); expect(GRAPHICS_PRESETS.high.particleLimit).toBeNull();
    expect(GRAPHICS_PRESETS.low.particleLimit).toBeLessThan(GRAPHICS_PRESETS.medium.particleLimit!);
  });
  it('persists a valid preference and falls back to high for missing, invalid or denied storage', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    expect(loadGraphicsQuality()).toBe('high');
    saveGraphicsQuality('low'); expect(localStorage.getItem(GRAPHICS_STORAGE_KEY)).toBe('low'); expect(loadGraphicsQuality()).toBe('low');
    localStorage.setItem(GRAPHICS_STORAGE_KEY, 'insane'); expect(loadGraphicsQuality()).toBe('high');
    expect(isGraphicsQuality('ultra')).toBe(true); expect(isGraphicsQuality('')).toBe(false); expect(isGraphicsQuality(3)).toBe(false);
    vi.stubGlobal('localStorage', undefined); expect(loadGraphicsQuality()).toBe('high'); expect(() => saveGraphicsQuality('medium')).not.toThrow();
    const denied = {} as Storage; Object.defineProperty(denied, 'getItem', { get() { throw new Error('denied'); } });
    vi.stubGlobal('localStorage', denied); expect(loadGraphicsQuality()).toBe('high');
  });
  it('applies pixel ratio, Stadium feed cadence/size and particle budget immediately', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const data = content(2), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data), world = match(data, 'idle');
    const gl = renderer.renderer as unknown as {setPixelRatio: ReturnType<typeof vi.fn>};
    expect(renderer.quality).toBe('high'); expect(gl.setPixelRatio).toHaveBeenLastCalledWith(2);
    const target = new THREE.WebGLRenderTarget(512, 256); const setSize = vi.spyOn(target, 'setSize');
    Object.assign(renderer, {stadiumScreen: {target, root: 1, parts: [6]}});
    renderer.setQuality('low');
    expect(renderer.quality).toBe('low'); expect(gl.setPixelRatio).toHaveBeenLastCalledWith(0.75);
    expect(setSize).toHaveBeenCalledWith(256, 128); expect(renderer.effects.common.particleLimit).toBe(96);
    for (const frame of [2, 4, 6]) { world.frame = frame; renderer.render(world); }
    expect(renderer.presentationSnapshot().stadiumCaptures).toBe(0);
    // Phase 3.5: `low` disables the jumbotron render-to-texture entirely and
    // keeps a static display instead of capturing every 8th frame.
    world.frame = 8; renderer.render(world); expect(renderer.presentationSnapshot().stadiumCaptures).toBe(0);
    renderer.setQuality('ultra');
    expect(gl.setPixelRatio).toHaveBeenLastCalledWith(3); expect(setSize).toHaveBeenLastCalledWith(1024, 512); expect(renderer.effects.common.particleLimit).toBeNull();
    world.frame = 9; renderer.render(world); expect(renderer.presentationSnapshot().stadiumCaptures).toBe(1);
    // Menu previews and fighter changes rebuild the effects layer; the budget must survive that.
    renderer.setQuality('medium'); renderer.setFighters(content(3));
    expect(renderer.effects.common.particleLimit).toBe(192); expect(renderer.quality).toBe('medium');
    renderer.dispose();
  });
});
