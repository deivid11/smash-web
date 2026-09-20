import { Box3, Color, PerspectiveCamera, Scene, Vector2, Vector3 } from 'three';
import { LocalMatch } from '../../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../../lib/game/roster.ts';
import type { GameContent } from '../../../lib/game/load.ts';
import type { FighterKind } from '../../../lib/game/data.ts';
import type { PlayRenderer } from '../render/play-renderer.ts';
import { ModelInstance } from '../render/model-instance.ts';
import { supportedStage, stageBackground } from '../../../lib/game/stages.ts';
import { COMMON_ITEM_NAMES, MATCH_ITEM_NAMES } from '../../../lib/game/item-kinds.ts';

/** Runtime thumbnails from already-loaded original models, never published assets.
 * Reuses the one WebGL context during boot; does not touch an active match.
 * Readback works despite `preserveDrawingBuffer: false` (Phase 3.1) because
 * every `toDataURL` runs synchronously in the same task as its render, before
 * the browser composites — no temporary context needed. */
export function captureMenuPreviews(renderer: PlayRenderer, stages: ReadonlyMap<string, GameContent>): { portraits: Record<string, string>; itemPortraits: Record<string, string>; stagePreviews: Record<string, string> } {
  const graphics = renderer.renderer, size = graphics.getSize(new Vector2());
  const ratio = graphics.getPixelRatio(), clear = graphics.getClearColor(new Color()).clone(), alpha = graphics.getClearAlpha();
  const scene = new Scene();
  try {
    const content = stages.get('battlefield')!;
    const portraits = captureFighterPortraits(renderer, scene, content, ROSTER_CHOICES as readonly FighterKind[]);
    const itemPortraits = captureItemPortraits(renderer, scene, content);
    const stagePreviews: Record<string, string> = {};
    for (const [id, stageContent] of stages) Object.assign(stagePreviews, captureStagePreview(renderer, scene, id, stageContent));
    return { portraits, itemPortraits, stagePreviews };
  } finally {
    graphics.setDrawingBufferSize(size.x, size.y, ratio); graphics.setClearColor(clear, alpha);
  }
}

/** Thumbnail captures borrow the live WebGL surface (pixel ratio, buffer
 * size, clear color) and must hand it back: the boot/idle/costume paths call
 * these while the menu backdrop is live, and a leaked 300×380 buffer upscaled
 * to fullscreen reads as “stuck on low quality” despite the setting (High+).
 * captureMenuPreviews already restores around the monolithic path; this
 * helper covers every chunked caller at once. */
export function withPreservedSurface<T>(graphics: { getSize(target: Vector2): Vector2; getPixelRatio(): number; getClearColor(target: Color): Color; getClearAlpha(): number; setPixelRatio(ratio: number): void; setSize(width: number, height: number, updateStyle: boolean): void; setDrawingBufferSize?(width: number, height: number, ratio: number): void; setClearColor(color: number, alpha: number): void }, run: () => T): T {
  const size = graphics.getSize(new Vector2());
  const ratio = graphics.getPixelRatio(), clear = graphics.getClearColor(new Color()).clone(), alpha = graphics.getClearAlpha();
  try { return run(); }
  finally {
    // One drawing-buffer reallocation: setPixelRatio alone already resizes the canvas.
    if (graphics.setDrawingBufferSize) graphics.setDrawingBufferSize(size.x, size.y, ratio);
    else { graphics.setPixelRatio(ratio); graphics.setSize(size.x, size.y, false); }
    graphics.setClearColor(clear.getHex(), alpha);
  }
}

/** Phase 2.2: portraits for one chunk of the roster (a page, or an idle slice),
 * so cold boot never blocks on all 33 fighters at once. Same framing as the
 * monolithic capture above. */
