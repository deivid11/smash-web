import type { GameContent } from './load.ts';
import type { MatchFighter, MatchEvent, PlayerInput, FighterState } from './match.ts';
import type { Projectile, ProjectileWorld } from './projectiles.ts';
import type { ItemWorld } from './item-engine.ts';
import { LIGHT_ITEM_MOTIONS, SMASH_ITEM_MOTIONS } from './item-common.ts';
import { dropSkullBomb, type SkullBombProjectile } from './sd-projectiles.ts';
export interface ItemThrowRuntime { item:number;throwBomb:boolean;bombReady:boolean;throwIndex:number;throwFacing:number;throwRate:number;cursor:number }
const indexName=(index:number):string=>index>=14?`${SMASH_ITEM_MOTIONS[index-14]}4`:LIGHT_ITEM_MOTIONS[index]!;
export function dropHeldBomb(f:MatchFighter,item:Projectile):void {
  if(!item.link)return;item.link.phase='flight';item.link.active=true;item.vx=f.velocity.x;item.vy=0;item.link.floor=null;f.link.bomb=null;
}
/** Native throw classification (ftCo_80095FD4 thresholds from PlCo itemInput): direction,
 * dash/smash selection and the resulting light-item motion index. Null when the stick/state
 * combination selects no throw. Shared by the Link-bomb and the generic match-item paths. */
