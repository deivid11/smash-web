/** Screen-space effect chain for the arena draw (glow, ambient occlusion,
 * color grade, sharpening, vignette). The scene renders into an offscreen
 * target, a few fullscreen passes run over it, and the composite writes the
 * canvas — so the original GX/TEV shading of every fighter and stage is left
 * exactly as it is and only the finished picture is touched.
 *
 * Presentation only: nothing here is ever read by simulation, snapshots or
 * hashes. With every effect off the chain steps aside completely and the
 * renderer draws straight to the canvas, so the cheapest tiers pay nothing.
 *
 * Color space: the offscreen target is plain RGBA8 (`NoColorSpace`), so
 * blending inside it matches the canvas byte for byte and a composite that
 * changes nothing reproduces the untouched frame. Scene shaders that encode
 * their own output do it explicitly (including installed custom sprite skins)
 * because three makes `<colorspace_fragment>` a no-op when the destination is
 * a render target. */
import * as THREE from 'three';
import { resolveVisualEffects, type ResolvedVisualEffects, type VisualEffectId } from './visual-effects.ts';

/** Explicit sRGB encode for scene shaders that used `<colorspace_fragment>`.
 * three only applies that chunk's transfer when the destination is the canvas:
 * rendering into a target switches it to the working (linear) space, so a
 * shader relying on the chunk would darken as soon as the chain turns on.
 * Encoding here keeps those materials identical either way; it is the same
 * curve three's `sRGBTransferOETF` uses. */
export const SRGB_ENCODE_FRAGMENT = 'gl_FragColor=vec4(mix(pow(gl_FragColor.rgb,vec3(0.41666))*1.055-vec3(0.055),gl_FragColor.rgb*12.92,vec3(lessThanEqual(gl_FragColor.rgb,vec3(0.0031308)))),gl_FragColor.a);';

/** Fullscreen triangle: one primitive, no matrices, no overdraw at the seam. */
function fullscreenGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return geometry;
}
const VERTEX = 'varying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}';

/** Bright pass: keeps only what outshines its own surroundings. A fixed
 * threshold cannot work here: the original's daylight stages sit above any
 * usable cut-off, so a whole sky would bloom into a white sheet. The scene
 * target carries mipmaps, and a high mip is a free local average, so the cut-off
 * rides a margin above the neighbourhood: neon on a dark stage, lasers, fire
 * and hit sparks pass, a uniformly bright sky or meadow does not.
 * Brightness is the strongest channel, not luminance (the original's energy
 * colours are saturated rather than light), and saturation lowers the bar a
 * little so coloured effects still read over a pale backdrop. */
