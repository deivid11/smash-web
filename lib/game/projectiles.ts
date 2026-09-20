import type { GameContent } from './load.ts';
import type { MatchFighter, MatchEvent, PoseProvider } from './match.ts';
import type { ArticleData } from './special-data.ts';
import { floorY, MAX_FLOOR_SLOPE, type FighterKind } from './data.ts';
import { activeHits, type HitDefinition } from './moves.ts';
import { linkHits, linkHitLanded } from './link.ts';
import { ITEM_COMMON } from './item-common.ts';
import { passiveLinkShield } from './link-actions.ts';
import type { V3 } from '../hsd/model.ts';
import { pointSegmentDistanceSquared, segmentDistanceSquared } from './collision.ts';
import { reflector, attackReflector, reflectSpecial, type ProjectileKind } from './specials.ts';
import { gamewatchAbsorber, gamewatchAbsorbed } from './gamewatch.ts';
import { nessAbsorber } from './ness.ts';
import { advanceNessProjectile, initializeNessProjectile, nessArticles, notifyBallGone, explodeNessFlash, type NessProjectile, type NessProjectileRuntime } from './ness-projectiles.ts';
import { advanceSonicSpring, sonicSpringData, spawnSonicSpring, type SonicSpringProjectile, type SonicSpringRuntime } from './sonic-spring.ts';
import { advanceLizardonRock, spawnLizardonBurst, spawnLizardonFlame, spawnLizardonRock, type LizardonProjectileRuntime } from './lizardon-projectiles.ts';
import { advanceBSonicSpring, spawnBSonicSpring, type BSonicSpringProjectile, type BSonicSpringRuntime } from './bsonic-projectiles.ts';
import { advanceSkullBomb, spawnSkullBomb, type SkullBombProjectile, type SkullBombRuntime } from './sd-projectiles.ts';
import { advanceDiddyBanana, bananaHits, bounceDiddyBanana, peanutTouchesStage, releaseDiddyBanana, spawnDiddyBanana, spawnDiddyPeanut, type DiddyBananaProjectile, type DiddyBananaRuntime } from './diddy-projectiles.ts';
import { DIDDY_FX } from './diddy-data.ts';
import { pikachuProjectileCenter, stepPikachuProjectile, finishPikachuProjectile, type PikachuProjectileRuntime } from './pikachu-projectiles.ts';
import { zeldaMuzzle } from './zelda.ts';
import { stepZeldaDin, type ZeldaProjectileRuntime } from './zelda-projectiles.ts';
import { needleOffsets } from './seak-data.ts';
import { stepSeakWhip, type SeakWhipRuntime } from './seak-projectiles.ts';
import { stepPopoIce } from './popo-projectiles.ts';
import { linkArticle, linkSpawnPoint, initializeLinkProjectile, advanceLinkProjectile, returnLinkBoomerang, damageLinkBomb, linkBombContact, stickLinkArrow, type LinkProjectile, type LinkProjectileRuntime } from './link-projectiles.ts';
import type { ShotIntent } from './specials.ts';
import { royCounter } from './roy.ts';
import { shieldBubble } from './combat.ts';
import { HurtboxCache, hurtSweepCandidate } from './hurt-cache.ts';

export interface Projectile { id:number;kind:ProjectileKind;owner:number;x:number;y:number;vx:number;vy:number;age:number;life:number;data:ArticleData;hit:HitDefinition;reflectionCooldown:number;victims:Set<number>;speed:number; exploded?:boolean; turn?:number; pikachu?:PikachuProjectileRuntime; zelda?:ZeldaProjectileRuntime; seak?:SeakWhipRuntime; link?:LinkProjectileRuntime; ness?:NessProjectileRuntime; sonicSpring?:SonicSpringRuntime; bsonicSpring?:BSonicSpringRuntime; lizardon?:LizardonProjectileRuntime;
  /** itKoopaFlame vars: the travel angle (from straight up), the rolled speed it keeps for life,
   * and xC_direction, the preferred heading every touched surface normal is folded into. */
  flame?:{angle:number;speed:number;dirX:number;dirY:number};
  /** Skull Kid's hitless bomb item (lib/game/sd-projectiles.ts). */
  skull?:SkullBombRuntime;
  /** Diddy's banana item (lib/game/diddy-projectiles.ts). */
  banana?:DiddyBananaRuntime;
  /** Tails' shot (PlTs itFunction:0): landed and sliding (item state 0) vs airborne (state 1), shield bounces. */
  tails?:{grounded:boolean;shieldHits:number} }
/** Article keys: a fighter kind for its own projectile, or `<kind>/copy/<source>` for a copied one. */
export interface ProjectileState { serial: number; items: Array<Omit<Projectile, 'data'> & {article: string}> }
/** Contact data must survive article transitions before LocalMatch applies it. */
export interface ProjectileImpact { projectile:Projectile;hit:HitDefinition;direction:number;victim:MatchFighter;point:V3;shield?:boolean;passiveAmount?:number;royCounter?:boolean;
  /** PlDd banana Trip_Check: the victim slips instead of taking the hit. */
  trip?:boolean }
