import * as THREE from 'three';
import { loadJointAnimation, sampleTrack, type AnimationClip } from '../../../lib/hsd/animation.ts';
import type { HsdModel, ModelRoot, ModelPart, ModelTexture, V3 } from '../../../lib/hsd/model.ts';
import { resolveMaterialLayers } from '../../../lib/hsd/model.ts';
import { jointMatrix } from '../../../lib/hsd/transform.ts';
import { loadMaterialAnimations, type MaterialAnimation } from '../../../lib/hsd/material-animation.ts';
import type { DecodedTexture } from '../../../lib/hsd/texture.ts';
import { programCacheKey, textureTevShader } from './texture-tev.ts';
import { modelGeometry, modelTexture, releaseModelGeometry, releaseModelTexture } from './model-resources.ts';
const animationResources=new WeakMap<ModelRoot,{animation:AnimationClip|null;materials:Map<string,MaterialAnimation>}>();
const UNIT_SCALE:V3=[1,1,1];
const copy3=(target:V3,source:V3):void=>{target[0]=source[0];target[1]=source[1];target[2]=source[2];};
export { jointMatrix } from '../../../lib/hsd/transform.ts';

/** Skinning palettes live in one float texture per instance (4 texels per matrix,
 * column-major, width a multiple of 4); each draw reads its slots from an offset.
 * One texture upload per instance replaces a 160-float uniform upload per draw. */
const paletteLookup = `
  uniform sampler2D paletteTexture;
  mat4 paletteMatrix(int slot) {
    int width = textureSize(paletteTexture, 0).x;
    int texel = slot * 4;
    ivec2 base = ivec2(texel % width, texel / width);
    return mat4(texelFetch(paletteTexture, base, 0), texelFetch(paletteTexture, base + ivec2(1, 0), 0),
      texelFetch(paletteTexture, base + ivec2(2, 0), 0), texelFetch(paletteTexture, base + ivec2(3, 0), 0));
  }
`;
const vertexShader = `
  attribute float gxMatrix;
  attribute vec4 gxColor;
  attribute vec2 gxUv2;
  uniform int paletteOffset;
  ${paletteLookup}
  uniform mat3 textureMatrix;
  uniform mat3 textureMatrix2;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying vec2 vReflUv;
  varying vec2 vReflUv2;
  varying vec4 vColor;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vFogDepth;
  void main() {
    mat4 bone = paletteMatrix(paletteOffset + int(gxMatrix));
    vec4 p = bone * vec4(position, 1.0);
    vUv = (textureMatrix * vec3(uv, 1.0)).xy;
    vUv2 = (textureMatrix2 * vec3(gxUv2, 1.0)).xy;
    // Generated sphere-map coordinates for reflection-texgen (TEX_COORD_REFLECTION)
    // layers, which carry no stored UVs: view-space normal mapped to a disc.
    // The TObj scale/translation still applies through the layer matrices above.
    vec3 viewN = normalize(normalMatrix * (mat3(bone) * normal));
    vec2 sph = reflect(vec3(0.0, 0.0, -1.0), viewN).xy * 0.5 + 0.5;
    vReflUv = (textureMatrix * vec3(sph, 1.0)).xy;
    vReflUv2 = (textureMatrix2 * vec3(sph, 1.0)).xy;
    vColor = gxColor;
    vNormal = normalize(mat3(modelMatrix) * mat3(bone) * normal);
    vec4 wp = modelMatrix * p;
    vWorldPos = wp.xyz;
  #ifdef OUTLINE_HULL
    // Outline pass (see setOutlineHull): slid back along its own view ray, so its
    // screen footprint is unchanged but the flat body in front always covers it.
    vec4 view = modelViewMatrix * p;
    view.xyz *= 1.0 + 0.5 / max(length(view.xyz), 1.0);
    gl_Position = projectionMatrix * view;
  #else
    gl_Position = projectionMatrix * modelViewMatrix * p;
  #endif
  }
`;
const fragmentShader = `
  uniform sampler2D image;
  uniform bool hasImage;
  uniform sampler2D image2;
  uniform bool hasImage2;
  uniform int texture2ColorMode;
  uniform int texture2AlphaMode;
  uniform float textureBlend2;
  uniform bool lit;
  uniform float richLit;
  uniform vec3 diffuse;
  uniform float opacity;
  uniform float fade;
  uniform vec4 tevConstant;
  uniform vec4 tevRegister0;
  uniform vec4 tevRegister1;
  uniform vec3 tint;
  uniform vec4 damageOverlay;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float fogEnabled;
  uniform int colorMode;
  uniform int textureColorMode;
  uniform int textureAlphaMode;
  uniform int alphaMode;
  uniform float textureBlend;
  uniform bool useReflUv;
  uniform bool useReflUv2;
  uniform float shininess;
  uniform bool specularOverlay;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying vec2 vReflUv;
  varying vec2 vReflUv2;
  varying vec3 vWorldPos;
  varying vec4 vColor;
  varying vec3 vNormal;
  varying float vFogDepth;
  void main() {
    vec3 c = diffuse;
    if (colorMode == 2) c = vColor.rgb;
    else if (colorMode == 3) c *= vColor.rgb;
    float a = alphaMode == 2 ? vColor.a : alphaMode == 3 ? opacity * vColor.a : opacity;
    if (hasImage) {
      vec4 t = texture2D(image, useReflUv ? vReflUv : vUv);
      /* TEXTURE_TEV */
      if (textureColorMode == 1) c = mix(c, t.rgb, t.a);
      else if (textureColorMode == 2) c = mix(c, t.rgb, t.rgb);
      else if (textureColorMode == 3) c = mix(c, t.rgb, textureBlend);
      else if (textureColorMode == 4) c *= t.rgb;
      else if (textureColorMode == 5) c = t.rgb;
      else if (textureColorMode == 7) c = min(c + t.rgb, vec3(1.0));
      else if (textureColorMode == 8) c = max(c - t.rgb, vec3(0.0));
      if (textureAlphaMode == 1) a = mix(a, t.a, t.a);
      else if (textureAlphaMode == 2) a = mix(a, t.a, textureBlend);
      else if (textureAlphaMode == 3) a *= t.a;
      else if (textureAlphaMode == 4) a = t.a;
      else if (textureAlphaMode == 6) a = min(a + t.a, 1.0);
      else if (textureAlphaMode == 7) a = max(a - t.a, 0.0);
    }
    // Second sampled layer: either a second diffuse/ext decal with stored UVs
    // (original painted floor markings) or a generated-coordinate reflection sheen.
    // A specular-role-only overlay with a BLEND/MODULATE colormap (fighter sheen)
    // is ADDED by the original specular TEV path (MObjMakeTExp RENDER_SPECULAR),
    // scaled by the specular light channel: Blinn-Phong NdotH^shininess with the
    // key light, so broad washes stay subtle and only mirror-aligned spots glint.
    // Stage shading washes use REPLACE and keep the file replace path (their
    // mid-gray artwork is sampled directly). See resolveMaterialLayers.
    if (hasImage2) {
      vec4 t2 = texture2D(image2, useReflUv2 ? vReflUv2 : vUv2);
      float specScale = 1.0;
      if (specularOverlay) {
        vec3 specN = normalize(vNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 halfDir = normalize(normalize(vec3(0.3, 0.8, 0.7)) + viewDir);
        specScale = pow(max(dot(specN, halfDir), 0.0), shininess);
      }
      if (texture2ColorMode == 1) c = mix(c, t2.rgb, t2.a);
      else if (texture2ColorMode == 2) c = mix(c, t2.rgb, t2.rgb);
      else if (texture2ColorMode == 3) c = mix(c, t2.rgb, textureBlend2);
      else if (texture2ColorMode == 4) c *= t2.rgb;
      else if (texture2ColorMode == 5) c = t2.rgb;
      else if (texture2ColorMode == 7) c = min(c + t2.rgb * specScale, vec3(1.0));
      else if (texture2ColorMode == 8) c = max(c - t2.rgb, vec3(0.0));
      if (texture2AlphaMode == 1) a = mix(a, t2.a, t2.a);
      else if (texture2AlphaMode == 2) a = mix(a, t2.a, textureBlend2);
      else if (texture2AlphaMode == 3) a *= t2.a;
      else if (texture2AlphaMode == 4) a = t2.a;
      else if (texture2AlphaMode == 6) a = min(a + t2.a, 1.0);
      else if (texture2AlphaMode == 7) a = max(a - t2.a, 0.0);
    }
    a *= fade;
    if (a <= 0.0) discard;
    if (lit) {
      vec3 n = normalize(vNormal);
      float key = max(dot(n, normalize(vec3(0.3, 0.8, 0.7))), 0.0);
      if (richLit > 0.5) {
        // Extra-high rig: warm key + cool fill + sky/ground hemisphere.
        // Same base brightness as legacy (~0.62-1.0 range) with more depth.
        float fill = max(dot(n, normalize(vec3(-0.55, 0.35, -0.45))), 0.0);
        float hemi = n.y * 0.5 + 0.5;
        vec3 amb = mix(vec3(0.52, 0.46, 0.40), vec3(0.74, 0.81, 0.92), hemi) * 0.58;
        c *= amb + vec3(1.0, 0.96, 0.90) * (key * 0.60) + vec3(0.52, 0.66, 0.95) * (fill * 0.30) + vec3(0.14);
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(lum), c, 1.10);
        c = (c - 0.5) * 1.05 + 0.5;
      } else {
        c *= 0.62 + 0.38 * key;
      }
    }
    // Original GX linear distance fog, applied per map object from its own
    // HSD_FogDesc (HSD_FogSet): factor 0 at fogNear, 1 at fogFar. Fighters and
    // effect skins carry no fog descriptor and skip this (their camera distance
    // keeps the difference imperceptible).
    if (fogEnabled > 0.5) c = mix(c, fogColor, clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0));
    gl_FragColor = vec4(mix(c * tint, damageOverlay.rgb, damageOverlay.a), a);
  }
`;
interface Pose {
  matrix: THREE.Matrix4; inverseBind: THREE.Matrix4; scale: V3; rotation: V3; translation: V3;
  accumulatedScale: V3; visible: boolean;
  /** Lazily cached invert(inverseBind): constant for the instance lifetime. */
  bind: THREE.Matrix4 | null;
}
/** Every field exists from creation (one hidden class for the per-frame prepare loop). */
interface Draw { part: ModelPart; mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; palette: THREE.Matrix4[]; texture?: ModelTexture; overlay?: ModelTexture; materialAnimation: MaterialAnimation | undefined; textureOverride: THREE.Texture | null;
  /** Material animation drives alpha (forces the transparent pass). */
  alphaAnimated: boolean;
  /** Envelope influence joint indices, resolved on first prepare. */
  envelopeJoints: number[][] | null;
  /** Skeleton ancestor of an envelope owner; -2 until resolved. */
  skeleton: number;
  /** First palette-texture slot and slot count (envelopes, or 1 for rigid parts). */
  paletteOffset: number; paletteSlots: number;
  /** Slots currently hold zeros (hidden part: its merged silhouette collapses). */
  paletteZeroed: boolean;
  /** Outline-pass colour (setOutlineHull); null for regular draws. */
  outline: THREE.Vector3 | null }
