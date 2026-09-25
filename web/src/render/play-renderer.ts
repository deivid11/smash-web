import * as THREE from 'three';
import type { GameContent, FighterContent } from '../../../lib/game/load.ts';
import { MAX_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import { playerPresentation } from '../../../lib/game/player-colors.ts';
import { SUPPORTED_STAGES, stageBackground } from '../../../lib/game/stages.ts';
import { applyCorneriaFlyby, readCorneriaFlyby } from './corneria-flyby.ts';
import { applyOnettRuntime, parkOnettCars, readOnettTraffic, type OnettLayout } from './onett-traffic.ts';
import { applyPeachBillRuntime } from './peach-bill.ts';
import type { LocalMatch, MatchEvent, MatchFighter } from '../../../lib/game/match.ts';
import { clampVisualAlpha, extrapolateAnimationFrame, extrapolatePosition, shouldSnapFighter, trackSimSnapshot, type InterpEntry, type InterpSnapshot } from './motion-interp.ts';
import { HILL_CAPTURE_FRAMES, HILL_TEAM_COLORS, HILL_ZONE_COLORS, hillClaims } from '../../../lib/game/hill.ts';
import { YOSHI_BLOCK_JOINTS, YOSHI_SPIN_FRAMES, visibleStageCollision } from '../../../lib/game/match.ts';
import { GREENS_ROWS, GREENS_COLS, greensIndex, GREENS_GRID_Y } from '../../../lib/game/greens.ts';
/** GrGr.dat block-pool root and model-space grid (root 6 j5-j34 at
 * [-85,-75,-65,65,75,85] x [-15,-5,5,15,25]; see lib/game/greens.ts). */
const GREENS_BLOCK_ROOT = 6;
const GREENS_MODEL_X = [-85, -75, -65, 65, 75, 85] as const;
const GREENS_MODEL_Y = [-15, -5, 5, 15, 25] as const;
const GREENS_TREE_ROOT = 5;
import { STAGE_CAMERA_DEFAULT, type StageGameplayData } from '../../../lib/game/data.ts';
import { activeHits } from '../../../lib/game/moves.ts';
import { ModelInstance } from './model-instance.ts';
import { GameRigs } from './game-rig.ts';
import { PlayEffects } from './play-effects.ts';
import { CameraShake, parseCameraQuakes, type CameraShakeLevel } from './camera-shake.ts';
import { GRAPHICS_PRESETS, type GraphicsQuality } from './graphics-quality.ts';
import { PostProcessing } from './post-processing.ts';
import { DEFAULT_VISUAL_EFFECT_CHOICES, resolveVisualEffects, type VisualEffectChoices, type VisualEffectId } from './visual-effects.ts';
import { DefenseVisuals } from './defense-visuals.ts';
import { hurtEnabled } from '../../../lib/game/specials.ts';
import { inhaledVictimHidden } from '../../../lib/game/kirby.ts';
import type { CustomEffects } from '../../../lib/custom/types.ts';
import { disposeCustomVisuals, type CustomVisuals } from './custom-visuals.ts';
import { crowdCameraFrame, classicCameraLimits, clampToCameraBounds, confineCameraTarget, focusCameraFrame, settleFrameTarget, settleFrameDistance, CROWD_CAMERA_LIFT, type FramingPoint, type FramingInsets } from './camera-framing.ts';
import { Magnifier, type MagnifyEntry } from './magnifier.ts';
import { magnifyBackground, magnifyHalfExtent } from './magnify.ts';
import { PauseCamera } from './pause-camera.ts';
import { isTopBlastKO } from '../../../lib/game/ko-effect.ts';
import { starKoPose, starKoDone, STAR_KO } from './star-ko.ts';
import { STADIUM_NORMAL_TERRAIN_ROOT, STADIUM_VARIANTS } from '../../../lib/game/stadium.ts';
import { profiler } from '../../../lib/perf/profiler.ts';

/** Presentation cost spans (timing only; see lib/perf/profiler.ts). */
const SPAN_STAGE = profiler.span('render.stage'), SPAN_FIGHTERS = profiler.span('render.fighters'), SPAN_OVERLAYS = profiler.span('render.overlays'), SPAN_CAMERA = profiler.span('render.camera'),
  SPAN_EFFECTS = profiler.span('render.effects'), SPAN_STADIUM = profiler.span('render.stadium'), SPAN_DRAW = profiler.span('render.draw');

/** Static-snapshot stages held at animation frame 0: their archived clips move
 * platforms/scenery (Brinstar mass, Kongo rock, Fountain platforms, MK lift)
 * whose collision the prototype keeps frozen at rest, so replaying match.frame
 * would desync the visuals from the floors (see lib/game/stages.ts). Mute City
 * is dynamic instead (lib/game/mutecity.ts): its road animation advances with
 * the traveling deck and area cycle. */
const STATIC_STAGE_ANIMATION: ReadonlySet<string> = new Set(['brinstar', 'kongo-jungle', 'fountain-of-dreams', 'mushroom-kingdom']);
interface Spark { mesh: THREE.LineSegments; remaining: number; total: number }
/** Pooled hit-spark resources (Phase 3.4): one shared star geometry per size
 * plus reusable line materials, so hit events never allocate per event. */
/** King of the Hill column in stage units (a fighter is ~20). The tube reaches
 * BELOW the zone as well, so on stairs and layered ground it visibly encloses
 * the whole patch instead of floating on one step. */
const HILL_COLUMN_HEIGHT = 46;
const HILL_COLUMN_DEPTH = 26;
const HILL_COLUMN_SPAN = HILL_COLUMN_HEIGHT + HILL_COLUMN_DEPTH;
/** Where the standing plane sits inside the tube, in 0–1 tube coordinates. */
const HILL_COLUMN_BASE = HILL_COLUMN_DEPTH / HILL_COLUMN_SPAN;
/** Column shader: fades toward the sky, and lights the captured share from the
 * ground up so a capture in progress reads as a filling bar of light. */
function hillColumnMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xffc94d) }, fill: { value: 0 }, glow: { value: 0.5 }, base: { value: HILL_COLUMN_BASE } },
    vertexShader: `varying float vH;varying vec3 vN;varying vec3 vV;
void main(){
  vH = uv.y;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 color;uniform float fill;uniform float glow;uniform float base;varying float vH;varying vec3 vN;varying vec3 vV;
void main(){
  // Glass tube: the silhouette edges carry the shape, the middle stays see-through
  // so fighters inside the zone are never hidden by their own objective.
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  // Heights are measured from the standing plane: the skirt below it grounds the
  // zone on stairs, the part above it carries the capture fill.
  float above = (vH - base) / max(0.001, 1.0 - base);
  float below = (base - vH) / max(0.001, base);
  float fade = vH >= base ? pow(1.0 - above, 1.6) : pow(1.0 - below, 0.9);
  float lit = vH >= base ? smoothstep(fill + 0.04, fill - 0.01, above) : 1.0;
  // Bright band travelling up with the capture, so progress reads at a glance.
  float band = vH >= base ? smoothstep(0.035, 0.0, abs(above - fill)) * step(0.001, fill) * step(fill, 0.999) : 0.0;
  float alpha = glow * fade * (0.1 + 0.22 * lit + 0.85 * rim) + band * 0.55 * fade;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(color * (0.75 + 0.35 * lit + 0.5 * band), min(alpha, 0.85));
}`,
    // Straight alpha, not additive: the player is reading fighters through this
    // wall, and an additive column over a bright stage (plus the bloom pass)
    // blows the whole quarter of the screen out.
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
/** Floor ring: lights up as a radial gauge while a capture runs, fully lit once
 * the zone is owned. */
function hillRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xffc94d) }, fill: { value: 0 }, opacity: { value: 0.8 } },
    vertexShader: 'varying vec2 vLocal;void main(){vLocal=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 color;uniform float fill;uniform float opacity;varying vec2 vLocal;
