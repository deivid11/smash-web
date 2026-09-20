import * as THREE from 'three';
import type { LocalMatch } from '../../../lib/game/match.ts';
import { shieldBubble } from '../../../lib/game/combat.ts';
import type { GameRigs } from './game-rig.ts';
import { PLAYER_PRESENTATIONS, playerPresentation } from '../../../lib/game/player-colors.ts';

/** Supplemental browser shield surface; gameplay radius comes from original data. */
export class DefenseVisuals {
  private geometry=new THREE.SphereGeometry(1,32,20);
  private shields:THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>[]=[];
  constructor(scene:THREE.Scene){
    for(const {color} of PLAYER_PRESENTATIONS){
      const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
        uniforms:{color:{value:new THREE.Color(color)},flash:{value:0}},
        vertexShader:`varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
        fragmentShader:`varying vec3 n;varying vec3 v;uniform vec3 color;uniform float flash;void main(){float rim=pow(1.0-abs(dot(normalize(n),normalize(v))),2.0);gl_FragColor=vec4(mix(color,vec3(1.0),flash*0.7),0.13+rim*0.7+flash*0.1);}`});
      const mesh=new THREE.Mesh(this.geometry,material);mesh.visible=false;mesh.name='Prototype shield surface';scene.add(mesh);this.shields.push(mesh);
    }
  }
  update(match:LocalMatch,rigs:GameRigs):void {
    // A rematch can shrink from eight players back to two; never retain old bubbles.
    for(const mesh of this.shields)mesh.visible=false;
    for(const f of match.fighters){const mesh=this.shields[f.slot]!,bubble=shieldBubble(f,match.content,rigs);mesh.visible=!!bubble;
      if(bubble){mesh.material.uniforms.color!.value.setHex(playerPresentation(f.seatId ?? f.slot).color);mesh.position.set(...bubble.center);mesh.scale.setScalar(bubble.radius);mesh.material.uniforms.flash!.value=f.combat.flash/8;}
    }
  }
  reset():void{for(const shield of this.shields)shield.visible=false;}
  dispose():void{for(const mesh of this.shields){mesh.removeFromParent();mesh.material.dispose();}this.geometry.dispose();}
}
