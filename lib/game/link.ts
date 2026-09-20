import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import type { SpecialRuntime } from './specials.ts';
import { beginSpecial, command } from './specials.ts';
import type { CommonGameplayData } from './data.ts';
import type { LinkSpecialData } from './link-data.ts';
import { activeHits, type ActiveHit } from './moves.ts';
import type { HookshotRuntime } from './link-hookshot.ts';
import type { ItemThrowRuntime } from './items.ts';

export interface LinkFighterRuntime { boomerang: number | null; bomb: number | null; sideTicks: number; verticalTicks: number; shieldAge: number; itemThrow: ItemThrowRuntime | null; passiveMode: boolean; passiveReady: boolean; hook: HookshotRuntime | null; tetherUsed: boolean; dairDisabled: boolean; dairTimer: number; dairRearmedAt: number | null; dairHits: ActiveHit[] }
export interface LinkRuntime {
  charge: number; chargeEnabled: boolean; shot: boolean; empty: boolean;
  throwBomb: boolean; bombReady: boolean; throwIndex: number; throwFacing: number; throwRate: number; aim: number; fast: boolean;
}
export interface LinkShot { player: number; kind: 'arrow' | 'boomerang' | 'link-bomb'; charge?: number; rawCharge?: number; aim?: number; fast?: boolean }
export interface LinkStep { handled: boolean; shots: LinkShot[]; sounds: number[] }
const f32=Math.fround;
export function createLinkState():LinkFighterRuntime{return {boomerang:null,bomb:null,sideTicks:255,verticalTicks:255,shieldAge:255,itemThrow:null,passiveMode:false,passiveReady:false,hook:null,tetherUsed:false,dairDisabled:false,dairTimer:0,dairRearmedAt:null,dairHits:[]};}
export function linkSpecialName(f:MatchFighter,direction:SpecialDirection,phase:SpecialRuntime['phase'],r:LinkRuntime|undefined):string {
  const prefix=f.grounded?'Special':'SpecialAir';
  if(direction==='neutral')return `${prefix}N${phase==='start'?'Start':phase==='loop'?'Loop':'End'}`;
  if(direction==='side')return `${prefix}S${phase==='hit'?'2':r?.empty?'1Empty':'1'}`;
  if(direction==='up')return `${prefix}Hi`;
  if(r?.throwBomb){
    const smash=r.throwIndex>=14, index=smash?r.throwIndex-(f.grounded?14:18):r.throwIndex-(f.grounded?0:6);
    return `LightThrow${f.grounded?'':'Air'}${['F','B','Hi','Lw'][index]}${smash?'4':''}`;
  }
  return `${prefix}Lw`;
}
export function beginLinkSpecial(f:MatchFighter,p:LinkSpecialData,state:LinkFighterRuntime,input:PlayerInput,common?:CommonGameplayData):LinkRuntime {
  // ftLk_SpecialLw's held-bomb path selects LightThrowF4 / LightThrowAirF4,
  // regardless of the down stick used to invoke the special.
  const direction=f.special!.direction,r:LinkRuntime={charge:0,chargeEnabled:false,shot:false,empty:direction==='side'&&state.boomerang!==null,throwBomb:direction==='down'&&state.bomb!==null,bombReady:false,throwIndex:f.grounded?14:18,throwFacing:f.facing,throwRate:(common?.itemSmashAnimationRate??1)/p.bomb.throwAnimationDivisor,aim:0,fast:Math.abs(input.x)>=(common?.dashThreshold??0.8)&&state.sideTicks<(common?.smashInputWindow??4)};
  if(direction==='up'&&!f.grounded){f.velocity.x=f32(f.velocity.x*p.up.momentum);f.velocity.y=p.up.lift;f.jumpsUsed=f.content.profile.attributes.maxJumps;}
  return r;
}
/** Restricted light-item A/strong throw controls, using original scripts/velocities.
 * General pickup, dash/Z-drop and stick-flick throw selection remain unported. */
