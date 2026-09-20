import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ModelInstance } from './model-instance.ts';

export class AssetViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20_000);
  readonly controls: OrbitControls;
  instances: ModelInstance[] = [];
  frame = 0;
  playing = true;
  onFrame: ((frame: number) => void) | undefined;
  onError: ((error: unknown) => void) | undefined;
  private previous = 0;
  private observer: ResizeObserver;
  private failed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x101724, 1);
    this.renderer.domElement.id = 'scene-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Original Melee stage and character assets rendered in WebGL');
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 4000;
    this.controls.minDistance = 3;
    this.setCamera('stage');
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.renderer.setAnimationLoop((time) => {
      if (this.failed) return;
      try {
        if (this.playing && this.previous !== 0) this.frame += Math.min(0.1, Math.max(0, (time - this.previous) / 1000)) * 60;
        this.previous = time;
        this.draw(); this.onFrame?.(this.frame);
      } catch (error) {
        this.failed = true; this.playing = false;
        this.onError?.(error);
      }
    });
  }
  private resize(): void {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  setCamera(kind: 'stage' | 'closeup' | 'trophy'): void {
    if (kind === 'stage') { this.camera.position.set(0, 63, 230); this.controls.target.set(0, 12, 0); }
    else if (kind === 'closeup') { this.camera.position.set(23, 13, 35); this.controls.target.set(0, 8, 0); }
    else { this.camera.position.set(19, 12, 29); this.controls.target.set(0, 6, 0); }
    this.controls.update();
  }
  replace(instances: ModelInstance[]): void {
    for (const old of this.instances) old.dispose();
    this.instances = instances;
    for (const instance of instances) this.scene.add(instance.group);
    this.frame = 0; this.failed = false;
    this.draw();
  }
  draw(): void {
    for (const instance of this.instances) instance.update(this.frame);
    this.controls.update(); this.renderer.render(this.scene, this.camera);
  }
  seek(frame: number): void {
    this.frame = Math.max(0, frame); this.previous = 0; this.draw();
  }
  async screenshot(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.draw();
    const source = this.renderer.domElement;
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot create screenshot canvas.');
    ctx.drawImage(source, 0, 0);
    ctx.fillStyle = '#081119d9'; ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
    ctx.fillStyle = '#b8f8d8'; ctx.font = '14px sans-serif';
    ctx.fillText('Smash Web · Original-asset viewer · No gameplay simulation', 18, canvas.height - 15);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const abort = () => reject(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        // Encoding itself is not cancellable; discard its result after teardown.
        canvas.toBlob((blob) => {
          signal?.removeEventListener('abort', abort);
          if (signal?.aborted) reject(signal.reason);
          else if (blob) resolve(blob);
          else reject(new Error('Screenshot encoding failed.'));
        }, 'image/png');
      } catch (error) { signal?.removeEventListener('abort', abort); reject(error); }
    });
    signal?.throwIfAborted();
    const url = URL.createObjectURL(blob);
    const release = () => { clearTimeout(timer); URL.revokeObjectURL(url); signal?.removeEventListener('abort', release); };
    const timer = setTimeout(release, 10_000);
    signal?.addEventListener('abort', release, { once: true });
    const link = document.createElement('a'); link.href = url; link.download = 'smash-web-original-assets.png'; link.click();
  }
  dispose(): void {
    this.renderer.setAnimationLoop(null); this.observer.disconnect(); this.controls.dispose();
    for (const instance of this.instances) instance.dispose();
    this.instances = []; this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
