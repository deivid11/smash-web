import { loadModel, type HsdModel, type V3 } from '../hsd/model.ts';
import type { HsdArchive } from '../hsd/archive.ts';
import type { StageGameplayData, StageSurface } from './data.ts';
import type { MatchFighter, MatchEvent, PlayerInput, PoseProvider, FighterState } from './match.ts';
import type { GameContent } from './load.ts';

/** Native ftParts[139] is supplied by the hook article, never a fighter skeleton joint. */
export const LINK_HOOK_BONE=139;
export interface HookshotData {
  ground:[number,number,number,number];dash:[number,number,number,number];air:[number,number,number,number];
  segmentLength:number;segments:number;launchSpeed:number;retractSpeed:number;pullSpeed:number;gravity:number;friction:number;groundScale:number;airScale:number;bounce:number;hangFrames:number;climbJump:number;
  tip:HsdModel;segmentsModels:[HsdModel,HsdModel];launcher:HsdModel;launcherBone:number;
}
export interface HookshotRuntime {
  mode:'ground'|'dash'|'air';phase:'held'|'extend'|'slack'|'retract'|'pull'|'hang'|'climb';
  serial:number;age:number;tip:V3;points:V3[];velocity:V3;active:boolean;hitDisabled:boolean;
  wall:number|null;wallT:number;hang:number;
}
export function parseLinkHookshot(arc:HsdArchive):HookshotData {
  const root=[...arc.symbols.values()][0]!,base=arc.pointer(root+4),article=arc.pointer(arc.pointer(root+0x48)+8),sa=arc.pointer(article+4);
  const timer=(o:number)=>{const n=arc.u32(base+o);if(n>600)throw Error('Invalid hookshot timing.');return n;};
  const value=(o:number)=>{const n=arc.f32(sa+o);if(!Number.isFinite(n)||n<0||n>100)throw Error('Invalid hookshot scalar.');return n;};
  const model=(pointer:number,name:string)=>{if(!pointer)throw Error('Missing original hookshot model.');return loadModel(arc,{offset:pointer,name});};
  const segments=arc.u32(sa+0xc);if(segments<2||segments>64)throw Error('Invalid hookshot segment count.');
  return {ground:[timer(0x84),timer(0x88),timer(0x8c),timer(0x90)],dash:[timer(0x94),timer(0x98),timer(0x9c),timer(0xa0)],air:[timer(0xa4),timer(0xa8),timer(0xac),timer(0xb0)],
    segmentLength:value(0x10),segments,launchSpeed:value(0x18),retractSpeed:value(0x20),pullSpeed:value(0x24),gravity:value(0x1c),friction:value(0x28),groundScale:value(0x4c),airScale:value(0x50),bounce:value(0),hangFrames:timer(0xb8),climbJump:arc.f32(base+0xb4),
    tip:model(arc.pointer(sa+0x5c),'hookshot-tip'),segmentsModels:[model(arc.pointer(sa+0x54),'hookshot-chain-a'),model(arc.pointer(sa+0x58),'hookshot-chain-b')],launcher:model(arc.pointer(arc.pointer(article+16)),'hookshot-launcher'),launcherBone:arc.u32(arc.pointer(article+16)+8)};
}
export interface SurfaceContact { surface:StageSurface;point:V3;t:number;u:number }
/** Segment intersection against original static map lines. Fighter ECB remains separate. */
export function traceStage(stage:StageGameplayData,start:V3,end:V3):SurfaceContact|null {
  let best:SurfaceContact|null=null;
  for(const s of stage.surfaces??stage.floors.map(f=>({...f,kind:'floor' as const}))){
    if((s.kind==='floor'&&end[1]>=start[1])||(s.kind==='ceiling'&&end[1]<=start[1]))continue;
    if(s.oneWay&&start[1]<Math.min(s.a[1],s.b[1]))continue;
    const rx=end[0]-start[0],ry=end[1]-start[1],sx=s.b[0]-s.a[0],sy=s.b[1]-s.a[1],cross=rx*sy-ry*sx;
    if(Math.abs(cross)<1e-8)continue;
    const dx=s.a[0]-start[0],dy=s.a[1]-start[1],t=(dx*sy-dy*sx)/cross,u=(dx*ry-dy*rx)/cross;
    if((t>1e-7||(s.kind!=='wall'&&t>=0))&&t<=1&&u>=0&&u<=1&&(!best||t<best.t))best={surface:s,t,u,point:[Math.fround(start[0]+rx*t),Math.fround(start[1]+ry*t),0]};
  }
  return best;
}
const f32=Math.fround;
const distance=(a:V3,b:V3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
function toward(a:V3,b:V3,amount:number):V3 {const d=distance(a,b),t=d>0?Math.min(1,amount/d):1;return [f32(a[0]+(b[0]-a[0])*t),f32(a[1]+(b[1]-a[1])*t),f32(a[2]+(b[2]-a[2])*t)];}
export function hookPoint(f:MatchFighter,offset:V3):V3 {
  const hook=f.link.hook;if(!hook)throw Error('Hookshot attachment queried without its article.');
  return [f32(hook.tip[0]+offset[2]*f.facing),f32(hook.tip[1]+offset[1]),f32(hook.tip[2]+offset[0])];
}
export function beginAirHookshot(f:MatchFighter,change:(state:FighterState,animation:string)=>void):boolean {
  if(!f.content.hookshot||f.grounded||f.link.tetherUsed||f.link.bomb!==null)return false;
  change('attack','AirCatch');f.link.tetherUsed=true;f.link.hook=null;f.fastFall=false;return true;
}
export interface HookHost {content:GameContent;poses:PoseProvider;events:MatchEvent[];change(f:MatchFighter,state:FighterState,animation:string):void;ledge(f:MatchFighter,id:number):boolean}
/** Restricted 2D adaptation of native link-chain extension/constraint/retraction callbacks.
 * Timings, chain length, speed, gravity and original tip/chain models come from each archive. */
export function stepHookshot(f:MatchFighter,host:HookHost):void {
  const p=f.content.hookshot;if(!p)return;
  let r=f.link.hook;
  if(f.grounded||f.state==='ledge')f.link.tetherUsed=false;
  const pulling=f.state==='holding'&&r?.phase==='pull';
  const using=(f.state==='grab'&&['Catch','CatchDash'].includes(f.animation))||(f.state==='attack'&&f.animation==='AirCatch');
  if(!using&&!pulling&&f.state!=='tether'){f.link.hook=null;return;}
  if(f.state==='tether')return;
  const hand=host.poses.point(f,f.content.profile.boneMap[49]!,[0,0,6]);
  const mode=f.animation==='AirCatch'?'air':f.animation==='CatchDash'?'dash':'ground';
  const timing=p[mode];
  if(!pulling&&mode!=='air'&&!f.grounded){host.change(f,'fall','Fall');f.link.hook=null;return;}
  if(!pulling&&(f.animationFrame<timing[0]||f.animationFrame>=timing[3])){f.link.hook=null;return;}
  if(!r){
    const factor=mode==='air'?p.airScale:p.groundScale;
    r={mode,phase:'held',serial:f.attackSerial,age:f.animationFrame,tip:[...hand],points:Array.from({length:Math.max(2,Math.trunc(p.segments*factor))},()=>[...hand] as V3),velocity:[0,0,0],active:false,hitDisabled:false,wall:null,wallT:0,hang:p.hangFrames};f.link.hook=r;
  }
  r.age=f.animationFrame;
  const scale=f.content.profile.attributes.modelScale,factor=r.mode==='air'?p.airScale:p.groundScale,length=p.segmentLength*scale;
  if(r.phase==='held'&&r.age>=timing[1]){r.phase='extend';r.active=true;r.tip=[...hand];r.points=r.points.map(()=>[...hand] as V3);r.velocity=[f32(p.launchSpeed*factor*scale*f.facing),0,0];host.events.push({type:'sound',player:f.slot,x:f.x,y:f.y,sound:f.content.profile.kind==='Cl'?0x111b9:0x27149,volume:127,pan:64});}
  if(!pulling&&r.age>=timing[2]&&r.phase!=='retract'){r.phase='retract';r.hitDisabled=true;host.events.push({type:'sound',player:f.slot,x:f.x,y:f.y,sound:f.content.profile.kind==='Cl'?0x111bc:0x2714c,volume:127,pan:64});}
  if(r.phase==='held'){r.tip=[...hand];r.points=r.points.map(()=>[...hand] as V3);return;}
  if(r.phase==='extend'||r.phase==='slack'){
    if(r.phase==='slack'){r.velocity[1]=f32(r.velocity[1]-p.gravity*scale);r.velocity[0]=f32(Math.sign(r.velocity[0])*Math.max(0,Math.abs(r.velocity[0])-p.friction*scale));}
    const next:V3=[f32(r.tip[0]+r.velocity[0]),f32(r.tip[1]+r.velocity[1]),0],contact=traceStage(host.content.stage,r.tip,next);
    if(contact){
      r.tip=contact.point;r.hitDisabled=true;
      if(r.mode==='air'&&contact.surface.kind==='wall'){
        r.phase='hang';r.wall=contact.surface.id;r.wallT=contact.u;r.hang=p.hangFrames;
        host.change(f,'tether','AirCatchHit');f.attackName=null;f.link.hook=r;f.velocity={x:0,y:0};f.fastFall=false;
      }else {r.phase='slack';r.velocity[0]=f32(-r.velocity[0]*p.bounce);}
    }else r.tip=next;
    const max=length*(r.points.length-1);
    if(distance(r.tip,hand)>max){r.tip=toward(hand,r.tip,max);if(r.phase==='extend'){r.phase='slack';r.hitDisabled=true;}}
  }else if(r.phase==='retract'||r.phase==='pull'){
    const speed=(r.phase==='pull'?p.pullSpeed:p.retractSpeed)*factor*scale;
    r.tip=toward(r.tip,hand,speed);
    if(distance(r.tip,hand)<length){
      f.link.hook=null;
      if(pulling){f.animation='CatchWait';f.animationFrame=0;f.animationEpoch++;f.combat.cursor=-1;}
      return;
    }
  }
  // Native sequential maximum-length constraints, tip toward the hand.
  r.points[0]=[...r.tip];
  for(let i=1;i<r.points.length;i++){const previous=r.points[i-1]!;if(distance(r.points[i]!,previous)>length)r.points[i]=toward(previous,r.points[i]!,length);}
  r.points[r.points.length-1]=[...hand];
}
/** Native AirCatchHit A-reel and timeout; static-wall attachment uses original map segments. */
export function stepTether(f:MatchFighter,input:PlayerInput,previous:PlayerInput,host:HookHost):boolean {
  if(f.state!=='tether')return false;
  const r=f.link.hook,p=f.content.hookshot;
  const surface=host.content.stage.surfaces?.find(s=>s.id===r?.wall);
  if(!r||!p||!surface||--r.hang<=0){host.change(f,'fall','Fall');f.link.hook=null;return false;}
  r.tip=[f32(surface.a[0]+(surface.b[0]-surface.a[0])*r.wallT),f32(surface.a[1]+(surface.b[1]-surface.a[1])*r.wallT),0];
  if(input.attack&&!previous.attack)r.phase='climb';
  const hand=host.poses.point(f,f.content.profile.boneMap[49]!,[0,0,6]),offset:V3=[hand[0]-f.x,hand[1]-f.y,0],scale=f.content.profile.attributes.modelScale;
  if(r.phase==='climb'){
    const next=toward(hand,r.tip,p.pullSpeed*p.airScale*scale);f.x=f32(next[0]-offset[0]);f.y=f32(next[1]-offset[1]);
    if(distance(next,r.tip)<=p.segmentLength*scale){
      const ledge=host.content.stage.ledges.find(l=>Math.hypot(l.x-r.tip[0],l.y-r.tip[1])<=f.content.profile.ledgeSnap.height*scale+5);
      f.link.hook=null;
      if(ledge&&host.ledge(f,ledge.id)){f.link.tetherUsed=false;return true;}
      host.change(f,'ledge-jump','CliffJumpSlow2');f.velocity={x:0,y:f.content.profile.attributes.ledgeJumpY*p.climbJump};return true;
    }
  }else {
    f.velocity.y=Math.max(-f.content.profile.attributes.terminal,f32(f.velocity.y-f.content.profile.attributes.gravity));f.x=f32(f.x+f.velocity.x);f.y=f32(f.y+f.velocity.y);
    const next:V3=[f.x+offset[0],f.y+offset[1],0],max=p.segmentLength*scale*(r.points.length-1);
    if(distance(next,r.tip)>max){const constrained=toward(r.tip,next,max);f.x=f32(constrained[0]-offset[0]);f.y=f32(constrained[1]-offset[1]);f.velocity={x:0,y:0};}
  }
  const end:V3=[f.x+offset[0],f.y+offset[1],0];r.points=r.points.map((_,i)=>toward(r.tip,end,distance(r.tip,end)*i/(r.points.length-1)));return true;
}