export function captureFighterPortraits(renderer: PlayRenderer, scene: Scene, content: GameContent, kinds: readonly FighterKind[]): Record<string, string> {
  return withPreservedSurface(renderer.renderer, () => {
  const graphics = renderer.renderer, portraits: Record<string, string> = {};
  graphics.setClearColor(0x000000, 0); graphics.setDrawingBufferSize(300, 380, 1);
  for (const kind of kinds) {
    // A modded fighter (Zero) is absent when the extension disc is not registered.
    if (!content.roster.has(kind)) continue;
    try {
      const selected = rosterPair(content, kind, 'Fx');
      const dataUrl = capturePortrait(renderer, scene, selected, kind);
      if (dataUrl) portraits[kind] = dataUrl;
    } catch { /* One poison model must not drop the whole chunk; the caller retries it later or falls back to its letter mark. */ }
  }
  return portraits;
  });
}
/** One alternate-costume portrait on demand (skin picker feedback): the caller
 * supplies content whose slot-0 fighter already carries the costume model
 * (see selectLineup); framing matches the roster capture exactly. */
export function captureCostumePortrait(renderer: PlayRenderer, scene: Scene, selected: GameContent, kind: FighterKind): string | null {
  return withPreservedSurface(renderer.renderer, () => {
    const graphics = renderer.renderer;
    graphics.setClearColor(0x000000, 0); graphics.setDrawingBufferSize(300, 380, 1);
    return capturePortrait(renderer, scene, selected, kind);
  });
}
/** Portrait framing: a wide scout render measures the posed fighter in pixels
 * (exact for skinned meshes, sprite skins and held props alike), then the same
 * camera re-renders through a view offset fitted to the bust, so every roster
 * entry is framed by its own silhouette instead of a hand-tuned offset. */
const PORTRAIT_W = 300, PORTRAIT_H = 380, SCOUT_VIEW = 3;
interface PortraitFrame { x: number; y: number; width: number; height: number }
let portraitCanvas: HTMLCanvasElement | null = null, portraitStage: HTMLCanvasElement | null = null;
function portraitContext(stage: boolean): CanvasRenderingContext2D {
  let canvas = stage ? portraitStage : portraitCanvas;
  if (!canvas) {
    canvas = document.createElement('canvas'); canvas.width = PORTRAIT_W; canvas.height = PORTRAIT_H;
    if (stage) portraitStage = canvas; else portraitCanvas = canvas;
  }
  return canvas.getContext('2d', { willReadFrequently: !stage })!;
}
/** Head-shot frame (in scout pixels) in the manner of the original select screen,
 * read from the alpha mask alone: the top band of the silhouette is the head, its
 * solid span (thin props such as a sword or parasol carry little mass) sets both
 * the centre and the zoom. Round fighters (Kirby, Jigglypuff) widen to the whole body. */
