import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { ActiveHit, HitDefinition } from './moves.ts';
import type { SpecialDirection } from './special-data.ts';
import { command, rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** Authoritative ftMars motion variables used by Roy/Marth; stored inside the full match snapshot. */
export interface RoyRuntime { charge: number; full: boolean; stage: number; branch: string; failed: boolean; descending: boolean }
const params = (f: MatchFighter) => { const p=f.content.specials.parameters; if(p.kind!=='Fe'&&p.kind!=='Ms'&&p.kind!=='Lu')throw Error('Missing Roy/Marth/Lucina data.');return p; };
export function roySpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix=f.grounded?'Special':'SpecialAir', r=f.special?.roy;
  if(direction==='neutral')return `${prefix}N${phase==='start'?'Start':phase==='loop'?'Loop':r?.full?'EndFull':'End'}`;
  if(direction==='side')return `${prefix}S${r?.stage??1}${r?.branch??''}`;
  if(direction==='up')return f.special?.startedAir?'SpecialAirHi':'SpecialHi';
  return `${prefix}Lw${phase==='hit'?'Hit':''}`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  f.special!.phase=next;f.special!.lastFrame=-1;
  f.animation=roySpecialName(f,f.special!.direction,next);f.animationFrame=0;f.stateFrame=0;f.animationRate=1;f.animationEpoch++;
  f.attackName=f.animation;f.attackSerial++;f.victims.clear();
}
export function beginRoySpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p=params(f);f.special!.roy={charge:0,full:false,stage:1,branch:'',failed:false,descending:false};f.special!.aim=0;
  if(direction==='neutral'){f.velocity.x/=p.neutral.divisor;if(!f.grounded&&f.velocity.y<=0)f.velocity.y=0;}
  if(direction==='side'){
    if(!f.grounded){f.velocity.x/=p.side.divisor;f.velocity.y=f.roySideBoostUsed?0:p.side.boost;f.roySideBoostUsed=true;}
    else f.velocity.y=0;
  }
  if(direction==='up'&&!f.grounded){f.velocity.x*=p.up.momentum;f.velocity.y=0;}
  if(direction==='down'){if(!f.grounded)f.velocity.x/=p.down.divisor;f.velocity.y=0;}
}
/** ftMs_SpecialNEnd_Anim integer division and ftMars_SpecialLwHit_ApplyDamage. */
export function royHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  if((f.content.profile.kind!=='Fe'&&f.content.profile.kind!=='Ms'&&f.content.profile.kind!=='Lu')||!f.special?.roy)return hits;
  const p=params(f),s=f.special,r=s.roy!;
  if(s.direction==='neutral'&&s.phase==='end'&&!r.full)return hits.map(h=>({...h,damage:p.neutral.baseDamage+Math.trunc(r.charge/30)*p.neutral.damagePerSecond}));
  if(s.direction==='down'&&s.phase==='hit'&&(s.counterDamage??0)>0)return hits.map(h=>({...h,damage:s.counterDamage!}));
  return hits;
}
export function royCounter(f: MatchFighter): ReturnType<typeof params>['down'] | null {
  return (f.content.profile.kind==='Fe'||f.content.profile.kind==='Ms'||f.content.profile.kind==='Lu')&&f.state==='special'&&f.special?.direction==='down'&&f.special.phase==='start'&&command(f,1)!==0?params(f).down:null;
}
/** Called only after collision with the original counter sphere, never for grabs. */
export function triggerRoyCounter(f: MatchFighter, hit: HitDefinition, fromX: number): boolean {
  const p=royCounter(f);if(!p||hit.element===8)return false;
  f.special!.counterDamage=Math.trunc(Math.trunc(hit.damage)*p.multiplier);
  f.facing=fromX>=f.x?1:-1;phase(f,'hit');return true;
}
/** Original ftMs orchestration over the prototype floor collision adapter, not a complete engine port. */
export function stepRoySpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless?:boolean,lag?:number,mobility?:number)=>void): SpecialStep {
  const p=params(f),s=f.special!,r=s.roy!,a=f.content.profile.attributes;
  // Lucina's scripts reference Marth-bank cues that don't exist on the ACE disc;
  // voice her direct lucina.ssm samples instead (Roy/Marth keep script audio).
  const out: SpecialStep={handled:true,shots:[],sounds:s.age===0&&p.kind==='Lu'?[s.direction==='neutral'?2444:s.direction==='side'?2448:s.direction==='up'?2454:2457]:[]};s.age++;
  const end=f.animationFrame>=Math.max(1,f.content.clips.get(f.animation)!.endFrame);
  if(s.direction==='neutral'){
    if(s.phase==='start'&&end)phase(f,'loop');
    if(s.phase==='loop'){
      ++r.charge;
      if(r.charge>p.neutral.maxCharge){r.full=true;phase(f,'end');f.animationFrame=1;}
      else if(!input.special){phase(f,'end');f.animationFrame=1;}
      else if(end)phase(f,'loop');
    }else if(s.phase==='end'&&end){finish();return out;}
  }else if(s.direction==='side'){
    const tap=pressed||(input.attack&&!f.previous.attack);
    if(r.stage<4&&tap&&s.age>1){
      if(command(f,0)===0)r.failed=true;
      else if(!r.failed){
        r.stage++;const y=input.y||(input.down?-1:0),threshold=p.side.branchThreshold!;
        r.branch=y>threshold?'Hi':r.stage===2?'Lw':y< -threshold?'Lw':'S';
        r.failed=false;phase(f,'travel');
      }
    }
    if(end&&f.animationFrame!==0){finish();return out;}
  }else if(end){finish(s.direction==='up',p.up.landing,p.up.mobility);return out;}
  const events=(f.content.timelines.get(f.animation)?.events??[]).filter(e=>e.frame>s.lastFrame&&e.frame<=f.animationFrame);s.lastFrame=f.animationFrame;
  // Full Flare Blade's native script applies recoil once. The serial/frame cursor is rollback-owned.
  for(const e of events)if(e.type==='self-damage')f.percent=Math.max(0,Math.min(999,Math.fround(f.percent+e.damage)));
  if(s.direction==='up'){
    if(command(f,0)===0&&Math.abs(input.x)>p.up.threshold){
      const angle=p.up.angle*((Math.abs(input.x)-p.up.threshold)/(1-p.up.threshold))*Math.PI/180*(input.x>0?-1:1);
      if(Math.abs(angle)>Math.abs(s.aim))s.aim=angle;
    }
    if(events.some(e=>e.type==='flag'&&e.flag===20)&&Math.abs(input.x)>p.up.reverse)f.facing=input.x>0?1:-1;
    if(events.some(e=>e.type==='flag'&&e.flag===101)||command(f,0)!==0){f.grounded=false;f.floor=null;f.jumpsUsed=a.maxJumps;}
    if(!f.grounded&&(!s.startedAir||command(f,0)!==0)){
      if(!r.descending){const delta=rootDelta(f);f.velocity=physics.motion(f.slot,delta.z,delta.y,f.facing,s.aim,s.startedAir?p.up.airScale:1);f.velocity.x=Math.abs(f.velocity.x)*f.facing;if(delta.y<0)r.descending=true;}
      else {f.velocity=physics.customAir(f.slot,f.velocity,p.up.gravity,p.up.terminal,0);f.velocity=physics.drift(f.slot,f.velocity,0,a.airDriftStickMul*p.up.mobility,a.airDriftMax*p.up.mobility);}
    }else if(f.grounded)f.velocity=physics.motion(f.slot,rootDelta(f).z,0,f.facing);
    else f.velocity=physics.customAir(f.slot,f.velocity,a.gravity,a.terminal,a.airFriction);
    return out;
  }
  if(s.direction==='side'&&r.stage>=3){
    const delta=rootDelta(f);f.velocity.x=physics.motion(f.slot,delta.z,0,f.facing).x;
    if(f.grounded)f.velocity.y=0;else f.velocity=physics.customAir(f.slot,f.velocity,p.side.gravity,p.side.terminal,0);
  }else if(f.grounded){
    f.velocity={x:s.direction==='neutral'&&s.phase==='start'?physics.customAir(f.slot,{x:f.velocity.x,y:0},0,a.terminal,p.neutral.friction).x:physics.ground(f.slot,f.velocity.x,0),y:0};
  }else{
    const gravity=s.direction==='side'?p.side.gravity:s.direction==='down'&&s.phase==='start'?p.down.gravity:a.gravity;
    const terminal=s.direction==='side'?p.side.terminal:s.direction==='down'&&s.phase==='start'?p.down.terminal:a.terminal;
    const friction=s.direction==='side'?p.side.friction:s.direction==='down'&&s.phase==='start'?p.down.friction:s.direction==='neutral'&&s.phase==='start'?p.neutral.friction:a.airFriction;
    f.velocity=physics.customAir(f.slot,f.velocity,gravity,terminal,friction);
  }
  return out;
}