const BRIGHT_FRAGMENT = `
uniform sampler2D tScene; uniform float threshold; uniform float margin; uniform float sourceLod; uniform float aroundLod; varying vec2 vUv;
void main(){
  vec3 c = textureLod(tScene, vUv, sourceLod).rgb;
  vec3 m = textureLod(tScene, vUv, aroundLod).rgb;
  float brightest = max(max(c.r, c.g), c.b);
  float saturation = (brightest - min(min(c.r, c.g), c.b)) / max(brightest, 1e-4);
  float around = max(max(m.r, m.g), m.b);
  float cut = max(threshold, around + margin) - saturation * 0.15;
  float k = clamp((brightest - cut) / max(1e-4, 1.0 - threshold), 0.0, 1.0);
  gl_FragColor = vec4(c * k * k, 1.0);
}`;
/** Separable 9-tap Gaussian; `direction` already carries the texel step. */
const BLUR_FRAGMENT = `
uniform sampler2D tSource; uniform vec2 direction; varying vec2 vUv;
void main(){
  vec3 sum = texture2D(tSource, vUv).rgb * 0.2270270270;
  sum += (texture2D(tSource, vUv + direction * 1.3846153846).rgb + texture2D(tSource, vUv - direction * 1.3846153846).rgb) * 0.3162162162;
  sum += (texture2D(tSource, vUv + direction * 3.2307692308).rgb + texture2D(tSource, vUv - direction * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;
/** Depth-only ambient occlusion. View positions come from the depth texture and
 * the normal from two neighbour samples (no derivative extension needed), so a
 * spiral of taps can ask how much of each point's hemisphere is blocked.
 * Background texels (depth 1) stay fully lit. */
const AO_FRAGMENT = `
uniform sampler2D tDepth; uniform mat4 projInv; uniform vec2 texel; uniform vec2 projScale;
uniform float radius; uniform float bias; uniform vec2 fade; varying vec2 vUv;
vec3 viewPos(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 view = projInv * clip;
  return view.xyz / view.w;
}
void main(){
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 p = viewPos(vUv);
  // Occlusion belongs to the fight plane. Far backdrops are flat paintings whose
  // coarse depth only yields noise and halos, so the effect fades out behind it.
  float reach = 1.0 - smoothstep(fade.x, fade.y, -p.z);
  if (reach <= 0.0) { gl_FragColor = vec4(1.0); return; }
  vec3 nx = viewPos(vUv + vec2(texel.x, 0.0)) - p;
  vec3 ny = viewPos(vUv + vec2(0.0, texel.y)) - p;
  vec3 n = normalize(cross(nx, ny));
  if (n.z < 0.0) n = -n;
  // Per-pixel rotation breaks the spiral into noise the composite blurs away.
  float angle = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float occlusion = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float a = angle + t * 12.5663706;
    vec2 offset = vec2(cos(a), sin(a)) * t * radius * projScale / max(1.0, -p.z);
    vec3 diff = viewPos(vUv + offset) - p;
    float len = length(diff);
    if (len < 1e-3) continue;
    occlusion += max(0.0, dot(n, diff / len) - bias) * (radius / (radius + len));
  }
  float ao = mix(1.0, clamp(1.0 - occlusion * 2.2 / float(SAMPLES), 0.0, 1.0), reach);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;
/** Final composite. Every effect is a compile-time branch, so a tier only pays
 * for the passes it actually asked for. */