export function portraitFrame(alpha: Uint8ClampedArray, width: number, height: number): PortraitFrame | null {
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (alpha[(y * width + x) * 4 + 3]! > 24) {
    if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x;
  }
  if (bottom < 0) return null;
  // The crown starts at the first row with real width: a raised blade tip is not a head.
  const rowFloor = Math.max(3, (right - left + 1) * 0.1);
  for (let y = top; y < bottom; y++) {
    let count = 0;
    for (let x = left; x <= right; x++) if (alpha[(y * width + x) * 4 + 3]! > 24) count++;
    if (count >= rowFloor) { top = y; break; }
  }
  const bodyH = bottom - top + 1, aspect = PORTRAIT_W / PORTRAIT_H;
  const band = Math.min(bottom, top + Math.ceil(bodyH * 0.3)), columns = new Float64Array(width);
  let mass = 0;
  for (let y = top; y <= band; y++) for (let x = left; x <= right; x++) { const a = alpha[(y * width + x) * 4 + 3]!; columns[x]! += a; mass += a; }
  // Solid columns only (≥ 30% of the densest): ears, wings, barrels and blades are thin by comparison.
  let peak = 0, low = left, high = right;
  for (let x = left; x <= right; x++) peak = Math.max(peak, columns[x]!);
  if (!mass) return null;
  for (let x = left; x <= right; x++) if (columns[x]! >= peak * 0.3) { low = x; break; }
  for (let x = right; x >= left; x--) if (columns[x]! >= peak * 0.3) { high = x; break; }
  const headW = high - low + 1, centre = (low + high + 1) / 2;
  // Never taller than the fighter: wings, barrels and tails crop at the sides
  // instead of shrinking the fighter into the top of an empty tile.
  const frameH = Math.min(Math.max(headW / 0.6 / aspect, bodyH * 0.4), bodyH * 1.1), frameW = frameH * aspect;
  return { x: centre - frameW / 2, y: top - frameH * 0.1, width: frameW, height: frameH };
}
/** Soft contact shadow + graded fighter + foot fade, kept transparent so tiles and seats supply the backdrop. */
function composePortrait(source: HTMLCanvasElement): string {
  const stage = portraitContext(true), context = portraitContext(false);
  stage.globalCompositeOperation = 'source-over';
  stage.clearRect(0, 0, PORTRAIT_W, PORTRAIT_H); stage.drawImage(source, 0, 0, PORTRAIT_W, PORTRAIT_H);
  stage.globalCompositeOperation = 'source-in'; stage.fillStyle = '#0a1024'; stage.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H);
  stage.globalCompositeOperation = 'source-over';
  context.globalCompositeOperation = 'source-over'; context.clearRect(0, 0, PORTRAIT_W, PORTRAIT_H);
  context.filter = 'blur(7px)'; context.globalAlpha = 0.6; context.drawImage(stage.canvas, 5, 7);
  context.globalAlpha = 1; context.filter = 'contrast(1.08) saturate(1.18) brightness(1.08)';
  context.drawImage(source, 0, 0, PORTRAIT_W, PORTRAIT_H);
  context.filter = 'none'; context.globalCompositeOperation = 'destination-out';
  const fade = context.createLinearGradient(0, PORTRAIT_H * 0.88, 0, PORTRAIT_H);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  context.fillStyle = fade; context.fillRect(0, PORTRAIT_H * 0.88, PORTRAIT_W, PORTRAIT_H * 0.12);
  context.globalCompositeOperation = 'source-over';
  return context.canvas.toDataURL('image/png');
}
/** Idles that turn the chest away from the screen: shot from the far side of the stage instead. */
const FAR_SIDE_PORTRAITS: ReadonlySet<string> = new Set(['Fx', 'Fe', 'Lk', 'Dk', 'Mt', 'Cl', 'Zx', 'Wf', 'Lu', 'Sm', 'Fc', 'Pc', 'Ms', 'Ys', 'Nm']);
function capturePortrait(renderer: PlayRenderer, scene: Scene, selected: GameContent, kind: FighterKind): string | null {
  const graphics = renderer.renderer;
  {
    renderer.setFighters(selected);
    // setFighters may also swap the stage (the live menu backdrop is often another stage), and
    // setStage resets the clear colour to that stage's opaque one: without this the capture
    // comes out as a tiny fighter in a solid black tile, because the alpha mask frames nothing.
    graphics.setClearColor(0x000000, 0);
    const match = new LocalMatch(selected, renderer.rigs);
    const fighter = match.fighters[0]; fighter.x = 0; fighter.y = 0; fighter.animationFrame = 8;
    // Game & Watch is a flat plane that reads edge-on from the generic side; the
    // rest are framed around their own chest direction below.
    if (kind === 'Gw') fighter.facing = -1;
    renderer.rigs.sample(fighter);
    // Near-frontal hero angle, nudged toward the side the chest opens to; the scout view is SCOUT_VIEW× wider than the final frame.
    const camera = new PerspectiveCamera(30, PORTRAIT_W / PORTRAIT_H, 0.1, 2000);
    // Flat fighters and custom sprite skins read best from the side.
    if (kind === 'Gw' || kind.startsWith('custom:')) camera.position.set(36, 6, 51);
    else camera.position.set(60, 6, FAR_SIDE_PORTRAITS.has(kind) ? -17 : 17);
    camera.lookAt(0, 10, 0); camera.updateMatrixWorld();
    camera.zoom = 1 / SCOUT_VIEW; camera.updateProjectionMatrix();
    renderer.rigs.renderSkins(match, camera, renderer.customPresentation);
    const actor = renderer.rigs.actors[0].group;
    scene.add(actor);
    try {
      graphics.render(scene, camera);
      const scout = portraitContext(false);
      scout.globalCompositeOperation = 'source-over'; scout.filter = 'none'; scout.globalAlpha = 1;
      scout.clearRect(0, 0, PORTRAIT_W, PORTRAIT_H); scout.drawImage(graphics.domElement, 0, 0, PORTRAIT_W, PORTRAIT_H);
      const frame = portraitFrame(scout.getImageData(0, 0, PORTRAIT_W, PORTRAIT_H).data, PORTRAIT_W, PORTRAIT_H);
      if (!frame) return null;
      // Same projection, sub-rectangle only: the bust re-renders at full resolution.
      camera.setViewOffset(PORTRAIT_W, PORTRAIT_H, frame.x, frame.y, frame.width, frame.height);
      camera.updateProjectionMatrix();
      renderer.rigs.renderSkins(match, camera, renderer.customPresentation);
      graphics.render(scene, camera);
      return composePortrait(graphics.domElement);
    }
    finally { renderer.scene.add(actor); }
  }
}