interface RootInstance { source: ModelRoot; poses: Pose[]; byId: Map<number, number>; draws: Draw[]; animation: AnimationClip | null;
  /** Per-joint skin matrices (matrix × inverseBind) memoized within one prepare() pass. */
  skin: THREE.Matrix4[]; skinStamp: number[] }
export interface ObjectOverride { offset?: V3; rotationY?: number; scale?: number; animationFrame?: number; visible?: boolean }

/** Phase 3.3 cache key: per-draw ShaderMaterials share compiled programs.
 * The only source variation is the TEV snippet (see texture-tev.ts). */
export { programCacheKey } from './texture-tev.ts';
/** Ultra-only true-silhouette shadows: the animated fighter re-drawn flattened
 * onto its receiver plane along a fixed sun direction, so the shadow is the
 * character's real posed silhouette (not a blob). Shares geometry and the live
 * pose palette with the main draws; only the tiny projection program is new. */
const shadowVertexShader = `
  attribute float gxSlot;
  ${paletteLookup}
  // One instanced draw per part: instance i is penumbra tap i (see SHADOW_TAPS).
  uniform vec3 sunDirs[3];
  uniform float tapWeights[3];
  uniform float groundY;
  varying float vFade;
  varying float vH;
  varying vec3 vWorld;
  void main() {
    vec3 sunDir = sunDirs[gl_InstanceID];
    vec4 wp = modelMatrix * (paletteMatrix(int(gxSlot)) * vec4(position, 1.0));
    float h = wp.y - groundY;
    float t = max(h / sunDir.y, 0.0);
    vec3 sp = wp.xyz - sunDir * t;
    sp.y = groundY + 0.5;
    vWorld = wp.xyz;
    vH = max(h, 0.0);
    // The tap weight is constant per instance, so folding it into the
    // interpolated fade is exactly the old per-tap opacity uniform.
    vFade = clamp(1.0 - max(h, 0.0) / 30.0, 0.2, 1.0) * tapWeights[gl_InstanceID];
    gl_Position = projectionMatrix * viewMatrix * vec4(sp, 1.0);
  }
`;
// Natural shade, not paint: multiply-blends a cool daylight tint over the
// terrain so the surface hue survives (black overlays go chalky gray here).
// Strength hardens at contact height, softens into a penumbra with distance
// from the caster, and eases off as the fighter climbs.
const shadowFragmentShader = `
  uniform float opacity;
  uniform vec2 casterXZ;
  varying float vFade;
  varying float vH;
  varying vec3 vWorld;
  void main() {
    float d = distance(vWorld.xz, casterXZ);
    float penumbra = 1.0 - smoothstep(5.0, 16.0, d);
    float contact = 1.0 - clamp(vH / 10.0, 0.0, 1.0);
    float k = opacity * vFade * penumbra * mix(0.5, 1.0, contact);
    gl_FragColor = vec4(mix(vec3(1.0), vec3(0.40, 0.48, 0.66), clamp(k, 0.0, 1.0)), 1.0);
  }
`;
/** Fixed sun (toward-sun, normalized): shadows fall right and away from the
 * camera, beside the feet instead of pooling underneath. */
const SHADOW_SUN = new THREE.Vector3(-0.331, 0.87, 0.365);
/** Penumbra taps: the core plus two laterally jittered copies whose offsets
 * grow with caster height (like a real penumbra), softening the silhouette
 * rim without any render target. Weights share one opacity across taps. */
const SHADOW_TAPS: readonly { offset: readonly [number, number]; weight: number }[] = [
  { offset: [0, 0], weight: 0.5 },
  { offset: [0.07, 0.06], weight: 0.25 },
  { offset: [-0.07, -0.06], weight: 0.25 },
];
const SHADOW_SUN_DIRS = SHADOW_TAPS.map(tap => new THREE.Vector3(SHADOW_SUN.x + tap.offset[0], SHADOW_SUN.y, SHADOW_SUN.z + tap.offset[1]));
const SHADOW_TAP_WEIGHTS = SHADOW_TAPS.map(tap => tap.weight);
/** Identity instance transforms shared by every silhouette draw (the shader
 * ignores instanceMatrix; tap placement comes from sunDirs[gl_InstanceID]). */
const SHADOW_INSTANCE_MATRICES = new THREE.InstancedBufferAttribute(new Float32Array(SHADOW_TAPS.flatMap(() => new THREE.Matrix4().toArray())), 16);
/** Children with identity local transforms reuse the owner's world matrix
 * object instead of recomposing and multiplying it on every scene update. */
function scaleInto(out: number[], source: readonly number[], weight: number): void {
  for (let component = 0; component < 16; component++) out[component] = source[component]! * weight;
}
function addScaled(out: number[], source: readonly number[], weight: number): void {
  for (let component = 0; component < 16; component++) out[component]! += source[component]! * weight;
}
const POSE_STATE_STRIDE = 29;
function writePoseState(target: Float64Array, offset: number, pose: Pose): void {
  const elements = pose.matrix.elements;
  for (let i = 0; i < 16; i++) target[offset + i] = elements[i]!;
  target[offset + 16] = pose.rotation[0]; target[offset + 17] = pose.rotation[1]; target[offset + 18] = pose.rotation[2];
  target[offset + 19] = pose.translation[0]; target[offset + 20] = pose.translation[1]; target[offset + 21] = pose.translation[2];
  target[offset + 22] = pose.scale[0]; target[offset + 23] = pose.scale[1]; target[offset + 24] = pose.scale[2];
  target[offset + 25] = pose.accumulatedScale[0]; target[offset + 26] = pose.accumulatedScale[1]; target[offset + 27] = pose.accumulatedScale[2];
  target[offset + 28] = pose.visible ? 1 : 0;
}
function readPoseState(source: Float64Array, offset: number, pose: Pose): void {
  const elements = pose.matrix.elements;
  for (let i = 0; i < 16; i++) elements[i] = source[offset + i]!;
  pose.rotation[0] = source[offset + 16]!; pose.rotation[1] = source[offset + 17]!; pose.rotation[2] = source[offset + 18]!;
  pose.translation[0] = source[offset + 19]!; pose.translation[1] = source[offset + 20]!; pose.translation[2] = source[offset + 21]!;
  pose.scale[0] = source[offset + 22]!; pose.scale[1] = source[offset + 23]!; pose.scale[2] = source[offset + 24]!;
  pose.accumulatedScale[0] = source[offset + 25]!; pose.accumulatedScale[1] = source[offset + 26]!; pose.accumulatedScale[2] = source[offset + 27]!;
  pose.visible = source[offset + 28] === 1;
}
function followParentWorld(object: THREE.Object3D, parent: THREE.Object3D): void {
  object.matrixAutoUpdate = false;
  object.matrixWorldAutoUpdate = false;
  object.matrixWorld = parent.matrixWorld;
}

