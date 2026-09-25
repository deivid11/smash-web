import * as THREE from 'three';
import { LUPE, magnifyPlacement } from './magnify.ts';

/** One fighter whose camera bone left the screen this frame. */
export interface MagnifyEntry {
  slot: number;
  /** The fighter's visible model; rendered alone into the lupe (ftDrawCommon_80080C28). */
  object: THREE.Object3D;
  /** Camera bone world position (the ortho view's interest). */
  bone: THREE.Vector3;
  /** Its projection on the canvas, in CSS pixels. */
  screen: { x: number; y: number };
  /** ifMagnify_802FBBDC ortho half extent (world units). */
  halfExtent: number;
  /** HSD_SetEraseColor for this fighter (0xRRGGBBAA). */
  background: number;
  /** Ring/arrow diffuse (0xRRGGBB). */
  color: number;
}
interface Lens { target: THREE.WebGLRenderTarget; group: THREE.Group; ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>; arrow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> }

/**
 * The original off-screen magnifier (ifMagnify): each off-screen fighter is drawn by itself
 * through an orthographic camera into a small render target, which then sits inside the
 * IfAll "lupe" ring at the screen edge with the arrow pointing at the fighter. Drawn after
 * the composed frame, so post effects never touch it. Presentation only.
 *
 * The lupe is rebuilt from its probed IfAll.dat geometry (IfAll.dat is not a served asset);
 * the texture renders at the display's pixel size instead of the original 64×64.
 */
export class Magnifier {
  private readonly overlay = new THREE.Scene();
  private readonly overlayCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  private readonly lens = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 32768);
  private readonly lenses = new Map<number, Lens>();
  private readonly clear = new THREE.Color();
  private readonly savedClear = new THREE.Color();
  /** Slots drawn on the last frame, for diagnostics and tests. */
  shown: readonly number[] = [];

  private lensFor(slot: number, size: number): Lens {
    let lens = this.lenses.get(slot);
    if (lens && lens.target.width !== size) { lens.target.setSize(size, size); }
    if (lens) return lens;
    const target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, stencilBuffer: false });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const flat = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(LUPE.ringInner, LUPE.ringOuter, 48), flat(0xffffff));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(LUPE.ringInner, 48), new THREE.MeshBasicMaterial({ map: target.texture, depthTest: false, depthWrite: false, toneMapped: false }));
    const arrowGeometry = new THREE.BufferGeometry();
    arrowGeometry.setAttribute('position', new THREE.Float32BufferAttribute([LUPE.arrowTip, 0, 0, LUPE.arrowBase, LUPE.arrowHalfWidth, 0, LUPE.arrowBase, -LUPE.arrowHalfWidth, 0], 3));
    const arrow = new THREE.Mesh(arrowGeometry, flat(0xffffff));
    ring.renderOrder = 1; disc.renderOrder = 2; arrow.renderOrder = 3;
    const group = new THREE.Group();
    group.add(ring, disc, arrow);
    this.overlay.add(group);
    lens = { target, group, ring, disc, arrow };
    this.lenses.set(slot, lens);
    return lens;
  }

  /** Draw every entry on top of the finished frame (call after the composite). */
  render(renderer: THREE.WebGLRenderer, entries: readonly MagnifyEntry[], width: number, height: number, insets?: { top: number; bottom: number }): void {
    for (const lens of this.lenses.values()) lens.group.visible = false;
    this.shown = entries.map((entry) => entry.slot);
    if (!entries.length || width <= 0 || height <= 0) return;
    const previousTarget = renderer.getRenderTarget(), previousAlpha = renderer.getClearAlpha(), previousAutoClear = renderer.autoClear;
    renderer.getClearColor(this.savedClear);
    try {
      const pixelRatio = renderer.getPixelRatio();
      for (const entry of entries) {
        const placement = magnifyPlacement(entry.screen.x, entry.screen.y, width, height, insets);
        // Render at the lupe's on-screen size (power of two, 64 minimum like the original).
        const size = Math.min(512, Math.max(LUPE.texels, 2 ** Math.ceil(Math.log2(2 * LUPE.ringInner * placement.unit * pixelRatio))));
        const lens = this.lensFor(entry.slot, size);
        const half = entry.halfExtent;
        this.lens.left = -half; this.lens.right = half; this.lens.top = half; this.lens.bottom = -half;
        this.lens.position.set(entry.bone.x, entry.bone.y, entry.bone.z + 300);
        this.lens.lookAt(entry.bone);
        this.lens.updateProjectionMatrix(); this.lens.updateMatrixWorld();
        const rgba = entry.background >>> 0;
        this.clear.setRGB(((rgba >>> 24) & 255) / 255, ((rgba >>> 16) & 255) / 255, ((rgba >>> 8) & 255) / 255, THREE.SRGBColorSpace);
        renderer.setRenderTarget(lens.target);
        renderer.setClearColor(this.clear, 1);
        renderer.clear(true, true, false);
        renderer.render(entry.object, this.lens);
        lens.ring.material.color.setHex(entry.color); lens.arrow.material.color.setHex(entry.color);
        lens.group.position.set(placement.x, height - placement.y, 0);
        lens.group.scale.setScalar(placement.unit);
        lens.arrow.rotation.z = placement.rotation;
        lens.group.visible = true;
      }
      this.overlayCamera.left = 0; this.overlayCamera.right = width; this.overlayCamera.top = height; this.overlayCamera.bottom = 0;
      this.overlayCamera.updateProjectionMatrix();
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.render(this.overlay, this.overlayCamera);
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(this.savedClear, previousAlpha);
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose(): void {
    for (const lens of this.lenses.values()) {
      lens.target.dispose(); lens.ring.geometry.dispose(); lens.ring.material.dispose();
      lens.disc.geometry.dispose(); lens.disc.material.dispose(); lens.arrow.geometry.dispose(); lens.arrow.material.dispose();
    }
    this.lenses.clear();
  }
}