void main(){
  float turn = fract((atan(vLocal.y, vLocal.x) + 1.5707963) / 6.2831853 + 1.0);
  float on = fill >= 0.999 ? 1.0 : step(turn, fill);
  gl_FragColor = vec4(color * (0.65 + 0.35 * on), opacity * (0.28 + 0.72 * on));
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
/** Capture bar floating over the zone: empty track, filled share, thin frame. */
function hillBarMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xffc94d) }, fill: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 color;uniform float fill;varying vec2 vUv;
void main(){
  // Crisp track with a bright frame: it has to read over a busy stage at a glance.
  float inside = step(0.012, vUv.x) * step(vUv.x, 0.988) * step(0.13, vUv.y) * step(vUv.y, 0.87);
  float done = step(vUv.x, fill) * inside;
  vec3 track = vec3(0.03, 0.05, 0.11);
  vec3 body = mix(track, color, done);
  gl_FragColor = vec4(mix(color * 0.9, body, inside), inside * mix(0.62, 0.96, done) + (1.0 - inside) * 0.92);
}`,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  });
}
const SPARK_RAYS = 10;
function sparkGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [], size = 4;
  for (let ray = 0; ray < SPARK_RAYS; ray++) {
    const angle = ray * Math.PI / 5;
    vertices.push(Math.cos(angle) * size * 0.2, Math.sin(angle) * size * 0.2, 0, Math.cos(angle) * size, Math.sin(angle) * size, 0);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
}
/** Lupe ring/arrow for CPU seats: gm_80160968 gives CPUs the grey slot colour (0x666666),
 * lifted like the seat palette so it reads on the same HUD. */
const MAGNIFY_CPU_COLOR = 0xadadad;
export class PlayRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20_000);
  readonly scene = new THREE.Scene();
  stage: ModelInstance;
  private stageModel: GameContent['stageModel'];
  /** Per-frame presentation-only stage motion (Corneria's city flyby); never simulation state. */
  private stageMotion: ((frame: number) => void) | null = null;
  /** Onett joint layout for authoritative hazard presentation; null elsewhere. */
  private onettLayout: OnettLayout | null = null;
  /** Pokémon Stadium variant terrains; cosmetic instances driven by the authoritative clock. */
  private stadiumTerrains = new Map<string, ModelInstance>();
  private stadiumHidden: number[] | null = null;
  /** Phase 3.2: static stages skip per-frame update() after the first pose. */
  private stageStatic = false;
  private stagePrimed = false;
  /** Stadium jumbotron: the original captured the framebuffer for its display; this
   * adapter renders the live scene into a target sampled by the screen draw. */
  private stadiumScreen: { target: THREE.WebGLRenderTarget; root: number; parts: number[] } | null = null;
  /** Broadcast camera for the display: frames the fighters like a stadium feed,
   * with a clean projection (the main camera carries HUD view offsets). */
  private readonly stadiumCamera = new THREE.PerspectiveCamera(42, 110 / 71, 0.1, 20_000);
  rigs: GameRigs;
  effects: PlayEffects;
  readonly defense: DefenseVisuals;
  readonly customEffects: CustomEffects[];
  debugHitboxes = false;
  /** Optional GPU timer around the frame's draws (web/src/perf/gpu-timer.ts). */
  gpuTimer: { begin(): void; end(): void } | null = null;
  debugCollision = false;
  private collisionLines: THREE.LineSegments | null = null;
  private collisionStage: StageGameplayData | null = null;
  private collisionSpin = 0;
  private collisionGreens = '';
  /** Green Greens block-pool mapping (grid index row*6+col → root-6 pose index,
   * -1 when the archived rest pose does not match the verified grid). */
  private greensBlockJoints: number[] | null = null;
  customPresentation: string = 'default';
  private target = new THREE.Vector3(0, 20, 0);
  private desired = new THREE.Vector3();
  private observer: ResizeObserver;
  private sparks: Spark[] = [];
  private debugGroup = new THREE.Group();
  private debugGeometry = new THREE.SphereGeometry(1, 8, 6);
  private debugMaterials = [0x55ddbb, 0xff7755].map((color) => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.6, depthTest: false }));
  private respawnRings: THREE.Mesh[] = [];
  /** King of the Hill zone markers: a floor ring and disc plus a vertical column
   * of light, which is what actually reads at gameplay distance (a flat circle
   * on sloped ground is nearly invisible). The column carries the zone's state:
   * dim in the zone colour while nobody owns it, lit in the owner's colour once
   * captured, and filling from the ground up in the claimant's colour while a
   * capture runs. Presentation only: it reads the authoritative hill state every
   * frame and never feeds simulation. */
  private hillMarkers: { ring: THREE.Mesh; disc: THREE.Mesh; column: THREE.Mesh; bars: THREE.Mesh[] }[] = [];
  private hillMarkersWidth = -1;
  private frame = 0;
  /** Original off-screen magnifier (ifMagnify); drawn over the composed frame. */
  private readonly magnifier = new Magnifier();
  private readonly magnifyBone = new THREE.Vector3();
  private readonly magnifyProjected = new THREE.Vector3();
  private stadiumCaptureFrame:number|null=null;
  private stadiumCaptureRevision:number|undefined;
  private stadiumCaptures=0;
  private stadiumInterval=GRAPHICS_PRESETS.high.stadiumInterval;
  private stadiumTarget=GRAPHICS_PRESETS.high.stadiumTarget;
  private pixelRatio=GRAPHICS_PRESETS.high.pixelRatio;
  private _quality:GraphicsQuality='high';
  /** User's own preset choice; gates shadows/rich light even when the
   * effective quality steps down. Set alongside _quality everywhere. */
  private manualQuality:GraphicsQuality='high';
  private presentationTime: number | null = null;
  private readonly shake = new CameraShake();
  private crowdPoints: readonly FramingPoint[] | null = null;
  /** Last camera branch taken (debug overlay only, never simulation). */
  private camMode: 'focus' | 'crowd' | 'classic' | 'none' = 'none';
  private camFocus: number | null = null;
  /** False when the focus came from the fallback scan instead of the match's
   * player slot; camDetail names the configured slot for crowd/classic. */
  private camPrimary = true;
  private camDetail = '';
  /** Ultra-only true-silhouette shadows, driven per fighter (see ModelInstance
   * setSilhouetteShadows/setShadowGround). Presentation only; simulation,
   * snapshots and hashes never read them. */
  private shadowsEnabled = false;
  private shadowStrength = 1;
  /** Fighters casting a silhouette this frame (drives the snapshot flag). */
  private shadowCasters = 0;
  private richLightEnabled = false;
  /** Screen-space effect chain over the finished frame (glow, ambient
   * occlusion, color grade, sharpening, vignette). Cosmetic only: it steps
   * aside entirely when every effect is off. See web/src/render/post-processing.ts. */
  private post!: PostProcessing;
  /** Per-effect user choices; `auto` follows the effective preset. */
  private effectChoices: VisualEffectChoices = DEFAULT_VISUAL_EFFECT_CHOICES;
  /** Cosmetic high-refresh smoothing (options menu, persisted): forward-
   * extrapolates rendered roots/poses a fraction of a tick so 120/144/165 Hz
   * displays see unique motion every RAF. Presentation only: the match object
   * is never written back, so sim, snapshots, hashes and rollback are exact. */
  smoothMotion = true;
  private interpStates = new Map<number, InterpEntry>();
  private interpRevision: number | undefined = undefined;
  /** Melee-style manual pause camera (orbit/zoom/pan/focus). Seeded from the
   * live shot on the first paused frame; presentation only, never simulation. */
  readonly pauseCamera = new PauseCamera();
  private pausedPrev = false;
  private readonly pauseAnchor = new THREE.Vector3();
  /** In-flight upward Star KOs, keyed by fighter slot. The KO'd actor is flown
   * up/back and spun (presentation only) while the fighter sits in its frozen
   * `ko` state; `base` is the actor's normal scale so respawn restores cleanly. */
  private readonly starKOs = new Map<number, { age: number; x: number; y: number; base: number }>();
  /** Star KO twinkle bursts (a bright pop-and-fade star at the vanishing point). */
  private starTwinkles: { mesh: THREE.LineSegments; age: number; life: number }[] = [];
  /** Current-frame fly-up points fed into camera framing so the shot zooms out
   * to reveal the spinning star in the sky (rebuilt every frame by updateStarKOs). */
  private starFramePoints: { x: number; y: number }[] = [];
  /** Last match handed to render(), so between-frame pause input (focus cycling)
   * can read the fighter roster without the caller threading it through. */
  private renderedMatch: LocalMatch | null = null;

  constructor(private readonly container: HTMLElement, content: GameContent,private readonly customVisuals: CustomVisuals = new Map(), initialQuality: GraphicsQuality = 'high', initialShake: CameraShakeLevel = 'full') {
    // Phase 3.1: gameplay never needs the drawing buffer preserved (menu
    // previews capture synchronously right after their explicit render, in
    // the same task, so readback still succeeds). MSAA is disabled on `low`
    // where resolution scaling already blurs. Both are context-creation
    // flags: runtime setQuality keeps the current context; they apply on the
    // next session/renderer rebuild (see graphics-quality.ts).
    this._quality = initialQuality; this.manualQuality = initialQuality;
    this.shake.setLevel(initialShake);
    const preset = GRAPHICS_PRESETS[initialQuality];
    this.pixelRatio = preset.pixelRatio; this.stadiumInterval = preset.stadiumInterval; this.stadiumTarget = preset.stadiumTarget;
    this.renderer = new THREE.WebGLRenderer({ antialias: initialQuality !== 'low', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(this.pixelRatio(devicePixelRatio)); this.renderer.setClearColor(this.stageClear(content), 1);
    this.post = new PostProcessing(this.renderer);
    this.renderer.domElement.id = 'play-canvas'; this.renderer.domElement.setAttribute('aria-label', 'Playable Melee porting prototype');
    container.prepend(this.renderer.domElement);
    this.stageModel = content.stageModel;
    this.stage = new ModelInstance(content.stageModel, false, false, true); this.stage.group.scale.setScalar(content.stage.scale);
    this.applyStageVisibility(content);
    this.rigs = new GameRigs(content,customVisuals);
    this.effects = new PlayEffects(this.scene, content, this.rigs, this.camera);
    this.defense = new DefenseVisuals(this.scene);
    this.customEffects=[...customVisuals.values()].flatMap(visual => visual.createEffects ? [visual.createEffects(this.scene)] : []);
    this.scene.add(this.stage.group, ...this.rigs.sceneGroups(), this.debugGroup);
    for (let slot = 0; slot < MAX_MATCH_PLAYERS; slot++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.2, 32), new THREE.MeshBasicMaterial({ color: playerPresentation(slot).color, side: THREE.DoubleSide, transparent: true, opacity: 0.75 }));
      ring.visible = false; ring.rotation.x = -Math.PI / 2; this.scene.add(ring); this.respawnRings.push(ring);
    }
    this.applyQualityVisuals();
    this.camera.position.set(0, 60, 170); this.camera.lookAt(this.target);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
  }
  /** Match background from the original per-stage fog pick; synthetic test
   * stages keep the legacy clear color. */
  private stageClear(content: GameContent): THREE.Color {
    const entry = SUPPORTED_STAGES.find((stage) => stage.id === content.stageId);
    return entry ? stageBackground(content.stageModel, entry.fogBackground) : new THREE.Color(0x101724);
  }
  setStage(content: GameContent): void {
    if (this.stageModel === content.stageModel) return;
    // Same build-before-dispose contract as setFighters: a poison stage
    // model must not leave the renderer stageless.
    const stage = new ModelInstance(content.stageModel, false, false, true);
    stage.group.scale.setScalar(content.stage.scale);
    this.stage.dispose();
    this.stageModel = content.stageModel;
    this.stage = stage;
    this.scene.add(this.stage.group);
    this.renderer.setClearColor(this.stageClear(content), 1);
    this.applyStageVisibility(content);
    this.applyQualityVisuals();
  }
  /** Stage entries may declare verified runtime-prop roots to hide (see stages.ts).
   * Unknown/synthetic stage ids simply draw everything. */
  private applyStageVisibility(content: GameContent): void {
    this.shake.setClips(parseCameraQuakes(content.stageModel.archive));
    const definition = SUPPORTED_STAGES.find(stage => stage.id === content.stageId);
    const hidden = [...(definition && 'hiddenObjects' in definition ? definition.hiddenObjects : [])];
    const flyby = content.stageId === 'corneria' ? readCorneriaFlyby(content.stageModel.archive) : null;
    this.onettLayout = content.stageId === 'onett' ? readOnettTraffic(content.stageModel) : null;
    // Unreadable car layout: keep the parked rest-pose pile hidden instead of driving it.
    if (content.stageId === 'onett' && !this.onettLayout && !hidden.includes(3)) hidden.push(3);
    if (hidden.length) this.stage.hideObjects(hidden);
    this.stageMotion = flyby ? (frame) => applyCorneriaFlyby(this.stage, flyby, frame, content.stage.scale) : null;
    this.stageMotion?.(0); // Menu previews and the first frame render the frame-0 layout.
    // Onett rests with an empty street (menus, previews); matches drive the
    // cars from authoritative state in render() below.
    if (this.onettLayout) parkOnettCars(this.stage, this.onettLayout);
    // A stage with procedural motion (Corneria flyby) is never static even if
    // its archive clips are empty.
    this.stageStatic = !this.stageMotion && this.stage.isStatic();
    this.stagePrimed = false;
    // Procedural joint overrides never leak across stage switches (Peach lift root 6
    // shares its index with Green Greens block root 6).
    this.stage.clearJointPlacementOverrides();
    this.stage.clearJointFrameOverrides();
    // Green Greens block-pool mapping from the archived rest pose (root 6).
    // Falling blocks are driven per joint from authoritative match state below;
    // an unmatched pool keeps collision live while its visuals stay at rest.
    this.greensBlockJoints = null;
    if (content.stageId === 'green-greens') {
      const root = content.stageModel.roots[GREENS_BLOCK_ROOT];
      if (root) {
        const mapping: number[] = [];
        for (let row = 0; row < GREENS_ROWS; row++) for (let col = 0; col < GREENS_COLS; col++) {
          const tx = GREENS_MODEL_X[col]!, ty = GREENS_MODEL_Y[row]!;
          const joint = root.joints.findIndex((j) => Math.abs(j.translation[0] - tx) < 0.01 && Math.abs(j.translation[1] - ty) < 0.01);
          mapping[greensIndex(row, col)] = joint;
        }
        if (mapping.every((joint) => joint >= 0)) this.greensBlockJoints = mapping;
      }
    }
    for (const instance of this.stadiumTerrains.values()) instance.dispose();
    this.stadiumTerrains.clear(); this.stadiumHidden = null;
    this.stadiumScreen?.target.dispose(); this.stadiumScreen = null;this.stadiumCaptureFrame=null;
    if (content.stadiumModels) this.attachStadiumScreen();
    if (content.stadiumModels) for (const form of STADIUM_VARIANTS) {
      const model = content.stadiumModels[form];
      if (!model) continue;
      const instance = new ModelInstance(model, false, false, true);
      instance.group.scale.setScalar(content.stage.scale);
      instance.group.visible = false;
      this.scene.add(instance.group);
      this.stadiumTerrains.set(form, instance);
    }
  }
  /** The display's stacked mode layers (root 1, parts 6–18) would be paged by the
   * original display state machine; keep the first panel as the live screen and
   * suppress the frozen alternates. Signatures are verified before touching anything. */
  private attachStadiumScreen(): void {
    const SCREEN_ROOT = 1, SCREEN_PART = 6, FIRST_LAYER = 5, LAST_LAYER = 18;
    // A display layer is a flat quad exactly on the screen plane (local z ≈ 0,
    // |x| ≤ 56, y within the panel). The original display state machine pages these.
    const isScreenLayer = (part: ReturnType<ModelInstance['getPart']>): boolean => {
      if (!part) return false;
      const positions = part.geometry.positions;
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs(positions[i]!) > 56 || positions[i + 1]! < -39 || positions[i + 1]! > 34 || Math.abs(positions[i + 2]!) > 1) return false;
      }
      return positions.length > 0;
    };
    // The first display mode is a pair: part 6 is the bezel frame (center cutout)
    // and part 7 the video surface filling it; both sample the same mode texture.
    const SCREEN_CENTER = 7;
    const primary = this.stage.getPart(SCREEN_ROOT, SCREEN_PART);
    const image = primary?.material.textures[0]?.image;
    if (!isScreenLayer(primary) || !image || image.width < 128 || image.height < 128) return;
    const target = new THREE.WebGLRenderTarget(this.stadiumTarget[0], this.stadiumTarget[1], { depthBuffer: true });
    target.texture.flipY = false; target.texture.colorSpace = this.renderer.outputColorSpace;
    if (!this.stage.overrideDrawTexture(SCREEN_ROOT, SCREEN_PART, target.texture)) { target.dispose(); return; }
    const parts = [SCREEN_PART];
    if (isScreenLayer(this.stage.getPart(SCREEN_ROOT, SCREEN_CENTER)) && this.stage.overrideDrawTexture(SCREEN_ROOT, SCREEN_CENTER, target.texture)) parts.push(SCREEN_CENTER);
    for (let part = FIRST_LAYER; part <= LAST_LAYER; part++) {
      if (parts.includes(part)) continue;
      if (isScreenLayer(this.stage.getPart(SCREEN_ROOT, part))) this.stage.setDrawHidden(SCREEN_ROOT, part, true);
    }
    this.stadiumScreen = { target, root: SCREEN_ROOT, parts };
  }
  /** Cosmetic transformation visuals only: terrain scale/visibility follows the
   * snapshot-owned clock; it never feeds back into collision or match state. */
  private updateStadium(match: LocalMatch): void {
    const runtime = match.stadium, data = match.content.stadium;
    if (!runtime || !data || !this.stadiumTerrains.size) return;
    const { shrink } = data.timing;
    const progress = runtime.phase === 'shrink' ? Math.max(0.05, runtime.timer / shrink)
      : runtime.phase === 'grow' ? Math.max(0.05, 1 - runtime.timer / shrink)
      : runtime.phase === 'pause' ? 0.05 : 1;
    const rising = runtime.phase === 'grow' && runtime.timer > shrink / 2 ? -10 * (runtime.timer - shrink / 2) / (shrink / 2) : 0;
    const hidden = runtime.form === 'normal' ? [] : [STADIUM_NORMAL_TERRAIN_ROOT];
    if (this.stadiumHidden === null || hidden.length !== this.stadiumHidden.length) { this.stage.hideObjects(hidden); this.stadiumHidden = hidden; }
    for (const [form, instance] of this.stadiumTerrains) {
      const active = runtime.form === form;
      instance.group.visible = active;
      if (!active) continue;
      instance.group.scale.y = match.content.stage.scale * progress;
      instance.group.position.y = rising;
      instance.update(match.frame);
    }
  }
  setFighters(content:GameContent):void {
    // Build the replacements BEFORE disposing the live ones, so a poison
    // model (modded skeletons) fails the capture without taking the renderer
    // (menu backdrop, live match) down with it.
    const rigs=new GameRigs(content,this.customVisuals);
    const effects=new PlayEffects(this.scene,content,rigs,this.camera);
    this.reset();this.setStage(content);this.effects.dispose();this.rigs.dispose();
    this.rigs=rigs;this.scene.add(...this.rigs.sceneGroups());
    this.effects=effects;
    this.effects.common.particleLimit=GRAPHICS_PRESETS[this._quality].particleLimit;
    this.applyQualityVisuals();
  }
  /** Debug hot-swap (P key): replace one fighter's rig (+ Nana twin) in place.
   * Stage, effects routing (it reads rigs live per frame) and the running sim
   * are untouched: no countdown, no reset. The sim swap (LocalMatch) must run
   * first so clips/poses already match the new body on the next frame. */
  swapFighterRig(slot:number,fighter:FighterContent):void {
    const old = this.rigs.slotGroups(slot);
    for (const group of old) this.scene.remove(group);
    this.rigs.replaceSlot(slot, fighter);
    this.scene.add(...this.rigs.slotGroups(slot));
    this.interpStates.delete(slot);
  }
  get quality():GraphicsQuality { return this._quality; }
  /** Cosmetic camera-shake intensity (options menu): presentation only, never simulation. */
  get shakeLevel(): CameraShakeLevel { return this.shake.getLevel(); }
  setShakeLevel(level: CameraShakeLevel): void { this.shake.setLevel(level); }
  /** Applies a cosmetic preset immediately: pixel ratio, Stadium feed cadence/size and particle budget.
   * `quality` is the effective (possibly auto-stepped) preset: resolution,
   * stadium feed, particles and shadow strength/taps. `manualQuality` is the
   * user's own choice, which alone gates rich shading. A hitchy arena sheds
   * pixels (and lightens shadows) without changing the chosen look's spirit. */
  setQuality(quality:GraphicsQuality, manualQuality:GraphicsQuality = quality):void {
    const preset=GRAPHICS_PRESETS[quality];this._quality=quality;this.manualQuality=manualQuality;
    this.pixelRatio=preset.pixelRatio;this.stadiumInterval=preset.stadiumInterval;this.stadiumTarget=preset.stadiumTarget;
    this.effects.common.particleLimit=preset.particleLimit;
    this.renderer.setPixelRatio(this.pixelRatio(devicePixelRatio));this.resize();
    if(this.stadiumScreen){this.stadiumScreen.target.setSize(preset.stadiumTarget[0],preset.stadiumTarget[1]);this.stadiumCaptureFrame=null;}
    this.applyQualityVisuals();
  }
  /** Tiered shadow strength plus manual-gated rich key/fill/hemisphere shading.
   * Shadows render on every tier (lighter + fewer taps low); only the rich
   * shader stays ultra-only, and the richer path is a uniform branch in the
   * same compiled GX shader. Presentation-only decals, never simulation. */
  private applyQualityVisuals(): void {
    const manual = GRAPHICS_PRESETS[this.manualQuality];
    const effective = GRAPHICS_PRESETS[this._quality];
    this.shadowsEnabled = effective.shadowStrength > 0;
    this.shadowStrength = effective.shadowStrength;
    this.richLightEnabled = manual.richLight;
    for (const actor of [...(this.rigs?.actors ?? []), ...(this.rigs?.partners.values() ?? [])]) {
      const visuals = actor as unknown as { setRichLighting?: (enabled: boolean) => void; setSilhouetteShadows?: (enabled: boolean) => void; setShadowTaps?: (count: number) => void };
      visuals.setRichLighting?.(manual.richLight);
      visuals.setSilhouetteShadows?.(effective.shadowStrength > 0);
      visuals.setShadowTaps?.(effective.shadowTaps);
    }
    (this.stage as unknown as { setLightingEnabled?: (enabled: boolean) => void }).setLightingEnabled?.(manual.richLight);
    (this.stage as unknown as { setRichLighting?: (enabled: boolean) => void }).setRichLighting?.(manual.richLight);
    for (const instance of this.stadiumTerrains?.values() ?? []) {
      (instance as unknown as { setLightingEnabled?: (enabled: boolean) => void }).setLightingEnabled?.(manual.richLight);
      (instance as unknown as { setRichLighting?: (enabled: boolean) => void }).setRichLighting?.(manual.richLight);
    }
    if (effective.shadowStrength <= 0) this.shadowCasters = 0;
    // Effects follow the EFFECTIVE preset: an auto-stepped arena sheds their
    // cost with its pixels, while a pinned preset keeps exactly what it chose.
    this.post?.setEffects(resolveVisualEffects(this._quality, this.effectChoices));
  }
  /** Per-effect choices from the options menu (`auto` follows the preset).
   * Presentation only; applies on the next frame without touching the context. */
  setVisualEffects(choices: VisualEffectChoices): void {
    this.effectChoices = choices;
    this.post?.setEffects(resolveVisualEffects(this._quality, this.effectChoices));
  }
  /** Effects actually running, in menu order (debug overlay and tests). */
  get visualEffects(): readonly VisualEffectId[] { return this.post?.active ?? []; }
  /** Highest floor at x not above the fighter (stage + Mute City deck).
   * Prototype approximation for shadows only: Yoshi's phased-out blocks and
   * Green Greens falling heights still shadow the rest pose. */
  private groundYForShadow(match: LocalMatch, x: number, y: number): number | null {
    let best: number | null = null;
    const consider = (ax: number, ay: number, bx: number, by: number): void => {
      if (x < Math.min(ax, bx) - 2 || x > Math.max(ax, bx) + 2) return;
      let ground: number;
      if (Math.abs(ay - by) <= 0.01) ground = ay;
      else {
        if (Math.abs(bx - ax) < 1e-6) return;
        ground = ay + (by - ay) * Math.max(0, Math.min(1, (x - ax) / (bx - ax)));
      }
      if (ground > y + 1 || (best !== null && ground <= best)) return;
      best = ground;
    };
    for (const floor of match.content.stage.floors ?? []) consider(floor.a[0], floor.a[1], floor.b[0], floor.b[1]);
    for (const floor of match.muteCity?.deck?.floors ?? []) consider(floor.a[0], floor.a[1], floor.b[0], floor.b[1]);
    return best;
  }
  /** Presentation-only view of a fighter at the display instant (latest sim +
   * leftover accumulator). Returns the authoritative object when smoothing is
   * off, paused, or must snap (action cut, loop wrap, respawn/teleport,
   * rollback); otherwise a shallow copy with extrapolated x/y (and, for
   * non-custom rigs, animationFrame). Never mutates the match. */
  private interpolatedFighter(fighter: MatchFighter, frame: number, alpha: number): MatchFighter {
    const curr: InterpSnapshot = { x: fighter.x, y: fighter.y, animation: fighter.animation, animationFrame: fighter.animationFrame, facing: fighter.facing, frame };
    if (!this.smoothMotion || alpha <= 0) {
      const entry = this.interpStates.get(fighter.slot) ?? {};
      this.interpStates.set(fighter.slot, trackSimSnapshot(entry, curr, false));
      return fighter;
    }
    const next = trackSimSnapshot(this.interpStates.get(fighter.slot) ?? {}, curr, false);
    this.interpStates.set(fighter.slot, next);
    if (!next.prev || !next.curr || shouldSnapFighter(next.prev, next.curr)) return fighter;
    const pos = extrapolatePosition(next.prev, next.curr, alpha);
    // Custom skins advance their own animation clocks with visualAlpha;
    // baking that interpolation into the model here too
    // would apply it twice. Positions still smooth via the actor group.
    if (fighter.content.custom) {
      if (pos.x === fighter.x && pos.y === fighter.y) return fighter;
      return { ...fighter, x: pos.x, y: pos.y };
    }
    const animationFrame = extrapolateAnimationFrame(next.prev, next.curr, alpha);
    if (pos.x === fighter.x && pos.y === fighter.y && animationFrame === fighter.animationFrame) return fighter;
    return { ...fighter, x: pos.x, y: pos.y, animationFrame };
  }
  /** Drives each fighter's silhouette cast: receiver ground plus strength that
   * fades with height, so jumps read as lift. KO'd slots and floorless air
   * hide the cast (actor-group visibility already hides KO/blink outlines). */
  private updateShadows(match: LocalMatch, positions?: ReadonlyMap<number, { x: number; y: number }>): void {
    if (!this.shadowsEnabled) { this.shadowCasters = 0; return; }
    let casters = 0;
    for (const fighter of match.fighters) {
      const actor = this.rigs.actors[fighter.slot];
      const cast = actor as unknown as { setShadowGround?: (groundY: number | null, opacity: number, casterX?: number) => void } | undefined;
      if (!cast?.setShadowGround) continue;
      if (fighter.state === 'ko') { cast.setShadowGround(null, 0); continue; }
      const px = positions?.get(fighter.slot)?.x ?? fighter.x;
      const py = positions?.get(fighter.slot)?.y ?? fighter.y;
      const ground = this.groundYForShadow(match, px, py);
      if (ground === null) { cast.setShadowGround(null, 0); continue; }
      const height = Math.max(0, py - ground);
      if (height > 60) { cast.setShadowGround(null, 0); continue; }
      // Base 1.0: the framebuffer is linear, so sRGB-intuition understates the
      // mix badly (0.5 reads as a whisper). The clamp in-shader caps the core.
      // Tier strength keeps low presets light and cheap-looking by design.
      const opacity = 1.0 * this.shadowStrength * Math.max(0, 1 - height / 45) * (fighter.state === 'respawn' ? 0.7 : 1);
      if (opacity < 0.02) { cast.setShadowGround(null, 0); continue; }
      cast.setShadowGround(ground, opacity, px);
      casters++;
    }
    this.shadowCasters = casters;
  }
  private resize(): void {
    this.insetsAt = -Infinity;
    if (!this.container.clientWidth || !this.container.clientHeight) return;
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight; this.camera.updateProjectionMatrix();
    if (this.crowdPoints) this.frameCrowd(this.crowdPoints, false);
  }
  private frameCrowd(points: readonly FramingPoint[], settle = true): void {
    if (!this.container.clientWidth || !this.container.clientHeight) return;
    const width = this.container.clientWidth, height = this.container.clientHeight;
    const frame = crowdCameraFrame(points, width, height, {target: this.target, distance: this.camera.position.z}, this.camera.fov, this.crowdInsets());
    // Crowded shots settle softly (branch swaps and KO gaps included) while a
    // resize reframes exactly.
    const target = settle ? { x: settleFrameTarget(this.target.x, frame.target.x), y: settleFrameTarget(this.target.y, frame.target.y) } : frame.target;
    const distance = settle ? settleFrameDistance(this.camera.position.z, frame.distance) : frame.distance;
    this.target.set(target.x, target.y, 0);
    this.camera.position.set(target.x, target.y + CROWD_CAMERA_LIFT, distance);
    this.camera.far = Math.max(20_000, frame.distance * 4);
    // Fit the useful arena rectangle, not the screen area covered by HUD rows.
    // A negative crop offset shifts its optical center without moving any actor.
    this.camera.setViewOffset(width, frame.viewportHeight, 0, -frame.offsetTop, width, height);
    this.camera.lookAt(this.target); this.camera.updateMatrixWorld(true);
  }
  /** Player-prioritized slot for crowded matches: the primary local human
   * (match.options.player covers solo, explicit seats and the online slot).
   * Null for small matches (classic/crowd framing already fits), CPU
   * exhibitions (nobody to favor) and while the focus is KO'd — deaths cut
   * back to the full-arena view, then return to the focus on respawn.
   * If the configured slot isn't an alive human at all, fall back to any
   * alive human rather than the full-arena shot (primary=false flags it). */
  private focusSlot(match: LocalMatch): { slot: number; primary: boolean } | null {
    if (match.fighters.length <= 4) return null;
    const player = match.options.player;
    if (Number.isInteger(player) && player >= 0 && player < match.fighters.length && match.controllerKinds[player] === 'human') {
      const me = match.fighters[player]!;
      if (me.state !== 'ko') return { slot: player, primary: true };
      return null;
    }
    const fallback = match.fighters.find(fighter => match.controllerKinds[fighter.slot] === 'human' && fighter.state !== 'ko');
    return fallback ? { slot: fallback.slot, primary: false } : null;
  }
  /** Crowded-match close-up: frame the focus plus its nearest rivals around
   * the focus, instead of fitting the whole arena. Same lift, insets and
   * fit math as the crowd shot. */
  private frameFocus(match: LocalMatch, slot: number, alive: readonly { slot: number; x: number; y: number }[]): void {
    if (!this.container.clientWidth || !this.container.clientHeight) return;
    const me = alive.find((fighter) => fighter.slot === slot) ?? match.fighters[slot]!;
    const width = this.container.clientWidth, height = this.container.clientHeight;
    const others = alive.filter(fighter => fighter.slot !== slot).map(fighter => ({ x: fighter.x, y: fighter.y }));
    const frame = focusCameraFrame({ x: me.x, y: me.y }, others, width, height, { target: this.target, distance: this.camera.position.z }, this.camera.fov, this.crowdInsets(), {});
    // The seat stays glued on x (mirrored fit); height settles and zoom
    // growth is capped so rival swaps drift instead of snapping.
    const y = settleFrameTarget(this.target.y, frame.target.y);
    const distance = settleFrameDistance(this.camera.position.z, frame.distance);
    this.target.set(frame.target.x, y, 0);
    this.camera.position.set(frame.target.x, y + CROWD_CAMERA_LIFT, distance);
    this.camera.far = Math.max(20_000, frame.distance * 4);
    this.camera.setViewOffset(width, frame.viewportHeight, 0, -frame.offsetTop, width, height);
    this.camera.lookAt(this.target); this.camera.updateMatrixWorld(true);
  }
  /** Debug tag for non-focus branches: configured slot, its controller kind
   * initial and its state (e.g. p0=C/idle explains a crowd shot). */
  private describePlayer(match: LocalMatch): string {
    const player = match.options.player;
    const kind = match.controllerKinds[player];
    const state = match.fighters[player]?.state ?? '?';
    return `p${player}=${kind === 'human' ? 'H' : kind === 'cpu' ? 'C' : '?'}${match.fighters.length > 4 ? `/${state}` : ''}`;
  }
  /** HUD insets change only with layout (resize, HUD mode), but reading them forces a
   * synchronous layout right after React's 30 Hz HUD commits: sample twice a second. */
  private insetsAt = -Infinity;
  private insetsValue: FramingInsets | undefined;
  private crowdInsets(): FramingInsets | undefined {
    const now = performance.now();
    if (now - this.insetsAt < 500) return this.insetsValue;
    this.insetsAt = now;
    return this.insetsValue = this.measureCrowdInsets();
  }
  private measureCrowdInsets(): FramingInsets | undefined {
    const root = this.container.parentElement, bounds = this.container.getBoundingClientRect?.();
    if (!root || !bounds) return undefined;
    let top = 24, header = false;
    for (const element of root.querySelectorAll('.hud-top, .match-actions, .screen-tools, .network-telemetry')) {
      const box = element.getBoundingClientRect();
      if (box.width && box.height) { top = Math.max(top, box.bottom - bounds.top + 8); header ||= element.classList.contains('hud-top'); }
    }
    const hud = root.querySelector('.fighters-hud')?.getBoundingClientRect();
    if (hud?.height) return {top, bottom: Math.max(0, this.container.clientHeight - (hud.top - bounds.top) + 8)};
    // Minimal HUD: the percents ride above the fighters and no card row covers the
    // bottom, so a mounted header means the arena is free below it. Keeping the
    // card-row fallback here squeezed phone landscape shots into a ~118px band.
    return header ? {top, bottom: 16} : undefined;
  }
  prepare(): void { this.renderer.compile(this.scene, this.camera); }
  /** Visible draw objects by owner (fighter parts, silhouette shadow draws, stage,
   * everything else). Walks the scene: telemetry calls it once per window. */
  drawBreakdown(): Record<string, number> {
    const counts = { fighters: 0, shadows: 0, stage: 0, other: 0 };
    const fighterGroups = new Set<THREE.Object3D>(this.rigs.sceneGroups());
    const walk = (object: THREE.Object3D, owner: 'fighters' | 'stage' | 'other'): void => {
      if (!object.visible) return;
      const next = fighterGroups.has(object) ? 'fighters' : object === this.stage.group ? 'stage' : owner;
      const drawable = object as THREE.Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
      if (drawable.isMesh || drawable.isPoints || drawable.isLine || drawable.isSprite) {
        if (object.name === 'silhouette shadow') counts.shadows++; else counts[next]++;
      }
      for (const child of object.children) walk(child, next);
    };
    walk(this.scene, 'other');
    return counts;
  }
  /** Read-only presentation diagnostics; not part of the authoritative snapshot. */
  presentationSnapshot(): { stadiumCaptures:number; koBeams: number; koParticles: number; koWarnings: readonly string[]; shake: { x: number; y: number }; shakeLevel: CameraShakeLevel; camMode: 'focus' | 'crowd' | 'classic' | 'none'; camFocus: number | null; camFallback: boolean; camDetail: string; camDistance: number; shadows: boolean; richLight: boolean; effects: readonly VisualEffectId[]; magnified: readonly number[] } {
    return { stadiumCaptures:this.stadiumCaptures, koBeams: this.effects.stats.koBeams, koParticles: this.effects.stats.koParticles, koWarnings: this.effects.koWarnings, shake: this.shake.sample(), shakeLevel: this.shake.getLevel(), camMode: this.camMode, camFocus: this.camFocus, camFallback: !this.camPrimary, camDetail: this.camDetail, camDistance: Math.round(this.camera.position.z), shadows: this.shadowsEnabled && this.shadowCasters > 0, richLight: this.richLightEnabled, effects: this.visualEffects, magnified: this.magnifier.shown };
  }
  reset(): void { this.stadiumCaptureFrame=null;this.stadiumCaptures=0;this.crowdPoints = null; for (const ring of this.respawnRings) ring.visible = false; this.shadowCasters = 0; for (const marker of this.hillMarkers) { marker.ring.visible = false; marker.disc.visible = false; marker.column.visible = false; for (const bar of marker.bars) bar.visible = false; } this.hillMarkersWidth = -1; for (const spark of this.sparks) this.releaseSpark(spark); this.sparks = []; for (const slot of [...this.starKOs.keys()]) this.finishStarKO(slot); for (const twinkle of this.starTwinkles) this.releaseSpark({ mesh: twinkle.mesh, remaining: 0, total: 1 }); this.starTwinkles = []; this.frame = 0; this.presentationTime = null; this.shake.reset(); this.effects.reset(); this.defense.reset(); this.customEffects.forEach(effect => effect.reset()); this.interpStates.clear(); this.interpRevision = undefined; }
  /** Pool size bounds the live LineSegments; excess events reuse the oldest. */
  private sparkPool: THREE.LineSegments[] = [];
  private sparkPoolCap = 24;
  private acquireSpark(color: number): THREE.LineSegments {
    let mesh = this.sparkPool.pop();
    if (!mesh) {
      const material = new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false });
      mesh = new THREE.LineSegments(sparkGeometry(), material);
      mesh.renderOrder = 1000;
    } else {
      (mesh.material as THREE.LineBasicMaterial).color.setHex(color);
      (mesh.material as THREE.LineBasicMaterial).opacity = 1;
    }
    mesh.scale.setScalar(1);
    return mesh;
  }
  private releaseSpark(spark: Spark): void {
    spark.mesh.removeFromParent();
    if (this.sparkPool.length < this.sparkPoolCap) this.sparkPool.push(spark.mesh);
    else { (spark.mesh.material as THREE.Material).dispose(); }
    // Shared star geometry is never disposed per event.
  }
  events(events: readonly MatchEvent[], match: LocalMatch): void {
    this.effects.events(events, match); this.shake.events(events);
    for (const event of events) {
      // Upward blast KO → spinning Star KO (the burst beam is suppressed for it
      // in PlayEffects). Custom rigs draw through their own skin path, so they
      // keep the plain hide instead of the actor-group fly-up.
      if (event.type === 'ko' && isTopBlastKO(event.x, event.y, match.content.stage.blast) && !match.fighters[event.player]?.content.custom) {
        const actor = this.rigs.actors[event.player];
        // Start the fly-up from the top blast line (not the off-screen crossing
        // point) so the shot reveals it climbing from the top of the view.
        if (actor) this.starKOs.set(event.player, { age: 0, x: event.x, y: match.content.stage.blast.top, base: actor.group.scale.x || 1 });
      }
    }
    for (const event of events) {
      if (!['reflect', 'bounce', 'cape', 'shield', 'shield-break', 'grab', 'throw', 'ledge', 'counter'].includes(event.type)) continue;
      const color = event.type === 'reflect' ? 0x80cfff : event.type === 'bounce' ? 0xff9e40 : 0xffefb0;
      const mesh = this.acquireSpark(color); mesh.position.set(event.x, event.y, 9);
      this.scene.add(mesh); this.sparks.push({ mesh, remaining: 12, total: 12 });
      // Bound live sparks: recycle the oldest instead of growing without limit.
      if (this.sparks.length > this.sparkPoolCap) {
        const oldest = this.sparks.shift()!;
        this.releaseSpark(oldest);
      }
    }
  }
  private destroySpark(spark: Spark): void {
    this.releaseSpark(spark);
  }
  /** Drive every in-flight Star KO: fly the frozen KO'd actor up and back into
   * the sky, spinning and shrinking, then twinkle and hide it. Presentation
   * only, advanced on the cosmetic clock so the last-stock star finishes after
   * the match stops and freezes cleanly on pause. */
  private updateStarKOs(match: LocalMatch, dt: number): void {
    this.starFramePoints.length = 0;
    for (const [slot, star] of [...this.starKOs]) {
      const fighter = match.fighters[slot], actor = this.rigs.actors[slot];
      // Left KO early (rollback, or respawned): restore the rig and drop it.
      if (!fighter || !actor || fighter.state !== 'ko') { this.finishStarKO(slot); continue; }
      star.age += dt;
      if (starKoDone(star.age)) {
        // Hold the vanishing point in frame for the twinkle, then hide the rig.
        this.starFramePoints.push({ x: star.x, y: star.y + STAR_KO.rise });
        this.spawnTwinkle(star.x, star.y + STAR_KO.rise, -STAR_KO.recede);
        actor.group.scale.setScalar(star.base); actor.group.rotation.z = 0; actor.group.rotation.x = 0;
        actor.group.visible = false;
        this.starKOs.delete(slot);
        continue;
      }
      const pose = starKoPose(star.age, star.y, star.base);
      // Feed the climbing star into camera framing so the shot zooms to reveal it.
      this.starFramePoints.push({ x: star.x, y: pose.y });
      actor.tint.set(1, 1, 1); actor.opacityMultiplier = 1;
      actor.group.position.set(star.x, pose.y, pose.z);
      actor.group.rotation.z = pose.roll; actor.group.rotation.y = 0;
      actor.group.scale.setScalar(pose.scale);
      actor.group.visible = true;
      actor.group.updateWorldMatrix(true, false);
    }
    for (const twinkle of [...this.starTwinkles]) {
      twinkle.age += dt;
      const p = twinkle.age / twinkle.life;
      if (p >= 1) { this.releaseSpark({ mesh: twinkle.mesh, remaining: 0, total: 1 }); this.starTwinkles.splice(this.starTwinkles.indexOf(twinkle), 1); continue; }
      // Pop out then fade: a bright star flashing at the vanishing point.
      const pop = Math.sin(Math.min(1, p * 1.35) * Math.PI);
      twinkle.mesh.scale.setScalar(0.6 + pop * 3.2);
      twinkle.mesh.rotation.z = twinkle.age * 0.22;
      (twinkle.mesh.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - p);
    }
  }
  private spawnTwinkle(x: number, y: number, z: number): void {
    const mesh = this.acquireSpark(0xfff4c8);
    mesh.position.set(x, y, z); mesh.scale.setScalar(0.6);
    this.scene.add(mesh);
    this.starTwinkles.push({ mesh, age: 0, life: 20 });
    if (this.starTwinkles.length > 8) { const oldest = this.starTwinkles.shift()!; this.releaseSpark({ mesh: oldest.mesh, remaining: 0, total: 1 }); }
  }
  /** Restore a KO'd actor's normal scale/roll and forget the Star KO. */
  private finishStarKO(slot: number): void {
    const actor = this.rigs.actors[slot], star = this.starKOs.get(slot);
    if (actor && star) { actor.group.scale.setScalar(star.base); actor.group.rotation.z = 0; actor.group.rotation.x = 0; }
    this.starKOs.delete(slot);
  }
  /** Hill zone markers follow the authoritative zones: flat amber/sky rings
   * with a translucent claim disc, gently pulsing. Rebuilt only when the
   * zone count or half-width changes (placement, not per frame). */
  private updateHillMarkers(match: LocalMatch): void {
    const hill = match.hill;
    if (!hill || !hill.zones.length || match.phase === 'ready') {
      for (const marker of this.hillMarkers) { marker.ring.visible = false; marker.disc.visible = false; marker.column.visible = false; for (const bar of marker.bars) bar.visible = false; }
      return;
    }
    const halfWidth = hill.zones[0]!.halfWidth;
    if (this.hillMarkers.length !== hill.zones.length || this.hillMarkersWidth !== halfWidth) {
      for (const marker of this.hillMarkers) { this.disposeHillMarker(marker); }
      this.hillMarkers = hill.zones.map(() => {
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.5, halfWidth - 1.5), halfWidth, 48), hillRingMaterial());
        const disc = new THREE.Mesh(new THREE.CircleGeometry(halfWidth, 48), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.16, depthWrite: false }));
        // Open-ended cylinder: the player sees the wall of light from any angle,
        // and the shader fades it toward the sky so it never hides the fighters.
        const column = new THREE.Mesh(new THREE.CylinderGeometry(halfWidth, halfWidth, HILL_COLUMN_SPAN, 40, 1, true), hillColumnMaterial());
        // One meter per fighter: everybody in the circle races on their own bar.
        const bars = Array.from({ length: MAX_MATCH_PLAYERS }, () => {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth * 1.25, Math.max(2, halfWidth * 0.15)), hillBarMaterial());
          bar.renderOrder = 1002; bar.visible = false;
          return bar;
        });
        ring.rotation.x = -Math.PI / 2; disc.rotation.x = -Math.PI / 2;
        ring.renderOrder = 5; disc.renderOrder = 4; column.renderOrder = 6;
        this.scene.add(ring, disc, column, ...bars);
        return { ring, disc, column, bars };
      });
      this.hillMarkersWidth = halfWidth;
    }
    hill.zones.forEach((zone, index) => {
      const marker = this.hillMarkers[index]!;
      const zoneColor = HILL_ZONE_COLORS[index % HILL_ZONE_COLORS.length]!;
      const holder = hill.holders[index] ?? null;
      const claims = hillClaims(hill, index);
      const lead = claims[0];
      const progress = lead ? Math.max(0, Math.min(1, lead.progress / HILL_CAPTURE_FRAMES)) : 0;
      // The column takes the colour of whoever is closest to taking the zone,
      // else its owner's, else the plain zone tint.
      const color = lead ? this.hillSlotColor(match, lead.slot) : holder === null ? zoneColor : this.hillSideColor(match, holder);
      const capturing = !!lead;
      const fill = capturing ? progress : holder !== null ? 1 : 0;
      (marker.disc.material as THREE.MeshBasicMaterial).color.setHex(color);
      const pulse = 0.6 + 0.3 * Math.sin(match.frame * 0.08 + index * 2.1);
      const ring = (marker.ring.material as THREE.ShaderMaterial).uniforms;
      (ring.color!.value as THREE.Color).setHex(color);
      ring.fill!.value = fill; ring.opacity!.value = pulse;
      const uniforms = (marker.column.material as THREE.ShaderMaterial).uniforms;
      (uniforms.color!.value as THREE.Color).setHex(color);
      uniforms.fill!.value = fill;
      uniforms.glow!.value = holder !== null && !capturing ? 0.72 : 0.5;
      marker.ring.visible = true; marker.disc.visible = true; marker.column.visible = true;
      marker.ring.position.set(zone.x, zone.y + 0.4, 0);
      marker.disc.position.set(zone.x, zone.y + 0.35, 0);
      marker.column.position.set(zone.x, zone.y + (HILL_COLUMN_HEIGHT - HILL_COLUMN_DEPTH) / 2, 0);
      // A meter per racer, stacked over the zone in their player colour and facing
      // the camera, so a four-way scramble reads at a glance. Leader on top.
      const step = Math.max(3, zone.halfWidth * 0.24);
      marker.bars.forEach((bar, order) => {
        const claim = claims[order];
        bar.visible = !!claim;
        if (!claim) return;
        const uniforms = (bar.material as THREE.ShaderMaterial).uniforms;
        (uniforms.color!.value as THREE.Color).setHex(this.hillSlotColor(match, claim.slot));
        uniforms.fill!.value = Math.max(0, Math.min(1, claim.progress / HILL_CAPTURE_FRAMES));
        bar.position.set(zone.x, zone.y + HILL_COLUMN_HEIGHT * 0.62 - order * step, 0);
        bar.quaternion.copy(this.camera.quaternion);
      });
    });
    for (let index = hill.zones.length; index < this.hillMarkers.length; index++) { const marker = this.hillMarkers[index]!; marker.ring.visible = false; marker.disc.visible = false; marker.column.visible = false; for (const bar of marker.bars) bar.visible = false; }
  }
  /** Colour of a hill OWNER: the team tint in team mode, else the seat's player colour. */
  private hillSideColor(match: LocalMatch, side: number): number {
    if (match.options.teams) return Number.parseInt(HILL_TEAM_COLORS[side === 1 ? 1 : 0].slice(1), 16);
    return this.hillSlotColor(match, side);
  }
  /** Colour of one fighter's capture meter: always their own player colour, even in
   * team mode, because the meters are per fighter. */
  private hillSlotColor(match: LocalMatch, slot: number): number {
    const seat = match.fighters[slot]?.seatId ?? slot;
    return playerPresentation(Math.max(0, Math.min(MAX_MATCH_PLAYERS - 1, seat))).color;
  }
  private disposeHillMarker(marker: { ring: THREE.Mesh; disc: THREE.Mesh; column: THREE.Mesh; bars: THREE.Mesh[] }): void {
    for (const mesh of [marker.ring, marker.disc, marker.column, ...marker.bars]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
  render(match: LocalMatch,visualAlpha=0,paused=false): void {
    this.renderedMatch = match;
    profiler.begin(SPAN_STAGE);
    // Cosmetic KO playback must finish even when the final-stock simulation stops.
    // Pausing freezes it; rollback/resimulation never rewinds or emits this clock.
    const now = performance.now();
    const presentationFrames = paused || this.presentationTime === null ? 0 : Math.max(0, Math.min(6, (now - this.presentationTime) * 0.06));
    this.presentationTime = now;
    this.shake.update(presentationFrames);
    const elapsed = Math.max(0, Math.min(6, match.frame - this.frame)); this.frame = match.frame;
    this.stageMotion?.(match.frame);
    // Onett hazards pose from authoritative match state (rollback-safe: the
    // runtime is snapshot-owned, never a presentation clock).
    if (this.onettLayout && match.content.stageId === 'onett' && match.onett) applyOnettRuntime(this.stage, this.onettLayout, match.onett);
    // Phase 3.2: stages without animated parts (most) pose once; animated
    // stages (Corneria flyby, Yoshi spin, material scrolls) update per frame.
    // Yoshi's Island blocks rest frozen at frame 0 and replay the archived
    // 324-frame joint loop per block while that block spins (see lib/game/stages.ts):
    // the loop ends at ~13 full turns, so settling back to frame 0 keeps orientation.
    // Replaying match.frame instead would spin them forever, desynced from collision.
    // Blocks live in stage root 1 (joints YOSHI_BLOCK_JOINTS); each spinning block
    // samples its own elapsed frame, every other joint the rest frame.
    let stageFrame = match.frame;
    if (match.content.stageId === 'yoshi-island') {
      stageFrame = 0;
      this.stage.clearJointFrameOverrides();
      match.yoshiBlocks.forEach((timer, block) => {
        if (timer > 0) this.stage.setJointFrameOverride(1, YOSHI_BLOCK_JOINTS[block]!, YOSHI_SPIN_FRAMES + 1 - timer);
      });
    } else if (STATIC_STAGE_ANIMATION.has(match.content.stageId)) stageFrame = 0;
    // Green Greens blocks follow the authoritative grid (falling blocks ride down
    // from the blast top, broken slots hide); Whispy replays its archived idle
    // sway at match.frame and leans into the wind as a prototype proxy for the
    // blow clips. Presentation only: collision never reads these overrides.
    if (match.content.stageId === 'green-greens' && match.greens) {
      const scale = match.content.stage.scale || 1;
      this.stage.clearJointPlacementOverrides();
      if (this.greensBlockJoints) {
        for (let row = 0; row < GREENS_ROWS; row++) for (let col = 0; col < GREENS_COLS; col++) {
          const index = greensIndex(row, col);
          const joint = this.greensBlockJoints[index]!;
          if (joint < 0) continue;
          const block = match.greens.blocks[index]!;
          if (block.status === 0) this.stage.setJointVisibilityOverride(GREENS_BLOCK_ROOT, joint, false);
          else {
            this.stage.setJointVisibilityOverride(GREENS_BLOCK_ROOT, joint, true);
            const dy = (block.y - GREENS_GRID_Y[row]!) / scale;
            if (Math.abs(dy) > 1e-6) this.stage.setJointTranslationOverride(GREENS_BLOCK_ROOT, joint, [0, dy, 0]);
          }
        }
      }
      const lean = match.greens.windActive === 1 ? -4 : match.greens.windActive === 2 ? 4 : 0;
      this.stage.setObjectOffset(GREENS_TREE_ROOT, lean, 0, 0);
    }
    // Peach's Castle yellow traveling platforms (GrCs map root 6 j1/j4) freeze at
    // dock: bind rest is y=234 model units, original init parks them at yakumono
    // x14=205, so ride -29 to match the frozen collision offsets in stages.ts.
    // Presentation only; collision never reads these overrides.
    if (match.content.stageId === 'peach-castle') {
      this.stage.setJointTranslationOverride(6, 1, [0, -29, 0]);
      this.stage.setJointTranslationOverride(6, 4, [0, -29, 0]);
      // Bills pose from authoritative runtime (hidden parked, one live missile).
      applyPeachBillRuntime(this.stage, match.peachBill, match.content.stage.scale || 1);
    }
    if (!this.stageStatic || !this.stagePrimed) { this.stage.update(stageFrame); this.stagePrimed = true; }
    this.updateStadium(match);
    profiler.end(SPAN_STAGE);
    profiler.begin(SPAN_FIGHTERS);
    for (const ring of this.respawnRings) ring.visible = false;
    // High-refresh smoothing: resim corrections share the frame number, so a
    // revision change resets the tracked pair instead of streaking corrected
    // poses across the screen. Same-frame re-renders keep the pair so
    // velocity survives the 2-3 RAFs between 60 Hz steps.
    const interpAlpha = this.smoothMotion && !paused ? clampVisualAlpha(visualAlpha) : 0;
    if (match.restoreRevision !== this.interpRevision) { this.interpStates.clear(); this.interpRevision = match.restoreRevision; }
    const interpPositions = new Map<number, { x: number; y: number }>();
    for (const fighter of match.fighters) {
      const view = this.interpolatedFighter(fighter, match.frame, interpAlpha);
      interpPositions.set(fighter.slot, { x: view.x, y: view.y });
      const actor = this.rigs.actors[fighter.slot]!;
      // Phase 3.2: invisible fighters skip skinning prepare() entirely.
      // Simulation poses already ran in LocalMatch.step; this only skips the
      // presentation re-sample for fighters nobody can see this frame.
      const hidden = fighter.state === 'ko' || inhaledVictimHidden(fighter, match.fighters) || (fighter.invulnerable > 0 && Math.floor(match.frame / 4) % 2 !== 0);
      if (hidden) { actor.group.visible = false; }
      else {
      const chargePulse=fighter.smash?.phase==='charging'?0.5+0.5*Math.sin(fighter.smash.frames*0.55):0;
      // Supplemental charge flash; not the complete original color-animation table.
      actor.tint.set(1+chargePulse*0.35,1+chargePulse*0.2,1-chargePulse*0.25);
      actor.opacityMultiplier=['dodge','air-dodge'].includes(fighter.state)&&!hurtEnabled(fighter,fighter.content.profile.boneMap[4]!)?0.4:1;
      this.rigs.sample(view);
      // rigs.sample already hid the teleport zooms (Mewtwo, Shadow's Chaos Control, Zelda, Sheik);
      // the invincibility blink must not bring them back every other window.
      actor.group.visible = actor.group.visible && !inhaledVictimHidden(fighter, match.fighters) && (fighter.invulnerable <= 0 || Math.floor(match.frame / 4) % 2 === 0);
      }
      const ring = this.respawnRings[fighter.slot]!; (ring.material as THREE.MeshBasicMaterial).color.setHex(playerPresentation(fighter.seatId ?? fighter.slot).color); ring.visible = fighter.state === 'respawn'; ring.position.set(view.x, view.y - 0.1, 0);
      if (hidden && fighter.state === 'respawn') { actor.group.visible = false; }
    }
    profiler.end(SPAN_FIGHTERS);
    profiler.begin(SPAN_OVERLAYS);
    this.updateStarKOs(match, presentationFrames);
    this.updateHillMarkers(match);
    this.updateShadows(match, interpPositions);
    for (const spark of [...this.sparks]) {
      spark.remaining -= elapsed;
      if (spark.remaining <= 0) { this.destroySpark(spark); this.sparks.splice(this.sparks.indexOf(spark), 1); }
      else { (spark.mesh.material as THREE.LineBasicMaterial).opacity = spark.remaining / spark.total; spark.mesh.scale.setScalar(1 + (1 - spark.remaining / spark.total) * 2); }
    }
    profiler.end(SPAN_OVERLAYS);
    profiler.begin(SPAN_CAMERA);
    const alive = match.fighters.filter((fighter) => fighter.state !== 'ko');
    // Camera_8002958C: a fighter past the stage camera range pulls the shot only to its edge,
    // so launched fighters leave the frame (and get the magnifier) like the original.
    const cameraBounds = match.content.stage.camera ?? STAGE_CAMERA_DEFAULT;
    const aliveInterp = alive.map((fighter) => ({ slot: fighter.slot, ...clampToCameraBounds({ x: interpPositions.get(fighter.slot)?.x ?? fighter.x, y: interpPositions.get(fighter.slot)?.y ?? fighter.y }, cameraBounds) }));
    // Every living fighter stays framed so a launched player never loses
    // themselves; KO beams stay world-locked, so a kill no longer flips the
    // 1v1 shot into a snapped crowd zoom. Branch selection below still uses
    // the unfiltered `alive` set.
    // Include any in-flight Star KO points so the classic/crowd shot widens to
    // keep the spinning, shrinking fighter in the sky visible.
    const framed = [...aliveInterp.map(fighter => ({x: fighter.x, y: fighter.y})), ...this.starFramePoints];
    // A confirmed death remains a temporary cosmetic framing target; never move
    // the fighter or resurrect an eliminated slot to keep its beam on screen.
    // Crowded matches follow the primary local human instead of fitting the
    // whole arena; KO drama and exhibitions fall back to the full-arena shot.
    if (paused) {
      // Frozen match: hand the camera to the player (orbit/zoom/pan/focus).
      this.crowdPoints = null;
      if (!this.pausedPrev) {
        // Seed the orbit from the live shot exactly once, dropping the HUD view
        // offset so the free camera fills the whole frame instead of the crop.
        if (this.camera.view?.enabled) this.camera.clearViewOffset();
        this.camera.aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
        this.camera.updateProjectionMatrix();
        this.pauseCamera.begin(this.camera, this.target);
        this.pausedPrev = true;
      }
      this.camMode = 'none'; this.camFocus = this.pauseCamera.focus; this.camPrimary = true;
      this.camDetail = `pause${this.pauseCamera.focus !== null ? ` P${this.pauseCamera.focus + 1}` : ''}`;
      this.pauseCamera.apply(this.camera, this.resolvePauseAnchor(match));
    } else {
    this.pausedPrev = false;
    const focus = this.focusSlot(match);
    this.crowdPoints = focus === null && match.fighters.length > 4 && alive.length
      ? framed : null;
    if (this.crowdPoints) { this.camMode = 'crowd'; this.camFocus = null; this.camPrimary = true; this.camDetail = this.describePlayer(match); this.frameCrowd(this.crowdPoints); }
    else if (focus !== null) { this.camMode = 'focus'; this.camFocus = focus.slot; this.camPrimary = focus.primary; this.camDetail = `P${focus.slot + 1}${focus.primary ? '' : '*'} ${this.describePlayer(match)}`; this.frameFocus(match, focus.slot, aliveInterp); }
    else if (alive.length) { this.camMode = 'classic'; this.camFocus = null; this.camPrimary = true; this.camDetail = this.describePlayer(match); this.camMode = 'classic'; this.camFocus = null;
      if (this.camera.view?.enabled) { this.camera.clearViewOffset(); this.camera.aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight); this.camera.updateProjectionMatrix(); }
      const xs = framed.map((f) => f.x), ys = framed.map((f) => f.y);
      // Frame limits derive from the live stage (never cached: Stadium swaps forms).
      const limits = classicCameraLimits(match.content.stage, this.camera.aspect);
      const cx = THREE.MathUtils.clamp((Math.min(...xs) + Math.max(...xs)) / 2, limits.cxLo, limits.cxHi);
      const cy = THREE.MathUtils.clamp((Math.min(...ys) + Math.max(...ys)) / 2 + 12, limits.cyLo, limits.cyHi);
      // Fit around the clamped center, not the spread midpoint: pan clamps can
      // pull the camera away from the midpoint, which would crop an edge fighter.
      const halfHeight = Math.max(...framed.map((f) => Math.max(Math.abs(f.y - cy), Math.abs(f.x - cx) / this.camera.aspect))) + 22;
      const distance = THREE.MathUtils.clamp(halfHeight / Math.tan(THREE.MathUtils.degToRad(21)), 95, limits.maxDistance);
      // Camera_8002A768: never show past the stage camera range (a climbing Star KO is the
      // one exception: it must stay in the sky shot).
      const shot = this.starFramePoints.length ? { x: cx, y: cy } : confineCameraTarget({ x: cx, y: cy }, distance, 32, this.camera.fov, this.camera.aspect, cameraBounds);
      this.desired.set(shot.x, shot.y, 0); this.target.lerp(this.desired, 0.12);
      this.desired.set(shot.x, shot.y + 32, distance); this.camera.position.lerp(this.desired, 0.12); this.camera.lookAt(this.target);
    }
    else { this.camMode = 'none'; this.camFocus = null; this.camPrimary = true; this.camDetail = ''; }
    }
    profiler.end(SPAN_CAMERA);
    profiler.begin(SPAN_EFFECTS);
    this.rigs.renderSkins(match,this.camera,this.customPresentation,visualAlpha,paused);
    this.effects.update(match,presentationFrames,{alpha:interpAlpha,smooth:this.smoothMotion&&!paused,revision:match.restoreRevision}); this.defense.update(match,this.rigs); this.customEffects.forEach(effect => effect.update(match,this.camera,this.customPresentation));
    this.updateDebug(match); this.syncCollisionLines(match);
    // Billboard-flagged stage draws (Battlefield's center glow sprite) track the
    // settled camera like the original JOBJ billboards; unflagged stages skip inside.
    this.stage.applyBillboards(this.camera);
    profiler.end(SPAN_EFFECTS);
    this.gpuTimer?.begin();
    profiler.begin(SPAN_STADIUM);
    // Phase 3.5: `low` disables the jumbotron render-to-texture entirely and
    // keeps the archive's static display texture (no per-frame RTT cost).
    if (this.stadiumScreen && this._quality !== 'low' && match.frame % this.stadiumInterval === 0 && (this.stadiumCaptureFrame!==match.frame||this.stadiumCaptureRevision!==match.restoreRevision)) {
      // A paused/stalled even frame must not re-render the scene on every RAF.
      // A corrected rollback boundary at that same frame is a new picture.
      this.stadiumCaptureFrame=match.frame;this.stadiumCaptureRevision=match.restoreRevision;this.stadiumCaptures++;
      // Live broadcast capture, like the original framebuffer grab: a stadium
      // camera framing the fighters, not the HUD-offset player camera.
      const alive = match.fighters.filter(f => f.stocks > 0);
      const xs = alive.map(f => f.x), ys = alive.map(f => f.y);
      const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
      const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 10;
      const spread = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * this.stadiumCamera.aspect) : 0;
      // Fit the fighters plus margin into the horizontal field of view: a zoomed
      // broadcast framing, not a wide establishing shot.
      const halfTangent = Math.tan(this.stadiumCamera.fov * Math.PI / 360);
      const distance = Math.min(130, Math.max(50, (spread / 2 + 18) / (halfTangent * this.stadiumCamera.aspect)));
      // High three-quarter broadcast angle: keeps the giant display itself out of
      // its own frame (a front-facing capture converges to a black feedback core)
      // and fills the feed with the bright arena floor and the fighters.
      this.stadiumCamera.position.set(cx * 0.85 + 30, cy + 55, distance * 0.9);
      this.stadiumCamera.lookAt(cx, cy - 2, 0);
      this.stadiumCamera.updateMatrixWorld(true);
      // The display stays in its own capture: the screen aperture is a hole in the
      // shell, so the one-frame-delayed feed fills it exactly like the original
      // framebuffer grab did (hiding it would show the night sky through the hole).
      this.renderer.setRenderTarget(this.stadiumScreen.target);
      this.renderer.render(this.scene, this.stadiumCamera);
      this.renderer.setRenderTarget(null);
    }
    profiler.end(SPAN_STADIUM);
    profiler.begin(SPAN_DRAW);
    const restoreProjection = this.shake.apply(this.camera, this.container.clientWidth, this.container.clientHeight,
      globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const magnified = paused ? [] : this.magnifyEntries(match);
    try { this.post.render(this.scene, this.camera); }
    finally { restoreProjection(); profiler.end(SPAN_DRAW); this.gpuTimer?.end(); }
    this.magnifier.render(this.renderer, magnified, this.container.clientWidth, this.container.clientHeight, magnified.length ? this.crowdInsets() : undefined);
  }
  /** ifMagnify_802FBBDC: fighters whose camera bone projects outside the screen (live,
   * visible ones only — ftLib_80086ED0), with their lens framing and background. */
  private magnifyEntries(match: LocalMatch): MagnifyEntry[] {
    if (match.phase !== 'playing' && match.phase !== 'countdown') return [];
    const entries: MagnifyEntry[] = [], stage = match.content.stage;
    const bounds = stage.camera ?? STAGE_CAMERA_DEFAULT, width = this.container.clientWidth, height = this.container.clientHeight;
    this.camera.updateMatrixWorld();
    for (const fighter of match.fighters) {
      if (fighter.state === 'ko' || fighter.state === 'respawn' || inhaledVictimHidden(fighter, match.fighters) || this.starKOs.has(fighter.slot)) continue;
      // The 5–8 player focus shot leaves distant rivals out on purpose: only the followed
      // fighter gets a lupe there (the original never had more than four fighters).
      if (this.camMode === 'focus' && fighter.slot !== this.camFocus) continue;
      const actor = this.rigs.actors[fighter.slot];
      if (!actor) continue;
      const profile = fighter.content.profile, box = profile.cameraBox;
      const [bx, by, bz] = box ? this.rigs.point(fighter, box.joint, box.offset) : [fighter.x, fighter.y + 10, 0];
      const bone = this.magnifyBone.set(bx, by, bz), screen = this.magnifyProjected.copy(bone).project(this.camera);
      if (screen.z < 1 && Math.abs(screen.x) <= 1 && Math.abs(screen.y) <= 1) continue;
      entries.push({
        slot: fighter.slot, object: actor.group, bone: bone.clone(),
        screen: { x: (screen.x + 1) * width / 2, y: (1 - screen.y) * height / 2 },
        halfExtent: magnifyHalfExtent(box?.magnify ?? 11, profile.attributes.modelScale),
        background: magnifyBackground(bx, by, bounds, stage.magnifyColors ?? []),
        // gm_80160968: CPU seats use the grey slot colour; humans keep their seat colour.
        color: match.controllerKinds[fighter.slot] === 'cpu' ? MAGNIFY_CPU_COLOR : playerPresentation(fighter.seatId ?? fighter.slot).color,
      });
    }
    return entries;
  }
  labelPosition(x: number, y: number): { x: number; y: number; visible: boolean } {
    const point = new THREE.Vector3(x, y + 20, 0).project(this.camera);
    return { x: (point.x + 1) * this.container.clientWidth / 2, y: (1 - point.y) * this.container.clientHeight / 2, visible: point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 };
  }
  /** Orbit centre while paused: the focused fighter's torso, or the free look
   * point (a KO'd or missing focus falls back to the free anchor). */
  private resolvePauseAnchor(match: LocalMatch): THREE.Vector3 {
    const slot = this.pauseCamera.focus;
    if (slot !== null) {
      const fighter = match.fighters[slot];
      if (fighter && fighter.state !== 'ko') return this.pauseAnchor.set(fighter.x, fighter.y + 14, 0);
    }
    return this.pauseAnchor.copy(this.pauseCamera.home);
  }
  // --- Manual pause camera controls (driven by PauseCameraControls) ---------
  /** Rotate the paused orbit (screen-space drag/keys already scaled to radians). */
  pauseOrbit(dYaw: number, dPitch: number): void { this.pauseCamera.orbit(dYaw, dPitch); }
  /** Multiplicative zoom (factor < 1 = closer). */
  pauseZoom(factor: number): void { this.pauseCamera.zoom(factor); }
  /** Pan the look point across the view plane (screen-space right/up amounts). */
  pausePan(right: number, up: number): void { this.pauseCamera.nudge(right, up, this.camera); }
  /** Restore the entry pose (orbit, zoom, no pan, free look). */
  pauseReset(): void { this.pauseCamera.reset(); }
  /** Centre on an explicit fighter slot (ignored if it is not a real fighter). */
  pauseFocusSlot(slot: number): { slot: number; name: string } | null {
    const match = this.renderedMatch;
    if (!match || !Number.isInteger(slot) || slot < 0 || slot >= match.fighters.length) return null;
    this.pauseCamera.focus = slot;
    return this.pauseFocusInfo();
  }
  /** Step the focus through the roster: free → P1 → … → Pn → free. */
  pauseFocusCycle(direction: 1 | -1 = 1): { slot: number; name: string } | null {
    const match = this.renderedMatch;
    if (!match || !match.fighters.length) return null;
    const count = match.fighters.length;
    // Order: null (free) then each slot; step and wrap around the ring.
    const current = this.pauseCamera.focus === null ? -1 : this.pauseCamera.focus;
    const next = ((current + 1 + direction) % (count + 1) + (count + 1)) % (count + 1) - 1;
    this.pauseCamera.focus = next < 0 ? null : next;
    return this.pauseFocusInfo();
  }
  /** Current pause focus label for the HUD (null while framing freely). */
  pauseFocusInfo(): { slot: number; name: string } | null {
    const match = this.renderedMatch, slot = this.pauseCamera.focus;
    if (!match || slot === null) return null;
    const fighter = match.fighters[slot];
    return fighter ? { slot, name: fighter.content.profile.name } : null;
  }
  private updateDebug(match: LocalMatch): void {
    for (const child of this.debugGroup.children) child.visible = false;
    if (!this.debugHitboxes) return;
    let used = 0;
    for (const fighter of match.fighters) {
      if (fighter.state === 'ko') continue;
      const sphere = (point: number[], radius: number, color: number) => {
        let mesh = this.debugGroup.children[used++] as THREE.Mesh | undefined;
        if (!mesh) { mesh = new THREE.Mesh(this.debugGeometry, this.debugMaterials[0]); this.debugGroup.add(mesh); }
        mesh.material = this.debugMaterials[color === 0x55ddbb ? 0 : 1]!;
        mesh.visible = true; mesh.scale.setScalar(radius); mesh.position.set(point[0]!, point[1]!, point[2]!);
      };
      for (const hurt of fighter.content.profile.hurts) {
        sphere(this.rigs.point(fighter, hurt.bone, hurt.a), hurt.radius, 0x55ddbb);
        sphere(this.rigs.point(fighter, hurt.bone, hurt.b), hurt.radius, 0x55ddbb);
      }
      if (fighter.smash?.phase!=='charging' && ['attack','grab','special','ledge-action'].includes(fighter.state) && fighter.attackName) for (const hit of activeHits(fighter.content.attacks.get(fighter.attackName)!, fighter.animationFrame)) sphere(this.rigs.point(fighter, hit.bone, hit.offset), hit.radius, 0xff7755);
    }
  }
  /** Collision wireframe (solid floors green, one-ways yellow, walls red, ceilings
   * blue, ledges white crosses): rebuilt only when the stage object or the Yoshi
   * spin state changes, so the overlay always draws the active set the simulation
   * reads — phased-out lines vanish instead of lying. X-rayed (no depth test) so
   * buried lines and invisible holes read at a glance. */
  private syncCollisionLines(match: LocalMatch): void {
    const spinning = match.content.stageId === 'yoshi-island'
      ? match.yoshiBlocks.reduce((mask, timer, block) => (timer > 0 ? mask | (1 << block) : mask), 0)
      : 0;
    // Green Greens blocks move every falling frame; rebuild the overlay only when
    // the live set actually changes (statuses + quantized heights).
    const greens = match.content.stageId === 'green-greens' && match.greens
      ? match.greens.blocks.map((block) => `${block.status}:${Math.round(block.y * 2)}`).join(',')
      : '';
    if (this.collisionLines && this.collisionStage === match.content.stage && this.collisionSpin === spinning && this.collisionGreens === greens) {
      this.collisionLines.visible = this.debugCollision;
      return;
    }
    this.collisionStage = match.content.stage; this.collisionSpin = spinning; this.collisionGreens = greens;
    this.collisionLines?.removeFromParent(); this.collisionLines?.geometry.dispose();
    (this.collisionLines?.material as THREE.Material | undefined)?.dispose();
    this.collisionLines = null;
    if (!this.debugCollision) return;
    const { surfaces } = visibleStageCollision(match.content.stage, match.content.stageId, match.yoshiBlocks, match.greens, match.muteCity);
    const positions: number[] = [], colors: number[] = [], color = new THREE.Color();
    const seg = (ax: number, ay: number, bx: number, by: number, hex: number) => {
      positions.push(ax, ay, 0, bx, by, 0); color.setHex(hex);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    };
    for (const surface of surfaces) {
      seg(surface.a[0], surface.a[1], surface.b[0], surface.b[1],
        surface.kind === 'wall' ? 0xff5555 : surface.kind === 'ceiling' ? 0x8f7bff : surface.oneWay ? 0xffe066 : 0x44ff88);
    }
    for (const ledge of match.content.stage.ledges) {
      seg(ledge.x - 1.5, ledge.y, ledge.x + 1.5, ledge.y, 0xffffff);
      seg(ledge.x, ledge.y - 1.5, ledge.x, ledge.y + 1.5, 0xffffff);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }));
    lines.renderOrder = 999; lines.frustumCulled = false;
    this.scene.add(lines); this.collisionLines = lines;
  }
  dispose(): void {
    this.observer.disconnect(); this.reset(); this.effects.dispose(); this.defense.dispose(); this.customEffects.forEach(effect => effect.dispose()); this.stage.dispose(); this.rigs.dispose();
    this.collisionLines?.removeFromParent(); this.collisionLines?.geometry.dispose();
    (this.collisionLines?.material as THREE.Material | undefined)?.dispose(); this.collisionLines = null; this.collisionStage = null;
    for (const instance of this.stadiumTerrains.values()) instance.dispose(); this.stadiumTerrains.clear();
    this.stadiumScreen?.target.dispose(); this.stadiumScreen = null;
    for (const spark of this.sparkPool) { spark.geometry.dispose(); (spark.material as THREE.Material).dispose(); }
    this.sparkPool = [];
    for (const ring of this.respawnRings) { ring.geometry.dispose(); (ring.material as THREE.Material).dispose(); }
    // Silhouette casts are owned and disposed by their ModelInstances (rigs/stage).
    for (const marker of this.hillMarkers) this.disposeHillMarker(marker);
    this.hillMarkers = []; this.hillMarkersWidth = -1;
    this.debugGroup.clear(); this.debugGeometry.dispose(); this.debugMaterials.forEach((material) => material.dispose());
    this.post.dispose(); this.magnifier.dispose();
    disposeCustomVisuals(this.customVisuals);this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
