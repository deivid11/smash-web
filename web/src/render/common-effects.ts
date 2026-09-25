import * as THREE from 'three';
import type { CommonEffectsData, BurnSequence, EffectModel } from '../../../lib/game/common-effects.ts';
import { COMMON_MODEL_EFFECTS, COMMON_PARTICLE_EFFECTS, HIT_EFFECT_IDS } from '../../../lib/game/common-effects.ts';
import type { LocalMatch, MatchEvent } from '../../../lib/game/match.ts';
import { ParticlePlayer } from '../../../lib/hsd/particle-player.ts';
import type { ParticleBank } from '../../../lib/hsd/particle-bank.ts';
import type { DecodedTexture } from '../../../lib/hsd/texture.ts';
import { ModelInstance } from './model-instance.ts';
import type { GameRigs } from './game-rig.ts';
interface Burst { instance:ModelInstance; data:EffectModel; age:number; cue:number; scale:number; owner:number; facing:number|undefined; /** m-ex behavior-6 effects ride the owner's joint. */ follow?:{bone:number;offset:readonly [number,number,number]} }
interface Burn { sequence:BurnSequence; age:number; cursor:number; bone:number; blend?:{from:[number,number,number,number];to:[number,number,number,number];frames:number;age:number} }
/** Shared native hit/ground effects. Cosmetic playback only; receives the same
 * confirmed events as audio and never writes fighter state or gameplay RNG. */