/** GX's clockwise front faces are opposite Three.js's default winding. */
export function gxCullSide(flags: number): THREE.Side {
  return flags & 0x8000 ? THREE.BackSide : flags & 0x4000 ? THREE.FrontSide : THREE.DoubleSide;
}

export class ModelInstance {
  readonly group = new THREE.Group();
  /** Playable-slice adapter: physics owns world translation, not TransN curves. */
  motionRootIndex: number | null = null;
  animationLoop = true;
  /** Changes whenever the evaluated local pose or bound animation changes. */
  private poseVersionValue=0;
  get poseVersion():number{return this.poseVersionValue;}
  opacityMultiplier = 1;
  readonly tint = new THREE.Vector3(1, 1, 1);
  /** Spawn-time material diffuse replacement (ftMaterial_800BFB4C for Mr. Game &
   * Watch: the file-white diffuse is overwritten with the ftDataGamewatch costume
   * color). Instance-local so the shared HsdModel archive stays untouched. */
  private diffuseOverride: V3 | null = null;
  /** Render-only depth squash (see setDepthScale); 1 leaves the palette untouched. */
  private depthScale = 1;
  /** Original elemental color-script RGBA; independent of opacity/charge tint. */
  readonly damageOverlay = new THREE.Vector4(0, 0, 0, 0);
  readonly rotationOverrides = new Map<number, { x?: number; y?: number; z?: number }>();
  /** Draw objects hidden by the original part-visibility tables (ftParts_80074B6C), by dobj ordinal. */
  readonly hiddenDobjs = new Set<number>();
  private readonly hiddenRoots = new Set<number>();
  /** Individual draws suppressed by an adapter (stacked display layers the original state machine would page). */
  private readonly hiddenDraws = new Set<string>();
  private readonly objectOverrides = new Map<number, ObjectOverride>();
  /** Per-joint animation frame overrides (`root:joint` → frame) for stage parts that
   * animate independently (Yoshi's Island blocks, one timer per block). Unlisted
   * joints sample the root frame. Cleared with the instance; the renderer repopulates
   * them every frame from authoritative match state. */
  private readonly jointFrameOverrides = new Map<string, number>();
  /** Per-joint translation offsets (`root:joint` → model-unit XYZ, added after
   * animation) for procedurally placed stage parts (Green Greens falling blocks).
   * The renderer repopulates them every frame from authoritative match state. */
  private readonly jointTranslationOverrides = new Map<string, V3>();
  /** Per-joint visibility gates (`root:joint` → visible) over bind/animation flags
   * for pooled stage parts (Green Greens block slots; empty slots hide). */
  private readonly jointVisibilityOverrides = new Map<string, boolean>();
  /** Per-joint rotation replacements (`root:joint` → radians XYZ, applied after
   * animation) for procedurally posed stage parts (Onett's mirrored/spinning
   * cars). The renderer repopulates them every frame from authoritative state. */
  private readonly jointRotationOverrides = new Map<string, V3>();
  private readonly roots: RootInstance[] = [];
  /** Ultra-only rich shading flag; applied to new draws and via setRichLighting. */
  private richLighting = false;
  /** Ultra-only silhouette cast: flattened re-draws sharing geometry and the
   * live pose palette (built lazily, one tiny shared program). */
  private shadowGroup: THREE.Group | null = null;
  private shadowMaterial: THREE.ShaderMaterial | null = null;
  /** The whole silhouette as one merged, instanced draw (instance count = active taps). */
  private shadowMesh: THREE.InstancedMesh | null = null;
  private paletteData = new Float32Array(16);
  private paletteTexture: THREE.DataTexture | null = null;
  /** Increments per prepare() pass; keys RootInstance.skin memoization. */
  private prepareSerial = 0;
  private shadowsOn = false;
  private shadowGround: number | null = null;
  private shadowOpacity = 0;
  /** Active penumbra taps (low tiers draw the core tap only). */
  private shadowTapCount = SHADOW_TAPS.length;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.ShaderMaterial>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly textureCache = new Map<ModelTexture, THREE.Texture>();
  private readonly frameTextures = new Map<DecodedTexture, Map<ModelTexture, THREE.Texture>>();
  private readonly nodeMatrix = new THREE.Matrix4();

  constructor(readonly model: HsdModel, private lighting = false, private readonly effectCombiners = false, private readonly mipmaps = false) {
    try {
      for (const source of model.roots) {
        const poses = source.joints.map((joint): Pose => ({
          matrix: new THREE.Matrix4(), inverseBind: new THREE.Matrix4().set(
            joint.inverseBind[0]!, joint.inverseBind[1]!, joint.inverseBind[2]!, joint.inverseBind[3]!,
            joint.inverseBind[4]!, joint.inverseBind[5]!, joint.inverseBind[6]!, joint.inverseBind[7]!,
            joint.inverseBind[8]!, joint.inverseBind[9]!, joint.inverseBind[10]!, joint.inverseBind[11]!, 0, 0, 0, 1,
          ),
          scale: [...joint.scale], rotation: [...joint.rotation], translation: [...joint.translation],
          accumulatedScale: [1, 1, 1], visible: !(joint.flags & 16), bind: null,
        }));
        let resources=animationResources.get(source);
        if (!resources) {
          // A material-animation table that cannot be decoded costs this model its texture
          // scroll, never the model itself: Onett and Mushroom Kingdom animate a
          // palette-indexed frame whose palette the table does not carry, and the stage
          // still has to be playable (the warning surfaces in the model report).
          let materials: Map<string, MaterialAnimation>;
          try { materials = loadMaterialAnimations(model.archive, source); }
          catch (error) { materials = new Map(); model.warnings.push(`${source.name}: texture animation ignored (${error instanceof Error ? error.message : String(error)})`); }
          resources = { animation: loadJointAnimation(model.archive, source.animationPointer), materials };
          animationResources.set(source, resources);
        }
        const animation = resources.animation;
        if (animation && animation.joints.length !== poses.length) model.warnings.push(`${source.name}: animation hierarchy differs; unmatched nodes use their bind transforms.`);
        const root: RootInstance = { source, poses, animation, byId: new Map(source.joints.map((joint, index) => [joint.id, index])), draws: [], skin: poses.map(() => new THREE.Matrix4()), skinStamp: poses.map(() => -1) };
        this.roots.push(root);
        const matAnimations = resources.materials;
        for (const part of source.parts) {
          const draw = this.createDraw(part, source.fog);
          draw.materialAnimation = matAnimations.get(`${source.joints[part.owner]!.id}:${part.material.id}`);
          draw.alphaAnimated = !!draw.materialAnimation?.animation?.tracks.some((track) => track.type === 10);
          if (draw.alphaAnimated) draw.mesh.material.transparent = true;
          root.draws.push(draw); this.group.add(draw.mesh); followParentWorld(draw.mesh, this.group);
        }
      }
      this.allocatePalette();
      this.update(0);
    } catch (error) { this.dispose(); throw error; }
  }

  setAnimation(clip: AnimationClip | null, evaluate = true): void {
    // Extended-skeleton clips (Kirby's Mewtwo copy hat adds tail tracks) sample only the
    // model's joints; HSDRaw-authored clips (ACE fighters) may omit trailing track-less
    // joints, which then hold their bind pose (the sampler skips missing entries).
    if (clip && this.roots.length !== 1) {
      throw new Error(`Fighter animation has ${clip.joints.length} joints, model has ${this.roots[0]?.poses.length}.`);
    }
    if (this.roots.length === 1) this.roots[0]!.animation = clip;
    this.poseVersionValue++;
    if(evaluate)this.update(0);
  }

  /** Ultra-only: flip GX-style shading on/off after construction (stage is
   * unlit below ultra, lit+rich on ultra). Updates existing draws only. */
  setLightingEnabled(enabled: boolean): void {
    this.lighting = enabled;
    for (const root of this.roots) for (const draw of root.draws) {
      const uniforms = draw.mesh.material.uniforms;
      if (uniforms.lit) uniforms.lit.value = enabled && draw.part.geometry.hasNormals;
    }
  }

