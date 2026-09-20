import * as THREE from 'three';
import type { FighterContent, GameContent } from '../../../lib/game/load.ts';
import { MAX_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import type { LocalMatch, MatchEvent } from '../../../lib/game/match.ts';

/** Mario (EfMr, generators from 1000) / Luigi (EfLg, from 18000) fire particles. The owner's own
 * bank when it loaded that effect file (Dr. Luigi, Luigi & Boo, Metal Mario); otherwise the
 * roster's (Kirby copies). The roster only holds this match's fighters, so a Luigi-less match
 * must not depend on it. */
function fireBank(match:LocalMatch,owner:LocalMatch['fighters'][number]|undefined,luigi:boolean){
  const own=owner?.content.specials.particles;
  if(own&&own.first===(luigi?18000:1000))return own;
  return match.content.roster.get(luigi?'Lg':'Mr')?.specials.particles;
}import type { HsdModel } from '../../../lib/hsd/model.ts';
import { ModelInstance } from './model-instance.ts';
import type { GameRigs } from './game-rig.ts';
import { ElectricStroke } from './electric-stroke.ts';
import { EffectHalo } from './effect-halo.ts';
import { reflector, command } from '../../../lib/game/specials.ts';
import { copyHat } from '../../../lib/game/kirby.ts';
import { diddyGun } from '../../../lib/game/diddy.ts';
import { gamewatchArticleOutline, gamewatchCostume, gamewatchJudgeSign, gamewatchRim } from '../../../lib/game/gamewatch.ts';
import { KoEffects } from './ko-effects.ts';
import { isTopBlastKO } from '../../../lib/game/ko-effect.ts';
import { CommonEffects } from './common-effects.ts';
import { LinkEffects } from './link-effects.ts';
import { clampVisualAlpha, extrapolatePoint, shouldSnapPoint, trackPointSnapshot, type PointEntry } from './motion-interp.ts';
import { PK, pokemonRender } from '../../../lib/game/item-pokemon.ts';
import { itemKind, POKEMON_BASE } from '../../../lib/game/item-kinds.ts';

interface Attached { key:string; model:ModelInstance; start:number }
interface Transient { model:ModelInstance; age:number; life:number; owner:number }
export class PlayEffects {
  private projectiles=new Map<number,ModelInstance>();
  private projectileSources=new Map<number,HsdModel>();
  /** Item age at which the current article model was attached, so a mid-life model swap
   * restarts its animation instead of resuming past the end of a finished one. */
  private projectileStarts=new Map<number,number>();
  /** it_802AC43C: the PK Thunder head trails six lagged copies of the trail article. */
  private thunderTrail=new Map<string,ModelInstance>();
  private matchItems=new Map<number,ModelInstance>();
  private matchItemSources=new Map<number,HsdModel>();
  private halos=new Map<string,EffectHalo>();
  private electric=new Map<string,ElectricStroke>();
  private auras=new Map<number,Attached>();
  private accessories=new Map<number,Attached>();
  /** Game & Watch's Judgment sign per fighter slot (It_Kind_GameWatch_Judge). */
  private judgeSigns=new Map<number,Attached>();
  /** Peach-kit held items: Toad on FtPart 109 and the pulled turnip on the item-hold bone. */
  private toads=new Map<number,Attached>();
  private parasols=new Map<number,Attached>();
  private vegetables=new Map<number,Attached>();
  private chargeOrbs=new Map<number,Attached>();
  private iceBlocks=new Map<number,Attached>();
  /** itKoopaFlame x44_spawned: each flame asks for its generator once. */
  private flameSpawned=new Set<number>();
  /** Last match frame each Charizard's SpawnTailFire proc emitted on (one generator per frame). */
  private tailFrames=new Map<number,number>();
  private hats=new Map<number,Attached>();
  private transients:Transient[]=[];
  private previousFrame=0;
  private coins:Array<{mesh:THREE.Mesh;age:number;vx:number;vy:number}>=[];
  private coinGeometry=new THREE.CylinderGeometry(0.7,0.7,0.13,12);
  private coinMaterial=new THREE.MeshBasicMaterial({color:0xffd652});
  private lastGhost=Array<number>(MAX_MATCH_PLAYERS).fill(-1);
  /** Presentation-only point tracks for fast articles and loose items so
   * they glide every RAF like fighters. Keys are article/item ids; values
   * are never written back into the match. */
  private projectilePoints=new Map<number,PointEntry>();
  private itemPoints=new Map<number,PointEntry>();
  private pointRevision:number|undefined=undefined;
  private scratch=new THREE.Matrix4();
  private scratchScale=new THREE.Vector3();
  private scratchPoint=new THREE.Vector3();
  private readonly ko: KoEffects;
  get koFocus(): readonly { x: number; y: number }[] { return this.ko.focusPoints; }
  get koWarnings(): readonly string[] { return this.ko.warnings; }
  readonly common: CommonEffects;
  readonly link: LinkEffects;
  readonly stats={models:0,projectiles:0,transients:0,halos:0,koBeams:0,koParticles:0};
  constructor(private readonly scene:THREE.Scene,content:GameContent,private readonly rigs:GameRigs,private readonly camera:THREE.Camera){this.ko=new KoEffects(scene,content.koEffect);this.common=new CommonEffects(scene,content.commonEffects,rigs,camera);this.link=new LinkEffects(scene,rigs,camera);}
  private spawn(model:HsdModel):ModelInstance {const instance=new ModelInstance(model,false,true);this.scene.add(instance.group);return instance;}
  private transient(model:HsdModel,x:number,y:number,facing:number,life:number,owner:number,scale=1):void {
    if(this.transients.length>=24)this.transients.shift()!.model.dispose();
    const instance=this.spawn(model);instance.animationLoop=false;
    if(model.roots[0]?.name==='illusion')instance.tint.set(0.35,0.7,1);instance.group.position.set(x,y,0);instance.group.rotation.y=facing>0?Math.PI/2:-Math.PI/2;instance.group.scale.setScalar(scale);
    this.transients.push({model:instance,age:0,life,owner});
  }
  events(events:readonly MatchEvent[],match:LocalMatch):void {
    this.common.events(events,match);
    for(const event of events){
      const fighter=match.fighters[event.player];if(!fighter)continue;
      // Top-blast KOs become the spinning Star KO (owned by PlayRenderer); the
      // boundary burst beam is only for left/right/bottom exits.
      if(event.type==='ko'&&!isTopBlastKO(event.x,event.y,match.content.stage.blast))this.ko.spawn(event.x,event.y,fighter.seatId??fighter.slot,match.content.stage.blast);
      if(event.type==='hit'&&event.element===4){
        for(let i=0;i<3;i++){
          if(this.coins.length>=36)this.coins.shift()!.mesh.removeFromParent();
          const mesh=new THREE.Mesh(this.coinGeometry,this.coinMaterial);mesh.position.set(event.x,event.y,2);mesh.rotation.x=Math.PI/2;this.scene.add(mesh);
          this.coins.push({mesh,age:0,vx:(i-1)*0.5,vy:0.9+i*0.15});
        }
      }
      // Fireball muzzle + trail + bounce are family-specific (Mario orange vs Luigi green).
      // Dr pills (owner Dr) have no fire: no muzzle, no trail, no fire puff (pill bounce
      // is efAsync 1184, left as the generic spark). Kirby copies resolve by copyAbility.
      const ownerKind=fighter.content.profile.kind;
      const copySrc=ownerKind==='Kb'?fighter.copyAbility:undefined;
      const isLuigiFire=ownerKind==='Lg'||ownerKind==='Dl'||ownerKind==='Lb'||copySrc==='Lg';
      const isPill=ownerKind==='Dr'&&event.projectileKind==='fireball';
      if(event.type==='shot'&&event.projectileKind==='fireball'&&!isPill){
        const bank=fireBank(match,fighter,isLuigiFire);
        const model=fighter.content.specials.effects.get('fireball-muzzle')??(bank&&match.content.roster.get(isLuigiFire?'Lg':'Mr')?.specials.effects.get('fireball-muzzle'));if(model)this.transient(model,event.x,event.y,fighter.facing,14,fighter.slot,fighter.content.profile.attributes.modelScale);
        // Mario efSync 1146 (efAlt 0x47A): Attach 0x3E8 model + generator 0x3E9 (1001);
        // Luigi efSync 1287 (0x507): Attach 0x4650 model + same-id particles (18000).
        const gen=isLuigiFire?(bank?bank.first+0:undefined):(bank?bank.first+1:undefined);
        if(bank&&gen!==undefined)this.common.spawnFrom(bank,`mfire-muzzle:${event.player}`,gen,[event.x,event.y,1],fighter.facing,fighter.content.profile.attributes.modelScale);
      }
      // Mario Coll 1147 (1003) / Luigi Coll 1288 (18002) bounce puffs.
      if(event.type==='bounce'&&event.projectileKind==='fireball'&&!isPill){
        const bank=fireBank(match,fighter,isLuigiFire);
        const gen=isLuigiFire?(bank?bank.first+2:undefined):(bank?bank.first+3:undefined);
        if(bank&&gen!==undefined)this.common.spawnFrom(bank,`mfire-bounce:${event.player}`,gen,[event.x,event.y,1],fighter.facing,fighter.content.profile.attributes.modelScale);
      }
    }
  }
  update(match:LocalMatch,presentationFrames?:number,interp?:{alpha?:number;smooth?:boolean;revision?:number}):void {
    // Forward-extrapolated article/item roots (presentation only). Ages and
    // models stay authoritative; only the drawn x/y glides between ticks.
    const pointAlpha = interp?.smooth === false ? 0 : clampVisualAlpha(interp?.alpha ?? 0);
    const pointRevision = interp?.revision ?? match.restoreRevision;
    if (pointRevision !== this.pointRevision) { this.projectilePoints.clear(); this.itemPoints.clear(); this.pointRevision = pointRevision; }
    const elapsed=Math.max(0,Math.min(6,match.frame-this.previousFrame));this.previousFrame=match.frame;
    this.common.update(match,elapsed);this.link.update(match);
    this.ko.update(presentationFrames??elapsed,this.camera);this.stats.koBeams=this.ko.count;this.stats.koParticles=this.ko.particleCount;
    const activeElectric=new Set<string>();
    const electric=(key:string,x:number,y:number,dx:number,dy:number,frame:number,amplitude=1)=>{
      activeElectric.add(key);let stroke=this.electric.get(key);
      if(!stroke){stroke=new ElectricStroke();this.electric.set(key,stroke);this.scene.add(stroke.mesh);}
      stroke.update(x,y,dx,dy,frame,amplitude);
    };
    const activeHalos=new Set<string>();
    const halo=(key:string,kind:'shine'|'fire')=>{activeHalos.add(key);let h=this.halos.get(key);if(!h){h=new EffectHalo(kind);this.halos.set(key,h);this.scene.add(h.mesh);}return h;};
    const active=new Set(match.projectiles.items.map((item)=>item.id));
    for(const [id,model]of this.projectiles)if(!active.has(id)){model.dispose();this.projectiles.delete(id);this.projectileSources.delete(id);this.projectileStarts.delete(id);}
    for(const id of [...this.projectilePoints.keys()])if(!active.has(id))this.projectilePoints.delete(id);
    for(const id of [...this.flameSpawned])if(!active.has(id))this.flameSpawned.delete(id);
    for(const item of match.projectiles.items){
      let model=this.projectiles.get(item.id);
      if(model&&this.projectileSources.get(item.id)!==item.data.model){model.dispose();this.projectiles.delete(item.id);model=undefined;}
      // An article that swaps its own model mid-life (the PK Flash ball becoming its explosion)
      // starts a new native animation: play it from its own frame 0, not the item's whole age.
      if(!model){
        model=this.spawn(item.data.model);this.projectiles.set(item.id,model);this.projectileSources.set(item.id,item.data.model);this.projectileStarts.set(item.id,item.age);
        const owner=match.fighters[item.owner];if(owner)dressGamewatchArticle(model,owner.content,item.data.model);
        // SpawnItem_Rock / SpawnItem_RockBurst: one model child per floor material stays visible
        // (JOBJ_HIDDEN on the rest); a fragment also shows only one of its two chunk shapes.
        if(item.lizardon&&(item.kind==='lizardon-rock'||item.kind==='lizardon-burst'))hideRockVariants(model,item.data.model,item.kind==='lizardon-rock'?1:0,item.lizardon.variant,item.kind==='lizardon-burst'?(item.id&1):undefined);
      }
      const modelAge=item.age-(this.projectileStarts.get(item.id)??0);
      const pointCurr={x:item.x,y:item.y,frame:match.frame};
      const pointNext=trackPointSnapshot(this.projectilePoints.get(item.id)??{},pointCurr,false);
      this.projectilePoints.set(item.id,pointNext);
      const point=pointAlpha>0&&pointNext.prev&&pointNext.curr&&!shouldSnapPoint(pointNext.prev,pointNext.curr)?extrapolatePoint(pointNext.prev,pointNext.curr,pointAlpha):pointCurr;
      // itNesspkfirepillar_UnkMotion0_Anim: the column shrinks from full size to its article's
      // minimum across its whole life, so the fire visibly burns down instead of standing still.
      const pillarMin=item.kind==='pk-fire-pillar'?(item.data as {minScale?:number}).minScale:undefined;
      // Rebound_Anim scales the popped spring to its article's x1C.
      const springScale=item.sonicSpring?.phase==='rebound'?(item.data as {reboundScale?:number}).reboundScale??1:1;
      const shrink=(pillarMin===undefined?1:pillarMin+(item.life*(1-pillarMin))/Math.max(1,item.data.lifetime))*springScale;
      // Skull Kid's bomb: the grow-in joint scale, hidden (x2FF8) while its holder teleports.
      const skullScale=item.skull?item.skull.scale:1;
      model.group.position.set(point.x,point.y,0);model.group.scale.setScalar(Math.max(0.001,item.data.scale*shrink*skullScale));
      model.group.visible=(item.pikachu?.delay??0)===0&&!(item.kind==='link-bomb'&&item.link?.phase==='explosion')&&!item.skull?.hidden;
      if(item.kind==='tjolt'||item.kind==='raichu-jolt'){
        model.group.rotation.y=(item.pikachu?.facing??Math.sign(item.vx))>=0?Math.PI/2:-Math.PI/2;model.group.rotation.x=0;
        if(item.pikachu?.grounded)model.group.position.set(item.pikachu.anchorX,item.pikachu.anchorY,0);
        electric(`jolt:${item.id}`,point.x-2,point.y,4,0,item.age,2);
      }else if(item.kind==='thunder'){
        model.group.rotation.y=0;model.group.scale.y*=item.pikachu?.scale??1;
      }else if(item.kind==='laser'){
        model.group.rotation.y=item.vx>=0?Math.PI/2:-Math.PI/2;
        model.group.rotation.x=Math.PI+Math.atan2(item.vy,item.vx>=0?-item.vx:item.vx);
        model.group.scale.z*=Math.max(0.001,Math.min(item.data.rayScale,item.age*Math.hypot(item.vx,item.vy)/11.25));
      }else if(item.kind==='cutter'){
        // it_2725_Logic7: the beam faces its travel direction and hides during its last five frames.
        model.group.rotation.y=item.vx>=0?Math.PI/2:-Math.PI/2;model.group.rotation.x=0;model.group.visible=item.life>5;
      }else if(['charge','missile','super-missile','bomb'].includes(item.kind)){
        model.group.rotation.y=item.vx>=0?Math.PI/2:-Math.PI/2;model.group.rotation.x=item.kind.includes('missile')?-Math.atan2(item.vy,Math.abs(item.vx)):0;
      }else if(item.kind==='arrow'||item.kind==='boomerang'){
        const stuck=item.link?.phase==='stuck';
        const vx=stuck?Math.cos(item.link!.angle):item.vx,vy=stuck?Math.sin(item.link!.angle):item.vy;
        const facing=item.link?.phase==='caught'?(match.fighters[item.link.sourceOwner]?.facing??1):Math.sign(vx)||1;
        model.group.rotation.y=facing>=0?Math.PI/2:-Math.PI/2;
        const params=item.link?match.content.roster.get(item.link.sourceKind)?.specials.parameters:undefined;
        const limit=params&&(params.kind==='Lk'||params.kind==='Cl')?params.arrow.angleLimit:Math.PI;
        model.group.rotation.x=item.kind==='arrow'?-Math.max(-limit,Math.min(limit,Math.atan2(vy,Math.abs(vx)))):0;
        model.opacityMultiplier=stuck?Math.min(1,item.life/5):1;
      }else{
        // Native article animation supplies its own material/flames. Never give
        // every unrecognized projectile (arrows, boomerangs, psychic attacks) fire.
        model.group.rotation.y=0;model.group.rotation.z=0;
      }
      model.update(item.kind==='tjolt'&&item.pikachu?.grounded?item.pikachu.waveFrame:item.link?.phase==='stuck'?item.link.stuckFrame:item.kind==='turnip'?(item.turn??0):modelAge); model.applyBillboards(this.camera);
      // itKoopaFlame_UnkMotion0_Anim: the flame item carries no mesh at all - its whole look is one
      // attached generator from the fighter's own bank (efSync 0x4DB-0x4DE -> 12005..12008), spawned
      // once and riding the item. The original picks the variant from the same random table as the
      // flame's angle; the id keeps it deterministic here.
      // PlLz flame anim: efSync_Spawn(0x1775 + state_var3) once on the item JObj. m-ex resolves
      // 6000+n against the owner's own bank (EfLzData: generators 12000+n), and the JObj carries
      // the size-pool scale the hitbox uses.
      if(item.kind==='lizardon-flame'&&!this.flameSpawned.has(item.id)){
        this.flameSpawned.add(item.id);
        const bank=match.fighters[item.owner]?.content.specials.particles;
        const live=match.projectiles.items,size=item.data.hit?item.hit.radius/item.data.hit.radius:1;
        if(bank)this.common.spawnFrom(bank,`lzflame:${item.owner}`,bank.first+5+(item.lizardon?.variant??0),()=>{
          const current=live.find((candidate)=>candidate.id===item.id);
          return current?[current.x,current.y,0]:[item.x,item.y,0];
        },item.vx>=0?1:-1,size,true);
      }
      if(item.kind==='koopa-flame'&&!this.flameSpawned.has(item.id)){
        this.flameSpawned.add(item.id);
        const bank=match.fighters[item.owner]?.content.specials.particles;
        const live=match.projectiles.items;
        if(bank)this.common.spawnFrom(bank,`flame:${item.owner}`,12005+(item.id&3),()=>{
          const current=live.find((candidate)=>candidate.id===item.id);
          return current?[current.x,current.y,0]:[item.x,item.y,0];
        },item.vx>=0?1:-1,item.data.scale,true);
      }
      // Mario article type-40 spawns 0x3EA (1002), Luigi 18001: without it the shot
      // reads as a sliding decal. Dr pills have no type-40 (static pill), so no trail.
      if(item.kind==='fireball'&&!this.flameSpawned.has(item.id)){
        this.flameSpawned.add(item.id);
        const owner=match.fighters[item.owner];
        const ownerKind=owner?.content.profile.kind;
        const copySrc=ownerKind==='Kb'?owner?.copyAbility:undefined;
        if(ownerKind==='Dr')continue;
        const isLuigiFire=ownerKind==='Lg'||ownerKind==='Dl'||ownerKind==='Lb'||copySrc==='Lg';
        const bank=fireBank(match,owner,isLuigiFire);
        const gen=isLuigiFire?(bank?bank.first+1:undefined):(bank?bank.first+2:undefined);
        const live=match.projectiles.items;
        if(bank&&gen!==undefined)this.common.spawnFrom(bank,`mfire-trail:${item.owner}`,gen,()=>{
          const current=live.find((candidate)=>candidate.id===item.id);
          return current?[current.x,current.y,0]:[item.x,item.y,0];
        },item.vx>=0?1:-1,item.data.scale,true);
      }
    }
    // itNesspkthunderball_UnkMotion0_Anim spawns six It_Kind_Ness_PKThunder1 segments behind the
    // head, each pinned to positions[i*2] of the ball's own 16-frame position ring. Without them
    // PK Thunder reads as a lone dot instead of the original comet.
    const activeTrail=new Set<string>();
    for(const item of match.projectiles.items){
      if(item.kind!=='pk-thunder'||!item.ness)continue;
      const trailModel=match.fighters[item.owner]?.content.specials.articles.ness?.trail;
      if(!trailModel)continue;
      for(let segment=0;segment<6;segment++){
        const spot=item.ness.trail[segment*2];
        if(!spot)continue;
        const key=`${item.id}:${segment}`;
        activeTrail.add(key);
        let piece=this.thunderTrail.get(key);
        if(!piece){piece=this.spawn(trailModel.model);this.thunderTrail.set(key,piece);}
        piece.group.position.set(spot[0],spot[1],0);
        piece.group.scale.setScalar(Math.max(0.001,trailModel.scale));
        piece.opacityMultiplier=1-segment/7;
        piece.update(item.age);piece.applyBillboards(this.camera);
      }
    }
    for(const [key,piece]of this.thunderTrail)if(!activeTrail.has(key)){piece.dispose();this.thunderTrail.delete(key);}
    // Match items (lib/game/item-engine.ts): per-state ItCo models, memoized by the archive.
    const itemsData=match.content.items;
    const liveItems=new Set(itemsData?match.itemWorld.items.map((item)=>item.id):[]);
    for(const [id,model]of this.matchItems)if(!liveItems.has(id)){model.dispose();this.matchItems.delete(id);this.matchItemSources.delete(id);}
    for(const id of [...this.itemPoints.keys()])if(!liveItems.has(id))this.itemPoints.delete(id);
    if(itemsData)for(const item of match.itemWorld.items){
      const kindData=itemsData.kind(item.kind);
      // Foods use their per-type record models; the Fire Flower's LGunBeam flame has no
      // model of its own, so the flame prop article stands in visually.
      // Pokémon draw their loaded state animation (lib/game/item-pokemon.ts). Particle-only
      // originals have no model: flames/gas show as hit-effect trails from the simulation, and
      // Lugia's Aeroblast borrows the scope beam so its depth stays visible. The 0x29 article
      // (It_Kind_F_Flower_Flame) is the Lip's Stick head flower, never a flame stand-in.
      const poke=item.pk?pokemonRender(item,itemsData):null;
      const slot=item.kind-POKEMON_BASE;
      let source:HsdModel;
      try{
        if(kindData.name==='LGunBeam'||(poke&&((slot>=PK.Flame1&&slot<PK.Flame1+4)||slot===PK.CyndaFlame||slot===PK.Gas1||slot===PK.Gas2)))throw new Error('particle-only');
        source=kindData.name==='Foods'?itemsData.foodModel(item.variant)
          :poke&&slot>=PK.Aero1&&slot<PK.Aero1+3?itemsData.stateModel(itemKind('SScopeBeam'),0)
          :poke?.letter!=null?itemsData.letterModel(item.kind,poke.letter)
          :poke?(poke.anim>=0&&kindData.states[poke.anim]?itemsData.stateModel(item.kind,poke.anim):itemsData.restModel(item.kind))
          :!kindData.states.length?itemsData.restModel(item.kind)
          :itemsData.stateModel(item.kind,Math.min(item.stateIndex,Math.max(0,kindData.states.length-1)));
      }catch{
        const stale=this.matchItems.get(item.id);
        if(stale){stale.dispose();this.matchItems.delete(item.id);this.matchItemSources.delete(item.id);}
        continue;
      }
      let model=this.matchItems.get(item.id);
      if(model&&this.matchItemSources.get(item.id)!==source){model.dispose();this.matchItems.delete(item.id);model=undefined;}
      if(!model){model=this.spawn(source);this.matchItems.set(item.id,model);this.matchItemSources.set(item.id,source);}
      const attributes=kindData.attributes;
      const holder=item.phase==='held'&&item.owner!==null&&!attributes.heavy?match.fighters[item.owner]:undefined;
      const holdBone=holder?.content.profile.itemHoldBone;
      if(holder&&holdBone!==undefined&&this.rigs.actors[holder.slot]){
        // Held items ride the hold bone's full joint matrix so swings track the hand.
        model.group.matrixAutoUpdate=false;
        model.group.matrix.copy(this.rigs.actors[holder.slot]!.jointWorldMatrix(holdBone,this.scratch)).scale(this.scratchScale.setScalar(Math.max(0.001,attributes.scale)));
        model.group.matrixWorldNeedsUpdate=true;
      }else{
        model.group.matrixAutoUpdate=true;
        const itemCurr={x:item.x,y:item.y,frame:match.frame};
        const itemNext=trackPointSnapshot(this.itemPoints.get(item.id)??{},itemCurr,false);
        this.itemPoints.set(item.id,itemNext);
        const drawn=pointAlpha>0&&itemNext.prev&&itemNext.curr&&!shouldSnapPoint(itemNext.prev,itemNext.curr)?extrapolatePoint(itemNext.prev,itemNext.curr,pointAlpha):itemCurr;
        model.group.position.set(drawn.x,drawn.y,poke?.z??0);
        // HSD_JObjSetScale replaces the root joint's scale; Pokémon models carry their own root
        // scale on disc (Bellossom 2.6, Mew 2.8…), so the group divides it back out.
        const rootScale=poke?(source.roots[0]?.joints[0]?.scale[0]||1):1;
        model.group.scale.setScalar(Math.max(0.001,poke?poke.scale/rootScale:attributes.scale));
        if(poke){
          model.group.rotation.set(poke.spin?.[0]??0,poke.spin?.[1]??poke.rotY,poke.spin?.[2]??0);
        }else{
          model.group.rotation.y=item.facing>=0?Math.PI/2:-Math.PI/2;
          model.group.rotation.z=item.phase==='flight'?item.age*0.18*(item.facing>=0?-1:1):0;
        }
      }
      model.group.visible=!poke?.hidden;
      if(poke){
        model.animationLoop=false;
        if(poke.rootJoint)model.setJointTranslationOverride(0,poke.rootJoint.joint,poke.rootJoint.offset);
        if(poke.tilt)model.setJointRotationOverride(0,poke.tilt.joint,poke.tilt.rotation);
      }
      model.update(poke&&poke.anim>=0?poke.frame:item.age); model.applyBillboards(this.camera);
    }
    for(const fighter of match.fighters){
      const s=fighter.special,kind=fighter.content.profile.kind;
      if((kind==='Pk'||kind==='Rc')&&s){
        if(s.direction==='up'&&s.phase==='travel')electric(`zip:${fighter.slot}`,fighter.x,fighter.y+5,-fighter.velocity.x*2,-fighter.velocity.y*2,s.age,2);
        // Raichu's side special is his roll, not the Skull Bash charge.
        if(kind==='Pk'&&s.direction==='side'&&s.phase==='loop')electric(`charge:${fighter.slot}`,fighter.x-4,fighter.y+7,8,2,s.age,1.5);
        if(s.direction==='down'&&s.phase==='hit')electric(`thunder-hit:${fighter.slot}`,fighter.x-8,fighter.y+5,16,5,s.age,4);
      }
      const throwing=(kind==='Fx'||kind==='Fc')&&fighter.state==='throw'&&command(fighter,1)===1;
      // Kirby's hammer item exists between the script's cmd_vars[0] spawn (1) and removal (2); a copied Fox blaster follows the copy special.
      // Roy's copy blade (hat_dynamics[0] joint) and Link's copy bow (source bow, Kirby-scaled via the hand joint) ride the same way for their copy neutrals.
      const copiedBlaster=kind==='Kb'&&fighter.copyAbility==='Fx'?fighter.content.copies?.Fx?.accessory?.model:undefined;
      const copiedSword=kind==='Kb'&&fighter.copyAbility==='Fe'?fighter.content.copies?.Fe?.sword:undefined;
      const copiedBow=kind==='Kb'&&(fighter.copyAbility==='Lk'||fighter.copyAbility==='Cl')?fighter.content.copies?.[fighter.copyAbility as 'Lk'|'Cl']?.sourceArticles.link?.bows?.[0]?.model:undefined;
      // ftNs_AttackS4_Enter spawns It_Kind_Ness_Bat on the item-hold part for the whole swing
      // (ftNs_AttackS4_Anim despawns it at the last frame); the yo-yo smashes do the same with
      // It_Kind_Ness_Yoyo. Both are held items, so they ride a joint like any accessory.
      const nessHeld=kind==='Ns'&&fighter.state==='attack'&&fighter.attackName
        ?fighter.attackName.startsWith('AttackS4')?fighter.content.specials.articles.ness?.bat
        :fighter.attackName.startsWith('AttackHi4')||fighter.attackName.startsWith('AttackLw4')?fighter.content.specials.articles.ness?.yoyo
        :undefined:undefined;
      // PlWf sub_03aac: Wolf holds his gun article on FtPart 0x43 for the whole blaster move.
      const wolfGun=(kind==='Wf'||kind==='WfU')&&s?.direction==='neutral'?fighter.content.specials.articles.wolf?.gun?.model:undefined;
      // PlDd Gun_Spawn → Gun_Destroy: the popgun rides FtPart 0x1F from the start's cmd0 to the shot's (or the blow's) cmd1.
      const diddyPopgun=kind==='Dd'&&diddyGun(fighter)?fighter.content.specials.articles.diddy?.gun.model:undefined;
      const heldGun=wolfGun??diddyPopgun,gunPart=wolfGun?0x43:0x1f;
      const accessory=throwing||!!nessHeld||!!heldGun||(s&&(((kind==='Fx'||kind==='Fc')&&s.direction==='neutral')||(kind==='Mr'&&s.direction==='side')||(kind==='Gw'&&s.direction==='up')||(kind==='Kb'&&s.direction==='side'&&command(fighter,0)===1)||(!!copiedBlaster&&s.direction==='neutral')||(!!copiedSword&&s.direction==='neutral')||(!!copiedBow&&s.direction==='neutral')));
      const age=throwing||nessHeld?fighter.animationFrame:(s?.age??0);
      const key=throwing?`${fighter.attackSerial}:throw`:nessHeld?`${fighter.attackSerial}:ness-held`:accessory?`${s!.serial}:accessory`:'';
      let item=this.accessories.get(fighter.slot);
      if(item?.key!==key){item?.model.dispose();this.accessories.delete(fighter.slot);item=undefined;}
      if(accessory){
        if(!item){const model=nessHeld?nessHeld.model:heldGun?heldGun:s?.direction==='neutral'&&copiedBlaster?copiedBlaster:s?.direction==='neutral'&&copiedSword?copiedSword:s?.direction==='neutral'&&copiedBow?copiedBow:fighter.content.specials.articles.accessory?.model;if(!model)throw Error('Active accessory has no original model.');item={key,model:this.spawn(model),start:age};this.accessories.set(fighter.slot,item);dressGamewatchArticle(item.model,fighter.content,model);}
        // The Ness items hang off FtPart_R2ndNa (0x2A), the part ftNs/itNessyoyo both name.
        const bone=nessHeld?(fighter.content.profile.partJoints[42]??fighter.content.profile.boneMap[49]!):heldGun?(fighter.content.profile.partJoints[gunPart]??fighter.content.profile.boneMap[49]!):fighter.content.profile.boneMap[49]!;
        item.model.group.matrixAutoUpdate=false;item.model.group.matrix.copy(this.rigs.actors[fighter.slot]!.jointWorldMatrix(bone,this.scratch));item.model.group.matrixWorldNeedsUpdate=true;
        item.model.update(age-item.start); item.model.applyBillboards(this.camera);
      }
      // it_802C7774: the Judgment sign rides the right thumb (FtPart_RThumbNb), posed once at its
      // number; it_802C78B8 turns the board (joint 2) by pi when he faces right so it reads forward.
      const sign=gamewatchJudgeSign(fighter),signKey=sign?`${sign.serial}:judge`:'';
      let judge=this.judgeSigns.get(fighter.slot);
      if(judge?.key!==signKey){judge?.model.dispose();this.judgeSigns.delete(fighter.slot);judge=undefined;}
      const judgeData=sign?fighter.content.specials.articles.gamewatch?.judge:undefined;
      if(sign&&judgeData){
        if(!judge){judge={key:signKey,model:this.spawn(judgeData.model),start:0};judge.model.animationLoop=false;dressGamewatchArticle(judge.model,fighter.content,judgeData.model);this.judgeSigns.set(fighter.slot,judge);}
        judge.model.rotationOverrides.set(2,{y:fighter.facing===1?Math.PI:0});
        judge.model.group.matrixAutoUpdate=false;judge.model.group.matrix.copy(this.rigs.actors[fighter.slot]!.jointWorldMatrix(fighter.content.profile.boneMap[49]!,this.scratch));judge.model.group.matrixWorldNeedsUpdate=true;
        judge.model.update(sign.frame);
      }
      // it_802BDE18: Toad (It_Kind_Peach_Toad) rides FtPart 109. State 0 plays under SpecialN and is
      // shown on its frames 7–53; the counter's it_802BE100 swaps to state 1 ten frames in (hidden at 60).
      const peachKit=kind==='Pe'||kind==='Da';
      const toadData=peachKit&&s?.direction==='neutral'&&(s.phase==='start'||s.phase==='hit')?fighter.content.specials.articles.peach?.toad:undefined;
      const toadPart=toadData?fighter.content.profile.partJoints[109]??-1:-1;
      const toadFrame=s?.phase==='hit'?fighter.animationFrame+10:fighter.animationFrame;
      const toadShown=!!toadData&&toadPart>=0&&(s!.phase==='hit'?toadFrame<60:toadFrame>=7&&toadFrame<53);
      const toadKey=toadShown?`${s!.serial}:${s!.phase}:toad`:'';
      let toad=this.toads.get(fighter.slot);
      if(toad?.key!==toadKey){toad?.model.dispose();this.toads.delete(fighter.slot);toad=undefined;}
      if(toadShown){
        if(!toad){toad={key:toadKey,model:this.spawn(s!.phase==='hit'?toadData!.toadHit:toadData!.model),start:0};toad.model.animationLoop=false;this.toads.set(fighter.slot,toad);}
        toad.model.group.matrixAutoUpdate=false;toad.model.group.matrix.copy(this.rigs.actors[fighter.slot]!.jointWorldMatrix(toadPart,this.scratch)).scale(this.scratchScale.setScalar(Math.max(0.001,toadData!.scale)));toad.model.group.matrixWorldNeedsUpdate=true;
        toad.model.group.visible=this.rigs.actors[fighter.slot]!.group.visible;
        toad.model.update(toadFrame);toad.model.applyBillboards(this.camera);
      }
      // it_802BDA64 (accessory4 on the first up-B frame): It_Kind_Peach_Parasol rides FtPart 109 until
      // the move ends. Item state 0 has no animation (closed); ItemParasolOpen's opcode 42 at frame 6
      // (ftCommon_8007E83C state 4, divisor 4) plays anim 0 at 15/4 per frame, and ItemParasolFall
      // enters with Ft_MF_SkipParasol, so the canopy stays open for the float.
      const parasolData=peachKit&&s?.direction==='up'&&s.phase!=='end'&&fighter.state!=='ko'&&fighter.state!=='respawn'?fighter.content.specials.articles.peach?.parasol:undefined;
      const parasolPart=parasolData?fighter.content.profile.partJoints[109]??-1:-1;
      const parasolKey=parasolData&&parasolPart>=0?`${s!.serial}:parasol`:'';
      let parasol=this.parasols.get(fighter.slot);
      if(parasol?.key!==parasolKey){parasol?.model.dispose();this.parasols.delete(fighter.slot);parasol=undefined;}
      if(parasolKey){
        if(!parasol){parasol={key:parasolKey,model:this.spawn(parasolData!.model),start:0};parasol.model.animationLoop=false;this.parasols.set(fighter.slot,parasol);}
        const openFrame=s!.phase==='start'?0:s!.phase==='travel'?Math.min(15,Math.max(0,(fighter.animationFrame-6)*15/4)):15;
        parasol.model.group.matrixAutoUpdate=false;parasol.model.group.matrix.copy(this.rigs.actors[fighter.slot]!.jointWorldMatrix(parasolPart,this.scratch)).scale(this.scratchScale.setScalar(Math.max(0.001,parasolData!.scale)));parasol.model.group.matrixWorldNeedsUpdate=true;
        parasol.model.group.visible=this.rigs.actors[fighter.slot]!.group.visible;
        parasol.model.update(openFrame);
      }
      // spawnVeg -> ftpickupitem_80094818: the pulled turnip sits on the item-hold bone until thrown;
      // its face is the model frame (it_80273670), as for the thrown one.
      const vegData=peachKit&&fighter.peachTurnip!==null&&fighter.state!=='ko'&&fighter.state!=='respawn'?fighter.content.specials.articles.peach?.turnip:undefined;
      const vegBone=fighter.content.profile.itemHoldBone;
      const vegKey=vegData&&vegBone!==undefined?`veg:${fighter.peachTurnip}`:'';
      let veg=this.vegetables.get(fighter.slot);
      if(veg?.key!==vegKey){veg?.model.dispose();this.vegetables.delete(fighter.slot);veg=undefined;}
      if(vegKey){
        if(!veg){veg={key:vegKey,model:this.spawn(vegData!.model),start:0};veg.model.animationLoop=false;this.vegetables.set(fighter.slot,veg);}
        veg.model.group.matrixAutoUpdate=false;veg.model.group.matrix.copy(this.rigs.actors[fighter.slot]!.jointWorldMatrix(vegBone!,this.scratch)).scale(this.scratchScale.setScalar(Math.max(0.001,vegData!.scale)));veg.model.group.matrixWorldNeedsUpdate=true;
        veg.model.group.visible=this.rigs.actors[fighter.slot]!.group.visible;
        veg.model.update(fighter.peachTurnip??0);
      }
      // it_802B55C8: the Charge Shot orb rides the right hand from the start script's cmd0 until
      // the shot leaves the cannon, growing over the stored level; SpecialNCancel destroys it
      // (ftSs_SpecialN_801291A8), which is why a stored charge shows nothing until she charges again.
      const charge=kind==='Ss'?fighter.content.specials.articles.samus:kind==='Kb'&&fighter.copyAbility==='Ss'?fighter.content.copies?.Ss?.sourceArticles.samus:undefined;
      const hand=charge?fighter.content.profile.partJoints?.[50]??-1:-1;
      const charging=!!charge&&hand>=0&&!!s&&s.direction==='neutral'&&(s.phase==='start'?command(fighter,0)===1:s.phase!=='end'&&!(s.phase==='travel'&&command(fighter,1)===1));
      // ADDED, not in the original: Melee only flashes her body once as the charge fills
      // (ftCo_800BFFD0 colanim 53) and then shows nothing, so a stored full shot is invisible.
      // A slow pulse of the same held-orb article keeps the loaded cannon readable.
      const loaded=!!charge&&hand>=0&&!charging&&fighter.samusCharge>=charge.charges.length-1&&fighter.state!=='ko'&&fighter.state!=='respawn';
      const orbKey=charging?`${s!.serial}:charge-orb`:loaded?'charge-loaded':'';
      let orb=this.chargeOrbs.get(fighter.slot);
      if(orb?.key!==orbKey){orb?.model.dispose();this.chargeOrbs.delete(fighter.slot);orb=undefined;}
      if(charging||loaded){
        if(!orb){orb={key:orbKey,model:this.spawn(charge!.hold.model),start:charging?s!.age:match.frame};this.chargeOrbs.set(fighter.slot,orb);}
        const level=Math.max(0,Math.min(charge!.charges.length-1,Math.floor(fighter.samusCharge)));
        const age=(charging?s!.age:match.frame)-orb.start;
        // The tell flares on the frame it fills, then settles into a breathing glow that stays
        // well under the level-1 charging orb, so it never reads as "still charging".
        const pulse=loaded?1.25+.2*Math.sin(age/8)+Math.max(0,1-age/14)*1.4:1;
        const point=this.rigs.point(fighter,hand,[0,0,4]);
        orb.model.group.position.set(point[0],point[1],point[2]);
        orb.model.group.rotation.y=fighter.facing>=0?Math.PI/2:-Math.PI/2;
        orb.model.group.scale.setScalar(Math.max(0.001,charge!.charges[loaded?0:level]!.scale*pulse));
        orb.model.group.visible=this.rigs.actors[fighter.slot]!.group.visible;
        orb.model.animationLoop=true;orb.model.update(age);orb.model.applyBillboards(this.camera);
      }
      // ftCo_DamageIce_Init: efAsync 0x415 hangs the block off FtPart_XRotN as a child, sized by
      // the fighter's own damageice_ice_size against the common one, and lives with the freeze.
      const iceModel=match.content.commonEffects?.iceBlock;
      const iceJoint=fighter.content.profile.partJoints?.[2]??-1;
      const iced=!!iceModel&&iceJoint>=0&&fighter.state==='frozen';
      let block=this.iceBlocks.get(fighter.slot);
      if(!!block!==iced){block?.model.dispose();this.iceBlocks.delete(fighter.slot);block=undefined;}
      if(iced){
        if(!block){block={key:'ice',model:this.spawn(iceModel!),start:match.frame};this.iceBlocks.set(fighter.slot,block);}
        const attributes=fighter.content.profile.attributes;
        // The joint matrix already carries the fighter's model scale, which the original applies
        // by hand (its block hangs off a constraint, not inside the scaled skeleton).
        const size=(attributes.iceSize??match.content.combat.ice.size)/match.content.combat.ice.size;
        block.model.group.matrixAutoUpdate=false;
        block.model.group.matrix.copy(this.rigs.actors[fighter.slot]!.jointWorldMatrix(iceJoint,this.scratch)).scale(this.scratchScale.setScalar(Math.max(0.001,size)));
        block.model.group.matrixWorldNeedsUpdate=true;
        block.model.group.visible=this.rigs.actors[fighter.slot]!.group.visible;
        block.model.update(match.frame-block.start);block.model.applyBillboards(this.camera);
      }
      // ftKb_UnkMtxFunc0: the copied hat follows fighter part 6 for as long as the ability is held.
      // Hat draw filtering (ftParts_8007487C costume-0 alternative 0) hides inner/outer doubles
      // like Link's white under-cap, so only the selected side shows with correct colors.
      const hat=copyHat(fighter), hatKey=hat?`hat:${fighter.copyAbility}`:'';
      let worn=this.hats.get(fighter.slot);
      if(worn?.key!==hatKey){worn?.model.dispose();this.hats.delete(fighter.slot);worn=undefined;}
      if(hat){
        if(!worn){const model=new ModelInstance(hat.model,true,true);const hidden=fighter.copyAbility?fighter.content.copies?.[fighter.copyAbility as import('../../../lib/game/special-data.ts').CopySource]?.hatHidden:undefined;model.hiddenDobjs.clear();for(const dobj of hidden??[])model.hiddenDobjs.add(dobj);this.scene.add(model.group);worn={key:hatKey,model,start:0};this.hats.set(fighter.slot,worn);}
        worn.model.group.matrixAutoUpdate=false;worn.model.group.matrix.copy(this.rigs.actors[fighter.slot]!.jointWorldMatrix(hat.joint,this.scratch));worn.model.group.matrixWorldNeedsUpdate=true;
        worn.model.group.visible=this.rigs.actors[fighter.slot]!.group.visible;worn.model.update(match.frame);
      }
      // PlLz SpawnTailFire (a GObj proc OnLoad installs): every frame efSync attrs x4 (6009 →
      // EfLzData generator 12009) on joint x0, the tail tip, facing the fighter.
      const lz=fighter.content.specials?.parameters,lzBank=fighter.content.specials?.particles;
      if(lz?.kind==='Lz'&&lzBank&&fighter.state!=='ko'&&fighter.state!=='respawn'&&this.rigs.actors[fighter.slot]?.group.visible&&this.tailFrames.get(fighter.slot)!==match.frame){
        this.tailFrames.set(fighter.slot,match.frame);
        const joint=fighter.content.profile.partJoints[lz.tail.bone];
        if(joint!==undefined&&lz.tail.effect>=6000&&lz.tail.effect<7000)this.common.spawnFrom(lzBank,`lztail:${fighter.slot}`,lzBank.first+lz.tail.effect-6000,this.rigs.point(fighter,joint,[0,0,0]) as [number,number,number],fighter.facing,fighter.content.profile.attributes.modelScale);
      }
      let name:string|null=null;
      // Wolf (PlWf) holds the same models from EfWfData.dat on the same parts; his launch flame is
      // model 4 (efSync 0x138C).
      const foxLike=kind==='Fx'||kind==='Fc'||kind==='Wf'||kind==='WfU';
      if(s&&foxLike&&s.direction==='down'&&s.phase!=='end')name=s.phase==='start'?'shine-start':s.phase==='hit'?'shine-hit':'shine-loop';
      if(s&&foxLike&&s.direction==='up')name=s.phase==='start'?'firefox-charge':'firefox-launch';
      if(s&&(kind==='Mr'||kind==='Dr'||kind==='MM'||kind==='Lg'||kind==='Dl'||kind==='Lb')&&s.direction==='down')name='tornado';
      if(s&&kind==='Kb'&&s.direction==='side'&&command(fighter,0)===1)name=s.startedAir?'hammer-air':'hammer-ground';
      if(s&&kind==='Kb'&&s.direction==='up')name=s.phase==='start'?'cutter-burst':(s.phase==='travel'||s.phase==='loop')?'cutter-blade':null;
      // ftSs_SpecialHi_Enter: efSync_Spawn(1154) rides FtPart_YRotN for the whole Screw Attack
      // and is destroyed with the move (ftSamus_DestroyAllUnsetx2444).
      if(s&&kind==='Ss'&&s.direction==='up')name='screw-attack';
      // ftNs_SpecialLwStart_Anim: efAsync_Spawn(1264) on FtPart_L1stNb holds the PSI Magnet
      // shield for the whole hold; ftNs_Special(Air)HiHold_Anim rides efSync 1262 on FtPart_HipN
      // while the ball is steered and swaps to 1263 for the PK Thunder 2 flight.
      if(s&&kind==='Ns'&&s.direction==='down'&&s.phase!=='end')name='psi-magnet';
      if(s&&kind==='Ns'&&s.direction==='up')name=s.phase==='hit'?'pk-thunder-2-aura':s.phase==='loop'?'pk-thunder-aura':null;
      // The ACE Ness clones hold the same shield and fly the same PSI burst; their up special
      // is the launch itself (phase 'travel'), not a steered ball.
      if(s&&(kind==='Lc'||kind==='Nt'||kind==='Lc2')&&s.direction==='down'&&s.phase!=='end')name='psi-magnet';
      if(s&&(kind==='Lc'||kind==='Nt'||kind==='Lc2')&&s.direction==='up'&&s.phase==='travel')name='pk-thunder-2-aura';
      // Sonic_GFXSpin: SpecialNCharge_Enter, SpecialNAttack_Enter and SpecialNAttackMiss_Enter install
      // it as accessory4, spawning efSync 0x1388 (the spin ball) on FtPart_TransN once per state.
      const sonicState=kind==='Sn'?s?.sonic?.state:undefined;
      if(sonicState==='NCharge'||sonicState==='NAttack'||sonicState==='NAttackMiss')name='sonic-spin';
      // Kirby dash fire (AttackDash frame9 gfx 1173, efAlt 0x495 -> EfKb index 3): attached for the dash duration like the original joint child. Frame0 flames (gfx 1043, common generator 55) arrive via the timeline event path.
      if(!name&&kind==='Kb'&&fighter.state==='attack'&&fighter.attackName==='AttackDash')name='dash-fire';
      const auraSerial=s?.serial??fighter.attackSerial;
      const auraAge=s?.age??fighter.animationFrame;
      const auraKey=name?`${auraSerial}:${name}`:'';
      let aura=this.auras.get(fighter.slot);
      if(aura?.key!==auraKey){aura?.model.dispose();this.auras.delete(fighter.slot);aura=undefined;}
      if(name){
        if(!aura){const data=fighter.content.specials.effects.get(name);if(data){aura={key:auraKey,model:this.spawn(data),start:auraAge};this.auras.set(fighter.slot,aura);}}
        if(aura){
          // FtPart_YRotN (3) for the screw, FtPart_L1stNb (23) for the magnet shield and
          // FtPart_HipN (4) for both PK Thunder auras, exactly as each spawn call names them.
          const rotationJoint=name==='screw-attack'?fighter.content.profile.partJoints?.[3]??-1
            :name==='psi-magnet'?fighter.content.profile.partJoints?.[23]??-1
            :name.startsWith('pk-thunder')?fighter.content.profile.partJoints?.[4]??-1
            :name==='sonic-spin'?fighter.content.profile.partJoints?.[1]??-1:-1;
          const hip=name.startsWith('shine')?this.rigs.point(fighter,fighter.content.profile.boneMap[4]!,[0,0,0])
            // ftFx_SpecialHi_CreateChargeGFX spawns 1163 on TransN, CreateLaunchGFX
            // spawns 1164 on HipN; the launch flame rides the body through travel
            // and the Landing/Fall end so it reads as the original fire tail.
            :name==='firefox-charge'?this.rigs.point(fighter,fighter.content.profile.boneMap[1]!,[0,0,0])
            :name==='firefox-launch'?this.rigs.point(fighter,fighter.content.profile.boneMap[4]!,[0,0,0])
            :rotationJoint>=0?this.rigs.point(fighter,rotationJoint,[0,0,0]):[fighter.x,fighter.y,0];
          // The screw's core texture is an additive flare the TEV approximation draws opaque;
          // keep it under Samus instead of hiding her inside it.
          if(name==='screw-attack')aura.model.opacityMultiplier=.5;
          // Same story for the PSI bubble: its additive core reads opaque here and would bury Ness.
          if(name==='psi-magnet')aura.model.opacityMultiplier=.5;
          if(name.startsWith('shine')) {
            // Keep the native animation under an explicit supplemental rim.
            aura.model.opacityMultiplier=0.65;
            const data=reflector(fighter);
            if(data){const center=this.rigs.point(fighter,data.bone,data.offset);
              halo(`shine:${fighter.slot}`,'shine').update(this.camera,center[0],center[1],center[2]+0.5,data.radius*fighter.content.profile.attributes.modelScale,auraAge,s?.phase==='hit'?1:0);
            }
          }
          aura.model.group.position.set(hip[0]!,hip[1]!,hip[2]!);aura.model.group.scale.setScalar(fighter.content.profile.attributes.modelScale);
          // efLib_Cb_SetScaleRotY_FromFighter turns the screw with her facing.
          aura.model.group.rotation.y=name==='screw-attack'?(fighter.facing>=0?Math.PI/2:-Math.PI/2):0;
          aura.model.group.rotation.z=name==='firefox-launch'?(s?.aim??0)-Math.PI/2:0;
          aura.model.animationLoop=['shine-loop','firefox-charge','firefox-launch','tornado','screw-attack','psi-magnet','pk-thunder-aura','pk-thunder-2-aura','sonic-spin'].includes(name);aura.model.update(auraAge-aura.start);
          if(name==='screw-attack'){
            // lb_8000C1C0 constrains the effect's own root joint to the attach joint, so the
            // model's baked root translation (0,7.72,0) must not lift the screw off her body.
            this.scratchPoint.setFromMatrixPosition(aura.model.jointWorldMatrix(0,this.scratch));
            aura.model.group.position.x+=hip[0]!-this.scratchPoint.x;aura.model.group.position.y+=hip[1]!-this.scratchPoint.y;aura.model.group.position.z+=hip[2]!-this.scratchPoint.z;
            aura.model.group.updateMatrixWorld(true);
          }
          aura.model.applyBillboards(this.camera);
        }
      }
      if(s&&(kind==='Fx'||kind==='Fc')&&s.direction==='side'&&s.phase==='travel'&&fighter.stateFrame!==this.lastGhost[fighter.slot]){
        const ghost=fighter.content.specials.articles.ghost;
        if(ghost){this.transient(ghost.model,fighter.x,fighter.y,fighter.facing,7,fighter.slot,fighter.content.profile.attributes.modelScale);this.lastGhost[fighter.slot]=fighter.stateFrame;}
      }else if(!s||s.phase!=='travel')this.lastGhost[fighter.slot]=-1;
    }
    for(const effect of [...this.transients]){
      if((match.fighters[effect.owner]?.hitlag??0)===0)effect.age+=elapsed;
      if(effect.age>=effect.life){effect.model.dispose();this.transients.splice(this.transients.indexOf(effect),1);}else { effect.model.opacityMultiplier = Math.min(1, (effect.life-effect.age)/5); effect.model.update(effect.age); effect.model.applyBillboards(this.camera); }
    }
    for(const coin of [...this.coins]){
      coin.age+=elapsed;coin.mesh.position.x+=coin.vx*elapsed;coin.mesh.position.y+=coin.vy*elapsed;coin.vy-=0.045*elapsed;coin.mesh.rotation.z+=elapsed*0.3;
      if(coin.age>22){coin.mesh.removeFromParent();this.coins.splice(this.coins.indexOf(coin),1);}
    }
    for(const [key,item]of this.halos)if(!activeHalos.has(key)){item.dispose();this.halos.delete(key);}
    for(const [key,stroke]of this.electric)if(!activeElectric.has(key)){stroke.dispose();this.electric.delete(key);}
    this.stats.halos=this.halos.size;
    this.stats.projectiles=this.projectiles.size+this.matchItems.size;this.stats.transients=this.transients.length;this.stats.models=this.projectiles.size+this.matchItems.size+this.transients.length+this.auras.size+this.accessories.size+this.chargeOrbs.size+this.iceBlocks.size+this.hats.size+this.ko.count+this.link.stats.models;
  }
  reset():void {
    this.common.reset();this.link.reset();
    for(const item of this.judgeSigns.values())item.model.dispose();this.judgeSigns.clear();
    for(const item of this.toads.values())item.model.dispose();this.toads.clear();for(const item of this.parasols.values())item.model.dispose();this.parasols.clear();
    for(const item of this.vegetables.values())item.model.dispose();this.vegetables.clear();
    this.ko.reset();this.stats.koBeams=0;this.stats.koParticles=0;
    for(const stroke of this.electric.values())stroke.dispose();this.electric.clear();
    for(const model of this.projectiles.values())model.dispose();for(const piece of this.thunderTrail.values())piece.dispose();for(const item of this.auras.values())item.model.dispose();for(const item of this.accessories.values())item.model.dispose();for(const item of this.chargeOrbs.values())item.model.dispose();this.chargeOrbs.clear();for(const item of this.iceBlocks.values())item.model.dispose();this.iceBlocks.clear();for(const item of this.hats.values())item.model.dispose();this.hats.clear();for(const item of this.transients)item.model.dispose();
    for(const item of this.halos.values())item.dispose();this.halos.clear();this.stats.halos=0;
    for(const model of this.matchItems.values())model.dispose();this.matchItems.clear();this.matchItemSources.clear();
    this.projectiles.clear();this.projectileSources.clear();this.projectileStarts.clear();this.thunderTrail.clear();this.auras.clear();this.accessories.clear();this.chargeOrbs.clear();this.iceBlocks.clear();this.transients=[];this.previousFrame=0;this.lastGhost.fill(-1);for(const coin of this.coins)coin.mesh.removeFromParent();this.coins=[];this.projectilePoints.clear();this.itemPoints.clear();this.flameSpawned.clear();this.pointRevision=undefined;
  }
  dispose():void{this.reset();this.common.dispose();this.coinGeometry.dispose();this.coinMaterial.dispose();}
}

/** Hides every draw object under the children of `parent` except child `keep` (and, when given,
 * under that child's sub-children except `subKeep`). */
function hideRockVariants(instance:ModelInstance,model:import('../../../lib/hsd/model.ts').HsdModel,parent:number,keep:number,subKeep?:number):void {
  const root=model.roots[0];if(!root)return;
  const children=root.joints[parent]?.children??[];
  const hidden=new Set<number>();
  const collect=(joint:number)=>{hidden.add(joint);for(const child of root.joints[joint]?.children??[])collect(child);};
  children.forEach((child,index)=>{
    if(index!==keep){collect(child);return;}
    if(subKeep!==undefined)(root.joints[child]?.children??[]).forEach((sub,subIndex)=>{if(subIndex!==subKeep)collect(sub);});
  });
  for(const part of root.parts)if(hidden.has(part.owner))instance.hiddenDobjs.add(part.dobjIndex);
}

/** it_8027CE64 for Game & Watch's articles: the owner's costume colour as every diffuse
 * (it_80278574) and the outline joints (it_266F_ItemVars) drawn as the outline hull in his
 * rim colour, like the item outline pass it_8026EECC. No-op for anyone else's articles. */
function dressGamewatchArticle(instance:ModelInstance,content:FighterContent,source:HsdModel):void{
  const color=gamewatchCostume(content),rim=gamewatchRim(content);if(!color||!rim)return;
  instance.setDiffuseOverride(color);
  const joints=gamewatchArticleOutline(content,source);if(joints?.length)instance.setOutlineJoints(joints,rim);
}