export function beginLinkBombThrow(f:MatchFighter,input:PlayerInput,strong:boolean,common:CommonGameplayData):void {
  const facing=f.facing, y=input.y??(input.down?-1:0);
  const direction=y>0.5?2:y<-.5?3:input.x*facing<-.28?1:0;
  beginSpecial(f,'down',{...input,x:0},common);
  const r=f.special!.link!,p=f.content.specials.parameters;
  if(p.kind!=='Lk'&&p.kind!=='Cl')throw Error('Only Link holds a Link bomb.');
  r.throwIndex=(strong?(f.grounded?14:18):(f.grounded?0:6))+direction;
  r.throwFacing=facing*(direction===1?-1:1);
  r.throwRate=(strong?(common.itemSmashAnimationRate??1):1)/p.bomb.throwAnimationDivisor;
  f.animation=linkSpecialName(f,'down','start',r);f.attackName=f.animation;f.animationRate=r.throwRate;
}
/** Native close-return catch: busy fighters discard it instead of cancelling their action. */
export function beginLinkBoomerangCatch(f:MatchFighter,common:CommonGameplayData):boolean {
  if(!['idle','walk','run','jump','airjump','fall'].includes(f.state))return false;
  beginSpecial(f,'side',{x:0,y:0,down:false,attack:false,strong:false,jump:false,shield:false,grab:false,special:false},common);
  const r=f.special!.link!;r.empty=false;r.shot=true;phase(f,r,'hit');return true;
}
function phase(f:MatchFighter,r:LinkRuntime,next:SpecialRuntime['phase']):void{
  const s=f.special!;s.phase=next;s.lastFrame=-1;f.animation=linkSpecialName(f,s.direction,next,r);f.animationFrame=0;f.animationRate=1;f.stateFrame=0;f.animationEpoch++;f.attackName=f.animation;f.attackSerial++;f.victims.clear();
}
/** Original ftLk callbacks with independent Lk/Cl parameters. Projectile and held-item state is serializable. */
export function stepLinkSpecial(f:MatchFighter,p:LinkSpecialData,r:LinkRuntime,state:LinkFighterRuntime,input:PlayerInput,physics:MeleePhysics,finish:(helpless:boolean,lag:number,mobility:number)=>void):LinkStep{
  const result:LinkStep={handled:true,shots:[],sounds:[]},s=f.special!,a=f.content.profile.attributes;s.age++;
  const ended=()=>f.animationFrame>=Math.max(1,f.content.clips.get(f.animation)!.endFrame);
  const gather=()=>{const events=(f.content.timelines.get(f.animation)?.events??[]).filter(e=>e.frame>s.lastFrame&&e.frame<=f.animationFrame);s.lastFrame=f.animationFrame;return events;};
  if(s.direction==='neutral'){
    if(s.phase==='start'){
      f.animationRate=p.neutral.animationRate;
      if(command(f,2)!==0)r.chargeEnabled=true;
      if(r.chargeEnabled)r.charge=Math.min(p.neutral.chargeFrames,r.charge+1);
      // Native Anim runs before IASA: a completed startup reaches full charge
      // even when B is released on exactly that boundary.
      if(ended()){r.charge=p.neutral.chargeFrames;phase(f,r,'loop');if(!input.special)phase(f,r,'end');}
      else if(r.chargeEnabled&&!input.special)phase(f,r,'end');
    }else if(s.phase==='loop'){
      r.charge=p.neutral.chargeFrames;
      if(!input.special)phase(f,r,'end');else if(ended())phase(f,r,'loop');
    }else if(ended()){finish(p.neutral.landing>0,p.neutral.landing,1);return result;}
    if(s.phase==='end'&&!r.shot&&gather().some(e=>e.type==='command'&&e.index===1&&e.value===1)){
      r.shot=true;result.shots.push({player:f.slot,kind:'arrow',rawCharge:r.charge});
    }
  }else if(s.direction==='side'){
    if(ended()){finish(false,0,1);return result;}
    if(!r.empty&&!r.shot&&gather().some(e=>e.type==='command'&&e.index===0&&e.value===1)){
      const y=input.y??0;r.aim=Math.abs(y)>p.side.threshold?Math.max(-p.side.maxAngle,Math.min(p.side.maxAngle,Math.atan2(y,Math.abs(input.x)))):0;
      r.shot=true;result.shots.push({player:f.slot,kind:'boomerang',aim:r.aim,fast:r.fast});
    }
  }else if(s.direction==='up'){
    if(ended()){finish(!f.grounded,p.up.landing,p.up.drift);return result;}
    if(!f.grounded){f.velocity=physics.customAir(f.slot,f.velocity,a.gravity*p.up.gravity,a.terminal,0);f.velocity=physics.controlledDrift(f.slot,f.velocity,input.x,a.airDriftStickMul*p.up.drift,a.airDriftMax*p.up.maxDrift);return result;}
  }else{
    if(ended()){f.animationRate=1;finish(false,0,1);return result;}
    const events=gather();
    if(r.throwBomb){
      f.animationRate=r.throwRate;
      // Throw flag 4 turns the fighter; flag 3 actually releases the item.
      if(events.some(e=>e.type==='flag'&&e.flag===20&&e.value===1))f.facing=-f.facing;
      if(events.some(e=>e.type==='flag'&&e.flag===20&&(e.value??0)===0))r.bombReady=true;
    }
    else if(!r.shot&&state.bomb===null&&events.some(e=>e.type==='flag'&&e.flag===24)){r.shot=true;result.shots.push({player:f.slot,kind:'link-bomb'});}
  }
  f.velocity=f.grounded?{x:physics.stationaryGround(f.slot,f.velocity.x),y:0}:physics.customAir(f.slot,f.velocity,a.gravity,a.terminal,a.airFriction);
  return result;
}
export function landLinkSpecial(f:MatchFighter,p:LinkSpecialData,r:LinkRuntime,finish:()=>void):boolean{
  const s=f.special!;
  if(s.direction==='up'){finish();f.state='landing';f.animation='Landing';f.animationRate=1;f.landingFrames=Math.ceil(p.up.landing);return true;}
  if(r.throwBomb){if(r.throwIndex>=18)r.throwIndex-=4;else if(r.throwIndex>=6&&r.throwIndex<=9)r.throwIndex-=6;}
  f.animation=linkSpecialName(f,s.direction,s.phase,r);f.attackName=f.animation;return true;
}
/** ftCo_800CECE8: the second forward smash is gated by the first's cmd0, not any attack cancel. */
export function canLinkSmashFollowup(f:MatchFighter,pressed:boolean):boolean {
  return (f.content.profile.kind==='Lk'||f.content.profile.kind==='Cl')&&pressed&&f.state==='attack'&&f.animation==='AttackS41'&&command(f,0)!==0;
}
export function resetLinkDair(f:MatchFighter):void {
  f.link.dairDisabled=false;f.link.dairTimer=0;f.link.dairRearmedAt=null;f.link.dairHits=[];
}
/** lwOnAnim counts unfrozen animation ticks before restoring the three cached hitboxes. */
export function stepLinkDair(f:MatchFighter):void {
  const r=f.link;
  if(f.state!=='attack'||f.attackName!==f.content.moves.downAir||r.dairTimer<=0)return;
  r.dairTimer=Math.max(0,r.dairTimer-f.animationRate);
  if(r.dairTimer===0&&f.animationFrame<f.content.clips.get(f.animation)!.endFrame){
    r.dairDisabled=false;r.dairRearmedAt=f.animationFrame;f.victims.clear();
  }
}
export function linkHits(f:MatchFighter,hits:ActiveHit[]):ActiveHit[] {
  const p=f.content.specials.parameters,r=f.link;
  if(p.kind==='Lk'||p.kind==='Cl'){
    hits=hits.filter(hit=>hit.bone!==139||(r.hook?.active&&!r.hook.hitDisabled));
    if(r.hook?.hitDisabled&&['Catch','CatchDash','AirCatch'].includes(f.animation))return [];
  }
  if((p.kind!=='Lk'&&p.kind!=='Cl')||f.state!=='attack'||f.attackName!==f.content.moves.downAir)return hits;
  if(r.dairDisabled)return [];
  if(r.dairRearmedAt!==null){
    const cleared=f.content.attacks.get(f.animation)!.events.some(e=>e.type==='clear'&&e.frame>r.dairRearmedAt!&&e.frame<=f.animationFrame);
    return (cleared?hits:r.dairHits).map(hit=>({...hit,damage:p.dairRearmDamage[hit.id]??hit.damage}));
  }
  return hits;
}
/** Native lwOnHit: disable hits, clear fast fall, rebound and rewind a late hit. */
export function linkHitLanded(f:MatchFighter):void {
  const p=f.content.specials.parameters;
  if(p.kind!=='Lk'&&p.kind!=='Cl')return;
  if(f.state==='attack'&&f.attackName===f.content.moves.downAir&&!f.grounded&&!f.link.dairDisabled){
    f.link.dairHits=linkHits(f,activeHits(f.content.attacks.get(f.animation)!,f.animationFrame)).map(hit=>({...hit}));
    f.velocity.y=p.dairBounce;f.fastFall=false;f.link.dairDisabled=true;
    f.link.dairTimer=p.dairRearmFrames;f.link.dairRearmedAt=null;
    // ftLk_Init_OnLoad fills the raw zero end attribute from the original down-air figatree.
    const rewind=f.content.clips.get(f.animation)!.endFrame-p.dairRearmFrames;
    if(f.animationFrame>rewind){f.animationFrame=rewind;f.animationEpoch++;}
  }
}
