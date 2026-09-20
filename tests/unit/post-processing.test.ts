import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PostProcessing } from '../../web/src/render/post-processing.ts';
import { DEFAULT_VISUAL_EFFECT_CHOICES, VISUAL_EFFECT_TUNING, resolveVisualEffects } from '../../web/src/render/visual-effects.ts';

interface Pass { kind: string; target: THREE.WebGLRenderTarget | null }
/** Records the draws a chain issues. No GL is involved: three only allocates
 * targets and materials here, the passes themselves are never compiled. */
class FakeRenderer {
  passes: Pass[] = [];
  target: THREE.WebGLRenderTarget | null = null;
  info = { autoReset: true, reset: () => { this.resets++; } };
  resets = 0;
  failAt: string | null = null;
  constructor(private width = 1280, private height = 720, private readonly scene?: THREE.Scene) {}
  setDrawingBufferSize(width: number, height: number): void { this.width = width; this.height = height; }
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 { return target.set(this.width, this.height); }
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void { this.target = target; }
  render(scene: THREE.Scene): void {
    const kind = this.classify(scene);
    if (this.failAt === kind) throw new Error(`pass ${kind} failed`);
    this.passes.push({ kind, target: this.target });
  }
  private classify(scene: THREE.Scene): string {
    if (this.scene && scene === this.scene) return 'scene';
    const material = (scene.children[0] as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined;
    const source = material?.fragmentShader ?? '';
    if (source.includes('uniform float threshold')) return 'bright';
    if (source.includes('uniform vec2 direction')) return 'blur';
    if (source.includes('uniform mat4 projInv')) return 'ao';
    return 'composite';
  }
  kinds(): string[] { return this.passes.map(pass => pass.kind); }
}
/** Effects are opt-in (Auto keeps them off), so the chain tests pin the former high set On. */
const ENABLED = { ...DEFAULT_VISUAL_EFFECT_CHOICES, bloom: 'on', ao: 'on', grade: 'on', vignette: 'on' } as const;
function chain(quality: Parameters<typeof resolveVisualEffects>[0] = 'high', choices: Parameters<typeof resolveVisualEffects>[1] = ENABLED, size: [number, number] = [1280, 720]): { post: PostProcessing; fake: FakeRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 20_000);
  camera.updateProjectionMatrix();
  const fake = new FakeRenderer(size[0], size[1], scene);
  const post = new PostProcessing(fake as unknown as THREE.WebGLRenderer);
  post.setEffects(resolveVisualEffects(quality, choices));
  return { post, fake, scene, camera };
}
const sceneTargetOf = (post: PostProcessing): THREE.WebGLRenderTarget => (post as unknown as { scene: THREE.WebGLRenderTarget }).scene;

describe('post-processing chain', () => {
  it('draws straight to the canvas when every effect is off', () => {
    const off = { bloom: 'off', ao: 'off', grade: 'off', sharpen: 'off', vignette: 'off' } as const;
    const { post, fake, scene, camera } = chain('ultra', off);
    post.render(scene, camera);
    expect(post.enabled).toBe(false);
    expect(fake.kinds()).toEqual(['scene']);
    expect(fake.passes[0]!.target).toBeNull();
    expect(post.passes).toBe(0);
  });
  it('renders the scene offscreen and composites it back to the canvas', () => {
    const { post, fake, scene, camera } = chain('medium');
    post.render(scene, camera);
    expect(fake.kinds()[0]).toBe('scene');
    expect(fake.passes[0]!.target).not.toBeNull();
    expect(fake.kinds().at(-1)).toBe('composite');
    expect(fake.passes.at(-1)!.target).toBeNull();
    // Back on the canvas for whatever draws next (menus, captures).
    expect(fake.target).toBeNull();
  });
  it('blurs the bright pass at the tier resolution and pass count', () => {
    const { post, fake, scene, camera } = chain('high');
    post.render(scene, camera);
    const tuning = VISUAL_EFFECT_TUNING.high;
    expect(fake.kinds().filter(kind => kind === 'bright')).toHaveLength(1);
    expect(fake.kinds().filter(kind => kind === 'blur')).toHaveLength(tuning.bloomPasses * 2);
    const bloom = fake.passes.find(pass => pass.kind === 'bright')!.target!;
    expect([bloom.width, bloom.height]).toEqual([1280 / tuning.bloomScale, 720 / tuning.bloomScale]);
  });
  it('gives ambient occlusion a depth texture and its own half-size buffer', () => {
    const { post, fake, scene, camera } = chain('high');
    post.render(scene, camera);
    expect(sceneTargetOf(post).depthTexture).toBeInstanceOf(THREE.DepthTexture);
    const ao = fake.passes.find(pass => pass.kind === 'ao')!.target!;
    expect([ao.width, ao.height]).toEqual([1280 / VISUAL_EFFECT_TUNING.high.aoScale, 720 / VISUAL_EFFECT_TUNING.high.aoScale]);
  });
  it('skips the depth texture and the occlusion pass when that effect is off', () => {
    const { post, fake, scene, camera } = chain('high', { ...ENABLED, ao: 'off' });
    post.render(scene, camera);
    expect(sceneTargetOf(post).depthTexture).toBeFalsy();
    expect(fake.kinds()).not.toContain('ao');
  });
  it('multisamples the offscreen buffer on every tier that antialiases the canvas', () => {
    const high = chain('high'); high.post.render(high.scene, high.camera);
    expect(sceneTargetOf(high.post).samples).toBe(VISUAL_EFFECT_TUNING.high.samples);
    const low = chain('low'); low.post.render(low.scene, low.camera);
    expect(sceneTargetOf(low.post).samples).toBe(0);
  });
  it('follows the drawing buffer when the window or the preset resizes it', () => {
    const { post, fake, scene, camera } = chain('high');
    post.render(scene, camera);
    fake.setDrawingBufferSize(800, 600);
    post.render(scene, camera);
    const target = sceneTargetOf(post);
    expect([target.width, target.height]).toEqual([800, 600]);
    const bloom = fake.passes.filter(pass => pass.kind === 'bright').at(-1)!.target!;
    expect([bloom.width, bloom.height]).toEqual([400, 300]);
  });
  it('keeps the frame draw counters covering the scene plus its passes', () => {
    const { post, fake, scene, camera } = chain('high');
    post.render(scene, camera);
    expect(fake.resets).toBe(1);
    expect(fake.info.autoReset).toBe(true);
  });
  it('releases every buffer when the last effect is switched off', () => {
    const { post, fake, scene, camera } = chain('high');
    post.render(scene, camera);
    post.setEffects(resolveVisualEffects('high', { bloom: 'off', ao: 'off', grade: 'off', sharpen: 'off', vignette: 'off' }));
    expect(sceneTargetOf(post)).toBeNull();
    fake.passes = [];
    post.render(scene, camera);
    expect(fake.kinds()).toEqual(['scene']);
  });
  it('stands down and keeps drawing the plain frame when a pass fails', () => {
    const { post, fake, scene, camera } = chain('high');
    fake.failAt = 'composite';
    post.render(scene, camera);
    expect(post.failed).toBe(true);
    expect(post.active).toEqual([]);
    expect(fake.kinds().at(-1)).toBe('scene');
    expect(fake.passes.at(-1)!.target).toBeNull();
    fake.passes = [];
    post.render(scene, camera);
    expect(fake.kinds()).toEqual(['scene']);
  });
  it('drops its buffers and materials on dispose', () => {
    const { post, scene, camera } = chain('ultra');
    post.render(scene, camera);
    post.dispose();
    expect(sceneTargetOf(post)).toBeNull();
  });
});
