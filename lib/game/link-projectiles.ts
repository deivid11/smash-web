import type { Projectile } from './projectiles.ts';
import type { GameContent } from './load.ts';
import { floorY } from './data.ts';
import type { MatchFighter, PoseProvider } from './match.ts';
import type { LinkKind, LinkSpecialData } from './link-data.ts';
import { beginLinkBoomerangCatch, type LinkFighterRuntime, type LinkRuntime, type LinkShot } from './link.ts';
import type { ArticleData, SpecialAssets } from './special-data.ts';
import { command } from './specials.ts';
import { ITEM_COMMON } from './item-common.ts';
import { traceStage } from './link-hookshot.ts';
import type { V3 } from '../hsd/model.ts';

export interface LinkProjectileRuntime {
  sourceKind: LinkKind; sourceOwner: number; phase: 'held'|'caught'|'loose'|'ground'|'stuck'|'flight'|'return'|'explosion';
  angle: number; fast: boolean; activation: number; active: boolean;
  turnAngle: number; homing: number; launchLife: number; reflected: boolean; damageScale: number;
  floor:number|null;damageTaken:number;damageBounced:boolean;struckBy:Set<string>;stuckTo:number|null;stuckOffset:V3;stuckFrame:number;
}
export type LinkProjectile = Omit<Projectile,'kind'> & {kind:LinkShot['kind'];link:LinkProjectileRuntime};
export const LINK_LEFT_THUMB=31,LINK_RIGHT_THUMB=49;
export function linkArticle(articles:SpecialAssets['articles'],kind:LinkShot['kind']):ArticleData {
  const data=kind==='arrow'?articles.projectile:kind==='boomerang'?articles.link?.boomerang:articles.link?.bomb;
  if(!data?.hit)throw Error(`Missing original ${kind} article.`);return data;
}
/** Original bow uses the right-thumb position and a five-degree launch angle. */
export function linkSpawnPoint(f:MatchFighter,kind:LinkShot['kind'],poses:PoseProvider):V3 {
  return poses.point(f,f.content.profile.boneMap[kind==='arrow'?LINK_RIGHT_THUMB:LINK_LEFT_THUMB]!,[0,0,0]);
}
export function initializeLinkProjectile(item:LinkProjectile,f:MatchFighter,p:LinkSpecialData,state:LinkFighterRuntime,shot:LinkShot):void {
  const fraction=Math.max(0,Math.min(1,shot.charge??0)),fast=!!shot.fast;
  item.link={sourceKind:p.kind,sourceOwner:f.slot,phase:shot.kind==='link-bomb'?'held':'flight',angle:shot.aim??5*Math.PI/180,fast,activation:-1,active:shot.kind!=='link-bomb',turnAngle:0,homing:0,launchLife:item.life,reflected:false,damageScale:1,floor:null,damageTaken:0,damageBounced:false,struckBy:new Set(),stuckTo:null,stuckOffset:[0,0,0],stuckFrame:0};
  if(shot.kind==='arrow'){
    const charge=Math.max(0,Math.min(p.neutral.chargeFrames,shot.rawCharge??fraction*p.neutral.chargeFrames));
    const interpolate=(min:number,max:number)=>Math.fround(Math.fround(charge*Math.fround(Math.fround(max-min)/p.neutral.chargeFrames))+min);
    item.speed=interpolate(p.arrow.minSpeed,p.arrow.maxSpeed);
    // it_80272460 takes u32 damage; native positive interpolation truncates.
    item.hit={...item.hit,damage:Math.trunc(interpolate(p.arrow.minDamage,p.arrow.maxDamage))};
    item.vx=Math.fround(Math.cos(item.link.angle)*item.speed*f.facing);item.vy=Math.fround(Math.sin(item.link.angle)*item.speed);
  }else if(shot.kind==='boomerang'){
    item.speed=fast?p.side.smashSpeed:p.side.speed;item.link.angle=(shot.aim??0)*f.facing+(f.facing<0?Math.PI:0);
    item.vx=Math.fround(Math.cos(item.link.angle)*item.speed);item.vy=Math.fround(Math.sin(item.link.angle)*item.speed);
    item.life=fast?p.boomerang.smashLifetime:p.boomerang.lifetime;item.link.launchLife=item.life;state.boomerang=item.id;
  }else {item.vx=0;item.vy=0;state.bomb=item.id;}
}
export function explodeLinkBomb(item:LinkProjectile,articles:NonNullable<SpecialAssets['articles']['link']>,p:LinkSpecialData,state:LinkFighterRuntime|undefined):void {
  if(!articles.explosion.hit)throw Error('Missing original bomb explosion.');
  item.data=articles.explosion;item.hit={...articles.explosion.hit};item.age=0;item.life=p.bomb.explosionFrames;item.vx=0;item.vy=0;item.victims.clear();item.link.phase='explosion';item.link.activation=-1;
  if(state?.bomb===item.id)state.bomb=null;
}
/** it_802A1948 / it_802A1F08: reverse now, then steer on subsequent return ticks. */
export function returnLinkBoomerang(item:LinkProjectile,p:LinkSpecialData,articles:NonNullable<SpecialAssets['articles']['link']>,contact=false):void {
  const r=item.link;if(r.reflected||r.phase!=='flight')return;
  r.phase='return';r.angle=Math.fround(r.angle<=0?r.angle+Math.PI:r.angle-Math.PI);
  r.turnAngle=(contact?p.boomerang.hitTurnAngle:p.boomerang.turnAngle)*Math.PI/180;r.homing=p.boomerang.homingFrames;
  item.data=articles.returning;if(!item.data.hit)throw Error('Original return hit missing.');
  item.hit={...item.data.hit,damage:Math.fround(item.data.hit.damage*r.damageScale)};item.victims.clear();
}
export function stickLinkArrow(item:LinkProjectile,p:LinkSpecialData,shield?:MatchFighter,poses?:PoseProvider):void {
  const r=item.link;r.phase='stuck';r.stuckFrame=item.age;r.active=false;r.angle=Math.atan2(item.vy,item.vx);item.life=p.arrow.stickLife;item.vx=0;item.vy=0;
  if(shield&&poses){const center=poses.point(shield,shield.content.profile.shieldBone,[0,0,0]);r.stuckTo=shield.slot;r.stuckOffset=[item.x-center[0],item.y-center[1],0];}
}
export function linkBombContact(item:LinkProjectile,p:LinkSpecialData,shield=false):void {
  if(item.link.phase!=='flight')return;
  if(shield){item.vx=Math.fround(item.vx*ITEM_COMMON.shieldBounceX);item.vy=Math.fround(item.vy*ITEM_COMMON.shieldBounceY+ITEM_COMMON.shieldBounceLift);}
  else if(Math.abs(item.vx)>p.bomb.impactX||Math.abs(item.vy)>p.bomb.impactY)item.life=0;
  else {item.vx=Math.fround(-(Math.sign(item.vx)||1)*p.bomb.hitBounceX);item.vy=p.bomb.hitBounceY;}
}
export function damageLinkBomb(item:LinkProjectile,p:LinkSpecialData,damage:number,direction:number,random:()=>number):void {
  const r=item.link;if(r.phase==='explosion')return;
  r.damageTaken=Math.fround(r.damageTaken+damage);
  if(r.damageTaken>=p.bomb.damageThreshold){item.life=0;return;}
  if(!r.damageBounced){
    r.damageBounced=true;
    if(r.phase!=='held'){
      item.vx=Math.fround(p.bomb.damageBounceX*(Math.abs(item.vx)>p.bomb.stopSpeed?-direction:2*random()-1));
      item.vy=Math.fround(p.bomb.damageBounceY*(Math.sign(item.vx)||1));r.phase='flight';r.floor=null;
    }
  }
}
/** Advance the native-parameter subset independently of rendering. Called once per simulation tick. */
export function advanceLinkProjectile(item:LinkProjectile,p:LinkSpecialData,articles:NonNullable<SpecialAssets['articles']['link']>,source:MatchFighter|undefined,state:LinkFighterRuntime|undefined,special:Pick<LinkRuntime,'throwBomb'|'bombReady'|'throwIndex'|'throwFacing'>|undefined,content:GameContent,poses:PoseProvider):{remove:boolean;active:boolean}{
  const r=item.link;
  if(item.life<=0){if(item.kind==='link-bomb'&&r.phase!=='explosion')explodeLinkBomb(item,articles,p,state);else return {remove:true,active:false};}
  if(item.kind==='arrow'&&r.phase==='stuck')return {remove:false,active:false};
  if(item.kind==='boomerang'&&r.phase==='caught'){
    if(!source||state?.boomerang!==item.id||source.special?.direction!=='side'||source.special.phase!=='hit'||command(source,1)!==0){
      if(state?.boomerang===item.id)state.boomerang=null;return {remove:true,active:false};
    }
    const point=poses.point(source,source.content.profile.boneMap[LINK_LEFT_THUMB]!,[0,0,0]);item.x=point[0];item.y=point[1];return {remove:false,active:false};
  }
  if(item.kind==='link-bomb'&&r.phase==='held'){
    if(source&&state?.bomb===item.id&&!['ko','respawn','hitstun','captured'].includes(source.state)){
      const point=poses.point(source,source.content.profile.itemHoldBone??source.content.profile.boneMap[LINK_LEFT_THUMB]!,[0,0,0]);item.x=point[0];item.y=point[1];
      if(special?.throwBomb&&special.bombReady){
        const data=content.common.itemThrows?.[special.throwIndex];if(!data)throw Error('Original item-throw velocity table is missing.');
        // ftCo_80095D5C: optional cmd0 speed/angle override and the facing
        // captured at throw entry (back-throw turn flags must not invert it twice).
        const override=command(source,0), degrees=(override<<20)>>20;
        const speed=data.speed*(source.content.profile.attributes.itemThrowVelocity??p.bomb.throwMultiplier)*(override?0.01*((override>>>12)&1023):1);
        const angle=override&&degrees!==361?degrees*Math.PI/180:data.angle;
        item.vx=Math.fround(Math.cos(angle)*speed*special.throwFacing);item.vy=Math.fround(Math.sin(angle)*speed);r.phase='flight';state.bomb=null;special.bombReady=false;
      }else return {remove:false,active:false};
    }else {r.phase='flight';r.active=true;if(state?.bomb===item.id)state.bomb=null;item.vx=source?.velocity.x??0;item.vy=0;}
  }
  if(item.kind==='link-bomb'&&r.phase==='explosion'){
    let active:import('./moves.ts').ActiveHit|null=null;
    for(const event of p.bomb.timeline){if(event.frame>item.age)break;active=event.hit;}
    if(active){if(active.activation!==r.activation){item.victims.clear();r.activation=active.activation;}item.hit={...active};}
    r.active=active!==null;return {remove:false,active:r.active};
  }
  if(item.kind==='link-bomb'&&r.phase==='ground'){
    const floor=content.stage.floors.find(f=>f.id===r.floor),x=Math.fround(item.x+item.vx);
    if(floor&&x>=Math.min(floor.a[0],floor.b[0])&&x<=Math.max(floor.a[0],floor.b[0])){
      item.x=x;item.y=floorY(floor,x);item.vx=Math.fround(Math.sign(item.vx)*Math.max(0,Math.abs(item.vx)-p.bomb.friction));if(Math.abs(item.vx)<p.bomb.stopSpeed)item.vx=0;return {remove:false,active:false};
    }r.phase='loose';r.floor=null;
  }
  const previous:V3=[item.x,item.y,0];
  if(item.kind==='arrow')item.vy=Math.fround(item.vy-p.arrow.gravity);
  else if(item.kind==='boomerang'){
    if(item.data===articles.boomerang&&item.age>=p.boomerang.lateFrame){
      item.data=articles.lateBoomerang;if(!item.data.hit)throw Error('Original late boomerang hit missing.');
      item.hit={...item.data.hit,damage:Math.fround(item.data.hit.damage*r.damageScale)};
    }
    if(!r.reflected){
      if(r.phase==='flight'){
        const speed=Math.fround(item.speed-p.boomerang.deceleration);
        item.speed=Math.max(p.boomerang.minSpeed,speed);
        if(speed<p.boomerang.minSpeed)returnLinkBoomerang(item,p,articles);
        item.vx=Math.fround(Math.cos(r.angle)*item.speed);item.vy=Math.fround(Math.sin(r.angle)*item.speed);
      }else if(r.phase==='return'){
        item.speed=Math.min(p.boomerang.returnSpeed,Math.fround(item.speed+p.boomerang.acceleration));
        // Native physics calculates this tick's velocity before homing adjusts the next heading.
        item.vx=Math.fround(Math.cos(r.angle)*item.speed);item.vy=Math.fround(Math.sin(r.angle)*item.speed);
        if(source&&source.stocks>0&&!['ko','respawn'].includes(source.state)){
          const dx=source.x-item.x,dy=source.y+p.boomerang.targetY-item.y;
          if(Math.hypot(dx,dy)<p.boomerang.catchRadius){
            if(state?.boomerang===item.id&&beginLinkBoomerangCatch(source,content.common)){r.phase='caught';r.active=false;item.vx=0;item.vy=0;return {remove:false,active:false};}
            if(state?.boomerang===item.id)state.boomerang=null;return {remove:true,active:false};
          }
          if(r.homing>0){
            r.homing--;const delta=Math.atan2(Math.sin(Math.atan2(dy,dx)-r.angle),Math.cos(Math.atan2(dy,dx)-r.angle));
            r.angle=Math.fround(r.angle+Math.max(-r.turnAngle,Math.min(r.turnAngle,delta)));
          }
        }
      }
    }
  }else {
    const velocity=content.physics.customAir(item.owner,{x:item.vx,y:item.vy},item.data.gravity,item.data.terminal,0);item.vx=velocity.x;item.vy=velocity.y;
  }
  item.x=Math.fround(item.x+item.vx);item.y=Math.fround(item.y+item.vy);
  const contact=!r.reflected?traceStage(content.stage,previous,[item.x,item.y,0]):null;
  if(contact){
    const floor=contact.surface;item.x=contact.point[0];item.y=contact.point[1];
    if(item.kind==='arrow'){stickLinkArrow(item,p);return {remove:false,active:false};}
    if(item.kind==='boomerang'){
      // it_802A15EC: reflect grazing incidence about the actual map normal.
      const dx=floor.b[0]-floor.a[0],dy=floor.b[1]-floor.a[1],length=Math.hypot(dx,dy);
      let nx=-dy/length,ny=dx/length,dot=item.vx*nx+item.vy*ny;
      if(dot>0){nx=-nx;ny=-ny;dot=-dot;}
      if(dot/Math.hypot(item.vx,item.vy)>-Math.sin(p.boomerang.surfaceAngle*Math.PI/180)){item.vx=Math.fround(item.vx-2*dot*nx);item.vy=Math.fround(item.vy-2*dot*ny);r.angle=Math.atan2(item.vy,item.vx);}
      else {returnLinkBoomerang(item,p,articles);item.vx=Math.fround(Math.cos(r.angle)*item.speed);item.vy=Math.fround(Math.sin(r.angle)*item.speed);}
      item.x=Math.fround(item.x+nx*.01);item.y=Math.fround(item.y+ny*.01);
    }
    else {
      if(Math.abs(item.vx)>p.bomb.impactX||Math.abs(item.vy)>p.bomb.impactY)explodeLinkBomb(item,articles,p,state);
      else if(floor.kind==='floor'){item.vy=0;r.phase='ground';r.floor=floor.id;r.active=false;}
      else {item.vx=Math.fround(-item.vx*p.bomb.bounce);item.vy=Math.fround(-item.vy*p.bomb.bounce);r.phase='loose';r.active=false;}
    }
  }
  if(r.phase==='explosion')return advanceLinkProjectile(item,p,articles,source,state,special,content,poses);
  r.active=!(item.kind==='link-bomb'&&(r.phase==='loose'||r.phase==='ground'));return {remove:false,active:r.active};
}