  /** Ultra-only: key+fill+hemisphere shading inside the existing GX shader.
   * Same compiled program (uniform branch), so low/high stay bit-identical. */
  setRichLighting(enabled: boolean): void {
    this.richLighting = enabled;
    for (const root of this.roots) for (const draw of root.draws) {
      const uniforms = draw.mesh.material.uniforms;
      if (uniforms.richLit) uniforms.richLit.value = enabled && draw.part.geometry.hasNormals ? 1 : 0;
    }
  }

  /** Ultra-only true-silhouette cast on/off. Builds the flattened re-draws
   * once (shared geometry and live pose palette, one tiny shared program)
   * and toggles them; per-frame receiver follows setShadowGround. */
  setSilhouetteShadows(enabled: boolean): void {
    this.shadowsOn = enabled;
    if (enabled && !this.shadowGroup) this.buildSilhouetteShadows();
    if (this.shadowGroup) this.shadowGroup.visible = enabled && this.shadowGround !== null && this.shadowOpacity > 0.02;
  }

  /** Active penumbra tap count (1 core on low tiers, up to all three). Extra
   * taps hide immediately; newly enabled ones appear on the next prepare. */
  setShadowTaps(count: number): void {
    this.shadowTapCount = Math.max(1, Math.min(SHADOW_TAPS.length, Math.floor(count)));
    if (this.shadowMesh) this.shadowMesh.count = this.shadowTapCount;
  }

  /** Per-frame receiver ground (world Y), strength and caster root (world XZ)
   * for this fighter's cast. Null hides the cast (no floor below, KO handled
   * by group visibility). */
  setShadowGround(groundY: number | null, opacity: number, casterX = 0): void {
    this.shadowGround = groundY; this.shadowOpacity = opacity;
    const material = this.shadowMaterial;
    if (groundY !== null && material) {
      material.uniforms.groundY!.value = groundY;
      material.uniforms.opacity!.value = opacity;
      (material.uniforms.casterXZ!.value as THREE.Vector2).set(casterX, 0);
    }
    if (this.shadowGroup) this.shadowGroup.visible = this.shadowsOn && groundY !== null && opacity > 0.02;
  }