export class CommonEffects {
  private player:ParticlePlayer|undefined;
  private bursts:Burst[]=[];private burns=new Map<number,Burn>();private seed=0x76543210;
  private sprites=new Map<string,THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>>();
  private textures=new Map<DecodedTexture,THREE.DataTexture>();
  private spriteMaterials:THREE.ShaderMaterial[]=[];
  private geometry=new THREE.PlaneGeometry(2,2);
  private matrix=new THREE.Matrix4();private position=new THREE.Vector3();
  private projectedA=new THREE.Vector3();private projectedB=new THREE.Vector3();private forward=new THREE.Vector3();
  readonly stats={particles:0,models:0,burning:0,spawnedDust:0,spawnedHits:0,unsupported:0,pooledMaterials:0,spriteMaterialsCreated:0,skippedParticles:0};
  /** Graphics preset budget for live sprites; particles beyond it stay simulated but undrawn. */
  particleLimit:number|null=null;
  /** One extra player per fighter effect bank that asks for its own generators (Bowser's flame
   * lives in EfKpData, not the common bank). Keyed so sprite ids from different players never
   * collide. */
  private extra=new Map<string,{player:ParticlePlayer;bank:ParticleBank}>();
  constructor(private scene:THREE.Scene,private data:CommonEffectsData|undefined,private rigs:GameRigs,private camera:THREE.Camera){
    if(data)this.player=new ParticlePlayer(data.particles);
    // Without the common bank (EfCoData/PlCo missing or unparsed) every hit spark, flash
    // and dust silently disappears while the match still plays; say so once instead.
    else console.warn('CommonEffects: no common effect bank loaded — hit sparks, flashes and dust are disabled for this match (check EfCoData.dat/PlCo.dat in the disc source).');
  }
  /** efLib_CreateGenerator against a fighter's own bank. `origin` may be a callback so the
   * particles ride a moving article, as the original's attached generators do. */
  spawnFrom(bank:ParticleBank,key:string,generator:number,origin:Parameters<ParticlePlayer['spawn']>[1],facing?:number,scale=1,attached=false):void {
    let entry=this.extra.get(key);
    if(!entry){entry={player:new ParticlePlayer(bank),bank};this.extra.set(key,entry);}
    try{entry.player.spawn(generator,origin,facing,scale,0,attached);}catch(error){entry.player.unsupported.add(String(error));}
  }
  get warnings():readonly string[]{return [...(this.player?.unsupported??[]),...[...this.extra.values()].flatMap(e=>[...e.player.unsupported])];}
  events(events:readonly MatchEvent[],match:LocalMatch):void {
    if(!this.data||!this.player)return;
    for(const e of events){
      const f=match.fighters[e.player];if(!f)continue;
      if(e.type==='ko'||e.type==='respawn'){this.burns.delete(e.player);this.rigs.actors[e.player]?.damageOverlay.set(0,0,0,0);continue;}
      if(e.type==='gfx'&&e.effect!==undefined){
        // m-ex fighter effects: 6000+n is generator n of the spawning fighter's own bank.
        const bank=e.effect>=6000&&e.effect<7000?f.content.specials.particles:undefined;
        // ...and 5000+n its effect-file model n. Entries whose table life is below one frame are
        // code-managed attachments (the spin ball), so only timed ones spawn from a script.
        const mex=e.effect>=5000&&e.effect<6000?f.content.specials.mexEffects?.get(e.effect-5000):undefined;
        if(bank)this.spawnFrom(bank,`fx:${e.player}`,bank.first+e.effect-6000,[e.x,e.y,1],e.facing??f.facing,f.content.profile.attributes.modelScale);
        else if(mex){if(mex.life>=1)this.fighterModel(mex,e.x,e.y,e.facing??f.facing,f.content.profile.attributes.modelScale,e.player,mex.follow&&e.bone!==undefined?{bone:e.bone,offset:e.offset??[0,0,0]}:undefined);}
        else this.effect(e.effect,e.x,e.y,e.facing??f.facing,1,e.floorAngle??0,e.player);
        continue;
      }
      if(e.type!=='hit')continue;
      const element=e.element??0,damage=e.damage??0,knockback=e.knockback??0,id=HIT_EFFECT_IDS[element];
      if(e.projectileKind==='laser'){this.effect(1011,e.x,e.y,e.facing??1,1,0,-1);this.stats.spawnedHits++;}
      else if(id===1000){
        // ftColl_80078538: the damage-scaled spark (1000) below the x3F0 knockback, the 1011 flash
        // at or above it; severity>=1 hits on a hit_spark_variant-0 victim add the 1007 sparkle
        // generator (victim facing, negated) with HSD_Randi(x3F4)==0 odds. Cosmetic seed only.
        if(knockback<this.data.sparkFlashKnockback)this.effect(1000,e.x,e.y,e.facing??1,Math.max(.3,Math.min(1.5,.04*damage+.3)),0,-1);
        else this.effect(1011,e.x,e.y,e.facing??1,1,0,-1);
        if((e.severity??0)>=1&&(f.content.profile.hitSparkVariant??0)===0&&Math.floor(this.random()*this.data.sparkExtraOdds)===0)this.effect(1007,e.x,e.y,-f.facing,1,0,-1);
        this.stats.spawnedHits++;
      }
      else if(id!==null&&id!==undefined){this.effect(id,e.x,e.y,e.facing??1,1,0,-1);this.stats.spawnedHits++;}
      if(damage>0){
        // ftCo_8008DA4C: fire/electric/ice/dark pick a script by knockback level; everything else
        // plays common script 4, the victim's white hit flash.
        const kb=knockback*this.data.knockbackScale,level=this.data.burnThresholds.filter(threshold=>kb>=threshold).length,colors=this.data.hitColors;
        const sequence=element===1?this.data.burns[level]!:element===2?colors.electric[level]!:element===5?colors.ice[level]!:element===13?colors.dark[level]!:colors.normal;
        this.burns.set(e.player,{sequence,age:0,cursor:0,bone:0});
      }
    }
  }
  /** A fighter-file model effect: played once at the event point, facing the fighter, for its life. */
  private fighterModel(entry:{model:import('../../../lib/hsd/model.ts').HsdModel;life:number},x:number,y:number,facing:number,scale:number,owner:number,follow?:Burst['follow']):void {
    if(this.bursts.length>=48)this.bursts.shift()!.instance.dispose();
    // Cosmetic only: an effect that fails to build must never stop the match.
    let instance:ModelInstance;
    try{instance=new ModelInstance(entry.model,false,true);instance.update(0);}catch(error){this.player?.unsupported.add(String(error));return;}
    instance.animationLoop=false;
    instance.group.position.set(x,y,1);instance.group.rotation.set(0,facing>=0?Math.PI/2:-Math.PI/2,0);instance.group.scale.setScalar(scale);
    this.scene.add(instance.group);this.bursts.push({instance,data:{model:entry.model,life:Math.min(240,entry.life),particles:[]},age:0,cue:0,scale,owner,facing,...(follow?{follow}:{})});
  }
  private random():number{this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  private effect(id:number,x:number,y:number,facing:number,scale:number,angle:number,owner:number):void {
    if(!this.data||!this.player)return;
    const model=id===1000?(this.random()<1/8?9:10):COMMON_MODEL_EFFECTS.get(id);
    if(model!==undefined){
      const data=this.data.models.get(model);if(!data)return;
      if(this.bursts.length>=48)this.bursts.shift()!.instance.dispose();
      const instance=new ModelInstance(data.model,false,true);instance.animationLoop=false;
      instance.group.position.set(x,y,1);instance.group.rotation.set(0,[3,5,16,18,19,20].includes(model)?facing*Math.PI/2:0,id===1004?this.random()*Math.PI*2:angle);
      // Only the normal hit routine scales by damage. Dust retains its native model scale.
      const nativeScale=id===1000?scale:1;instance.group.scale.setScalar(nativeScale);
      this.scene.add(instance.group);this.bursts.push({instance,data,age:0,cue:0,scale:nativeScale,owner,facing:[3,5,16,18,19,20].includes(model)?facing:undefined});
    }else {const generator=COMMON_PARTICLE_EFFECTS.get(id)??(id<0x250?id:undefined);if(generator!==undefined)this.player.spawn(generator,[x,y,1],id===1022||id===1007?facing:undefined,id===1000?scale:1);}
    if([1012,1013,1014,1015,1016,1017,1018,1021,1022,1023,1028,1030,1031,1042,1043,1044,1059,1060,1094,1290].includes(id))this.stats.spawnedDust++;
  }
  private releaseSprite(mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>):void {
    mesh.removeFromParent();mesh.material.uniforms.image!.value=null;
    if(this.spriteMaterials.length<(this.player?.capacity??192))this.spriteMaterials.push(mesh.material);else mesh.material.dispose();
  }
  update(match:LocalMatch,elapsed:number):void {
    if(!this.player||!this.data)return;
    for(const [slot,burn]of this.burns){
      if(elapsed===0)continue;
      const f=match.fighters[slot],actor=this.rigs.actors[slot];
      if(!f||!actor||f.state==='ko'||f.state==='respawn'||burn.age>=burn.sequence.life){actor?.damageOverlay.set(0,0,0,0);this.burns.delete(slot);continue;}
      while(burn.cursor<burn.sequence.events.length&&burn.sequence.events[burn.cursor]!.frame<=burn.age){
        const event=burn.sequence.events[burn.cursor++]!;
        if(event.type==='color'){delete burn.blend;actor.damageOverlay.set(...event.rgba.map(v=>v/255) as [number,number,number,number]);}
        else if(event.type==='blend')burn.blend={from:actor.damageOverlay.toArray() as [number,number,number,number],to:event.rgba.map(v=>v/255) as [number,number,number,number],frames:event.frames,age:0};
        else {
          // Part 0x8D (and any part outside the map) cycles the five effect attachment parts.
          const bones=f.content.effectBones??[],mapped=event.bone===undefined||event.bone===0x8d?undefined:f.content.profile.partJoints[event.bone];
          const bone=mapped!==undefined&&mapped>=0?mapped:bones[burn.bone++%Math.max(1,bones.length)]??f.content.profile.boneMap[4]!;
          this.player.spawn(event.generator,()=>{const p=this.rigs.point(f,bone,[0,0,0]);return [p[0],p[1],p[2]];},f.facing,f.content.profile.attributes.modelScale);
        }
      }
      if(f.hitlag===0){
        burn.age+=elapsed;
        const blend=burn.blend;
        if(blend){blend.age+=elapsed;const t=Math.min(1,blend.age/blend.frames);actor.damageOverlay.set(...blend.from.map((v,i)=>v+(blend.to[i]!-v)*t) as [number,number,number,number]);if(t>=1)delete burn.blend;}
      }
    }
    for(const burst of [...this.bursts]){
      const rider=burst.follow?match.fighters[burst.owner]:undefined;
      if(burst.follow&&rider){const p=this.rigs.point(rider,burst.follow.bone,burst.follow.offset as [number,number,number]);burst.instance.group.position.set(p[0],p[1],1);burst.instance.group.rotation.y=rider.facing>=0?Math.PI/2:-Math.PI/2;}
      if(elapsed===0){burst.instance.applyBillboards(this.camera);continue;}
      burst.instance.update(burst.age);burst.instance.applyBillboards(this.camera);
      while(burst.cue<burst.data.particles.length&&burst.data.particles[burst.cue]!.frame<=burst.age){
        const cue=burst.data.particles[burst.cue++]!;
        burst.instance.jointWorldMatrix(cue.bone,this.matrix);this.position.setFromMatrixPosition(this.matrix);
        this.player.spawn(cue.generator,[this.position.x,this.position.y,this.position.z],burst.facing,burst.scale);
      }
      if(burst.owner<0||(match.fighters[burst.owner]?.hitlag??0)===0)burst.age+=elapsed;
      if(burst.age>=burst.data.life){burst.instance.dispose();this.bursts.splice(this.bursts.indexOf(burst),1);}
    }
    for(let i=0;i<elapsed;i++){this.player.step();for(const entry of this.extra.values())entry.player.step();}
    const sources:Array<{prefix:string;player:ParticlePlayer;bank:ParticleBank}>=[{prefix:'',player:this.player,bank:this.data.particles},
      ...[...this.extra].map(([prefix,entry])=>({prefix:`${prefix}:`,player:entry.player,bank:entry.bank}))];
    const live=new Set(sources.flatMap(source=>source.player.particles.map(p=>`${source.prefix}${p.id}`)));
    for(const [id,mesh]of this.sprites)if(!live.has(id)){this.releaseSprite(mesh);this.sprites.delete(id);}
    for(const source of sources)for(const p of source.player.particles){
      if(p.frame<0)continue;
      let texture:THREE.DataTexture;
      try{
        const decoded=source.bank.texture(p.definition.texture,p.frame,p.palette);let cached=this.textures.get(decoded);
        if(!cached){cached=new THREE.DataTexture(decoded.pixels,decoded.width,decoded.height,THREE.RGBAFormat);cached.minFilter=THREE.LinearFilter;cached.magFilter=THREE.LinearFilter;cached.needsUpdate=true;this.textures.set(decoded,cached);}texture=cached;
      }catch(error){source.player.unsupported.add(String(error));continue;}
      const spriteKey=`${source.prefix}${p.id}`;
      let mesh=this.sprites.get(spriteKey);
      if(!mesh){
        if(this.particleLimit!==null&&this.sprites.size>=this.particleLimit){this.stats.skippedParticles++;continue;}
        let material=this.spriteMaterials.pop();
        if(!material){this.stats.spriteMaterialsCreated++;material=new THREE.ShaderMaterial({uniforms:{image:{value:texture},prim:{value:new THREE.Vector4()},env:{value:new THREE.Vector4()},useEnv:{value:0}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D image;uniform vec4 prim,env;uniform float useEnv;varying vec2 uv0;void main(){vec4 t=texture2D(image,uv0);vec3 c=mix(t.rgb*prim.rgb,mix(env.rgb,prim.rgb,t.rgb),useEnv);float a=t.a*prim.a;if(a<0.005)discard;gl_FragColor=vec4(c,a);}',transparent:true,depthWrite:false,side:THREE.DoubleSide});}
        // Keep a fresh Object3D ID so equal-depth transparent ordering is unchanged.
        mesh=new THREE.Mesh(this.geometry,material);mesh.name=`Native particle ${p.definition.id}`;mesh.frustumCulled=false;this.scene.add(mesh);this.sprites.set(spriteKey,mesh);
      }
      const pos=source.player.worldPosition(p);
      // psDispSub: the square's half-extent is `size`; its rotation axis points away from the
      // viewer, so the original's angle is our negative roll. Trail/DirVec sprites turn to the
      // velocity's SCREEN direction (previous position -> current, projected), plus the script
      // rotation for DirVec.
      let angle=-p.rotation,half=p.size*p.scale,cx=pos[0],cy=pos[1],cz=pos[2];
      if(p.kind&0x300000){
        const [wx,wy,wz]=source.player.worldVelocity(p);
        const a=this.projectedA.set(cx,cy,cz).project(this.camera),b=this.projectedB.set(cx-wx,cy-wy,cz-wz).project(this.camera);
        const aspect=this.camera instanceof THREE.PerspectiveCamera?this.camera.aspect:1,dx=(a.x-b.x)*aspect,dy=a.y-b.y;
        const direction=Math.abs(dx)<1e-9&&Math.abs(dy)<1e-9?0:Math.atan2(dx,dy);
        angle=-(direction+(p.kind&0x200000?p.rotation:0));
        if(p.kind&0x100000){
          // psDispSubMakePolygon Trail quad: the near edge sits at the current position and the
          // far edge at the previous one, each keeping the sprite's own half-size overhang. The
          // view-axis component is dropped so the stretched sprite stays camera-facing.
          const f=this.forward;this.camera.getWorldDirection(f);
          const along=wx*f.x+wy*f.y+wz*f.z,tx=wx-f.x*along,ty=wy-f.y*along,tz=wz-f.z*along,length=Math.hypot(tx,ty,tz);
          half+=length/2;cx-=tx/2;cy-=ty/2;cz-=tz/2;
        }
      }
      mesh.position.set(cx,cy,cz);mesh.quaternion.copy(this.camera.quaternion);mesh.rotateZ(angle);
      mesh.scale.set((p.kind&0x40000?-1:1)*p.size*p.scale,(p.kind&0x80000?-1:1)*half,1);
      mesh.material.uniforms.image!.value=texture;
      (mesh.material.uniforms.prim!.value as THREE.Vector4).set(...p.color.map(v=>v/255) as [number,number,number,number]);
      (mesh.material.uniforms.env!.value as THREE.Vector4).set(...p.environment.map(v=>v/255) as [number,number,number,number]);
      mesh.material.uniforms.useEnv!.value=p.kind&128?1:0;
      mesh.material.depthTest=!(p.kind&0x10000000);mesh.material.blending=p.kind&0x400000?THREE.AdditiveBlending:THREE.NormalBlending;
    }
    this.stats.pooledMaterials=this.spriteMaterials.length;
    this.stats.models=this.bursts.length;this.stats.particles=this.sprites.size;this.stats.burning=this.burns.size;this.stats.unsupported=(this.player.unsupported.size)+[...this.extra.values()].reduce((total,entry)=>total+entry.player.unsupported.size,0);
  }
  reset():void {
    this.player?.clear();for(const entry of this.extra.values())entry.player.clear();this.extra.clear();for(const b of this.bursts)b.instance.dispose();this.bursts=[];
    for(const slot of this.burns.keys())this.rigs.actors[slot]?.damageOverlay.set(0,0,0,0);this.burns.clear();
    for(const mesh of this.sprites.values())this.releaseSprite(mesh);this.sprites.clear();this.stats.pooledMaterials=this.spriteMaterials.length;this.seed=0x76543210;
    Object.assign(this.stats,{particles:0,models:0,burning:0,spawnedDust:0,spawnedHits:0,unsupported:0});
  }
  dispose():void {this.reset();for(const material of this.spriteMaterials)material.dispose();this.spriteMaterials=[];this.stats.pooledMaterials=0;for(const texture of this.textures.values())texture.dispose();this.textures.clear();this.geometry.dispose();}
}