function classifyThrow(f:MatchFighter,input:PlayerInput,prev:PlayerInput,content:GameContent):{index:number;name:string;facing:number;smash:boolean}|null {
  const t=content.common.itemInput;if(!t)throw Error('Missing original item input thresholds.');
  const y=input.y??(input.down?-1:0),angle=Math.atan2(y,Math.abs(input.x));
  const neutral=Math.abs(input.x)<t.neutralX&&Math.abs(y)<t.neutralY;
  const direction=neutral?0:angle>t.angle&&y>=t.up?2:angle<-t.angle&&y<=t.down?3:input.x*f.facing<0?1:0;
  const smash=(input.strong&&!prev.strong)||(!f.grounded?!neutral&&(direction>=2?f.link.verticalTicks:f.link.sideTicks)<t.airWindow:
    Math.abs(input.x)>=content.common.dashThreshold&&f.link.sideTicks<(content.common.smashInputWindow??0)||y>=t.smashUp&&f.link.verticalTicks<t.upWindow+f.content.profile.attributes.jumpStartup||y<=t.smashDown&&f.link.verticalTicks<t.downWindow);
  const dash=f.grounded&&f.state==='run'&&!input.walk&&!smash;
  const index=dash?4:(smash?(f.grounded?14:18):(f.grounded?0:6))+direction,name=indexName(index);
  if(!f.content.clips.has(name))return null;
  return {index,name,facing:f.facing*(direction===1?-1:1),smash};
}
/** Native light-item pickup boxes and actor-owned throw scripts; no borrowed character poses. */
export function handleItemInput(f:MatchFighter,input:PlayerInput,prev:PlayerInput,world:ProjectileWorld,content:GameContent,change:(state:FighterState,animation:string)=>void,itemWorld?:ItemWorld,events?:MatchEvent[]):boolean {
  const attack=input.attack&&!prev.attack,strong=input.strong&&!prev.strong,grab=!!input.grab&&!prev.grab;
  const item=world.items.find(p=>p.id===f.link.bomb&&p.kind==='link-bomb'&&p.link?.phase==='held');
  if(item){
    if(!f.grounded&&(grab||(input.shield&&attack))&&Math.abs(input.x)<(content.common.itemInput?.neutralX??0)&&Math.abs(input.y??0)<(content.common.itemInput?.neutralY??0)){dropHeldBomb(f,item);return true;}
    if(!attack&&!strong&&!grab)return false;
    const params=content.roster.get(item.link!.sourceKind)!.specials.parameters;
    if(params.kind!=='Lk'&&params.kind!=='Cl')throw Error('Invalid bomb source.');
    const selected=classifyThrow(f,input,prev,content);if(!selected)return false;
    const rate=(selected.smash?(content.common.itemSmashAnimationRate??1):1)/params.bomb.throwAnimationDivisor;
    change('item-throw',selected.name);f.link.itemThrow={item:item.id,throwBomb:true,bombReady:false,throwIndex:selected.index,throwFacing:selected.facing,throwRate:rate,cursor:-1};f.animationRate=rate;return true;
  }
  if(f.link.bomb!==null)f.link.bomb=null;
  // Skull Kid's bomb (Fighter_GiveItem): a light item in his hand while in item states 0/1.
  const skull=f.skullkid.bomb===null?undefined:world.items.find(p=>p.id===f.skullkid.bomb&&p.kind==='skull-bomb'&&(p.skull?.state??2)<=1);
  if(skull){
    if(!f.grounded&&(grab||(input.shield&&attack))&&Math.abs(input.x)<(content.common.itemInput?.neutralX??0)&&Math.abs(input.y??0)<(content.common.itemInput?.neutralY??0)){dropSkullBomb(skull as SkullBombProjectile,f);f.skullkid.bombState=2;return true;}
    if(!attack&&!strong&&!grab)return false;
    const selected=classifyThrow(f,input,prev,content);if(!selected)return false;
    const rate=selected.smash?(content.common.itemSmashAnimationRate??1):1;
    change('item-throw',selected.name);f.link.itemThrow={item:skull.id,throwBomb:true,bombReady:false,throwIndex:selected.index,throwFacing:selected.facing,throwRate:rate,cursor:-1};f.animationRate=rate;return true;
  }
  const held=itemWorld?.find(f.heldItem);
  if(held&&held.phase==='held'){
    // The Hammer and the ridden Warp Star own their holder: no throw, drop or shot.
    if(f.itemStatus?.kind==='hammer'||f.itemStatus?.kind==='warp')return true;
    const heavy=itemWorld!.heavyHeld(f);
    if(!heavy&&!f.grounded&&(grab||(input.shield&&attack))&&Math.abs(input.x)<(content.common.itemInput?.neutralX??0)&&Math.abs(input.y??0)<(content.common.itemInput?.neutralY??0)){itemWorld!.dropHeld(f);return true;}
    if(!attack&&!strong&&!grab)return false;
    // Shootable items (ftCo_Attack_800CDD14 class 3): the attack input fires; grab throws.
    if(!grab&&itemWorld!.shootable(f)){
      const motion=itemWorld!.shoot(f,events??[]);
      if(motion){change('attack',motion);f.attackName=null;}
      return true;
    }
    // Battering items (ftCo_AttackS4 checkItemThrow class 2): a grounded attack input
    // swings through the normal attack pipeline; only grab throws on the ground.
    // Fighters without the shared swing motions (custom/modded tables) throw instead.
    if(!grab&&!heavy&&f.grounded&&itemWorld!.swingFor(f,'jab')!==null)return false;
    const selected=classifyThrow(f,input,prev,content);if(!selected)return false;
    if(heavy){
      // Heavy carries only know the four HeavyThrow directions (no dash/smash variants).
      const direction=selected.index>=18?selected.index-18:selected.index>=14?selected.index-14:selected.index>=6?selected.index-6:Math.min(3,selected.index);
      const name=(['HeavyThrowF','HeavyThrowB','HeavyThrowHi','HeavyThrowLw'] as const)[direction]!;
      if(!f.content.clips.has(name)){itemWorld!.dropHeld(f);return true;}
      change('item-throw',name);f.link.itemThrow={item:held.id,throwBomb:false,bombReady:false,throwIndex:direction,throwFacing:selected.facing,throwRate:1,cursor:-1};f.animationRate=1;return true;
    }
    const rate=selected.smash?(content.common.itemSmashAnimationRate??1):1;
    change('item-throw',selected.name);f.link.itemThrow={item:held.id,throwBomb:false,bombReady:false,throwIndex:selected.index,throwFacing:selected.facing,throwRate:rate,cursor:-1};f.animationRate=rate;return true;
  }
  if(f.heldItem!==null)f.heldItem=null;
  if(!(grab||attack)||!f.content.profile.itemPickup||!f.content.clips.has('LightGet')||(!f.grounded&&!grab&&!(input.shield&&attack)))return false;
  const box=f.content.profile.itemPickup[f.grounded?'ground':'air'],scale=f.content.profile.attributes.modelScale;
  const x=f.x+box[0]*f.facing*scale,y=f.y+box[1]*scale;
  const picked=world.items.filter(item=>{
    if(item.kind!=='link-bomb'||!item.link||!['loose','ground','flight'].includes(item.link.phase))return false;
    const p=content.roster.get(item.link.sourceKind)!.specials.parameters;if(p.kind!=='Lk'&&p.kind!=='Cl')return false;
    return Math.abs(item.x-x)<box[2]*scale+p.bomb.pickup[0]*item.data.scale&&Math.abs(item.y-y)<box[3]*scale+p.bomb.pickup[1]*item.data.scale;
  }).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y)||a.id-b.id)[0];
  if(picked?.link){
    picked.owner=f.slot;picked.link.sourceOwner=f.slot;picked.link.phase='held';picked.link.active=false;picked.link.floor=null;picked.vx=0;picked.vy=0;picked.victims.clear();f.link.bomb=picked.id;
    if(f.grounded)change('item-pickup','LightGet');return true;
  }
  if(itemWorld&&content.items){
    const candidate=itemWorld.items.filter(entry=>{
      // Pokémon run in their own `act` phase; pickable() admits only an armed Electrode.
      if((!['ground','fall','flight'].includes(entry.phase)&&!entry.pk)||entry.mode===3)return false;
      if(!itemWorld.pickable(entry,f))return false;
      const attributes=content.items!.kind(entry.kind).attributes;
      const reachX=Math.max(1.5,attributes.grabRange[0]*attributes.scale),reachY=Math.max(1.5,attributes.grabRange[1]*attributes.scale);
      return Math.abs(entry.x-x)<box[2]*scale+reachX&&Math.abs(entry.y-y)<box[3]*scale+reachY;
    }).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y)||a.id-b.id)[0];
    if(candidate){
      const heavy=content.items.kind(candidate.kind).attributes.heavy;
      itemWorld.pickup(f,candidate,events);
      if(f.grounded)change('item-pickup',heavy&&f.content.clips.has('HeavyGet')?'HeavyGet':'LightGet');
      return true;
    }
  }
  return false;
}
export function stepItemAnimation(f:MatchFighter,change:(state:FighterState,animation:string)=>void):void {
  if(f.state!=='item-throw'&&f.state!=='item-pickup')return;
  if(f.animationFrame>=f.content.clips.get(f.animation)!.endFrame){change(f.grounded?'idle':'fall',f.grounded?'Wait1':'Fall');return;}
  const r=f.link.itemThrow;if(f.state!=='item-throw'||!r)return;
  for(const e of f.content.timelines.get(f.animation)!.events){
    if(e.frame<=r.cursor||e.frame>f.animationFrame||e.type!=='flag'||e.flag!==20)continue;
    if(e.value===1)f.facing=-f.facing;else if((e.value??0)===0)r.bombReady=true;
  }
  r.cursor=f.animationFrame;f.animationRate=r.throwRate;
}
