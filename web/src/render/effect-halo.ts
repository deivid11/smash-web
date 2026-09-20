import * as THREE from 'three';

/** Explicit supplemental browser accents, not original HSD particle data.
 * One bounded quad per active effect, animated by simulation time only. */
export class EffectHalo {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(readonly kind: 'shine' | 'fire') {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, flash: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float flash;
      void main(){
        vec2 p=(vUv-0.5)*2.0;
        ${kind === 'shine' ? `
          float d=max(abs(p.y),dot(abs(p),vec2(0.8660254,0.5)))-0.67;
          float edge=exp(-abs(d)*65.0);
          float halo=exp(-abs(d)*13.0);
          float shimmer=0.85+0.15*sin(atan(p.y,p.x)*3.0-time*0.18);
          float a=(edge*0.8+halo*0.24)*shimmer;
          vec3 color=mix(vec3(0.08,0.25,1.0),vec3(0.25,0.9,1.0),edge);
          color=mix(color,vec3(1.0),flash*edge);
        ` : `
          float r=length(p);
          float a=exp(-r*r*7.0)*0.28*(0.9+0.1*sin(time*0.6));
          vec3 color=mix(vec3(1.0,0.16,0.0),vec3(1.0,0.65,0.08),exp(-r*r*20.0));
        `}
        a*=1.0-smoothstep(0.82,1.0,max(abs(p.x),abs(p.y)));
        gl_FragColor=vec4(color,a);
      }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.name = `Supplemental ${kind} halo`; this.mesh.frustumCulled = false;
  }
  update(camera: THREE.Camera, x: number, y: number, z: number, radius: number, age: number, flash = 0): void {
    this.mesh.position.set(x,y,z); this.mesh.quaternion.copy(camera.quaternion); this.mesh.scale.setScalar(radius*2.8);
    this.mesh.material.uniforms.time!.value = age; this.mesh.material.uniforms.flash!.value = flash;
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