  private buildSilhouetteShadows(): void {
    const group = new THREE.Group();
    // Link the group first: the cast below captures the fighter's world matrix object through it.
    followParentWorld(group, this.group);
    // Every part merged into one geometry whose per-vertex slot indexes the shared
    // palette texture; hidden parts zero their slots, collapsing to no fragments.
    let vertexCount = 0, indexCount = 0;
    for (const root of this.roots) for (const draw of root.draws) { vertexCount += draw.part.geometry.matrices.length; indexCount += draw.part.geometry.indices.length; }
    const positions = new Float32Array(vertexCount * 3), slots = new Float32Array(vertexCount);
    const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let vertex = 0, index = 0;
    for (const root of this.roots) for (const draw of root.draws) {
      const geometry = draw.part.geometry;
      positions.set(geometry.positions.subarray(0, geometry.matrices.length * 3), vertex * 3);
      for (let i = 0; i < geometry.matrices.length; i++) slots[vertex + i] = draw.paletteOffset + geometry.matrices[i]!;
      for (let i = 0; i < geometry.indices.length; i++) indices[index + i] = geometry.indices[i]! + vertex;
      vertex += geometry.matrices.length; index += geometry.indices.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('gxSlot', new THREE.BufferAttribute(slots, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: shadowVertexShader,
      fragmentShader: shadowFragmentShader,
      uniforms: {
        paletteTexture: { value: this.paletteTexture },
        // Same sun height keeps the projection distance identical; the
        // lateral jitter alone spreads the rim into a penumbra.
        sunDirs: { value: SHADOW_SUN_DIRS },
        tapWeights: { value: SHADOW_TAP_WEIGHTS },
        groundY: { value: this.shadowGround ?? 0 },
        opacity: { value: this.shadowOpacity },
        casterXZ: { value: new THREE.Vector2(0, 0) },
      },
      transparent: true,
      depthWrite: false,
      // Depth-tested so bodies occlude their own cast instead of the
      // silhouette painting over the fighter; polygon offset keeps the
      // decal above the road top without visible floating.
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      // MultiplyBlending is a no-op white quad unless premultipliedAlpha
      // is set (three keeps the previous blend func and logs instead).
      // With alpha 1 the blend is exactly dst * mix(white, tint, k), which
      // commutes, so one merged instanced draw keeps the per-part result.
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    });
    material.customProgramCacheKey = () => 'smash:silhouette';
    const mesh = new THREE.InstancedMesh(geometry, material, SHADOW_TAPS.length);
    mesh.instanceMatrix = SHADOW_INSTANCE_MATRICES;
    mesh.count = this.shadowTapCount;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.name = 'silhouette shadow';
    group.add(mesh); followParentWorld(mesh, group);
    group.visible = false;
    this.group.add(group);
    this.shadowGroup = group; this.shadowMesh = mesh; this.shadowMaterial = material;
  }

  /** Assigns palette-texture slots to every draw and builds the texture. */
  private allocatePalette(): void {
    let slots = 0;
    for (const root of this.roots) for (const draw of root.draws) {
      let highest = 0;
      for (const matrix of draw.part.geometry.matrices) if (matrix > highest) highest = matrix;
      draw.paletteOffset = slots;
      draw.paletteSlots = Math.max(draw.part.kind === 'envelope' ? draw.part.envelopes.length : 1, highest + 1);
      slots += draw.paletteSlots;
    }
    // Width a multiple of 4 (a matrix never wraps rows), capped well below MAX_TEXTURE_SIZE.
    const width = Math.max(4, Math.min(1024, slots * 4)), height = Math.max(1, Math.ceil((slots * 4) / width));
    this.paletteData = new Float32Array(width * height * 4);
    const texture = new THREE.DataTexture(this.paletteData, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false; texture.flipY = false;
    texture.needsUpdate = true;
    this.paletteTexture = texture;
    for (const root of this.roots) for (const draw of root.draws) {
      const uniforms = draw.mesh.material.uniforms;
      uniforms.paletteTexture!.value = texture;
      uniforms.paletteOffset!.value = draw.paletteOffset;
    }
  }
  /** Copies a draw's CPU palette into its texture slots. */
  private packPalette(draw: Draw): void {
    const data = this.paletteData, base = draw.paletteOffset * 16, depth = this.depthScale;
    for (let slot = 0; slot < draw.paletteSlots; slot++) {
      const at = base + slot * 16;
      data.set(draw.palette[slot]!.elements, at);
      // diag(depth, 1, 1) × matrix: scales row 0 (column-major 0, 4, 8, 12).
      if (depth !== 1) { data[at] = data[at]! * depth; data[at + 4] = data[at + 4]! * depth; data[at + 8] = data[at + 8]! * depth; data[at + 12] = data[at + 12]! * depth; }
    }
    draw.paletteZeroed = false;
  }

  private createTexture(source: ModelTexture): THREE.Texture {
    const cached = this.textureCache.get(source);
    if (cached) return cached;
    // Effect models (effectCombiners) churn per burst, so they keep their decoded RGBA;
    // fighters and stages release theirs with the last GPU texture.
    const texture = modelTexture(source,this.textures,this.mipmaps,!this.effectCombiners);
    this.textureCache.set(source, texture);
    return texture;
  }

  private createDraw(part: ModelPart, fog?: ModelRoot['fog']): Draw {
    const material = part.material;
    // Sampled layers follow the original TObj roles (see resolveMaterialLayers):
    // a stored-UV diffuse/ext base, a specular-role sheen overlay (added, never
    // replacing), and generated-coordinate reflection layers (no stored UVs).
    const resolved = resolveMaterialLayers(material, (set) => part.geometry.uvs.has(set));
    const source = resolved.source, overlay = resolved.overlay;
    const uv=!resolved.sourceReflection&&source?part.geometry.uvs.get(source.uvSet):undefined;
    const uv2=!resolved.overlayReflection&&overlay?part.geometry.uvs.get(overlay.uvSet):undefined;
    const geometry = modelGeometry(part,this.geometries,()=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(part.geometry.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(part.geometry.normals, 3));
    geometry.setAttribute('gxColor', new THREE.BufferAttribute(part.geometry.colors, 4));
    geometry.setAttribute('gxMatrix', new THREE.BufferAttribute(part.geometry.matrices, 1));
    geometry.setIndex(new THREE.BufferAttribute(part.geometry.indices, 1));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv ?? new Float32Array(part.geometry.matrices.length * 2), 2));
    geometry.setAttribute('gxUv2', new THREE.BufferAttribute(uv2 ?? new Float32Array(part.geometry.matrices.length * 2), 2));
    // GPU palette skinning poses vertices in the vertex shader, so the CPU
    // bind-pose bounds Three.js would cull against never match the drawn
    // positions (stage joints sit hundreds of units from the origin). Keep a
    // sphere for raycast/debug use only; every draw disables frustum culling
    // below like the other palette/billboard effects already do.
    geometry.computeBoundingSphere();
    return geometry;
    });
    const palette = Array.from({ length: 10 }, () => new THREE.Matrix4());
    const layerMatrix = (layer: ModelTexture | undefined): THREE.Matrix3 => {
      const matrix = new THREE.Matrix3();
      if (!layer) return matrix;
      const sx = Math.abs(layer.scale[0]) > 1e-8 ? layer.repeatS / layer.scale[0] : 0;
      const sy = Math.abs(layer.scale[1]) > 1e-8 ? layer.repeatT / layer.scale[1] : 0;
      const tx = layer.translation[0], ty = layer.translation[1] + (layer.wrapT === 2 && sy !== 0 ? 1 / sy : 0);
      const c = Math.cos(-layer.rotation[2]), s = Math.sin(-layer.rotation[2]);
      matrix.set(sx * c, -sx * s, sx * (-c * tx + s * ty), sy * s, sy * c, sy * (-s * tx - c * ty), 0, 0, 1);
      return matrix;
    };
    const textureMatrix = layerMatrix(source);
    // Phase 3.3: per-draw ShaderMaterial instances share compiled programs
    // (see programCacheKey): identical TEVs compile once and bind one
    // program across N fighters x parts; distinct TEVs still differ.
    const tevSnippet = textureTevShader(this.effectCombiners ? source?.tev : undefined);
    const shader = new THREE.ShaderMaterial({
      vertexShader, fragmentShader: fragmentShader.replace('/* TEXTURE_TEV */', tevSnippet),
      uniforms: {
        // CPU palette kept for adapters/diagnostics; the GPU reads paletteTexture slots.
        palette: { value: palette }, paletteTexture: { value: null }, paletteOffset: { value: 0 }, textureMatrix: { value: textureMatrix }, textureMatrix2: { value: layerMatrix(overlay) },
        image: { value: source ? this.createTexture(source) : null }, hasImage: { value: !!source && (!!uv || resolved.sourceReflection) },
        useReflUv: { value: resolved.sourceReflection }, useReflUv2: { value: resolved.overlayReflection },
        image2: { value: overlay ? this.createTexture(overlay) : null }, hasImage2: { value: !!overlay && (!!uv2 || resolved.overlayReflection) },
        texture2ColorMode: { value: overlay ? (resolved.overlayAdditive ? 7 : (overlay.flags >>> 16) & 15) : 0 },
        shininess: { value: material.shininess }, specularOverlay: { value: resolved.overlayAdditive },
        texture2AlphaMode: { value: overlay ? (overlay.flags >>> 20) & 15 : 0 }, textureBlend2: { value: overlay?.blending ?? 1 },
        diffuse: { value: new THREE.Vector3(...(this.diffuseOverride ?? material.color)) }, opacity: { value: material.alpha }, tint: { value: this.tint }, damageOverlay: { value: this.damageOverlay }, fade: { value: 1 },
        fogColor: { value: new THREE.Vector3(...(fog?.color ?? [0, 0, 0])) }, fogNear: { value: fog?.start ?? 0 }, fogFar: { value: fog?.end ?? 1 }, fogEnabled: { value: fog ? 1 : 0 },
        tevConstant: { value: new THREE.Vector4(...(source?.tev?.constant ?? [0,0,0,0])) },
        tevRegister0: { value: new THREE.Vector4(...(source?.tev?.register0 ?? [0,0,0,0])) },
        tevRegister1: { value: new THREE.Vector4(...(source?.tev?.register1 ?? [0,0,0,0])) },
        colorMode: { value: material.renderMode & 3 }, textureColorMode: { value: source ? (source.flags >>> 16) & 15 : 0 },
        alphaMode: { value: ((material.renderMode >>> 13) & 3) || ((material.renderMode & 3) || 1) },
        textureAlphaMode: { value: source ? (source.flags >>> 20) & 15 : 0 }, textureBlend: { value: source?.blending ?? 1 },
        lit: { value: this.lighting && part.geometry.hasNormals },
        richLit: { value: this.richLighting && part.geometry.hasNormals ? 1 : 0 },
      },
      transparent: material.transparent || material.alpha < 1,
      depthWrite: material.depthWrite,
      blending: material.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: gxCullSide(part.flags),
    });
    shader.customProgramCacheKey = () => programCacheKey(source, this.effectCombiners);
    this.materials.add(shader);
    const mesh = new THREE.Mesh(geometry, shader);
    // Never frustum-cull palette-skinned draws: Three.js only sees the mesh
    // world matrix, not the per-vertex joint palette in the vertex shader, so
    // bind-pose bounds incorrectly kill large-offset stage parts (Peach's
    // Castle foreground) as soon as the camera gets close to them.
    mesh.frustumCulled = false;
    mesh.name = `HSD mesh ${material.id.toString(16)}`;
    return { mesh, part, palette, texture: source, overlay, materialAnimation: undefined, textureOverride: null, alphaAnimated: false, envelopeJoints: null, skeleton: -2, paletteOffset: 0, paletteSlots: 0, paletteZeroed: false, outline: null };
  }

  /** Spawn diffuse replacement for every draw of this instance (see
   * diffuseOverride). Applies to existing draws immediately; draws created
   * later pick it up in createDraw, and material animation falls back to it. */
  setDiffuseOverride(rgb: V3): void {
    this.diffuseOverride = [rgb[0], rgb[1], rgb[2]];
    for (const root of this.roots) for (const draw of root.draws) {
      if (!draw.outline) (draw.mesh.material.uniforms.diffuse!.value as THREE.Vector3).set(rgb[0], rgb[1], rgb[2]);
    }
    this.poseVersionValue++;
  }
  /** Original outline pass (ftDrawCommon_80080E18, Mr. Game & Watch's set-4 hull):
   * these draw objects render unlit in `rgb`, free of colour overlays (x2223_b2
   * swaps the overlay for the outline colour). The original draws the hull first
   * without depth writes, the body over it, then the hull's depth alone; here the
   * hull writes depth from slightly behind the body along each view ray instead
   * (OUTLINE_HULL), which leaves the same rim whatever order the draws run in. */
  setOutlineHull(dobjs: Iterable<number>, rgb: V3): void {
    const hull = new Set(dobjs);
    for (const root of this.roots) for (const draw of root.draws) {
      if (!hull.has(draw.part.dobjIndex)) continue;
      const material = draw.mesh.material, uniforms = material.uniforms;
      draw.outline = new THREE.Vector3(rgb[0], rgb[1], rgb[2]);
      (uniforms.diffuse!.value as THREE.Vector3).copy(draw.outline);
      uniforms.lit!.value = false;
      uniforms.tint = { value: new THREE.Vector3(1, 1, 1) };
      uniforms.damageOverlay = { value: new THREE.Vector4(0, 0, 0, 0) };
      material.defines = { ...material.defines, OUTLINE_HULL: '' };
      material.depthWrite = true;
      material.needsUpdate = true;
    }
  }
  /** setOutlineHull for every draw object owned by these joints of the first root
   * (Game & Watch's articles list outline joints, it_266F_ItemVars x8/xC). */
  setOutlineJoints(joints: Iterable<number>, rgb: V3): void {
    const owners = new Set(joints), root = this.roots[0];
    if (root) this.setOutlineHull(root.draws.filter((draw) => owners.has(draw.part.owner)).map((draw) => draw.part.dobjIndex), rgb);
  }
  /** Squashes the model's depth axis (local X, which the facing rotation turns
   * into world Z) for drawing only: Mr. Game & Watch's root joint scale.x
   * (Fighter_UpdateModelScale). Only the GPU palette carries it, so joint
   * queries (jointPoint/jointWorldMatrix) and gameplay keep the full pose, as
   * the original's x44_mtx correction does. */
  setDepthScale(scale: number): void {
    this.depthScale = scale;
    this.poseVersionValue++;
  }
  /** Instance-local equivalent of efLib_SetTevKonstColor's RGB writes. Call after
   * update() so animated material channels cannot overwrite the spawn adapter.
   * The shared archive and alpha channels are deliberately left untouched.
   */  setDrawTevColors(rootIndex: number, partIndex: number, constant: V3, register0: V3): void {
    const uniforms = this.roots[rootIndex]?.draws[partIndex]?.mesh.material.uniforms;
    if (!uniforms) return;
    for (const [name, rgb] of [['tevConstant', constant], ['tevRegister0', register0]] as const) {
      const value = uniforms[name]!.value as THREE.Vector4;
      value.set(rgb[0], rgb[1], rgb[2], value.w);
    }
  }

  /** Hide whole stage-object roots: runtime props whose original spawn/placement
   * code this prototype does not run (Corneria's parked city/Arwing groups). */
  hideObjects(indices: readonly number[]): void {
    this.hiddenRoots.clear();
    for (const index of indices) this.hiddenRoots.add(index);
    this.update(0);
  }
  /** Source part lookup so adapters can verify a draw's signature before touching it. */
  getPart(rootIndex: number, partIndex: number): ModelPart | undefined {
    return this.roots[rootIndex]?.source.parts[partIndex];
  }
  /** Immediate mesh visibility toggle, valid until the next update(); used to keep
   * the live display out of its own capture pass. */
  setDrawVisibleNow(rootIndex: number, partIndex: number, visible: boolean): void {
    const draw = this.roots[rootIndex]?.draws[partIndex];
    if (draw) draw.mesh.visible = visible;
  }
  /** Suppress a single draw (a stacked display layer the original state machine would page away). */
  setDrawHidden(rootIndex: number, partIndex: number, hidden: boolean): void {
    if (!this.roots[rootIndex]?.draws[partIndex]) return;
    if (hidden) this.hiddenDraws.add(`${rootIndex}:${partIndex}`);
    else this.hiddenDraws.delete(`${rootIndex}:${partIndex}`);
  }
  /** Replace a draw's sampled texture with a live render target (the original stage
   * captured the framebuffer for its display); pass null to restore the archive texture. */
  overrideDrawTexture(rootIndex: number, partIndex: number, texture: THREE.Texture | null): boolean {
    const draw = this.roots[rootIndex]?.draws[partIndex];
    if (!draw) return false;
    draw.textureOverride = texture;
    const uniforms = draw.mesh.material.uniforms;
    if (texture) {
      uniforms.textureColorMode!.value = 5; // REPLACE
      uniforms.textureAlphaMode!.value = 0;
      uniforms.hasImage2!.value = false;
      (uniforms.textureMatrix!.value as THREE.Matrix3).set(1, 0, 0, 0, -1, 1, 0, 0, 1); // render targets are bottom-up
    } else {
      const source = draw.texture ?? draw.part.material.textures[0];
      uniforms.image!.value = source ? this.createTexture(source) : null;
      uniforms.hasImage!.value = !!source;
      uniforms.textureColorMode!.value = source ? (source.flags >>> 16) & 15 : 0;
      uniforms.textureAlphaMode!.value = source ? (source.flags >>> 20) & 15 : 0;
    }
    return true;
  }
  /** Per-frame world offset of a stage-object root, replaying original procedural
   * placement code (Corneria's city strip conveyor). Presentation only. */
  setObjectOffset(index: number, x: number, y: number, z: number): void {
    const state = this.objectOverrides.get(index);
    if (state) state.offset = [x, y, z];
    else this.objectOverrides.set(index, { offset: [x, y, z] });
  }
  /** Full presentation override of a stage-object root: placement, root rotation/scale,
   * an own animation clock and a visibility gate over hideObjects (Corneria's Arwing
   * escort). null removes the override. */
  setObjectState(index: number, state: ObjectOverride | null): void {
    if (state) this.objectOverrides.set(index, state);
    else this.objectOverrides.delete(index);
  }
  /** Pin one joint to its own animation frame (see jointFrameOverrides). */
  setJointFrameOverride(rootIndex: number, jointIndex: number, frame: number): void {
    this.jointFrameOverrides.set(`${rootIndex}:${jointIndex}`, frame);
  }
  /** Drop all per-joint animation frames; every joint follows the root frame again. */
  clearJointFrameOverrides(): void {
    this.jointFrameOverrides.clear();
  }
  /** Pin one joint's translation offset (model units, added after animation). */
  setJointTranslationOverride(rootIndex: number, jointIndex: number, offset: V3): void {
    this.jointTranslationOverrides.set(`${rootIndex}:${jointIndex}`, offset);
  }
  /** Gate one joint's visibility over its bind/animation flags. */
  setJointVisibilityOverride(rootIndex: number, jointIndex: number, visible: boolean): void {
    this.jointVisibilityOverrides.set(`${rootIndex}:${jointIndex}`, visible);
  }
  /** Drop all per-joint translation/visibility overrides (stage switches). */
  clearJointPlacementOverrides(): void {
    this.jointTranslationOverrides.clear();
    this.jointVisibilityOverrides.clear();
    this.jointRotationOverrides.clear();
  }
  /** Replace one joint's rotation (radians, applied after animation). */
  setJointRotationOverride(rootIndex: number, jointIndex: number, rotation: V3): void {
    this.jointRotationOverrides.set(`${rootIndex}:${jointIndex}`, rotation);
  }
  /** Replace a stage-object root's joint animation (the loader binds slot 0 only;
   * Corneria's Arwing banking lives in later slots of the same original table). */
  setObjectClip(index: number, clip: AnimationClip | null): void {
    const root = this.roots[index];
    if (root && root.animation !== clip) root.animation = clip;
  }
  update(frame: number, prepareDraws = true): void {
    this.poseVersionValue++;
    for (let rootIndex=0;rootIndex<this.roots.length;rootIndex++) {
      const { source, poses, animation } = this.roots[rootIndex]!;
      for (let index = 0; index < poses.length; index++) {
        const pose = poses[index]!, joint = source.joints[index]!;
        copy3(pose.rotation,joint.rotation);copy3(pose.scale,joint.scale);copy3(pose.translation,joint.translation);pose.visible=!(joint.flags&16);
      }
      const override = this.objectOverrides.get(rootIndex);
      const rootFrame = override?.animationFrame ?? frame;
      if (animation) for (let index = 0; index < poses.length; index++) {
        const tracks = animation.joints[index];
        if (!tracks) continue;
        const jointFrame = this.jointFrameOverrides.size ? this.jointFrameOverrides.get(`${rootIndex}:${index}`) : undefined;
        const frameForJoint = jointFrame ?? rootFrame;
        const time = tracks.endFrame > 0 ? (this.animationLoop ? frameForJoint % tracks.endFrame : Math.min(frameForJoint, tracks.endFrame)) : 0;
        const pose = poses[index]!;
        for (const track of tracks.tracks) {
          const value = sampleTrack(track.keys, time);
          if (value === undefined) continue;
          if (track.type >= 1 && track.type <= 3) pose.rotation[track.type - 1] = value;
          else if (track.type >= 5 && track.type <= 7) pose.translation[track.type - 5] = value;
          else if (track.type >= 8 && track.type <= 10) pose.scale[track.type - 8] = value;
          else if (track.type === 11) pose.visible = value >= 0.5;
          else if (track.type === 12) {
            const setBranch = (i: number): void => { poses[i]!.visible = value >= 0.5; for (const child of source.joints[i]!.children) setBranch(child); };
            setBranch(index);
          }
        }
      }
      if (this.rotationOverrides.size) for (const [index, override] of this.rotationOverrides) {
        const pose = poses[index]; if (pose) { if (override.x !== undefined) pose.rotation[0] = override.x; if (override.y !== undefined) pose.rotation[1] = override.y; if (override.z !== undefined) pose.rotation[2] = override.z; }
      }
      if (this.jointTranslationOverrides.size) for (const [key, offset] of this.jointTranslationOverrides) {
        const sep = key.indexOf(':');
        if (sep < 0 || Number(key.slice(0, sep)) !== rootIndex) continue;
        const pose = poses[Number(key.slice(sep + 1))];
        if (pose) { pose.translation[0] += offset[0]; pose.translation[1] += offset[1]; pose.translation[2] += offset[2]; }
      }
      if (this.jointRotationOverrides.size) for (const [key, rotation] of this.jointRotationOverrides) {
        const sep = key.indexOf(':');
        if (sep < 0 || Number(key.slice(0, sep)) !== rootIndex) continue;
        const pose = poses[Number(key.slice(sep + 1))];
        if (pose) { pose.rotation[0] = rotation[0]; pose.rotation[1] = rotation[1]; pose.rotation[2] = rotation[2]; }
      }
      if (this.jointVisibilityOverrides.size) for (const [key, visible] of this.jointVisibilityOverrides) {
        const sep = key.indexOf(':');
        if (sep < 0 || Number(key.slice(0, sep)) !== rootIndex) continue;
        const pose = poses[Number(key.slice(sep + 1))];
        if (pose) pose.visible = visible;
      }
      if (this.motionRootIndex !== null && poses[this.motionRootIndex]) {
        copy3(poses[this.motionRootIndex]!.translation,source.joints[this.motionRootIndex]!.translation);
      }
      if (override && poses[0]) {
        const pose = poses[0]!;
        if (override.offset) {pose.translation[0]+=override.offset[0];pose.translation[1]+=override.offset[1];pose.translation[2]+=override.offset[2];}
        if (override.rotationY !== undefined) pose.rotation[1]=override.rotationY;
        if (override.scale !== undefined) {pose.scale[0]*=override.scale;pose.scale[1]*=override.scale;pose.scale[2]*=override.scale;}
      }
      for (let index = 0; index < poses.length; index++) {
        const pose = poses[index]!, joint = source.joints[index]!;
        const parentScale = joint.parent >= 0 ? poses[joint.parent]!.accumulatedScale : UNIT_SCALE;
        if(joint.flags&8)copy3(pose.accumulatedScale,parentScale);
        else {pose.accumulatedScale[0]=pose.scale[0]*parentScale[0];pose.accumulatedScale[1]=pose.scale[1]*parentScale[1];pose.accumulatedScale[2]=pose.scale[2]*parentScale[2];}
        jointMatrix(pose.matrix, pose.scale, pose.rotation, pose.translation, pose.accumulatedScale);
        if (joint.parent >= 0) pose.matrix.premultiply(poses[joint.parent]!.matrix);
      }
    }
    if(prepareDraws)this.prepare(frame);
  }
  /** GPU/material work is unnecessary for collision samples and rollback replays. */
  prepare(frame:number):void {
    const serial = ++this.prepareSerial;
    let dirty = false;
    for(let rootIndex=0;rootIndex<this.roots.length;rootIndex++){
      const root=this.roots[rootIndex]!,override=this.objectOverrides.size?this.objectOverrides.get(rootIndex):undefined;
      const rootHidden = override?.visible !== undefined ? !override.visible : this.hiddenRoots.has(rootIndex);
      for (let drawIndex = 0; drawIndex < root.draws.length; drawIndex++) {
        const draw = root.draws[drawIndex]!;
        const visible = this.prepareMaterial(root, draw, rootIndex, drawIndex, rootHidden, frame);
        if (!visible) {
          // Hidden parts (stone forms, part swaps, paged display layers) cast no silhouette:
          // zeroed slots collapse them in the merged cast. The CPU palette is rebuilt the
          // frame the part shows again, so nothing samples a stale one.
          if (!draw.paletteZeroed) { this.paletteData.fill(0, draw.paletteOffset * 16, (draw.paletteOffset + draw.paletteSlots) * 16); draw.paletteZeroed = true; dirty = true; }
          continue;
        }
        if (draw.part.kind === 'rigid') this.prepareRigid(root, draw);
        else this.prepareEnvelope(root, draw, serial);
        this.packPalette(draw); dirty = true;
      }
    }
    if (dirty && this.paletteTexture) this.paletteTexture.needsUpdate = true;
  }
  /** Per-frame material state and visibility of one draw (small: keeps prepare's loops inlinable). */
  private prepareMaterial(root: RootInstance, draw: Draw, rootIndex: number, drawIndex: number, rootHidden: boolean, frame: number): boolean {
    const uniforms = draw.mesh.material.uniforms, part = draw.part;
    uniforms.opacity!.value = part.material.alpha;
    uniforms.fade!.value = this.opacityMultiplier;
    draw.mesh.material.transparent = this.opacityMultiplier < 1 || part.material.transparent || part.material.alpha < 1 || draw.alphaAnimated;
    if (draw.materialAnimation) { this.animateMaterial(draw, frame); if (draw.outline) (uniforms.diffuse!.value as THREE.Vector3).copy(draw.outline); }
    if (draw.textureOverride) { uniforms.image!.value = draw.textureOverride; uniforms.hasImage!.value = true; }
    const visible = !rootHidden && root.poses[part.owner]!.visible && (part.flags & 0xc000) !== 0xc000 && !(this.hiddenDobjs.size > 0 && this.hiddenDobjs.has(part.dobjIndex)) && !(this.hiddenDraws.size > 0 && this.hiddenDraws.has(`${rootIndex}:${drawIndex}`));
    draw.mesh.visible = visible;
    return visible;
  }
  private prepareRigid(root: RootInstance, draw: Draw): void {
    const index = draw.part.reference ? root.byId.get(draw.part.reference)! : draw.part.owner;
    const matrix = root.poses[index]!.matrix, palette = draw.palette;
    for (let slot = 0; slot < palette.length; slot++) palette[slot]!.copy(matrix);
  }
  private prepareEnvelope(root: RootInstance, draw: Draw, serial: number): void {
    const { source, poses } = root, part = draw.part, owner = source.joints[part.owner]!;
    const node = this.nodeMatrix.identity();
    if (!(owner.flags & 2)) {
      let skeleton = draw.skeleton;
      if (skeleton === -2) {
        skeleton = part.owner;
        while (skeleton >= 0 && !(source.joints[skeleton]!.flags & 3)) skeleton = source.joints[skeleton]!.parent;
        if (skeleton < 0) throw new Error('Envelope mesh has no skeleton ancestor.');
        draw.skeleton = skeleton;
      }
      if (skeleton === part.owner) {
        const skeletonPose = poses[skeleton]!;
        node.copy(skeletonPose.bind ??= skeletonPose.inverseBind.clone().invert());
      } else {
        node.copy(poses[part.owner]!.matrix).invert();
        if (!(source.joints[skeleton]!.flags & 2)) node.premultiply(poses[skeleton]!.inverseBind);
        node.premultiply(poses[skeleton]!.matrix);
      }
    }
    const envelopes = part.envelopes;
    const joints = draw.envelopeJoints ??= envelopes.map(influences => influences.map(influence => root.byId.get(influence.joint)!));
    const ownerRigid = (owner.flags & 2) !== 0;
    for (let index = 0; index < envelopes.length; index++) {
      const influences = envelopes[index]!, destination = draw.palette[index]!;
      if (influences.length === 1) {
        const joint = joints[index]![0]!, weight = influences[0]!.weight;
        const transform = ownerRigid ? poses[joint]!.matrix : this.skinMatrix(root, joint, serial);
        if (weight === 1) destination.copy(transform);
        else scaleInto(destination.elements, transform.elements, weight);
      } else this.blendInfluences(root, destination, influences, joints[index]!, serial);
      destination.multiply(node);
    }
  }
  private blendInfluences(root: RootInstance, destination: THREE.Matrix4, influences: ReadonlyArray<{ weight: number }>, joints: readonly number[], serial: number): void {
    const out = destination.elements;
    out.fill(0);
    for (let influence = 0; influence < influences.length; influence++) addScaled(out, this.skinMatrix(root, joints[influence]!, serial).elements, influences[influence]!.weight);
  }
  /** matrix × inverseBind for one joint, computed at most once per prepare() pass. */
  private skinMatrix(root: RootInstance, joint: number, serial: number): THREE.Matrix4 {
    const cached = root.skin[joint]!;
    if (root.skinStamp[joint] !== serial) {
      const bone = root.poses[joint]!;
      cached.multiplyMatrices(bone.matrix, bone.inverseBind);
      root.skinStamp[joint] = serial;
    }
    return cached;
  }

  private animateMaterial(draw: Draw, frame: number): void {
    const animation = draw.materialAnimation; if (!animation) return;
    const uniforms = draw.mesh.material.uniforms, base = draw.part.material;
    const sample = (a: typeof animation.animation, type: number) => {
      if (!a) return undefined;
      const track = a.tracks.find((track) => track.type === type); if (!track) return undefined;
      const time = a.endFrame > 0 ? (this.animationLoop ? frame % a.endFrame : Math.min(frame, a.endFrame)) : 0;
      return sampleTrack(track.keys, time);
    };
    const color = uniforms.diffuse!.value as THREE.Vector3;
    const fallback = this.diffuseOverride ?? base.color;
    color.set(sample(animation.animation, 4) ?? fallback[0], sample(animation.animation, 5) ?? fallback[1], sample(animation.animation, 6) ?? fallback[2]);
    uniforms.opacity!.value = Math.min(1, Math.max(0, sample(animation.animation, 10) ?? base.alpha));
    const texture = draw.texture;
    if (texture) {
      const tex = animation.textures.find((item) => item.id === texture.animId);
      if (tex) {
        if (texture.tev) {
          for (const [name, values, start] of [['tevConstant', texture.tev.constant, 12], ['tevRegister0', texture.tev.register0, 16], ['tevRegister1', texture.tev.register1, 20]] as const) {
            const value = uniforms[name]!.value as THREE.Vector4;
            values.forEach((base, i) => value.setComponent(i, Math.min(1, Math.max(0, sample(tex.animation, start+i) ?? base))));
          }
        }
        const imageIndex = sample(tex.animation, 1);
        if (imageIndex !== undefined && tex.images.length) {
          const image = tex.images[Math.max(0, Math.min(tex.images.length - 1, Math.floor(imageIndex)))];
          if (image) {
            const map = this.frameTextures.get(image) ?? new Map<ModelTexture, THREE.Texture>();
            let frameTexture = map.get(texture);
            if (!frameTexture) { frameTexture = this.createTexture({ ...texture, image }); map.set(texture, frameTexture); this.frameTextures.set(image, map); }
            uniforms.image!.value = frameTexture;
          }
        }
        const scaleX = sample(tex.animation, 4) ?? texture.scale[0], scaleY = sample(tex.animation, 5) ?? texture.scale[1];
        const sx = Math.abs(scaleX) > 1e-8 ? texture.repeatS / scaleX : 0, sy = Math.abs(scaleY) > 1e-8 ? texture.repeatT / scaleY : 0;
        const tx = sample(tex.animation, 2) ?? texture.translation[0], ty = (sample(tex.animation, 3) ?? texture.translation[1]) + (texture.wrapT === 2 && sy !== 0 ? 1 / sy : 0);
        const angle = -(sample(tex.animation, 8) ?? texture.rotation[2]), c = Math.cos(angle), s = Math.sin(angle);
        (uniforms.textureMatrix!.value as THREE.Matrix3).set(sx*c,-sx*s,sx*(-c*tx+s*ty),sy*s,sy*c,sy*(-s*tx-c*ty),0,0,1);
        uniforms.textureBlend!.value = sample(tex.animation, 9) ?? texture.blending;
      }
    }
    // Second sampled layer (stage water detail, decals): its own TexAnim drives the
    // overlay matrix/blend/image, otherwise two-layer water scrolls half-frozen.
    const overlay = draw.overlay;
    if (overlay) {
      const tex2 = animation.textures.find((item) => item.id === overlay.animId);
      if (tex2) {
        const imageIndex2 = sample(tex2.animation, 1);
        if (imageIndex2 !== undefined && tex2.images.length) {
          const image = tex2.images[Math.max(0, Math.min(tex2.images.length - 1, Math.floor(imageIndex2)))];
          if (image) {
            const map = this.frameTextures.get(image) ?? new Map<ModelTexture, THREE.Texture>();
            let frameTexture = map.get(overlay);
            if (!frameTexture) { frameTexture = this.createTexture({ ...overlay, image }); map.set(overlay, frameTexture); this.frameTextures.set(image, map); }
            uniforms.image2!.value = frameTexture;
          }
        }
        const scaleX2 = sample(tex2.animation, 4) ?? overlay.scale[0], scaleY2 = sample(tex2.animation, 5) ?? overlay.scale[1];
        const sx2 = Math.abs(scaleX2) > 1e-8 ? overlay.repeatS / scaleX2 : 0, sy2 = Math.abs(scaleY2) > 1e-8 ? overlay.repeatT / scaleY2 : 0;
        const tx2 = sample(tex2.animation, 2) ?? overlay.translation[0], ty2 = (sample(tex2.animation, 3) ?? overlay.translation[1]) + (overlay.wrapT === 2 && sy2 !== 0 ? 1 / sy2 : 0);
        const angle2 = -(sample(tex2.animation, 8) ?? overlay.rotation[2]), c2 = Math.cos(angle2), s2 = Math.sin(angle2);
        (uniforms.textureMatrix2!.value as THREE.Matrix3).set(sx2*c2,-sx2*s2,sx2*(-c2*tx2+s2*ty2),sy2*s2,sy2*c2,sy2*(-s2*tx2-c2*ty2),0,0,1);
        uniforms.textureBlend2!.value = sample(tex2.animation, 9) ?? overlay.blending;
      }
    }
  }
  applyBillboards(camera: THREE.Camera, preserveWorldAxis = false): void {
    this.group.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
    const inverse = this.group.matrixWorld.clone().invert(), world = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (const root of this.roots) for (const draw of root.draws) {
      const owner = root.source.joints[draw.part.owner]!, mode = owner.flags & 0xe00;
      if (!mode || draw.part.kind !== 'rigid') continue;
      world.multiplyMatrices(this.group.matrixWorld, root.poses[draw.part.owner]!.matrix);
      position.setFromMatrixPosition(world); scale.setFromMatrixScale(world);
      if (mode === 0x400) {
        const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
        // Native axial billboards retain the transformed local Y axis. Opt in for
        // directional common effects: a side KO's root Z rotation must not vanish.
        const up = preserveWorldAxis ? new THREE.Vector3().setFromMatrixColumn(world, 1).normalize() : new THREE.Vector3(0, 1, 0);
        cameraPosition.addScaledVector(up, -cameraPosition.clone().sub(position).dot(up));
        world.lookAt(cameraPosition, position, up); rotation.setFromRotationMatrix(world);
      } else rotation.setFromRotationMatrix(camera.matrixWorld);
      rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), root.poses[draw.part.owner]!.rotation[2]));
      world.compose(position, rotation, scale).premultiply(inverse);
      for (const palette of draw.palette) palette.copy(world);
      if (draw.mesh.visible) { this.packPalette(draw); if (this.paletteTexture) this.paletteTexture.needsUpdate = true; }
    }
  }
  jointWorldMatrix(index: number, output = new THREE.Matrix4()): THREE.Matrix4 {
    const pose = this.roots[0]?.poses[index]; if (!pose) throw new Error(`Missing fighter joint ${index}.`);
    this.group.updateWorldMatrix(true, false); return output.multiplyMatrices(this.group.matrixWorld, pose.matrix);
  }
  /** Phase 3.2: true when no joint or material animation drives this model,
   * so the renderer may skip per-frame update() after the first pose. Texture-only
   * scrolls (Peach's Castle river) count: their material-level animation is null
   * while their TexAnims carry the translation tracks. */
  isStatic(): boolean {
    for (const root of this.roots) {
      if (root.animation) return false;
      for (const draw of root.draws) {
        if (draw.materialAnimation?.animation) return false;
        if (draw.materialAnimation?.textures.some((tex) => tex.animation)) return false;
      }
    }
    return true;
  }
  /** Length of a flat pose snapshot: per joint 16 matrix + 12 TRS/accumulated-scale values + visibility. */
  get poseStateLength(): number {
    let length = 0;
    for (const root of this.roots) length += root.poses.length * POSE_STATE_STRIDE;
    return length;
  }
  /** Exact copy of every evaluated joint, restorable with restorePoseState. */
  capturePoseState(target: Float64Array): void {
    let offset = 0;
    for (const root of this.roots) for (const pose of root.poses) { writePoseState(target, offset, pose); offset += POSE_STATE_STRIDE; }
  }
  /** Restores a capturePoseState snapshot bit-for-bit; counts as a pose change. */
  restorePoseState(source: Float64Array): void {
    let offset = 0;
    for (const root of this.roots) for (const pose of root.poses) { readPoseState(source, offset, pose); offset += POSE_STATE_STRIDE; }
    this.poseVersionValue++;
  }
  jointPoint(index: number, offset: V3, output = new THREE.Vector3()): THREE.Vector3 {
    const pose = this.roots[0]?.poses[index];
    if (!pose) throw new Error(`Missing fighter joint ${index}.`);
    this.group.updateWorldMatrix(true, false);
    return output.set(...offset).applyMatrix4(pose.matrix).applyMatrix4(this.group.matrixWorld);
  }
  poseSignature(): number[] { return this.roots.flatMap((root) => root.poses.flatMap((pose) => pose.matrix.elements.slice(12, 15))); }
  dispose(): void {
    this.group.removeFromParent(); this.group.clear();
    for (const geometry of this.geometries) releaseModelGeometry(geometry);
    for (const material of this.materials) material.dispose();
    // The merged silhouette owns its geometry and material; the palette texture is per instance.
    this.shadowMaterial?.dispose(); this.shadowMesh?.geometry.dispose(); this.paletteTexture?.dispose();
    this.shadowGroup = null; this.shadowMaterial = null; this.shadowMesh = null; this.paletteTexture = null;
    this.shadowsOn = false; this.shadowGround = null; this.shadowOpacity = 0;
    for (const texture of this.textures) releaseModelTexture(texture);
    this.geometries.clear(); this.materials.clear(); this.textures.clear(); this.textureCache.clear(); this.frameTextures.clear();
  }
}
