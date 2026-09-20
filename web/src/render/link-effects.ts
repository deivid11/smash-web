import * as THREE from 'three';
import type { LocalMatch, MatchFighter } from '../../../lib/game/match.ts';
import type { HsdModel } from '../../../lib/hsd/model.ts';
import { command } from '../../../lib/game/specials.ts';
import { ModelInstance } from './model-instance.ts';
import type { GameRigs } from './game-rig.ts';
interface Prop { source:HsdModel; model:ModelInstance }
/** Native Link articles and chain meshes. Presentation reads, never advances, authoritative state. */
export class LinkEffects {
  private props=new Map<string,Prop>();private matrix=new THREE.Matrix4();private direction=new THREE.Vector3();private forward=new THREE.Vector3(0,0,1);private target=new THREE.Vector3();private root=new THREE.Vector3();
  readonly stats={models:0,bows:0,arrows:0,hookLinks:0};
  constructor(private scene:THREE.Scene,private rigs:GameRigs,private camera:THREE.Camera){}
  private prop(key:string,source:HsdModel,active:Set<string>):ModelInstance {
    active.add(key);let prop=this.props.get(key);
    if(prop?.source!==source){prop?.model.dispose();prop={source,model:new ModelInstance(source,false,true)};this.scene.add(prop.model.group);this.props.set(key,prop);}
    return prop.model;
  }
  private attach(model:ModelInstance,f:MatchFighter,bone:number,frame:number,scale=1,attachmentBone=0):void {
    model.group.matrixAutoUpdate=false;model.group.matrix.copy(this.rigs.actors[f.slot]!.jointWorldMatrix(bone,this.matrix));
    model.group.matrix.scale(new THREE.Vector3(scale,scale,scale));model.group.matrixWorldNeedsUpdate=true;
    this.target.setFromMatrixPosition(model.group.matrix);
    model.group.visible=this.rigs.actors[f.slot]!.group.visible;model.update(frame);
    // it_80274F48 constrains the article's ModelDesc attachment joint to the hand;
    // the bow/arrow use joint1, not the model root. Keep the animated local offsets.
    model.jointWorldMatrix(attachmentBone,this.matrix);this.root.setFromMatrixPosition(this.matrix);
    model.group.matrix.elements[12]!+=this.target.x-this.root.x;model.group.matrix.elements[13]!+=this.target.y-this.root.y;model.group.matrix.elements[14]!+=this.target.z-this.root.z;
    model.group.matrixWorldNeedsUpdate=true;model.group.updateMatrixWorld(true);model.applyBillboards(this.camera);
  }
  update(match:LocalMatch):void {
    const active=new Set<string>();this.stats.bows=0;this.stats.arrows=0;this.stats.hookLinks=0;
    for(const f of match.fighters){
      const articles=f.content.specials.articles.link;if(!articles)continue;
      const s=f.special;
      if(s?.direction==='neutral'&&s.link){
        const index=(f.grounded?0:3)+(s.phase==='loop'?1:s.phase==='end'?2:0),data=articles.bows[index]!;
        const bow=this.prop(`bow:${f.slot}`,data.model,active);bow.animationLoop=s.phase==='loop';
        this.attach(bow,f,f.content.profile.boneMap[49]!,f.animationFrame,data.scale,data.attachmentBone??0);this.stats.bows++;
        if(!s.link.shot&&(command(f,0)!==0||s.link.chargeEnabled||s.phase==='loop')){
          const data=f.content.specials.articles.projectile!,arrow=this.prop(`drawn-arrow:${f.slot}`,data.model,active);
          arrow.animationLoop=false;this.attach(arrow,f,f.content.profile.boneMap[31]!,0,data.scale,data.attachmentBone??0);this.stats.arrows++;
        }
      }
      const h=f.link.hook,data=f.content.hookshot;
      if(h&&data){
        this.attach(this.prop(`hook-launcher:${f.slot}`,data.launcher,active),f,f.content.profile.boneMap[49]!,0,1,data.launcherBone);
        if(h.active)for(let i=0;i<h.points.length;i++){
          const point=h.points[i]!,next=h.points[Math.max(0,i-1)]!,model=this.prop(`hook:${f.slot}:${i}`,i===0?data.tip:data.segmentsModels[i%2]!,active);
          model.group.matrixAutoUpdate=true;model.group.position.set(...point);model.group.scale.setScalar(f.content.profile.attributes.modelScale);
          this.direction.set(next[0]-point[0],next[1]-point[1],next[2]-point[2]);
          if(this.direction.lengthSq()<1e-8)this.direction.set(f.facing,0,0);else this.direction.normalize();
          model.group.quaternion.setFromUnitVectors(this.forward,this.direction);model.update(0);model.applyBillboards(this.camera);this.stats.hookLinks++;
        }
      }
    }
    // Supplemental translucent trails use the native boomerang mesh, never fire particles.
    for(const p of match.projectiles.items)if(p.kind==='boomerang'&&p.link?.phase!=='caught'&&p.age>2){
      for(let i=1;i<=2;i++){
        const model=this.prop(`boomerang-trail:${p.id}:${i}`,p.data.model,active);model.opacityMultiplier=.16/i;
        model.group.position.set(p.x-p.vx*i*2,p.y-p.vy*i*2,0);model.group.rotation.y=p.vx>=0?Math.PI/2:-Math.PI/2;model.group.scale.setScalar(p.data.scale);
        model.update(Math.max(0,p.age-i*2));model.applyBillboards(this.camera);
      }
    }
    for(const [key,prop] of this.props)if(!active.has(key)){prop.model.dispose();this.props.delete(key);}
    this.stats.models=this.props.size;
  }
  reset():void {for(const prop of this.props.values())prop.model.dispose();this.props.clear();this.stats.models=this.stats.bows=this.stats.arrows=this.stats.hookLinks=0;}
  dispose():void {this.reset();}
}