/** Item Switch tiles: real ItCo models framed by their own bounds (never published assets). */
export function captureItemPortraits(renderer: PlayRenderer, scene: Scene, content: GameContent): Record<string, string> {
  return withPreservedSurface(renderer.renderer, () => {
  const graphics = renderer.renderer, itemPortraits: Record<string, string> = {};
  const itemsData = content.items;
  if (itemsData) {
    graphics.setSize(160, 160, false);
    for (const name of MATCH_ITEM_NAMES) {
      const kind = COMMON_ITEM_NAMES.indexOf(name);
      const data = itemsData.kinds.get(kind);
      if (!data?.model.joint || !data.states.length) continue;
      let instance: ModelInstance | undefined;
      try {
        instance = new ModelInstance(itemsData.stateModel(kind, 0), false, true);
        instance.update(0);
        scene.add(instance.group);
        const bounds = new Box3().setFromObject(instance.group);
        const center = bounds.getCenter(new Vector3()), extent = bounds.getSize(new Vector3());
        const radius = Math.max(extent.x, extent.y, extent.z, 0.5) / 2;
        const camera = new PerspectiveCamera(34, 1, 0.1, 4000);
        const distance = radius / Math.tan((34 * Math.PI / 180) / 2) * 1.25;
        camera.position.set(center.x + distance * 0.55, center.y + distance * 0.32, center.z + distance * 0.78);
        camera.lookAt(center); camera.updateMatrixWorld();
        instance.applyBillboards(camera);
        graphics.render(scene, camera);
        itemPortraits[name] = graphics.domElement.toDataURL('image/png');
      } catch { /* A tile without a portrait falls back to its text mark. */ }
      finally { if (instance) { scene.remove(instance.group); instance.dispose(); } }
    }
  }
  return itemPortraits;
  });
}

/** One stage preview card (framed against the stage's own original fog background). */
export function captureStagePreview(renderer: PlayRenderer, scene: Scene, id: string, content: GameContent): Record<string, string> {
  return withPreservedSurface(renderer.renderer, () => {
  const graphics = renderer.renderer;
  graphics.setClearColor(stageBackground(content.stageModel, supportedStage(content.stageId).fogBackground).getHex(), 1); graphics.setSize(540, 300, false);
  renderer.setStage(content); renderer.stage.update(0);
  const camera = new PerspectiveCamera(43, 540 / 300, 0.1, 20000);
  camera.position.set(0, 65, 185); camera.lookAt(0, 10, 0); camera.updateMatrixWorld();
  scene.add(renderer.stage.group);
  try { graphics.render(scene, camera); return { [id]: graphics.domElement.toDataURL('image/jpeg', 0.88) }; }
  finally { renderer.scene.add(renderer.stage.group); }
  });
}