const COMPOSITE_FRAGMENT = `
uniform sampler2D tScene; uniform vec2 texel;
#ifdef BLOOM
uniform sampler2D tBloom; uniform float bloomStrength;
#endif
#ifdef AO
uniform sampler2D tAO; uniform vec2 aoTexel; uniform float aoStrength;
#endif
#ifdef SHARPEN
uniform float sharpenStrength;
#endif
#ifdef GRADE
uniform float gradeStrength; uniform float gradeContrast; uniform float gradeVibrance;
#endif
#ifdef VIGNETTE
uniform float vignetteStrength;
#endif
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
#ifdef SHARPEN
  vec3 l = texture2D(tScene, vUv - vec2(texel.x, 0.0)).rgb, r = texture2D(tScene, vUv + vec2(texel.x, 0.0)).rgb;
  vec3 u = texture2D(tScene, vUv + vec2(0.0, texel.y)).rgb, d = texture2D(tScene, vUv - vec2(0.0, texel.y)).rgb;
  // Contrast-adaptive unsharp mask, clamped to the cross so edges never ring.
  vec3 lo = min(c, min(min(l, r), min(u, d))), hi = max(c, max(max(l, r), max(u, d)));
  c = clamp(c + (c * 4.0 - (l + r + u + d)) * sharpenStrength * 0.25, lo, hi);
#endif
#ifdef AO
  float ao = texture2D(tAO, vUv).r + texture2D(tAO, vUv + vec2(aoTexel.x, 0.0)).r + texture2D(tAO, vUv - vec2(aoTexel.x, 0.0)).r
    + texture2D(tAO, vUv + vec2(0.0, aoTexel.y)).r + texture2D(tAO, vUv - vec2(0.0, aoTexel.y)).r;
  c *= mix(1.0, ao * 0.2, aoStrength);
#endif
#ifdef BLOOM
  // Screen blend: the glow lifts what is under it but can never clip it white.
  c = 1.0 - (1.0 - c) * (1.0 - clamp(texture2D(tBloom, vUv).rgb * bloomStrength, 0.0, 1.0));
#endif
#ifdef GRADE
  // The picture is already display-referred, so a tone-mapping curve would only
  // flatten and fade it. An S-curve pinned at black, mid grey and white adds
  // depth without moving the exposure, and vibrance lifts the muted colours
  // while leaving the already saturated neon alone.
  // The curve's weight falls off with luminance: shadows and midtones deepen,
  // while a bright sky is not pushed the last few steps into clipping.
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 graded = mix(c, c * c * (3.0 - 2.0 * c), gradeContrast * (1.0 - luma * luma));
  // Bright colours pivot on their strongest channel instead of their luminance:
  // they gain saturation by deepening, never by pushing a channel into clipping.
  float strongest = max(max(graded.r, graded.g), graded.b), spread = strongest - min(min(graded.r, graded.g), graded.b);
  float pivot = mix(dot(graded, vec3(0.2126, 0.7152, 0.0722)), strongest, smoothstep(0.6, 1.0, strongest));
  graded = mix(vec3(pivot), graded, 1.0 + gradeVibrance * (1.0 - spread));
  c = mix(c, graded, gradeStrength);
#endif
#ifdef VIGNETTE
  vec2 offset = vUv - 0.5;
  // Corners only: the fall-off starts past the middle of the half-diagonal, so
  // the arena itself keeps its full brightness.
  c *= 1.0 - vignetteStrength * smoothstep(0.55, 1.0, length(offset) * 1.41421356);
#endif
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const OFF = resolveVisualEffects('high', { bloom: 'off', ao: 'off', grade: 'off', sharpen: 'off', vignette: 'off' });

export class PostProcessing {
  private settings: ResolvedVisualEffects = OFF;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.Camera();
  private readonly quad: THREE.Mesh;
  private scene: THREE.WebGLRenderTarget | null = null;
  private bloomA: THREE.WebGLRenderTarget | null = null;
  private bloomB: THREE.WebGLRenderTarget | null = null;
  private ao: THREE.WebGLRenderTarget | null = null;
  private bright: THREE.ShaderMaterial | null = null;
  private blur: THREE.ShaderMaterial | null = null;
  private aoMaterial: THREE.ShaderMaterial | null = null;
  private composite: THREE.ShaderMaterial | null = null;
  private compositeKey = '';
  private aoKey = -1;
  private width = 0; private height = 0; private samples = 0; private depthWanted = false; private mipsWanted = false;
  private readonly size = new THREE.Vector2();
  private readonly cameraPosition = new THREE.Vector3();
  /** Set when a pass throws (lost context, an unsupported target): the chain
   * stands down for good and the arena keeps drawing the plain picture. */
  failed = false;
  /** Passes drawn on the last frame (debug overlay and tests only). */
  passes = 0;
  /** Message from the failure that stood the chain down, if any. */
  error = '';

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.quad = new THREE.Mesh(fullscreenGeometry(), new THREE.MeshBasicMaterial());
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }
  get enabled(): boolean { return this.settings.enabled && !this.failed; }
  get active(): readonly VisualEffectId[] { return this.failed ? [] : this.settings.active; }
  setEffects(settings: ResolvedVisualEffects): void {
    this.settings = settings;
    if (!settings.enabled) { this.releaseTargets(); return; }
    // Ambient occlusion is the only pass that needs a depth texture, and the
    // sample count is a compile-time constant: both force a rebuild.
    const depthWanted = settings.aoStrength > 0, mipsWanted = settings.bloomStrength > 0;
    if (depthWanted !== this.depthWanted || mipsWanted !== this.mipsWanted || settings.samples !== this.samples) { this.depthWanted = depthWanted; this.mipsWanted = mipsWanted; this.samples = settings.samples; this.scene?.dispose(); this.scene = null; }
    if (!depthWanted) { this.ao?.dispose(); this.ao = null; }
    if (settings.bloomStrength <= 0) { this.bloomA?.dispose(); this.bloomB?.dispose(); this.bloomA = this.bloomB = null; }
    // A preset change can move the helper divisors under buffers that already exist.
    if (this.scene && this.width && this.height) this.resizeTargets();
  }
  /** Draws the scene through the chain. Falls back to a direct canvas draw when
   * nothing is enabled, or if the offscreen targets cannot be created. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.passes = 0;
    if (!this.enabled) { this.renderer.render(scene, camera); return; }
    try { if (this.chain(scene, camera)) return; }
    catch (error) {
      // A broken chain must never cost the player the match: stand down and
      // draw the frame the old way, this time and every time after it.
      this.failed = true; this.error = error instanceof Error ? error.message : String(error);
      try { this.releaseTargets(); } catch { /* the context is already gone */ }
      this.renderer.setRenderTarget(null);
    }
    this.renderer.render(scene, camera);
  }
  /** One composed frame; false when the offscreen buffer is not available yet. */
  private chain(scene: THREE.Scene, camera: THREE.PerspectiveCamera): boolean {
    this.renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, Math.floor(this.size.x)), height = Math.max(1, Math.floor(this.size.y));
    if (width !== this.width || height !== this.height) { this.width = width; this.height = height; this.resizeTargets(); }
    const target = this.sceneTarget();
    if (!target) return false;
    const info = this.renderer.info, autoReset = info.autoReset;
    // The scene draw plus the post passes are one frame's worth of work: keep
    // them in the same counters the HUD and telemetry already read.
    info.autoReset = false; info.reset();
    try {
      this.renderer.setRenderTarget(target);
      this.renderer.render(scene, camera);
      const bloom = this.settings.bloomStrength > 0 ? this.renderBloom(target) : null;
      const occlusion = this.settings.aoStrength > 0 && target.depthTexture ? this.renderAO(target, camera) : null;
      this.drawComposite(target, bloom, occlusion);
    } finally { this.renderer.setRenderTarget(null); info.autoReset = autoReset; }
    return true;
  }
  private draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.passes++;
  }
  private renderBloom(source: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget | null {
    const a = this.bloomA, b = this.bloomB;
    if (!a || !b) return null;
    const bright = this.bright ??= new THREE.ShaderMaterial({ uniforms: { tScene: { value: null }, threshold: { value: 0.7 }, margin: { value: 0.25 }, sourceLod: { value: 0 }, aroundLod: { value: 5 } }, vertexShader: VERTEX, fragmentShader: BRIGHT_FRAGMENT, depthTest: false, depthWrite: false });
    bright.uniforms.tScene!.value = source.texture; bright.uniforms.threshold!.value = this.settings.bloomThreshold; bright.uniforms.margin!.value = this.settings.bloomMargin;
    // The mip matching the bloom buffer prefilters thin lines (no shimmer); the
    // one about twenty texels wide is the neighbourhood the cut-off rides on.
    bright.uniforms.sourceLod!.value = Math.log2(Math.max(1, this.settings.bloomScale));
    bright.uniforms.aroundLod!.value = Math.max(0, Math.log2(Math.max(source.width, source.height) / 20));
    this.draw(bright, a);
    const blur = this.blur ??= new THREE.ShaderMaterial({ uniforms: { tSource: { value: null }, direction: { value: new THREE.Vector2() } }, vertexShader: VERTEX, fragmentShader: BLUR_FRAGMENT, depthTest: false, depthWrite: false });
    const direction = blur.uniforms.direction!.value as THREE.Vector2;
    for (let pass = 0; pass < this.settings.bloomPasses; pass++) {
      // Each pass widens the kernel, so a few cheap taps still reach far.
      const spread = pass + 1;
      blur.uniforms.tSource!.value = a.texture; direction.set(spread / a.width, 0); this.draw(blur, b);
      blur.uniforms.tSource!.value = b.texture; direction.set(0, spread / a.height); this.draw(blur, a);
    }
    return a;
  }
  private renderAO(source: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): THREE.WebGLRenderTarget | null {
    const target = this.ao, depth = source.depthTexture;
    if (!target || !depth) return null;
    if (!this.aoMaterial || this.aoKey !== this.settings.aoSamples) {
      this.aoMaterial?.dispose();
      this.aoKey = this.settings.aoSamples;
      this.aoMaterial = new THREE.ShaderMaterial({
        defines: { SAMPLES: Math.max(1, Math.round(this.settings.aoSamples)) },
        uniforms: { tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, texel: { value: new THREE.Vector2() }, projScale: { value: new THREE.Vector2() }, radius: { value: 6 }, bias: { value: 0.08 }, fade: { value: new THREE.Vector2(1e9, 2e9) } },
        vertexShader: VERTEX, fragmentShader: AO_FRAGMENT, depthTest: false, depthWrite: false,
      });
    }
    const material = this.aoMaterial;
    material.uniforms.tDepth!.value = depth;
    (material.uniforms.projInv!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (material.uniforms.texel!.value as THREE.Vector2).set(1 / target.width, 1 / target.height);
    // View-space radius → uv offset at this depth (halved because uv spans 2 in clip space).
    const projection = camera.projectionMatrix.elements;
    (material.uniforms.projScale!.value as THREE.Vector2).set(projection[0]! * 0.5, projection[5]! * 0.5);
    material.uniforms.radius!.value = this.settings.aoRadius;
    // The fight happens on the z = 0 plane, so the camera's distance to it is the
    // depth the effect is tuned for; a camera sitting on the plane disables the fade.
    const focus = Math.abs(camera.getWorldPosition(this.cameraPosition).z);
    if (focus > 1) (material.uniforms.fade!.value as THREE.Vector2).set(focus * 1.35, focus * 2.2);
    else (material.uniforms.fade!.value as THREE.Vector2).set(1e9, 2e9);
    this.draw(material, target);
    return target;
  }
  private drawComposite(source: THREE.WebGLRenderTarget, bloom: THREE.WebGLRenderTarget | null, ao: THREE.WebGLRenderTarget | null): void {
    const settings = this.settings;
    const key = `${bloom ? 1 : 0}${ao ? 1 : 0}${settings.gradeStrength > 0 ? 1 : 0}${settings.sharpenStrength > 0 ? 1 : 0}${settings.vignetteStrength > 0 ? 1 : 0}`;
    if (!this.composite || this.compositeKey !== key) {
      this.composite?.dispose();
      this.compositeKey = key;
      const defines: Record<string, string> = {};
      if (bloom) defines.BLOOM = '';
      if (ao) defines.AO = '';
      if (settings.gradeStrength > 0) defines.GRADE = '';
      if (settings.sharpenStrength > 0) defines.SHARPEN = '';
      if (settings.vignetteStrength > 0) defines.VIGNETTE = '';
      this.composite = new THREE.ShaderMaterial({
        defines,
        uniforms: {
          tScene: { value: null }, texel: { value: new THREE.Vector2() },
          tBloom: { value: null }, bloomStrength: { value: 0 },
          tAO: { value: null }, aoTexel: { value: new THREE.Vector2() }, aoStrength: { value: 0 },
          sharpenStrength: { value: 0 }, gradeStrength: { value: 0 }, gradeContrast: { value: 0 }, gradeVibrance: { value: 0 }, vignetteStrength: { value: 0 },
        },
        vertexShader: VERTEX, fragmentShader: COMPOSITE_FRAGMENT, depthTest: false, depthWrite: false,
      });
    }
    const material = this.composite, uniforms = material.uniforms;
    uniforms.tScene!.value = source.texture;
    (uniforms.texel!.value as THREE.Vector2).set(1 / source.width, 1 / source.height);
    uniforms.tBloom!.value = bloom?.texture ?? null; uniforms.bloomStrength!.value = bloom ? settings.bloomStrength : 0;
    uniforms.tAO!.value = ao?.texture ?? null; uniforms.aoStrength!.value = ao ? settings.aoStrength : 0;
    if (ao) (uniforms.aoTexel!.value as THREE.Vector2).set(1 / ao.width, 1 / ao.height);
    uniforms.sharpenStrength!.value = settings.sharpenStrength;
    uniforms.gradeStrength!.value = settings.gradeStrength; uniforms.gradeContrast!.value = settings.gradeContrast; uniforms.gradeVibrance!.value = settings.gradeVibrance;
    uniforms.vignetteStrength!.value = settings.vignetteStrength;
    this.draw(material, null);
  }
  /** Offscreen scene buffer, rebuilt when size, multisampling or the depth
   * requirement changes. Plain RGBA8 so blending matches the canvas exactly. */
  private sceneTarget(): THREE.WebGLRenderTarget | null {
    if (this.scene) return this.scene;
    if (!this.width || !this.height) return null;
    const options: THREE.RenderTargetOptions = {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace,
      // Only the glow reads the mip chain (its prefilter and local average);
      // every other pass samples texel for texel and stays on mip 0.
      minFilter: this.mipsWanted ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: this.mipsWanted,
      depthBuffer: true, stencilBuffer: false, samples: this.samples,
    };
    if (this.depthWanted) {
      const depth = new THREE.DepthTexture(this.width, this.height, THREE.UnsignedIntType);
      depth.minFilter = THREE.NearestFilter; depth.magFilter = THREE.NearestFilter;
      options.depthTexture = depth;
    }
    this.scene = new THREE.WebGLRenderTarget(this.width, this.height, options);
    this.allocateHelpers();
    return this.scene;
  }
  /** Bloom ping-pong and the ambient-occlusion buffer, both at their tier's divisor. */
  private allocateHelpers(): void {
    const settings = this.settings;
    if (settings.bloomStrength > 0 && !this.bloomA) {
      const width = Math.max(1, Math.floor(this.width / settings.bloomScale)), height = Math.max(1, Math.floor(this.height / settings.bloomScale));
      const options: THREE.RenderTargetOptions = { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
      this.bloomA = new THREE.WebGLRenderTarget(width, height, options);
      this.bloomB = new THREE.WebGLRenderTarget(width, height, options);
    }
    if (settings.aoStrength > 0 && !this.ao) {
      const width = Math.max(1, Math.floor(this.width / settings.aoScale)), height = Math.max(1, Math.floor(this.height / settings.aoScale));
      this.ao = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    }
  }
  private resizeTargets(): void {
    const settings = this.settings;
    // three reallocates the depth texture with the framebuffer on the next bind.
    this.scene?.setSize(this.width, this.height);
    if (this.bloomA && this.bloomB) {
      const width = Math.max(1, Math.floor(this.width / settings.bloomScale)), height = Math.max(1, Math.floor(this.height / settings.bloomScale));
      this.bloomA.setSize(width, height); this.bloomB.setSize(width, height);
    }
    if (this.ao) this.ao.setSize(Math.max(1, Math.floor(this.width / settings.aoScale)), Math.max(1, Math.floor(this.height / settings.aoScale)));
    this.allocateHelpers();
  }
  private releaseTargets(): void {
    this.scene?.dispose(); this.scene = null;
    this.bloomA?.dispose(); this.bloomB?.dispose(); this.bloomA = this.bloomB = null;
    this.ao?.dispose(); this.ao = null;
  }
  dispose(): void {
    this.releaseTargets();
    this.bright?.dispose(); this.blur?.dispose(); this.aoMaterial?.dispose(); this.composite?.dispose();
    this.bright = this.blur = this.aoMaterial = this.composite = null;
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}
