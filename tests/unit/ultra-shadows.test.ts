import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPHICS_PRESETS } from '../../web/src/render/graphics-quality.ts';
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
    poseVersion=0; shadowsOn=false; shadowTapCount=3; shadowGround: number | null = null; shadowOpacity=0;
    setAnimation() {this.poseVersion++;} update() {this.poseVersion++;} prepare() {} applyBillboards() {} dispose() { this.group.removeFromParent(); }
    hideObjects() {} clearJointPlacementOverrides() {} clearJointFrameOverrides() {} setJointTranslationOverride() {} setJointFrameOverride() {} setJointVisibilityOverride() {} setObjectOffset() {}
    setSilhouetteShadows(on: boolean) { this.shadowsOn = on; }
    setShadowTaps(count: number) { this.shadowTapCount = count; }
    setShadowGround(ground: number | null, opacity: number) { this.shadowGround = ground; this.shadowOpacity = opacity; }
    isStatic() { return false; }
    jointPoint(_bone: number, offset: [number, number, number]) { return this.group.position.clone().add(new three.Vector3(...offset)); }
  }};
});
function content(): GameContent {
  const fighter = {profile: {kind: 'Fx', motionRoot: 0, boneMap: Array(54).fill(0), shieldBone: 0, attributes: {modelScale: 1, shieldSize: 8}}, model: {}, clips: new Map([['Wait1', {}]]), specials: {articles: {ghost: {model: {roots: [{name: 'x'}]}}}}, timelines: new Map()};
  return {fighters: [fighter, fighter], stageModel: {}, stage: {scale: 1, floors: [{id: 1, a: [-100, 0], b: [100, 0], oneWay: false}]}, combat: {shield: {minimumScale: 0.1, maximum: 60, sizeScale: 1}}} as unknown as GameContent;
}
function match(data: GameContent): LocalMatch {
  return {content: data, frame: 1, phase: 'playing', projectiles: {items: []}, restoreRevision: 0, options: {player: 0}, controllerKinds: ['human', 'human'], fighters: data.fighters.map((fighterContent, slot) => ({slot, content: fighterContent, x: slot * 20, y: 0, grounded: true,
    state: 'idle' as MatchFighter['state'], stateFrame: 0, animation: 'Wait1', animationFrame: 0, facing: 1, special: null, smash: null, hitlag: 0, invulnerable: 0, combat: {shield: 60, flash: 0}}))} as unknown as LocalMatch;
}
function actorOf(renderer: PlayRenderer): { shadowsOn: boolean; shadowTapCount: number; shadowGround: number | null; shadowOpacity: number } {
  return renderer.rigs.actors[0] as unknown as { shadowsOn: boolean; shadowTapCount: number; shadowGround: number | null; shadowOpacity: number };
}
beforeEach(() => { vi.stubGlobal('devicePixelRatio', 1); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => vi.unstubAllGlobals());

describe('silhouette shadows render on every tier, lighter when low', () => {
  it('orders shadow strength low to ultra and keeps taps within budget', () => {
    expect(GRAPHICS_PRESETS.low.shadowStrength).toBeGreaterThan(0);
    expect(GRAPHICS_PRESETS.low.shadowStrength).toBeLessThan(GRAPHICS_PRESETS.medium.shadowStrength);
    expect(GRAPHICS_PRESETS.medium.shadowStrength).toBeLessThan(GRAPHICS_PRESETS.high.shadowStrength);
    expect(GRAPHICS_PRESETS.high.shadowStrength).toBeLessThanOrEqual(GRAPHICS_PRESETS.ultra.shadowStrength);
    expect(GRAPHICS_PRESETS.low.shadowTaps).toBeLessThanOrEqual(GRAPHICS_PRESETS.medium.shadowTaps);
    expect(GRAPHICS_PRESETS.medium.shadowTaps).toBeLessThanOrEqual(GRAPHICS_PRESETS.high.shadowTaps);
  });
  it('casts on high without rich light, lighter on low, full on ultra', () => {
    const data = content(), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data, undefined, 'high'), world = match(data);
    renderer.render(world);
    // High: shadows on at 0.7, legacy flat shading (rich stays ultra-only).
    expect(renderer.presentationSnapshot().shadows).toBe(true);
    expect(renderer.presentationSnapshot().richLight).toBe(false);
    expect(actorOf(renderer).shadowsOn).toBe(true);
    expect(actorOf(renderer).shadowGround).toBe(0);
    expect(actorOf(renderer).shadowTapCount).toBe(GRAPHICS_PRESETS.high.shadowTaps);
    expect(actorOf(renderer).shadowOpacity).toBeCloseTo(GRAPHICS_PRESETS.high.shadowStrength, 5);
    // Low: still casting, but lighter and fewer taps.
    renderer.setQuality('low');
    renderer.render(world);
    expect(renderer.presentationSnapshot().shadows).toBe(true);
    expect(actorOf(renderer).shadowTapCount).toBe(GRAPHICS_PRESETS.low.shadowTaps);
    expect(actorOf(renderer).shadowOpacity).toBeCloseTo(GRAPHICS_PRESETS.low.shadowStrength, 5);
    expect(actorOf(renderer).shadowOpacity).toBeLessThan(GRAPHICS_PRESETS.high.shadowStrength);
    // Ultra: full strength plus rich light.
    renderer.setQuality('ultra');
    renderer.render(world);
    expect(renderer.presentationSnapshot().shadows).toBe(true);
    expect(renderer.presentationSnapshot().richLight).toBe(true);
    expect(actorOf(renderer).shadowOpacity).toBeCloseTo(1, 5);
    renderer.dispose();
  });
  it('keeps rich light on manual ultra while effective pixels step down', () => {
    const data = content(), container = {clientWidth: 1000, clientHeight: 700, prepend: vi.fn()} as unknown as HTMLElement;
    const renderer = new PlayRenderer(container, data, undefined, 'ultra'), world = match(data);
    renderer.setQuality('high', 'ultra');
    expect(renderer.quality).toBe('high');
    const gl = renderer.renderer as unknown as {setPixelRatio: ReturnType<typeof vi.fn>};
    expect(gl.setPixelRatio).toHaveBeenLastCalledWith(1);
    renderer.render(world);
    // Pixels at high, but manual-ultra rich light stays — and low-tier shadows stay on.
    expect(renderer.presentationSnapshot().richLight).toBe(true);
    expect(renderer.presentationSnapshot().shadows).toBe(true);
    expect(actorOf(renderer).shadowOpacity).toBeCloseTo(GRAPHICS_PRESETS.high.shadowStrength, 5);
    renderer.dispose();
  });
});