/** Item_ClampAngleReverse: the shortest signed way round. */
const clampAngle=(angle:number):number=>{
  let value=angle;
  while(value>Math.PI)value-=Math.PI*2;
  while(value<-Math.PI)value+=Math.PI*2;
  return value;
};
export class ProjectileWorld {
  readonly items:Projectile[]=[];
  private serial=0;
  /** Team rule for items that filter rivals themselves (PlDd's banana Trip_Check). */
  allies:(a:number,b:number)=>boolean=()=>false;
  constructor(private readonly content:GameContent){}
  /** itKoopaFlame_Update_Direction/Update_Angle: every surface the flame touches folds its normal
   * into the flame's preferred heading, and the flame steers its travel angle toward that heading -
   * gently while they nearly agree, sharply once they do not. A flame that meets the ground rolls
   * along it and curls away instead of dying there. */
  private steerFlame(item:Projectile):void {
    const flame=item.flame!;
    const floor=this.content.stage.floors.find((candidate)=>item.x>=Math.min(candidate.a[0],candidate.b[0])&&item.x<=Math.max(candidate.a[0],candidate.b[0])
      &&item.y<=floorY(candidate,item.x)+1&&item.y>=floorY(candidate,item.x)-3);
    if(floor){
      const dx=floor.b[0]-floor.a[0],dy=floor.b[1]-floor.a[1],length=Math.hypot(dx,dy)||1;
      const side=dx<0?-1:1,nx=-dy/length*side,ny=dx/length*side;
      let vx=flame.dirX+nx,vy=flame.dirY+ny;
      const size=Math.hypot(vx,vy);
      if(size>1e-6){vx/=size;vy/=size;flame.dirX=Math.fround(vx);flame.dirY=Math.fround(vy);}
      const difference=clampAngle(flame.angle-Math.atan2(flame.dirX,flame.dirY));
      if(difference!==0){
        const between=Math.acos(Math.max(-1,Math.min(1,Math.sin(flame.angle)*flame.dirX+Math.cos(flame.angle)*flame.dirY)));
        const rate=Math.abs(difference)<Math.PI/2?0.02*(Math.abs(difference)/Math.PI):0.5*(Math.abs(difference)/Math.PI);
        flame.angle=Math.fround(flame.angle-between*(difference<0?-rate:rate));
      }
      item.y=Math.max(item.y,Math.fround(floorY(floor,item.x)+0.02));
    }
    item.vx=Math.fround(Math.sin(flame.angle)*flame.speed);
    item.vy=Math.fround(Math.cos(flame.angle)*flame.speed);
  }
  /** `copy` fires the owner's copied ability (Kirby): its own copy article, hand bone and launch parameters. */
  spawn(f:MatchFighter,kind:ProjectileKind,poses:PoseProvider,copy=false,charge=0,intent?:ShotIntent):Projectile {
    if(kind==='sonic-spring'){
      // Spawn_Spring: one spring per Sonic (ft_var1), the previous one is destroyed first.
      for(const old of this.items.filter((item)=>item.kind==='sonic-spring'&&item.owner===f.slot))this.remove(old);
      const item=spawnSonicSpring(++this.serial,f,sonicSpringData(f),intent?.at??[f.x,f.y],(intent?.variant??0)===0);
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='skull-bomb'){
      // fn_03e88: the bomb goes straight into Skull Kid's hand (ft_var52).
      const item=spawnSkullBomb(++this.serial,f,poses);
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='bsonic-spring'){
      // M347_Anim → ptr_03678+8: no cap on springs; a grounded SpecialHi retires the old ones (ft_var43).
      const item=spawnBSonicSpring(++this.serial,f,intent?.at??[f.x,f.y],(intent?.variant??0)===0);
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='arrow'||kind==='boomerang'||kind==='link-bomb'){
      // A copied bow (Kirby) fires the source Link's arrow with its full article machinery.
      const source=copy&&(f.copyAbility==='Lk'||f.copyAbility==='Cl')?this.content.roster.get(f.copyAbility):undefined;
      const content=source??f.content;
      const p=content.specials.parameters;
      if(p.kind!=='Lk'&&p.kind!=='Cl')throw new Error('Only a Link fighter fires Link articles.');
      const data=linkArticle(content.specials.articles,kind), point=source?poses.point(f,f.content.profile.boneMap[21]!,[0,0,0]):linkSpawnPoint(f,kind,poses);
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:0,vy:0,age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      initializeLinkProjectile(item as LinkProjectile,f,p,f.link,{player:f.slot,kind,charge:intent?.charge,rawCharge:intent?.rawCharge,aim:intent?.aim,fast:intent?.fast});
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='koopa-flame'||kind==='turnip'||kind==='toad-spore'||kind==='peach-blast'){
      const p=f.content.specials.parameters,scale=f.content.profile.attributes.modelScale;
      if(kind==='koopa-flame'){
        if(p.kind!=='Kp'&&p.kind!=='Gk')throw new Error('Only Bowser breathes flames.');
        const flame=f.content.specials.articles.koopa!,data=flame.flame;
        // itKoopaFlame_Spawn: the pool scales the roll (x222C / da->x10), the speed and angle are
        // rolled inside the article's own bounds, and the angle is measured from straight up and
        // mirrored by facing. No gravity or decay: the flame holds that velocity for its lifetime.
        const pool=Math.max(0,Math.min(1,charge/p.breath.maxStrength));
        const speed=Math.fround(pool*(flame.speed[0]+(flame.speed[1]-flame.speed[0])*this.content.physics.random()));
        const angle=Math.fround((flame.angle[0]+(flame.angle[1]-flame.angle[0])*this.content.physics.random())*f.facing);
        // itKoopaFlame_UnkMotion0_Anim rescales the hitbox by the same pool ratio every frame, so a
        // draining breath burns a thinner and thinner stream.
        const hit={...data.hit!,radius:Math.fround(data.hit!.radius*pool)};
        const item:Projectile={id:++this.serial,kind,owner:f.slot,x:Math.fround(f.x+13*scale*f.facing),y:Math.fround(f.y+10.5*scale),vx:Math.fround(Math.sin(angle)*speed),vy:Math.fround(Math.cos(angle)*speed),age:0,life:Math.ceil(data.lifetime),data,hit,reflectionCooldown:0,victims:new Set(),speed:0,flame:{angle,speed,dirX:f.facing,dirY:0}};
        if(this.items.length>=32)this.items.shift();this.items.push(item);
        return item;
      }
      if(p.kind!=='Pe'&&p.kind!=='Da')throw new Error('Only the Peach kit fires her articles.');
      const articles=f.content.specials.articles.peach!;
      if(kind==='turnip'){
        const face=Math.max(0,Math.min(articles.turnip.faces.length-1,Math.trunc(charge)));
        const spec=intent??{player:f.slot,kind};
        const angle=spec.aim??0.9,speed=spec.rawCharge??1.6;
        const item:Projectile={id:++this.serial,kind,owner:f.slot,x:Math.fround(f.x+3*scale*f.facing),y:Math.fround(f.y+9*scale),vx:Math.fround(Math.cos(angle)*speed*f.facing),vy:Math.fround(Math.sin(angle)*speed),age:0,life:Math.ceil(articles.turnip.lifetime),data:articles.turnip,hit:{...(articles.turnip.hit??articles.spore.hit!),damage:articles.turnip.faces[face]!.damage},reflectionCooldown:0,victims:new Set(),speed:0,turn:face};
        if(this.items.length>=32)this.items.shift();this.items.push(item);
        return item;
      }
      if(kind==='toad-spore'){
        // it_802BE2E8: speed x0 + x4·rand, angle 0.5(π − xC) + xC·rand from vertical, life 60,
        // spawned at FtPart 109 + 2.5 y (onHitAccessory4).
        const data=articles.spore,part=f.content.profile.partJoints[109];
        const at:V3=part!==undefined&&part>=0?poses.point(f,part,[0,0,0]):[f.x+5*scale*f.facing,f.y+9*scale,0];
        const speed=Math.fround(data.minSpeed+data.speedRange*this.content.physics.random());
        const angle=Math.fround(0.5*(Math.PI-data.cone)+data.cone*this.content.physics.random());
        const item:Projectile={id:++this.serial,kind,owner:f.slot,x:Math.fround(at[0]),y:Math.fround(at[1]+2.5),vx:Math.fround(f.facing*speed*Math.sin(angle)),vy:Math.fround(speed*Math.cos(angle)),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
        if(this.items.length>=32)this.items.shift();this.items.push(item);
        return item;
      }
      // doPostEnd: it_802BD158 drops the Bomber explosion on the HipN joint (z flattened).
      const data=articles.explosion,hip=f.content.profile.partJoints[4];
      const at:V3=hip!==undefined&&hip>=0?poses.point(f,hip,[0,0,0]):[f.x+6*scale*f.facing,f.y+8*scale,0];
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:Math.fround(at[0]),y:Math.fround(at[1]),vx:0,vy:0,age:0,life:12,data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='pk-fire'||kind==='pk-fire-pillar'||kind==='pk-flash'||kind==='pk-thunder'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Ns')throw new Error('Only Ness fires PSI articles.');
      const articles=nessArticles(this.content);
      const data=kind==='pk-fire'?articles.fire:kind==='pk-fire-pillar'?articles.pillar:kind==='pk-flash'?articles.flash:articles.ball;
      const scale=f.content.profile.attributes.modelScale;
      // ftNs_SpecialS_ItemPKFireSpawn reads the FtPart_R2ndNa joint and offsets it in world
      // space, so the bolt leaves Ness's hand at the pose's own height instead of a fixed one.
      const hand=f.content.profile.partJoints[42];
      const handPoint=kind==='pk-fire'&&hand!==undefined&&hand>=0?poses.point(f,hand,[0,0,0]):null;
      const point:V3=kind==='pk-fire'
        ?handPoint?[Math.fround(handPoint[0]+p.fire.spawnX*f.facing*scale),Math.fround(handPoint[1]+p.fire.spawnY*scale),0]
          :[Math.fround(f.x+p.fire.spawnX*f.facing*scale),Math.fround(f.y+p.fire.spawnY*scale+3),0]
        :[f.x,Math.fround(f.y+9*scale),0];
      const hit=data.hit??articles.explosion.hit!;
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:0,vy:0,age:0,life:Math.ceil(data.lifetime),data,hit:{...hit,...(kind==='pk-flash'?{damage:0,radius:0}:{})},reflectionCooldown:0,victims:new Set(),speed:0};
      initializeNessProjectile(item as NessProjectile,f,articles);
      if(kind==='pk-fire'){
        const angle=f.grounded?p.fire.groundAngle:p.fire.airAngle,speed=f.grounded?p.fire.groundSpeed:p.fire.airSpeed;
        item.vx=Math.fround(Math.cos(angle)*speed*f.facing);item.vy=Math.fround(Math.sin(angle)*speed);
      }
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='iceball'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Td')throw new Error('Only Toad throws ice balls.');
      const toad=f.content.specials.articles.toad;
      if(!toad)throw new Error('Toad ice articles are missing.');
      const data=toad.ice;
      const point=poses.point(f,f.content.profile.boneMap[40]!,[0,0,2]);
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos(p.neutral.shotAngle)*p.neutral.shotSpeed*f.facing),vy:Math.fround(Math.sin(p.neutral.shotAngle)*p.neutral.shotSpeed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='raichu-jolt'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Rc')throw new Error('Only Raichu fires jolts.');
      const data=f.content.specials.articles.projectile;
      if(!data?.hit)throw new Error('Raichu jolt article is missing.');
      // PlRc accessory callback (SpecialN): the jolt leaves fighter part 14's world position.
      const point=poses.point(f,f.content.profile.partJoints[14]!,[0,0,0]);
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos(data.angle)*data.speed*f.facing),vy:Math.fround(Math.sin(data.angle)*data.speed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='lizardon-flame'||kind==='lizardon-rock'||kind==='lizardon-burst'){
      const random=()=>this.content.physics.random();
      // SpecialLw_Enter only spawns a rock while ft_var8 is empty.
      const held=kind==='lizardon-rock'?this.items.find((item)=>item.kind==='lizardon-rock'&&item.owner===f.slot):undefined;
      if(held)return held;
      const item=kind==='lizardon-flame'?spawnLizardonFlame(++this.serial,f,poses,random,intent??{player:f.slot,kind}):kind==='lizardon-rock'?spawnLizardonRock(++this.serial,f,poses):spawnLizardonBurst(++this.serial,f,poses,random);
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='wolf-laser'){
      const p=f.content.specials.parameters,wolf=f.content.specials.articles.wolf;
      if(p.kind!=='Wf')throw new Error('Only Wolf fires the wolf laser.');
      if(!wolf?.laser.hit)throw new Error('Wolf laser article is missing.');
      // fn_0281c: item 0 at the held gun's joint 5 (Item_Hold on FtPart 0x43), aimed by facing;
      // itFunction:0 gives it a 25-frame life and rewrites its velocity at 2.3 every frame.
      const point=poses.point(f,f.content.profile.partJoints[p.neutral.gunPart]!,wolf.muzzle);
      const speed=p.neutral.laserSpeed,data=wolf.laser;
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(speed*f.facing),vy:0,age:0,life:p.neutral.laserLife,data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='diddy-peanut'){
      // PlDd Gun_Shoot: item 1 from the popgun's joint 7; its life is the ItCo default (x30).
      const item=spawnDiddyPeanut(++this.serial,f,poses,intent,this.content.items?.common.lifetime??1200);
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='diddy-banana'){
      // Banana_Spawn (variant 0) puts it in Diddy's hand; Banana_Release (variant 1) tosses it.
      const held=this.items.find((item):item is DiddyBananaProjectile=>item.kind==='diddy-banana'&&item.owner===f.slot&&item.banana?.state===3);
      if((intent?.variant??0)===1){if(held)releaseDiddyBanana(held,f,poses);if(held)return held;}
      if(held)return held;
      const item=spawnDiddyBanana(++this.serial,f,poses);
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='dedede-gordo'){
      const p=f.content.specials.parameters;
      if(p.kind!=='De')throw new Error('Only Dedede throws Gordos.');
      const data=f.content.specials.articles.dedede?.gordo;
      if(!data?.hit)throw new Error('Dedede Gordo article is missing.');
      const point=poses.point(f,f.content.profile.boneMap[40]!,[0,0,2]);
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos(p.side.shotAngle)*p.side.shotSpeed*f.facing),vy:Math.fround(Math.sin(p.side.shotAngle)*p.side.shotSpeed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='blastoise-water'||kind==='blastoise-spray'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Bl')throw new Error('Only Blastoise sprays water.');
      const data=kind==='blastoise-water'?f.content.specials.articles.blastoise?.water:f.content.specials.articles.blastoise?.spray;
      if(!data?.hit)throw new Error('Blastoise water article is missing.');
      const point=poses.point(f,f.content.profile.boneMap[40]!,[0,0,2]);
      const shot=kind==='blastoise-water'?p.neutral:p.down;
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos((shot as {shotAngle:number}).shotAngle)*(shot as {shotSpeed:number}).shotSpeed*f.facing),vy:Math.fround(Math.sin((shot as {shotAngle:number}).shotAngle)*(shot as {shotSpeed:number}).shotSpeed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='lucas-freeze'||kind==='lucas-fire'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Lc')throw new Error('Only Lucas fires PK.');
      const data=kind==='lucas-freeze'?f.content.specials.articles.lucas?.freeze:f.content.specials.articles.lucas?.fire;
      if(!data?.hit)throw new Error('Lucas PK article is missing.');
      const scale=f.content.profile.attributes.modelScale;
      const point:V3=kind==='lucas-fire'?[Math.fround(f.x+5*scale*f.facing),Math.fround(f.y+5*scale),0]:poses.point(f,f.content.profile.boneMap[40]!,[0,0,2]);
      // ftNs_SpecialS_ItemPKFireSpawn's trajectory pair: the aerial shot leaves on its own
      // steeper angle, which the clones inherit along with the attribute block it comes from.
      const angle=kind==='lucas-fire'?(f.grounded?p.side.shotAngle:p.side.airAngle):0;
      const speed=kind==='lucas-fire'?(f.grounded?p.side.shotSpeed:p.side.airSpeed):2.4;
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos(angle)*speed*f.facing),vy:Math.fround(Math.sin(angle)*speed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='metal-shot'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Nm')throw new Error('Only Metal Sonic fires the shot.');
      const data=f.content.specials.articles.metal?.shot;
      if(!data?.hit)throw new Error('Metal shot article is missing.');
      // PlNm ptr_04ffc / ptr_053e8: item 0 from fp->parts[22], flying (±speed, 0) with no Phys;
      // the strong shot lives the article's x0, the weak one (intent variant 1) a fixed 8 frames.
      const weak=intent?.variant===1, n=p.neutral, point=poses.point(f,f.content.profile.partJoints[n.bone]!,[0,0,0]);
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround((weak?n.weakSpeed:n.strongSpeed)*f.facing),vy:0,age:0,life:Math.ceil(weak?n.weakLife:data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='chunli-kiko'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Cn')throw new Error('Only Chun-Li throws Kikokens.');
      const data=f.content.specials.articles.chunli?.kiko;
      if(!data?.hit)throw new Error('Chun-Li Kikoken article is missing.');
      const point=poses.point(f,f.content.profile.boneMap[40]!,[0,0,2]);
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos(p.neutral.shotAngle)*p.neutral.shotSpeed*f.facing),vy:Math.fround(Math.sin(p.neutral.shotAngle)*p.neutral.shotSpeed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='fay-laser'||kind==='fay-sniper'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Fy')throw new Error('Only Fay fires her guns.');
      const data=kind==='fay-laser'?f.content.specials.articles.fay?.laser:f.content.specials.articles.fay?.sniper;
      if(!data?.hit)throw new Error('Fay gun article is missing.');
      const point=poses.point(f,f.content.profile.boneMap[49]!,[0,1.2325000762939453,4.263599872589111]);
      const shot=kind==='fay-laser'?p.neutral:p.side;
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos((shot as {shotAngle:number}).shotAngle)*(shot as {shotSpeed:number}).shotSpeed*f.facing),vy:Math.fround(Math.sin((shot as {shotAngle:number}).shotAngle)*(shot as {shotSpeed:number}).shotSpeed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='tails-shot'){
      // SpecialN_SpawnProjectile: FtPart 0x34, item state 1, self_vel = (x8·facing, 0), life x0 (+ x4 fade).
      const data=f.content.specials.articles.tails?.shot;
      if(!data?.hit)throw new Error('Tails shot article is missing.');
      const part=f.content.profile.partJoints[0x34];
      const point:V3=part!==undefined&&part>=0?poses.point(f,part,[0,0,0]):[f.x+4*f.facing,f.y+6,0];
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:Math.fround(point[0]),y:Math.fround(point[1]),vx:Math.fround(data.speed*f.facing),vy:0,age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0,tails:{grounded:false,shieldHits:0}};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='ninten-pellet'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Nt')throw new Error('Only Ninten fires pellets.');
      const data=f.content.specials.articles.ninten?.pellet;
      if(!data?.hit)throw new Error('Ninten pellet article is missing.');
      const scale=f.content.profile.attributes.modelScale;
      const point:V3=[Math.fround(f.x+5*scale*f.facing),Math.fround(f.y+5*scale),0];
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(p.side.shotSpeed*f.facing),vy:0,age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='ice-shot'||kind==='blizzard'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Pp')throw new Error('Only Popo throws ice and blizzards.');
      const data=kind==='ice-shot'?f.content.specials.articles.projectile:f.content.specials.articles.accessory;
      if(!data?.hit)throw new Error('Original Popo article is missing.');
      const scale=f.content.profile.attributes.modelScale;
      // Ice leaves the hammer head level; blizzard sprays from L3rdNa (part 26)
      // plus the xBC/xC0 offsets (falls back down the finger chain if unmapped).
      const joints=[26,21].map((part)=>f.content.profile.partJoints[part]).find((joint)=>joint!==undefined&&joint>=0) ?? f.content.profile.shieldBone;
      const point:V3=kind==='blizzard'?poses.point(f,joints,[Math.fround(p.down.offsetX*f.facing),Math.fround(p.down.offsetY),0]):[Math.fround(f.x+5*scale*f.facing),Math.fround(f.y+5*scale),0];
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:0,vy:0,age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(kind==='ice-shot'){item.vx=Math.fround(p.ice.startSpeed*f.facing);item.vy=0;}
      else{
        // itClimbersBlizzard spray cone around straight-down-forward (sim RNG).
        const range=p.blizzard.coneHi-p.blizzard.coneLo;
        const temp=Math.fround(p.blizzard.coneLo+this.content.physics.random()*range);
        const aim=(f.facing>0?temp:-temp)-Math.PI/2;
        item.vx=Math.fround(p.blizzard.speed*Math.cos(aim));item.vy=Math.fround(p.blizzard.speed*Math.sin(aim));
      }
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='dins-fire'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Zd')throw new Error('Only Zelda fires Din\u2019s.');
      const zelda=f.content.specials.articles.zelda;
      if(!zelda)throw new Error('Din articles are missing.');
      const scale=f.content.profile.attributes.modelScale;
      // Spawn at the part-89 muzzle plus the x20/x24 offsets (exact helper).
      const point=poses.point(f,zeldaMuzzle(f),[Math.fround(p.side.spawnFwd*f.facing*scale),Math.fround(p.side.spawnUp*scale),0]);
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(p.dins.startSpeed*f.facing),vy:0,age:0,life:Math.ceil(p.dins.travelLife),data:zelda.travel,hit:{id:0,group:0,bone:0,damage:0,radius:2,offset:[0,0,0],angle:0,growth:0,weightSet:0,base:0,grounded:false,airborne:false},reflectionCooldown:0,victims:new Set(),speed:0};
      // Inert travel capsule: impacts skip unexploded Din's (mirrors PK Flash).
      item.zelda={sourceOwner:f.slot,serial:f.special?.serial??0,frames:0,exploded:false,angle:0,speed:p.dins.startSpeed,spawnFacing:f.facing};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='needles'||kind==='chain-whip'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Sk')throw new Error('Only Sheik throws needles and chains.');
      const seak=f.content.specials.articles.seak;
      if(!seak)throw new Error('Sheik articles are missing.');
      const scale=f.content.profile.attributes.modelScale;
      if(kind==='needles'){
        // One needle per shot (the step pushes one intent per stored needle):
        // forward offset by grounded state, Y from the scale table + base.
        const rand=this.content.physics.random();
        const table=needleOffsets();
        const pick=table[Math.min(table.length-1,Math.floor(rand*table.length))]!;
        const data=seak.needles;
        if(!data.hit)throw new Error('Sheik needle has no hit definition.');
        const point:V3=f.grounded
          ?[Math.fround(f.x+p.neutral.groundFwd*scale*f.facing),Math.fround(f.y+(p.neutral.groundBaseY+pick)*scale),0]
          :[Math.fround(f.x+p.neutral.airFwd*scale*f.facing),Math.fround(f.y+(2*pick+p.neutral.airBaseY)*scale),0];
        const airy=!f.grounded;
        const base=airy?2.3561945:1.5707964;
        const angle=f.facing*base+Math.PI/2;
        const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(-data.speed*Math.cos(angle)),vy:Math.fround(data.speed*Math.sin(angle)),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
        if(this.items.length>=32)this.items.shift();this.items.push(item);
        return item;
      }
      // Chain whip: the article tip hit (radius ~10) covers the extended links,
      // so the item anchors one radius ahead and keeps the script's tip height.
      const data=seak.chain;
      const tip=data.hit;
      if(!tip)throw new Error('Sheik chain tip has no hit definition.');
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:Math.fround(f.x+tip.radius*f.facing),y:Math.fround(f.y+tip.offset[1]),vx:0,vy:0,age:0,life:120,data,hit:{...tip,offset:[0,0,0]},reflectionCooldown:0,victims:new Set(),speed:0};item.seak={sourceOwner:f.slot,serial:f.special?.serial??0,reach:tip.radius,tipY:tip.offset[1]};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='sausage'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Gw')throw new Error('Only Game & Watch flips sausages.');
      const gw=f.content.specials.articles.gamewatch;
      if(!gw)throw new Error('Sausage articles are missing.');
      // Pan flip from LThumbNb (part 31) plus the (2.5, 6.5) offset.
      const joints=[31].map((part)=>f.content.profile.partJoints[part]).find((joint)=>joint!==undefined&&joint>=0) ?? f.content.profile.shieldBone;
      const point=poses.point(f,joints,[Math.fround(2.5*f.facing),6.5,0]);
      const arc=p.sausage.arcs[intent?.variant ?? 0] ?? p.sausage.arcs[0]!;
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(arc.vx*f.facing),vy:Math.fround(arc.vy),age:0,life:Math.ceil(p.sausage.life),data:gw.sausage,hit:{...gw.sausage.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='yoshi-egg'||kind==='yoshi-star'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Ys')throw new Error('Only Yoshi throws eggs and stars.');
      const ys=f.content.specials.articles.yoshi;
      if(!ys)throw new Error('Yoshi articles are missing.');
      const scale=f.content.profile.attributes.modelScale;
      if(kind==='yoshi-egg'){
        // Thrown with the step-computed angle/speed; spawns at part-31 hand.
        const joints=[31].map((part)=>f.content.profile.partJoints[part]).find((joint)=>joint!==undefined&&joint>=0) ?? f.content.profile.shieldBone;
        const point=poses.point(f,joints,[Math.fround(p.hi.spawnX*f.facing*scale),Math.fround(p.hi.spawnY*scale),0]);
        const speed=intent?.rawCharge ?? p.hi.speedBase, angle=intent?.aim ?? Math.PI/2;
        const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos(angle)*speed),vy:Math.fround(Math.sin(angle)*speed),age:0,life:Math.ceil(p.eggLife),data:ys.egg,hit:{...ys.egg.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
        if(this.items.length>=32)this.items.shift();this.items.push(item);
        return item;
      }
      // Bomb stars burst both ways from TransN plus the star offset.
      const dir=intent?.variant===0?-1:1;
      const point:V3=[Math.fround(f.x+dir*p.stars.offsetX*scale),Math.fround(f.y+p.stars.offsetY*scale),0];
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(p.stars.speed*dir),vy:Math.fround(p.stars.spawnVY),age:0,life:600,data:ys.star,hit:{...ys.star.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    if(kind==='buster'||kind==='buster-charged'){
      const p=f.content.specials.parameters;
      if(p.kind!=='Zx')throw new Error('Only Zero fires the Z-Buster.');
      const zero=f.content.specials.articles.zero;
      if(!zero)throw new Error('Zero buster articles are missing.');
      const data=kind==='buster'?zero.shot:zero.charged;
      // Muzzle: right hand (common part 40 of the Link5K table) plus a forward offset.
      const point=poses.point(f,f.content.profile.boneMap[40]!,[0,0,2.5]);
      const speed=kind==='buster'?p.neutral.shotSpeed:p.neutral.chargedSpeed;
      const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(speed*f.facing),vy:0,age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
      if(this.items.length>=32)this.items.shift();this.items.push(item);
      return item;
    }
    const copied=copy&&f.copyAbility?f.content.copies?.[f.copyAbility as import('./special-data.ts').CopySource]:undefined;
    if(copy&&!copied)throw new Error('The fighter has no copied ability to fire.');
    const samus=f.content.specials.articles.samus;
    const pk=f.content.specials.articles.pikachu;
    const mewtwo=f.content.specials.articles.mewtwo;
    // Copies beyond Fox/Mario fire the source fighter's own article (charge shot, shadow ball, jolt).
    const level=Math.max(0,Math.min(7,Math.floor(charge)));
    const copyData=copied?(copied.projectile??(kind==='charge'?copied.sourceArticles.samus?.charges[level]:kind==='shadow-ball'?copied.sourceArticles.mewtwo?.charges[level]:copied.sourceArticles.projectile)):undefined;
    const data=copied ? copyData : kind==='shadow-ball'&&mewtwo ? mewtwo.charges[level]! : kind==='disable'&&mewtwo ? mewtwo.disable : kind==='thunder'&&pk ? pk.thunder : samus ? kind==='charge'?samus.charges[level]!:kind==='missile'?samus.missile:kind==='super-missile'?samus.superMissile:kind==='bomb'?samus.bomb:f.content.specials.articles.projectile : f.content.specials.articles.projectile;
    if(!data?.hit)throw new Error('Original projectile has no hit definition.');
    const params=f.content.specials.parameters;
    // it_8029BAB8: Kirby's cutter beam starts on the floor in front of TransN (part 0) and rides it.
    // ftKb_SpecialNFx_800FDF30: the copied blaster fires from fighter part 44 (R3rdNa); fn_800F9260 spawns the copy fireball at LHandN.
    const point:V3=(params.kind==='Pk'||params.kind==='Pc'||params.kind==='Rc') ? kind==='thunder' ? [f.x, Math.fround(f.y+params.down.height), 0] : [Math.fround(f.x+(f.grounded?params.neutral.groundX:params.neutral.airX)*f.facing*f.content.profile.attributes.modelScale),Math.fround(f.y+(f.grounded?params.neutral.groundY:params.neutral.airY)*f.content.profile.attributes.modelScale),0]
      :params.kind==='Ss'?kind==='bomb'?[Math.fround(f.x+params.down.spawn[0]*f.facing),Math.fround(f.y+params.down.spawn[1]),0]:kind==='charge'?poses.point(f,f.content.profile.partJoints[51]!,[0,0,0]):poses.point(f,f.content.profile.partJoints[56]!,[0,0,0])
      // ftMt: the ball launches from RShoulderN (common part 35) +2 forward; Disable leaves
      // L3rdNb (common part 27) plus the attribute offsets (ftMt_SpecialLw_CreateDisable).
      // Shadow Mewtwo shares both muzzle conventions with Mewtwo.
      :params.kind==='Mt'||params.kind==='Sm'?(kind==='shadow-ball'?poses.point(f,f.content.profile.boneMap[35]!,[0,0,2])
      :[Math.fround(poses.point(f,f.content.profile.boneMap[27]!,[0,0,0])[0]+params.down.offsetX*f.facing),Math.fround(poses.point(f,f.content.profile.boneMap[27]!,[0,0,0])[1]+params.down.offsetY),0])
      :kind==='cutter'&&params.kind==='Kb'?[Math.fround(f.x+params.cutter.spawnX*f.facing),Math.fround(f.y+params.cutter.spawnY),0]
      :copied&&params.kind==='Kb'?(kind==='laser'?poses.point(f,f.content.profile.partJoints[44]!,params.copyLaser.offset):poses.point(f,f.content.profile.boneMap[21]!,[0,0,0]))
      :poses.point(f,f.content.profile.boneMap[kind==='laser'?49:23]!,kind==='laser'?[0,1.2325000762939453,4.263599872589111]:[0,0,0]);
    if(params.kind==='Ss'&&(kind==='missile'||kind==='super-missile'))point[0]=Math.fround(point[0]+params.side.spawnX*f.facing);
    const speed=copied&&params.kind==='Kb'&&kind==='laser'?params.copyLaser.speed:(kind==='laser'&&(params.kind==='Fx'||params.kind==='Fc'))?params.neutral.speed:data.speed;
    const angle=copied&&params.kind==='Kb'&&kind==='laser'?params.copyLaser.angle:(kind==='laser'&&(params.kind==='Fx'||params.kind==='Fc'))?params.neutral.angle:data.angle;
    const item:Projectile={id:++this.serial,kind,owner:f.slot,x:point[0],y:point[1],vx:Math.fround(Math.cos(angle)*speed*f.facing),vy:Math.fround(Math.sin(angle)*speed),age:0,life:Math.ceil(data.lifetime),data,hit:{...data.hit},reflectionCooldown:0,victims:new Set(),speed:kind==='cutter'||kind==='tjolt'?speed:0};
    if (kind==='bomb'&&samus) {item.vy=samus.bombLaunchY;item.exploded=false;}
    if (kind==='missile'||kind==='super-missile') item.turn=0;
    if (((params.kind==='Pk'||params.kind==='Pc'||params.kind==='Rc')&&(kind==='tjolt'||kind==='thunder'))||(copied&&kind==='tjolt')) {
      item.pikachu={sourceOwner:f.slot,serial:f.special?.serial??0,segment:0,delay:0,grounded:false,stopY:null,stopped:false,collapse:0,scale:1,anchorX:point[0],anchorY:point[1],waveFrame:0,facing:f.facing};
      if(kind==='thunder'&&(params.kind==='Pk'||params.kind==='Pc'||params.kind==='Rc')) { item.vx=0;item.vy=params.down.speed; }
    }
    if(this.items.length>=32)this.items.shift();this.items.push(item);
    if(kind==='thunder'&&(params.kind==='Pk'||params.kind==='Pc'||params.kind==='Rc')) for(let segment=1;segment<params.down.count;segment++) {
      const child:Projectile={...item,id:++this.serial,hit:{...item.hit},victims:new Set(),pikachu:{...item.pikachu!,segment,delay:segment*params.down.delay}};
      if(this.items.length>=32)this.items.shift();this.items.push(child);
    }
    return item;
  }
  step(fighters:readonly MatchFighter[],poses:PoseProvider,events:MatchEvent[],frozen?:readonly boolean[]):ProjectileImpact[] {
    const impacts:ProjectileImpact[]=[],hurtCache=new HurtboxCache(poses);
    this.strikeBombs(fighters,poses,events,frozen);
    for(const item of [...this.items]){
      if(item.pikachu && item.pikachu.delay>0){item.pikachu.delay--;continue;}
      item.age++;item.life--;item.reflectionCooldown=Math.max(0,item.reflectionCooldown-1);
      if(item.life<=0&&!item.link&&!item.ness&&!item.sonicSpring){if(item.kind==='bomb'&&!item.exploded)this.explodeBomb(item);else {finishPikachuProjectile(item,fighters);this.remove(item);continue;}}
      const facing=Math.sign(item.vx)||1;
      // itKirbyCutterBeam: the hit capsule sits above/behind the beam origin along its facing.
      const center=(x:number,y:number):V3=>item.pikachu?pikachuProjectileCenter(item,x,y):item.kind==='cutter'?[Math.fround(x+facing*item.hit.offset[2]),Math.fround(y+item.hit.offset[1]),0]:[x,y,0];
      const previous:V3=center(item.x,item.y);
      if(item.link){
        const ownerContent=this.content.roster.get(item.link.sourceKind), p=ownerContent?.specials.parameters, articles=ownerContent?.specials.articles.link;
        if(!p||(p.kind!=='Lk'&&p.kind!=='Cl')||!articles)throw new Error('Link projectile content is missing.');
        const source=fighters[item.link.sourceOwner],oldPhase=item.link.phase;
        if(item.kind==='arrow'&&item.link.phase==='stuck'&&item.link.stuckTo!==null){
          const attached=fighters[item.link.stuckTo];if(!attached||['ko','respawn'].includes(attached.state)){this.remove(item);continue;}
          const center=poses.point(attached,attached.content.profile.shieldBone,[0,0,0]);item.x=center[0]+item.link.stuckOffset[0];item.y=center[1]+item.link.stuckOffset[1];
        }
        const advanced=advanceLinkProjectile(item as LinkProjectile,p,articles,source,source?.link,source?.special?.link??source?.link.itemThrow??undefined,this.content,poses);
        if(advanced.remove){this.remove(item);continue;}
        if(item.kind==='link-bomb'&&oldPhase!=='explosion'&&item.link.phase==='explosion'){
          events.push({type:'gfx',player:item.owner,x:item.x,y:item.y,effect:0x40e,facing:1});
          events.push({type:'sound',player:item.owner,x:item.x,y:item.y,sound:0x74,volume:127,pan:64});
        }
        if(item.kind==='arrow'&&oldPhase!=='stuck'&&item.link.phase==='stuck')events.push({type:'sound',player:item.owner,x:item.x,y:item.y,sound:p.kind==='Lk'?0x27152:0x111c2,volume:127,pan:64});
        if(item.kind==='boomerang'&&item.link.phase!=='caught'&&(item.age-1)%Math.max(1,Math.ceil(p.boomerang.soundPeriod))===0)events.push({type:'sound',player:item.owner,x:item.x,y:item.y,sound:p.kind==='Lk'?0x2715b:0x111cb,volume:127,pan:64});
        if(!advanced.active)continue;
      }
      if(item.sonicSpring){
        if(!advanceSonicSpring(item as SonicSpringProjectile,fighters,this.content,events)){this.remove(item);continue;}
        // Idle and Fall move themselves and carry no hit; Rebound falls through the shared loop.
        if(item.sonicSpring.phase!=='rebound')continue;
      }
      if(item.skull){
        // Held, flying, stuck, armed or exploding, the bomb never carries a hit.
        if(!advanceSkullBomb(item as SkullBombProjectile,fighters[item.owner],this.content,poses,events))this.remove(item);
        continue;
      }
      if(item.banana){
        const next=advanceDiddyBanana(item as DiddyBananaProjectile,fighters,this.content,poses,this.allies);
        if(!next.alive){this.remove(item);continue;}
        if(next.trip)impacts.push({projectile:item,hit:{...item.hit},direction:next.trip.facing,victim:next.trip,point:[item.x,item.y,0],trip:true});
        // Only the airborne states carry the 3% box; they sweep it below from where they were.
        if(!bananaHits(item as DiddyBananaProjectile))continue;
      }
      if(item.bsonicSpring){
        if(!advanceBSonicSpring(item as BSonicSpringProjectile,fighters,this.content,events)){this.remove(item);continue;}
        // The grounded spring carries no hit; the airborne one sweeps its state-1 hitbox.
        if(item.bsonicSpring.phase==='idle')continue;
      }
      if(item.ness){
        if(!advanceNessProjectile(item as NessProjectile,fighters,nessArticles(this.content),this.content)){this.remove(item);continue;}
      }
      if(item.kind==='lizardon-rock'){if(!advanceLizardonRock(item,fighters,poses))this.remove(item);continue;}
      if((item.kind==='missile'||item.kind==='super-missile')) {
        const p=this.content.roster.get('Ss')?.specials.parameters;
        if(p?.kind==='Ss') {
          if(item.kind==='super-missile'&&item.age>=p.missile.delay) item.vx=Math.fround(facing*Math.min(p.missile.maxSpeed,Math.abs(item.vx)+p.missile.accel));
          else if(item.kind==='missile'&&item.age<=p.missile.homingFrames) {
            // Prototype target selection: nearest live opponent ahead; original turn bounds/speed.
            const target=fighters.filter(f=>f.slot!==item.owner&&f.stocks>0&&!['ko','respawn'].includes(f.state)&&(f.x-item.x)*facing>0).sort((a,b)=>Math.hypot(a.x-item.x,a.y+8-item.y)-Math.hypot(b.x-item.x,b.y+8-item.y)||a.slot-b.slot)[0];
            if(target){const desired=Math.atan2(target.y+8-item.y,Math.abs(target.x-item.x));const delta=desired-(item.turn??0);if(Math.abs(delta)>p.missile.deadAngle)item.turn=Math.max(-p.missile.maxAngle,Math.min(p.missile.maxAngle,(item.turn??0)+Math.sign(delta)*p.missile.turn));}
            item.vx=Math.fround(facing*item.data.speed*Math.cos(item.turn??0));item.vy=Math.fround(item.data.speed*Math.sin(item.turn??0));
          } else if(item.kind==='missile'&&Math.hypot(item.vx,item.vy)>p.missile.minimum){item.vx=Math.fround(item.vx*p.missile.decay);item.vy=Math.fround(item.vy*p.missile.decay);}
        }
      }
      if(item.tails){
        // itFunction:0 state 0 (landed): no gravity, vy 0, and Item_CollGround_PassLedge hands a shot
        // that slid off the floor back to state 1; state 1: Item_ProjectileVelocityCalculate on the
        // article's common gravity/terminal.
        if(item.tails.grounded){
          item.vy=0;
          if(!this.content.stage.floors.some((floor)=>item.x>=Math.min(floor.a[0],floor.b[0])&&item.x<=Math.max(floor.a[0],floor.b[0])&&Math.abs(floorY(floor,item.x)-item.y)<0.5))item.tails.grounded=false;
        }
        if(!item.tails.grounded){const velocity=this.content.physics.customAir(item.owner,{x:item.vx,y:item.vy},item.data.gravity,item.data.terminal,0);item.vx=velocity.x;item.vy=velocity.y;}
      }
      if(item.kind==='turnip') {
        const velocity=this.content.physics.customAir(item.owner,{x:item.vx,y:item.vy},item.data.gravity||0.06,item.data.terminal||2.4,0);item.vx=velocity.x;item.vy=velocity.y;
      }
      // itPeachtoadspore_UnkMotion0_Phys: no gravity, velocity scaled by x8 every frame.
      if(item.kind==='toad-spore'){const decay=(item.data as {decay?:number}).decay??1;item.vx=Math.fround(item.vx*decay);item.vy=Math.fround(item.vy*decay);}
      if(item.kind==='fireball'||item.kind==='iceball'||item.kind==='raichu-jolt'||item.kind==='diddy-peanut'||item.kind==='dedede-gordo'||item.kind==='blastoise-water'||item.kind==='blastoise-spray'||item.kind==='lucas-freeze'||item.kind==='lucas-fire'||item.kind==='ninten-pellet'||item.kind==='sausage'||(item.kind==='bomb'&&!item.exploded)) {
        const velocity=this.content.physics.customAir(item.owner,{x:item.vx,y:item.vy},item.data.gravity,item.data.terminal,0);item.vx=velocity.x;item.vy=velocity.y;
      } else if(item.kind==='wolf-laser') {
        // PlWf itFunction:0 Anim: self_vel = (cos, sin)(angle) · speed every frame, so a reflect
        // (OnReflect: angle + π) turns the laser without changing its speed.
        const speed=Math.hypot(item.vx,item.vy);
        if(speed>0){item.vx=Math.fround(item.vx/speed*item.speed);item.vy=Math.fround(item.vy/speed*item.speed);}
      } else if(item.kind==='cutter') {
        // itKirbycutterbeam_UnkMotion0_Phys: decelerate along the floor, never below 0.01.
        item.speed=Math.max(0.01,Math.fround(item.speed-item.data.deceleration));item.vx=Math.fround(facing*item.speed);item.vy=0;
      } else if(item.kind==='shadow-ball') {
        // Supplemental approximation of it_802C4D10's child-JObj wander: the native ball
        // re-aims randomly every wobble period; the match RNG keeps replays deterministic.
        const period=this.content.roster.get('Mt')?.specials.articles.mewtwo?.wobblePeriod??12;
        if(item.age%period===0)item.turn=Math.fround((this.content.physics.random()-0.5)*Math.PI*0.5);
        item.vy=Math.fround(Math.sin(item.turn??0)*Math.abs(item.vx)*0.6);
      }
      const previousY=item.y;
      if(!item.link&&!item.banana){item.x=Math.fround(item.x+item.vx);item.y=Math.fround(item.y+item.vy);}
      // PlDd itFunction:1 Coll (Item_CollAir_NoCB): any floor, wall or ceiling ends the peanut.
      if(item.kind==='diddy-peanut'&&peanutTouchesStage(item,previous,this.content,events)){this.remove(item);continue;}
      if(item.pikachu&&!stepPikachuProjectile(item,previousY,this.content,fighters,this.items,events)){finishPikachuProjectile(item,fighters);this.remove(item);continue;}
      if(item.kind==='ice-shot'&&!stepPopoIce(item,this.content)){this.remove(item);continue;}
      if(item.kind==='chain-whip'&&!stepSeakWhip(item,fighters)){this.remove(item);continue;}
      if(item.kind==='yoshi-star'){
        // itYoshiStar: constant forward accel from the article.
        const owner=this.content.roster.get('Ys')?.specials.parameters;
        if(owner?.kind==='Ys')item.vx=Math.fround(item.vx+owner.stars.accel*Math.sign(item.vx||1));
      }
      if(item.kind==='dins-fire'&&!stepZeldaDin(item,this.content,fighters,poses,events)){this.remove(item);continue;}
      if(item.kind==='blizzard'){
        // itClimbersBlizzard phys adds the article x8 drift every frame.
        const owner=this.content.roster.get('Pp')!.specials.parameters;
        if(owner.kind!=='Pp')throw new Error('Missing Popo parameters.');
        item.vy=Math.fround(item.vy+owner.blizzard.gravity);
      }
      // PlLz Flame Phys rewrites xDEC to the current heading every frame before the shared
      // itKoopaFlame_UnkMotion0_Coll folds the touched surfaces into it.
      if(item.flame&&item.kind==='lizardon-flame'){item.flame.dirX=Math.fround(Math.sin(item.flame.angle));item.flame.dirY=Math.fround(Math.cos(item.flame.angle));}
      if(item.flame)this.steerFlame(item);
      if(item.kind==='cutter'){
        // Bounded floor following: the beam travels on its supporting floor and stops at its ends.
        const floor=this.content.stage.floors.find((floor)=>Math.abs(floorY(floor,item.x)-item.y)<Math.abs(item.vx)*MAX_FLOOR_SLOPE+0.01&&item.x>=Math.min(floor.a[0],floor.b[0])&&item.x<=Math.max(floor.a[0],floor.b[0]));
        if(!floor){this.remove(item);continue;}
        item.y=floorY(floor,item.x);
      }
      let end:V3=center(item.x,item.y);
      if(item.vy<0&&!item.pikachu&&!item.link&&!item.banana&&!item.sonicSpring&&item.kind!=='ice-shot'&&item.kind!=='dins-fire'&&item.kind!=='lizardon-burst'){
        const floor=this.content.stage.floors.filter((floor)=>previous[1]>=floorY(floor,item.x)&&item.y<=floorY(floor,item.x)&&item.x>=Math.min(floor.a[0],floor.b[0])&&item.x<=Math.max(floor.a[0],floor.b[0])).sort((a,b)=>floorY(b,item.x)-floorY(a,item.x))[0];
        // Tails' shot lands without bouncing (Item_SetGrounded → state 0) and keeps sliding.
        if(floor&&item.tails){item.y=Math.fround(floorY(floor,item.x));item.vy=0;item.tails.grounded=true;end=[item.x,item.y,0];}
        else if(floor){
          if(['laser','charge','missile','super-missile','shadow-ball','disable','toad-spore','buster','buster-charged','wolf-laser','metal-shot','fay-laser','fay-sniper','chunli-kiko'].includes(item.kind)){this.remove(item);continue;}
          if(item.kind==='pk-fire'){this.spawnNessPillar(item,events);this.remove(item);continue;}
          if(item.kind==='pk-flash'&&!(item as NessProjectile).ness.exploding){item.y=Math.fround(floorY(floor,item.x)+1);item.vx=0;item.vy=0;explodeNessFlash(item as NessProjectile,nessArticles(this.content));notifyBallGone(fighters[(item as NessProjectile).ness.sourceOwner],item as NessProjectile);end=[item.x,item.y,0];}
          else if(item.kind==='pk-flash'||item.kind==='pk-fire-pillar'){item.vx=0;item.vy=0;end=[item.x,item.y,0];}
          if(item.kind==='bomb'){item.y=floorY(floor,item.x);item.vx=0;item.vy=0;end=[item.x,item.y,0];}
          else if(item.kind==='sausage'){
            item.y=floorY(floor,item.x);item.vx=0;item.vy=0;
            const ownerParams=this.content.roster.get(fighters[item.owner]!.content.profile.kind)?.specials.parameters;
            const sit=(ownerParams?.kind==='Gw')?ownerParams.sausage.sitLife:30;
            item.life=Math.min(item.life,Math.ceil(sit));end=[item.x,item.y,0];
          }
          else {
          item.y=Math.fround(floorY(floor,item.x)+0.02);item.vx=Math.fround(item.vx*item.data.bounce);item.vy=Math.fround(-item.vy*item.data.bounce);end=[item.x,item.y,0];
          // itMariofireball Coll spawns efAsync 1147 (Mario bank 1003) on every bounce;
          // carry the kind so the renderer can spawn the native fire puff instead of a generic spark.
          events.push({type:'bounce',player:item.owner,x:item.x,y:item.y,projectileKind:item.kind});
          if(Math.hypot(item.vx,item.vy)<item.data.minSpeed){this.remove(item);continue;}
          }
        }
      }
      if(item.kind==='bomb'&&item.exploded) {
        let active=true;
        for(const change of this.content.roster.get('Ss')!.specials.articles.samus!.bombBlast) if(item.age>=change.frame){if(change.radius===null)active=false;else item.hit.radius=change.radius;}
        if(!active)continue;
      }
      // PlLz flame anim: it_802725D4 clears the hitbox once the frame counter passes x4.
      if(item.lizardon&&item.age>item.lizardon.hitFrames)continue;
      const linkBlast=item.kind==='link-bomb'&&item.link?.phase==='explosion';
      let reflected=false;
      for(const fighter of fighters){
        if(item.kind==='thunder'||linkBlast||fighter.slot===item.owner||fighter.state==='ko'||item.reflectionCooldown)continue;
        const absorb=nessAbsorber(fighter);
        if(absorb&&['tjolt','laser','fireball','charge','shadow-ball','pk-fire','pk-flash','koopa-flame','buster','buster-charged','iceball','raichu-jolt','lizardon-flame','wolf-laser','diddy-peanut','dedede-gordo','blastoise-water','blastoise-spray','lucas-freeze','lucas-fire','metal-shot','ninten-pellet','fay-laser','fay-sniper','chunli-kiko','dins-fire'].includes(item.kind)){
          const center=poses.point(fighter,absorb.bone,absorb.offset);
          if(pointSegmentDistanceSquared(center,previous,end)<=(absorb.radius+Math.max(1,item.hit.radius))**2){
            const damage=item.kind==='pk-flash'?Math.trunc((item as NessProjectile).ness.charge*nessArticles(this.content).explosion.damagePerCharge+nessArticles(this.content).explosion.baseDamage):item.hit.damage;
            if(fighter.special?.ness)fighter.special.ness.absorbed+=Math.max(1,Math.round(damage*absorb.healMul));
            events.push({type:'reflect',player:fighter.slot,x:item.x,y:item.y});
            this.remove(item);reflected=true;break;
          }
        }
        // Oil Panic bucket shares the energy-kind table; absorbed hits charge
        // it (count + damage) and pose the Catch instead of healing.
        const bucket=gamewatchAbsorber(fighter);
        if(bucket&&['tjolt','laser','fireball','charge','shadow-ball','pk-fire','pk-flash','koopa-flame','buster','buster-charged','iceball','raichu-jolt','lizardon-flame','wolf-laser','diddy-peanut','dedede-gordo','blastoise-water','blastoise-spray','lucas-freeze','lucas-fire','metal-shot','ninten-pellet','fay-laser','fay-sniper','chunli-kiko','dins-fire'].includes(item.kind)){
          const center=poses.point(fighter,bucket.bone,bucket.offset);
          if(pointSegmentDistanceSquared(center,previous,end)<=(bucket.radius+Math.max(1,item.hit.radius))**2){
            fighter.gwOil++;fighter.gwOilDamage=Math.fround(fighter.gwOilDamage+item.hit.damage);
            gamewatchAbsorbed(fighter);
            events.push({type:'reflect',player:fighter.slot,x:item.x,y:item.y});
            this.remove(item);reflected=true;break;
          }
        }
        const bubble=reflector(fighter)??attackReflector(fighter);if(!bubble||item.hit.damage>bubble.maxDamage)continue;
        const center=poses.point(fighter,bubble.bone,bubble.offset);
        if(pointSegmentDistanceSquared(center,previous,end)<=(bubble.radius+item.hit.radius)**2){
          if(!bubble.keepOwner)item.owner=fighter.slot;
          item.vx=Math.fround(-item.vx*bubble.speedMultiplier);item.vy=Math.fround(-item.vy*bubble.speedMultiplier);
          item.hit={...item.hit,damage:Math.min(100,Math.fround(item.hit.damage*bubble.damageMultiplier))};
          if(item.kind==='fireball')item.life=Math.ceil(item.data.lifetime/2);
          // PlNm itFunction OnReflect: the shot's life restarts from the article's x0.
          if(item.kind==='metal-shot')item.life=Math.ceil(item.data.lifetime);
          if(item.kind==='tjolt'){
            item.speed=Math.fround(item.speed*bubble.speedMultiplier);
            if(item.pikachu){item.pikachu.facing=-item.pikachu.facing;if(item.pikachu.grounded)item.pikachu.anchorX=Math.fround(2*item.x-item.pikachu.anchorX);}
          }
          if(item.link){
            item.link.damageScale=Math.fround(item.link.damageScale*bubble.damageMultiplier);
            if(item.kind==='boomerang'){
              // it_802A20E8: reflected flight no longer decelerates/homes and frees the old slot.
              item.link.reflected=true;
              item.link.angle=Math.atan2(item.y-fighter.y,item.x-fighter.x);
              item.speed=Math.fround(Math.hypot(item.vx,item.vy));
              item.vx=Math.fround(Math.cos(item.link.angle)*item.speed);item.vy=Math.fround(Math.sin(item.link.angle)*item.speed);
              // Verified USA 1.02 ItCo common x4C half-life factor, not remaining life / 2.
              item.life=Math.ceil(item.link.launchLife*ITEM_COMMON.reflectedLife);
              const source=fighters[item.link.sourceOwner];if(source?.link.boomerang===item.id)source.link.boomerang=null;
            }else {
              item.link.phase='flight';
              if(item.kind==='link-bomb')item.life=Math.ceil(item.link.launchLife*ITEM_COMMON.reflectedLife);
              // Native arrow reflection advances once by the reversed velocity.
              if(item.kind==='arrow'){item.x=Math.fround(item.x+item.vx);item.y=Math.fround(item.y+item.vy);}
            }
            item.link.angle=Math.atan2(item.vy,item.vx);
          }
          item.victims.clear();item.reflectionCooldown=3;reflectSpecial(fighter,item);
          events.push({type:'reflect',player:fighter.slot,x:item.x,y:item.y});reflected=true;break;
        }
      }
      if(reflected)continue;
      this.projectileBombContact(item,previous,end,events);
      if(!this.items.includes(item))continue;
      const victimsBefore=item.victims.size;
      for(const victim of fighters){
        // it_8029F69C calls it_80275444: bomb blasts can hit their owner.
        if((victim.slot===item.owner&&!linkBlast)||item.victims.has(victim.slot)||victim.invulnerable>0||victim.state==='ko'||victim.state==='respawn')continue;
        if(item.kind==='pk-flash'&&!(item as NessProjectile).ness.exploding)continue;
        if(item.kind==='dins-fire'&&!item.zelda?.exploded)continue;
        const counter=royCounter(victim);
        if(counter&&pointSegmentDistanceSquared(poses.point(victim,counter.bone,counter.offset),previous,end)<=(counter.radius+item.hit.radius)**2){
          item.victims.add(victim.slot);impacts.push({projectile:item,hit:{...item.hit},direction:Math.sign(item.vx)||1,victim,point:end,royCounter:true});this.remove(item);break;
        }
        const passive=passiveLinkShield(victim,poses),shield=passive??shieldBubble(victim,this.content,poses);
        if(shield&&pointSegmentDistanceSquared(shield.center,previous,end)<=(shield.radius+item.hit.radius)**2){
          item.victims.add(victim.slot);impacts.push({projectile:item,hit:{...item.hit},direction:Math.sign(item.vx)||1,victim,point:end,shield:true,...(passive?{passiveAmount:passive.amount}:{})});
          if(item.kind==='diddy-peanut')events.push({type:'gfx',player:item.owner,x:end[0],y:end[1],effect:DIDDY_FX.peanut,facing:1});
          if(linkBlast)continue; // Keep the native blast/pulses alive for other fighters.
          if(item.kind==='link-bomb')this.bombContact(item,true);
          else if(item.kind==='arrow'){
            const p=this.content.roster.get(item.link!.sourceKind)!.specials.parameters;if(p.kind==='Lk'||p.kind==='Cl')stickLinkArrow(item as LinkProjectile,p,victim,poses);
          }
          else if(item.kind==='bomb'&&!item.exploded)item.life=0;
          else if(item.kind==='boomerang')this.returnBoomerang(item);
          else if(item.kind==='pk-fire'){this.spawnNessPillar(item,events);this.remove(item);}
          else if(item.kind==='pk-thunder'){notifyBallGone(fighters[(item as NessProjectile).ness.sourceOwner],item as NessProjectile);this.remove(item);}
          // PlLz flame OnShieldHit returns false (it burns on); the rock burst's returns true.
          else if(item.kind!=='bomb'&&item.kind!=='thunder'&&item.kind!=='pk-fire-pillar'&&item.kind!=='pk-flash'&&item.kind!=='lizardon-flame')this.remove(item);break;
        }
        const worldHurts=hurtCache.get(victim);
        if(!hurtSweepCandidate(worldHurts,previous,end,item.hit.radius))continue;
        for(const hurt of worldHurts.capsules){
          const {a,b}=hurt;
          if(segmentDistanceSquared(previous,end,a,b)<=(item.hit.radius+hurt.radius)**2){
            item.victims.add(victim.slot);impacts.push({projectile:item,hit:{...item.hit},direction:Math.sign(item.vx)||1,victim,point:end});
            // PlDd itFunction:1 OnGiveDamage: the peanut's 0x1772 puff where it lands.
            if(item.kind==='diddy-peanut')events.push({type:'gfx',player:item.owner,x:end[0],y:end[1],effect:DIDDY_FX.peanut,facing:1});
            if(item.kind==='link-bomb')this.bombContact(item,false);
            else if(item.kind==='bomb'&&!item.exploded)item.life=0;
            else if(item.kind==='boomerang')this.returnBoomerang(item);
            else if(item.kind==='pk-fire'){this.spawnNessPillar(item,events);this.remove(item);}
            else if(item.kind==='pk-thunder'){notifyBallGone(fighters[(item as NessProjectile).ness.sourceOwner],item as NessProjectile);this.remove(item);}
            // PlDd banana OnGiveDamage: it bounces off the victim (itColl_BounceOffVictim).
            else if(item.banana)bounceDiddyBanana(item as DiddyBananaProjectile,this.content);
            // itKoopaFlame_Logic111_DmgDealt returns false: a flame keeps going through whoever it
            // burns (it just never hits the same fighter twice), unlike every article below.
            // PlTs itFunction:0 OnGiveDamage is a bare blr: r3 still holds the item, so it is destroyed.
            else if(['tails-shot','tjolt','fireball','charge','missile','super-missile','arrow','shadow-ball','disable','turnip','toad-spore','peach-blast','buster','buster-charged','iceball','raichu-jolt','wolf-laser','diddy-peanut','dedede-gordo','blastoise-water','blastoise-spray','lucas-freeze','lucas-fire','metal-shot','ninten-pellet','fay-laser','fay-sniper','chunli-kiko','needles'].includes(item.kind))this.remove(item);
            break;
          }
        }
        // A consumed fireball cannot also hit subsequent slots this frame.
        if (!this.items.includes(item)) break;
      }
      if(item.kind==='thunder') for(const sibling of this.items) if(sibling.kind==='thunder'&&sibling.pikachu?.sourceOwner===item.pikachu!.sourceOwner&&sibling.pikachu.serial===item.pikachu!.serial) for(const victim of item.victims)sibling.victims.add(victim);
      // it_8026FAC4: a flame's new victim is registered on every flame of its stream group alive at
      // that moment; flames spawned afterwards start clean, so the stream keeps burning.
      if(item.kind==='lizardon-flame'&&item.lizardon&&item.victims.size>victimsBefore){
        const fresh=[...item.victims].slice(victimsBefore);
        for(const sibling of this.items) if(sibling!==item&&sibling.kind==='lizardon-flame'&&sibling.owner===item.owner&&sibling.lizardon?.group===item.lizardon.group) for(const victim of fresh)sibling.victims.add(victim);
      }
      const blast=this.content.stage.blast;
      if(item.x<blast.left-100||item.x>blast.right+100||item.y<blast.bottom-30||item.y>blast.top+100)this.remove(item);
    }
    // Held-item bookkeeping survives any removal path (catch, blast bounds, capacity shift).
    for(const fighter of fighters){
      if(fighter.link.boomerang!==null&&!this.items.some(i=>i.id===fighter.link.boomerang))fighter.link.boomerang=null;
      if(fighter.link.bomb!==null&&!this.items.some(i=>i.id===fighter.link.bomb))fighter.link.bomb=null;
    }
    return impacts;
  }
  private bombContact(item:Projectile,shield:boolean):void {
    if(!item.link)return;const p=this.content.roster.get(item.link.sourceKind)!.specials.parameters;
    if(p.kind==='Lk'||p.kind==='Cl')linkBombContact(item as LinkProjectile,p,shield);
  }
  /** it_2725_Logic23_DmgDealt: the bolt turns into the stationary multihit pillar. */
  private spawnNessPillar(item:Projectile,events:MatchEvent[]):void {
    const articles=nessArticles(this.content),pillar=articles.pillar;
    // it_2725_Logic23_DmgDealt raises the pillar by itNessPKFirepillarAttributes x4 above the
    // bolt's own position before spawning it.
    const child:Projectile={id:++this.serial,kind:'pk-fire-pillar',owner:item.owner,x:item.x,y:Math.fround(item.y+articles.fire.pillarOffset),vx:0,vy:0,age:0,life:Math.ceil(pillar.lifetime),data:pillar,hit:{...pillar.hit!},reflectionCooldown:0,victims:new Set(),speed:0};
    child.ness={sourceOwner:item.ness?.sourceOwner??item.owner,serial:item.ness?.serial??0,charge:0,exploding:false,detached:false,angle:0,trail:[]};
    if(this.items.length>=32)this.items.shift();this.items.push(child);
    events.push({type:'sound',player:item.owner,x:item.x,y:item.y,sound:0x265db,volume:127,pan:64});
  }
  private strikeBombs(fighters:readonly MatchFighter[],poses:PoseProvider,events:MatchEvent[],frozen?:readonly boolean[]):void {
    for(const item of this.items){
      if(item.kind!=='link-bomb'||!item.link||item.link.phase==='explosion')continue;
      const p=this.content.roster.get(item.link.sourceKind)!.specials.parameters;if(p.kind!=='Lk'&&p.kind!=='Cl')continue;
      const h=p.bomb.hurt,s=item.data.scale,a:V3=[item.x+h.a[2]*s,item.y+h.a[1]*s,h.a[0]*s],b:V3=[item.x+h.b[2]*s,item.y+h.b[1]*s,h.b[0]*s];
      for(const f of fighters){
        if((frozen?.[f.slot]??f.hitlag>0)||!['attack','special'].includes(f.state)||!f.attackName||(item.link.phase==='held'&&f.slot===item.owner))continue;
        for(const hit of linkHits(f,activeHits(f.content.attacks.get(f.attackName)!,f.animationFrame))){
          const key=`${f.slot}:${f.attackSerial}:${hit.group}:${hit.activation}`;if(hit.damage<=0||hit.element===8||item.link.struckBy.has(key))continue;
          const point=poses.point(f,hit.bone,hit.offset);if(pointSegmentDistanceSquared(point,a,b)>(hit.radius+h.radius*s)**2)continue;
          item.link.struckBy.add(key);damageLinkBomb(item as LinkProjectile,p,hit.damage,f.facing,()=>this.content.physics.random());
          f.hitlag=Math.max(f.hitlag,this.content.physics.hit(f.slot,0,hit,false).hitlag);linkHitLanded(f);
          events.push({type:'gfx',player:f.slot,x:item.x,y:item.y,effect:1000});break;
        }
      }
    }
  }
  private projectileBombContact(projectile:Projectile,start:V3,end:V3,events:MatchEvent[]):void {
    if(projectile.kind==='link-bomb'&&projectile.link?.phase!=='explosion')return;
    for(const bomb of this.items){
      if(bomb===projectile||bomb.kind!=='link-bomb'||!bomb.link||bomb.link.phase==='explosion'||(bomb.link.phase==='held'&&bomb.owner===projectile.owner))continue;
      const key=`projectile:${projectile.id}:${projectile.link?.activation??0}`;if(bomb.link.struckBy.has(key))continue;
      const p=this.content.roster.get(bomb.link.sourceKind)!.specials.parameters;if(p.kind!=='Lk'&&p.kind!=='Cl')continue;
      const h=p.bomb.hurt,s=bomb.data.scale,a:V3=[bomb.x+h.a[2]*s,bomb.y+h.a[1]*s,h.a[0]*s],b:V3=[bomb.x+h.b[2]*s,bomb.y+h.b[1]*s,h.b[0]*s];
      if(segmentDistanceSquared(start,end,a,b)>(projectile.hit.radius+h.radius*s)**2)continue;
      bomb.link.struckBy.add(key);damageLinkBomb(bomb as LinkProjectile,p,projectile.hit.damage,Math.sign(projectile.vx)||1,()=>this.content.physics.random());
      events.push({type:'gfx',player:projectile.owner,x:bomb.x,y:bomb.y,effect:1000});
      if(projectile.kind==='boomerang'){this.returnBoomerang(projectile);break;}
      if(!['link-bomb','bomb','thunder'].includes(projectile.kind)){this.remove(projectile);break;}
    }
  }
  /** A struck boomerang abandons its outward flight and homes back (itBoomerang hit callback). */
  private returnBoomerang(item:Projectile):void {
    if(!item.link||item.link.phase!=='flight')return;
    const content=this.content.roster.get(item.link.sourceKind),p=content?.specials.parameters,articles=content?.specials.articles.link;
    if(!articles||!p||(p.kind!=='Lk'&&p.kind!=='Cl'))throw new Error('Original return data missing.');
    returnLinkBoomerang(item as LinkProjectile,p,articles,true);
  }
  /** Stable article keys, never models/assets; restore rebinds this world's resources. */
  captureState(): ProjectileState {
    return { serial: this.serial, items: this.items.map(({data, ...state}) => {
      let article = [...this.content.roster].find(([,f]) => f.specials.articles.projectile === data)?.[0] as string | undefined;
      if (!article) for (const [kind, fighter] of this.content.roster) for (const [source, copy] of Object.entries(fighter.copies ?? {})) if (copy?.projectile === data) article = `${kind}/copy/${source}`;
      if (!article) for (const [kind, fighter] of this.content.roster) {
        const s=fighter.specials.articles.samus;if(!s)continue;
        for(const [key,value] of Object.entries(s)) {if(value===data)article=`${kind}/samus/${key}`;if(key==='charges'){const index=s.charges.indexOf(data);if(index>=0)article=`${kind}/samus/charge${index}`;}}
      }
      if (!article) for (const [kind,fighter] of this.content.roster) {
        const pk=fighter.specials.articles.pikachu;
        if(pk?.thunder===data)article=`${kind}/pikachu/thunder`;
        if(pk?.groundJolt===data)article=`${kind}/pikachu/groundJolt`;
      }
      if (!article) for (const [kind,fighter] of this.content.roster) {
        const lk=fighter.specials.articles.link;if(!lk)continue;
        for(const key of ['boomerang','lateBoomerang','returning','bomb','explosion'] as const)if(lk[key]===data)article=`${kind}/link/${key}`;
      }
      if (!article) for (const [kind,fighter] of this.content.roster) {
        const mt=fighter.specials.articles.mewtwo;if(!mt)continue;
        if(mt.disable===data)article=`${kind}/mewtwo/disable`;
        const index=mt.charges.indexOf(data);if(index>=0)article=`${kind}/mewtwo/charge${index}`;
      }
      if (!article) for (const [kind,fighter] of this.content.roster) {
        const zx=fighter.specials.articles.zero;if(!zx)continue;
        if(zx.shot===data)article=`${kind}/zero/shot`;
        if(zx.charged===data)article=`${kind}/zero/charged`;
      }
      if (!article) for (const [kind,fighter] of this.content.roster) {
        const td=fighter.specials.articles.toad;if(!td)continue;
        if(td.ice===data)article=`${kind}/toad/ice`;
        if(td.bigIce===data)article=`${kind}/toad/bigIce`;
      }
      if (!article) for (const [kind,fighter] of this.content.roster) {
        const lz=fighter.specials.articles.lizardon;
        if(lz)for(const key of ['flame','rock','burst'] as const)if(lz[key]===data)article=`${kind}/lizardon/${key}`;
        if(fighter.specials.articles.wolf?.laser===data)article=`${kind}/wolf/laser`;
        if(fighter.specials.articles.wolf?.gun===data)article=`${kind}/wolf/gun`;
        if(fighter.specials.articles.diddy?.peanut===data)article=`${kind}/diddy/peanut`;
        if(fighter.specials.articles.diddy?.banana===data)article=`${kind}/diddy/banana`;
        if(fighter.specials.articles.dedede?.gordo===data)article=`${kind}/dedede/gordo`;
        if(fighter.specials.articles.dedede?.star===data)article=`${kind}/dedede/star`;
        if(fighter.specials.articles.blastoise?.water===data)article=`${kind}/blastoise/water`;
        if(fighter.specials.articles.blastoise?.spray===data)article=`${kind}/blastoise/spray`;
        if(fighter.specials.articles.lucas?.freeze===data)article=`${kind}/lucas/freeze`;
        if(fighter.specials.articles.lucas?.fire===data)article=`${kind}/lucas/fire`;
        if(fighter.specials.articles.metal?.shot===data)article=`${kind}/metal/shot`;
        if(fighter.specials.articles.metal?.spark===data)article=`${kind}/metal/spark`;
        if(fighter.specials.articles.ninten?.pellet===data)article=`${kind}/ninten/pellet`;
        if(fighter.specials.articles.fay?.laser===data)article=`${kind}/fay/laser`;
        if(fighter.specials.articles.fay?.sniper===data)article=`${kind}/fay/sniper`;
        if(fighter.specials.articles.chunli?.kiko===data)article=`${kind}/chunli/kiko`;
        if(fighter.specials.articles.sonic?.spring===data)article=`${kind}/sonic/spring`;
        if(fighter.specials.articles.bsonic?.spring===data)article=`${kind}/bsonic/spring`;
        if(fighter.specials.articles.tails?.shot===data)article=`${kind}/tails/shot`;
        const ns=fighter.specials.articles.ness;
        if(ns)for(const key of ['fire','pillar','flash','explosion','ball','trail'] as const)if(ns[key]===data)article=`${kind}/ness/${key}`;
      }
      if (!article) throw new Error('Unknown projectile article resource.');
      return {...structuredClone(state), article};
    }) };
  }
  restoreState(state: ProjectileState): void {
    const items = state.items.map(({article, ...item}) => {
      const [kind, marker, source] = article.split('/');
      const fighter = this.content.roster.get(kind as FighterKind);
      const samus=fighter?.specials.articles.samus;
      const samusData=samus&&source?(source.startsWith('charge')?samus.charges[Number(source.slice(6))]:samus[source as 'bomb'|'explosion'|'missile'|'superMissile']):undefined;
      const pkData=source==='thunder'?fighter?.specials.articles.pikachu?.thunder:source==='groundJolt'?fighter?.specials.articles.pikachu?.groundJolt:undefined;
      const lkData=marker==='link'?fighter?.specials.articles.link?.[source as 'boomerang'|'lateBoomerang'|'returning'|'bomb'|'explosion']:undefined;
      const mtData=marker==='mewtwo'?(source==='disable'?fighter?.specials.articles.mewtwo?.disable:fighter?.specials.articles.mewtwo?.charges[Number(source?.slice(6))]):undefined;
      const zxData=marker==='zero'?(source==='shot'?fighter?.specials.articles.zero?.shot:fighter?.specials.articles.zero?.charged):undefined;
      const tdData=marker==='toad'?(source==='ice'?fighter?.specials.articles.toad?.ice:fighter?.specials.articles.toad?.bigIce):undefined;
      const extraData=marker==='fay'?(source==='laser'?fighter?.specials.articles.fay?.laser:fighter?.specials.articles.fay?.sniper):marker==='chunli'?fighter?.specials.articles.chunli?.kiko:marker==='lizardon'?fighter?.specials.articles.lizardon?.[source as 'flame'|'rock'|'burst']:marker==='wolf'?(source==='laser'?fighter?.specials.articles.wolf?.laser:fighter?.specials.articles.wolf?.gun):marker==='diddy'?(source==='peanut'?fighter?.specials.articles.diddy?.peanut:fighter?.specials.articles.diddy?.banana):marker==='dedede'?(source==='gordo'?fighter?.specials.articles.dedede?.gordo:fighter?.specials.articles.dedede?.star):marker==='blastoise'?(source==='water'?fighter?.specials.articles.blastoise?.water:fighter?.specials.articles.blastoise?.spray):marker==='lucas'?(source==='freeze'?fighter?.specials.articles.lucas?.freeze:fighter?.specials.articles.lucas?.fire):marker==='metal'?(source==='shot'?fighter?.specials.articles.metal?.shot:fighter?.specials.articles.metal?.spark):marker==='ninten'?fighter?.specials.articles.ninten?.pellet:marker==='bsonic'?fighter?.specials.articles.bsonic?.spring:undefined;
      const nsData=marker==='ness'?fighter?.specials.articles.ness?.[source as 'fire'|'pillar'|'flash'|'explosion'|'ball'|'trail']:undefined;
      const snData=marker==='sonic'?fighter?.specials.articles.sonic?.spring:undefined;
      const tsData=marker==='tails'?fighter?.specials.articles.tails?.shot:undefined;
      const data = marker === 'tails' ? tsData : marker === 'ness' ? nsData : marker === 'sonic' ? snData : marker === 'lizardon' || marker === 'wolf' || marker === 'diddy' || marker === 'dedede' || marker === 'blastoise' || marker === 'lucas' || marker === 'metal' || marker === 'ninten' || marker === 'fay' || marker === 'chunli' || marker === 'bsonic' ? extraData : marker === 'toad' ? tdData : marker === 'zero' ? zxData : marker === 'mewtwo' ? mtData : marker === 'link' ? lkData : marker === 'pikachu' ? pkData : marker === 'samus' ? samusData : marker === 'copy' ? fighter?.copies?.[source as import('./special-data.ts').CopySource]?.projectile : marker === undefined ? fighter?.specials.articles.projectile : undefined;
      if (!data) throw new Error('Incompatible projectile article resource.');
      return {...structuredClone(item), data};
    });
    this.serial = state.serial;
    this.items.splice(0, this.items.length, ...items);
  }
  private explodeBomb(item:Projectile):void {
    const data=this.content.roster.get('Ss')?.specials.articles.samus?.explosion;
    if(!data?.hit)throw Error('Samus bomb explosion is missing.');
    item.data=data;item.hit={...data.hit};item.life=Math.ceil(data.lifetime);item.age=0;item.vx=0;item.vy=0;item.exploded=true;item.victims.clear();
  }
  consume(id:number):void{const item=this.items.find(p=>p.id===id);if(item)this.remove(item);}
  private remove(item:Projectile):void {const index=this.items.indexOf(item);if(index>=0)this.items.splice(index,1);}
}
