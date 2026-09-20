import * as THREE from 'three';
import { ParticlePlayer, type ParticlePoint } from '../../../lib/hsd/particle-player.ts';
import type { ParticleBank } from '../../../lib/hsd/particle-bank.ts';
import type { DecodedTexture } from '../../../lib/hsd/texture.ts';

/** The KO model's native dptcl burst, in the effect root's coordinate system.
 * Uses original particle scripts/textures and their additive flags. The existing
 * bounded particle VM/quad display is a subset, not full HSD particle equivalence. */
export class KoParticles {
  readonly group = new THREE.Group();
  readonly player: ParticlePlayer;
  private geometry = new THREE.PlaneGeometry(2, 2);
  private sprites = new Map<number, THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>();
  private textures = new Map<DecodedTexture, THREE.DataTexture>();
  private rootRotation = new THREE.Quaternion();
  private inverseRotation = new THREE.Quaternion();
  private billboard = new THREE.Quaternion();
  private velocity = new THREE.Vector3();
  private cameraInverse = new THREE.Quaternion();
  constructor(private readonly bank: ParticleBank) {
    this.player = new ParticlePlayer(bank, 64); // At most 8 KO roots / 512 sprites globally.
    this.group.name = 'native-ko-particles';
  }
  get count(): number { return this.sprites.size; }
  spawn(generator: number, origin: ParticlePoint): void { this.player.spawn(generator, origin); }
  step(): void { this.player.step(); }
  render(camera: THREE.Camera): void {
    const live = new Set(this.player.particles.filter(p => p.frame >= 0).map(p => p.id));
    for (const [id, mesh] of this.sprites) if (!live.has(id)) { mesh.removeFromParent(); mesh.material.dispose(); this.sprites.delete(id); }
    this.group.getWorldQuaternion(this.rootRotation); this.inverseRotation.copy(this.rootRotation).invert();
    camera.getWorldQuaternion(this.billboard); this.cameraInverse.copy(this.billboard).invert();
    this.billboard.premultiply(this.inverseRotation);
    for (const p of this.player.particles) {
      if (p.frame < 0) continue;
      try {
        const decoded = this.bank.texture(p.definition.texture, p.frame, p.palette);
        let texture = this.textures.get(decoded);
        if (!texture) {
          texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
          texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
          this.textures.set(decoded, texture);
        }
        let mesh = this.sprites.get(p.id);
        if (!mesh) {
          const material = new THREE.ShaderMaterial({
            uniforms: {image:{value:texture}, prim:{value:new THREE.Vector4()}, env:{value:new THREE.Vector4()}, useEnv:{value:0}},
            vertexShader: 'varying vec2 texcoord; void main(){texcoord=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
            fragmentShader: 'uniform sampler2D image; uniform vec4 prim,env; uniform float useEnv; varying vec2 texcoord; void main(){vec4 t=texture2D(image,texcoord);vec3 c=mix(t.rgb*prim.rgb,mix(env.rgb,prim.rgb,t.rgb),useEnv);float a=t.a*prim.a;if(a<=0.0)discard;gl_FragColor=vec4(c,a);}',
            transparent:true, depthWrite:false, side:THREE.DoubleSide,
          });
          mesh = new THREE.Mesh(this.geometry, material); mesh.frustumCulled = false;
          mesh.name = `Native KO particle ${p.definition.id}`;
          this.group.add(mesh); this.sprites.set(p.id, mesh);
        }
        mesh.position.set(...this.player.worldPosition(p)); mesh.quaternion.copy(this.billboard);
        // Project the native local velocity through the KO root orientation before
        // orienting a directional sprite. Side/top KOs must not all emit upward.
        this.velocity.set(...p.velocity).applyQuaternion(this.rootRotation).applyQuaternion(this.cameraInverse);
        mesh.rotateZ(p.rotation + (p.kind & 0x300000 ? Math.atan2(this.velocity.y, this.velocity.x) - Math.PI / 2 : 0));
        const stretch = p.trail === undefined ? 1 : Math.max(1, this.velocity.length() * p.trail / Math.max(.01, p.size));
        mesh.scale.set((p.kind & 0x40000 ? -1 : 1) * p.size * p.scale, (p.kind & 0x80000 ? -1 : 1) * p.size * p.scale * stretch, 1);
        mesh.material.uniforms.image!.value = texture;
        (mesh.material.uniforms.prim!.value as THREE.Vector4).set(...p.color.map(v => v / 255) as [number,number,number,number]);
        (mesh.material.uniforms.env!.value as THREE.Vector4).set(...p.environment.map(v => v / 255) as [number,number,number,number]);
        mesh.material.uniforms.useEnv!.value = p.kind & 128 ? 1 : 0;
        mesh.material.depthTest = !(p.kind & 0x10000000);
        mesh.material.blending = p.kind & 0x400000 ? THREE.AdditiveBlending : THREE.NormalBlending;
      } catch (error) { this.player.unsupported.add(`KO particle ${p.definition.id}: ${String(error)}`); }
    }
  }
  dispose(): void {
    this.player.clear(); for (const mesh of this.sprites.values()) mesh.material.dispose(); this.sprites.clear();
    for (const texture of this.textures.values()) texture.dispose(); this.textures.clear();
    this.geometry.dispose(); this.group.removeFromParent(); this.group.clear();
  }
}
