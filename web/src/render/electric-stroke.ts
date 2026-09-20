import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial } from 'three';

/** Explicit supplemental particle approximation; not an emulated GX effect. Fixed 9 vertices. */
export class ElectricStroke {
  private points = new Float32Array(27);
  private geometry = new BufferGeometry();
  private material = new LineBasicMaterial({ color: 0xffee68, transparent: true, opacity: 0.95, depthWrite: false });
  readonly mesh: Line;
  constructor() { this.geometry.setAttribute('position', new BufferAttribute(this.points, 3)); this.mesh = new Line(this.geometry, this.material); this.mesh.frustumCulled = false; }
  update(x: number, y: number, dx: number, dy: number, frame: number, amplitude = 1): void {
    const length = Math.max(0.001, Math.hypot(dx, dy));
    for (let i = 0; i < 9; i++) {
      const t = i / 8, wiggle = i === 0 || i === 8 ? 0 : Math.sin(i * 7.1 + Math.floor(frame / 2) * 2.4) * amplitude;
      this.points[i * 3] = x + dx * t - dy / length * wiggle;
      this.points[i * 3 + 1] = y + dy * t + dx / length * wiggle;
      this.points[i * 3 + 2] = 1;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
  }
  dispose(): void { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
