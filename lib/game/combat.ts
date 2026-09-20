import type { GameContent } from './load.ts';
import type { MatchFighter, FighterState, MatchEvent, PlayerInput, PoseProvider } from './match.ts';
import { activeHits, type HitDefinition } from './moves.ts';
import { CSTICK_THRESHOLD, cStickEdge } from './smash-stick.ts';
import { command, rootDelta, hurtEnabled, fighterHurts, specialCatchesLedge } from './specials.ts';
import { sampleTrack } from '../hsd/animation.ts';
import type { V3 } from '../hsd/model.ts';
import type { ProjectileWorld } from './projectiles.ts';
import { beginInhaleCapture, stepInhalePull, copiedAbility, inhaleHoldActive, inhaleWalking, KIRBY_EAT_WALKS } from './kirby.ts';
import { beginAirHookshot } from './link-hookshot.ts';
import { cargoWalking } from './dk.ts';
import { diddyClinging, glueDiddy, stepDiddyCaptive } from './diddy.ts';

export interface CombatRuntime {
  shield:number; shieldStun:number; shieldHold:number; flash:number; dizzy:number;
  partner:number|null; holdTimer:number; cursor:number; throwTarget:number|null; motionFacing:number;
  ledge:number|null; ledgeTimer:number; cooldown:number; ledgeReady:boolean;
}
export function createCombat(content:GameContent):CombatRuntime {
  return {shield:content.combat.shield.maximum,shieldStun:0,shieldHold:0,flash:0,dizzy:0,partner:null,holdTimer:0,cursor:-1,throwTarget:null,motionFacing:1,ledge:null,ledgeTimer:0,cooldown:0,ledgeReady:false};
}
export interface CombatHost {
  content:GameContent; fighters:readonly MatchFighter[]; poses:PoseProvider; events:MatchEvent[]; projectiles:ProjectileWorld;
  change(f:MatchFighter,state:FighterState,animation:string):void;
  strike(a:MatchFighter,v:MatchFighter,hit:HitDefinition,point:V3,direction:number,damageOnly?:boolean):void;
}
export function shieldBubble(f:MatchFighter,content:GameContent,poses:PoseProvider):{center:V3;radius:number}|null {
  if(f.state!=='shield'||!f.grounded||f.animation==='GuardOff'||f.combat.shield<=0)return null;
  const p=content.combat.shield,a=f.content.profile.attributes;
  return {center:poses.point(f,f.content.profile.shieldBone,[0,0,0]),radius:a.shieldSize*a.modelScale*(p.minimumScale+(1-p.minimumScale)*f.combat.shield/p.maximum*p.sizeScale)};
}
const isHeld=(s:FighterState)=>s==='holding'||s==='throw'||s==='captured';
/** The captor's Koopa Klaw escape table, when it has one (Bowser and Giga Bowser). */
const klawEscape=(a:MatchFighter):{escapeBase:number;escapeDecay:number;escapeMash:number}|null=>{
  const p=a.content.specials.parameters;return p.kind==='Kp'||p.kind==='Gk'?p.klaw:null;
};
const isLedge=(s:FighterState)=>s==='ledge'||s==='ledge-action';
const axis=(i:PlayerInput)=>i.y||(i.down?-1:0);
// Mashing counts every fresh input, including C-stick flicks and full-deflection
// reversals of either stick (a vigorous smash-stick wiggle helps break free).
const mash=(i:PlayerInput,p:PlayerInput)=>!!((i.attack&&!p.attack)||(i.special&&!p.special)||(i.jump&&!p.jump)||(i.shield&&!p.shield)||(i.grab&&!p.grab)||(i.strong&&!p.strong)||cStickEdge(i,p)||(Math.abs(i.x)>0.5&&Math.sign(i.x)!==Math.sign(p.x))||(Math.abs(axis(i))>0.5&&Math.sign(axis(i))!==Math.sign(axis(p)))||(Math.abs(i.cX??0)>CSTICK_THRESHOLD&&Math.sign(i.cX!)!==Math.sign(p.cX??0))||(Math.abs(i.cY??0)>CSTICK_THRESHOLD&&Math.sign(i.cY!)!==Math.sign(p.cY??0)));
/** Restricted two-to-four-player adaptation of Guard/Escape/Catch/Throw/Cliff routines.
 * Native scripts/parameters drive timing; ECB, victim retargeting, analog
 * shields, powershields and general original state-machine equivalence are not provided. */
export class CombatController {
  constructor(private readonly h:CombatHost){}
  private idle(f:MatchFighter):void{this.h.change(f,f.grounded?'idle':'fall',f.grounded?'Wait1':'Fall');}
  private sound(f:MatchFighter,id:number):void{this.h.events.push({type:'sound',player:f.slot,x:f.x,y:f.y,sound:id,volume:127,pan:64});}
  private change(f:MatchFighter,state:FighterState,animation:string):void {
    this.h.change(f,state,animation);f.combat.cursor=-1;
    f.attackName=['grab','throw','ledge-action'].includes(state)?animation:null;
    f.attackSerial++;f.victims.clear();
  }
  stateChanged(f:MatchFighter,state:FighterState):void {
    if(f.combat.partner!==null&&!isHeld(state))this.release(f);
    if(f.combat.ledge!==null&&!isLedge(state)){f.combat.ledge=null;f.combat.cooldown=this.h.content.combat.ledge.cooldown;}
    if(state!=='shield')f.combat.shieldStun=0;
  }
  release(f:MatchFighter):void {
    const other=f.combat.partner===null?null:this.h.fighters[f.combat.partner];f.combat.partner=null;
    if(!other)return;other.combat.partner=null;
    if(other.state==='captured'){
      other.grounded=f.grounded;other.floor=f.floor;
      this.change(other,'grab-release','CaptureCut');other.velocity.x=-other.facing*0.5;
    }else if(other.state==='holding'||other.state==='throw')this.change(other,'grab-release','CatchCut');
  }
  /** Runs only on an unfrozen fighter tick. True means anchored: do not run gravity/floor integration. */
  before(f:MatchFighter,i:PlayerInput,prev:PlayerInput):boolean {
    const c=f.combat,p=this.h.content.combat,ended=f.animationFrame>=f.content.clips.get(f.animation)!.endFrame;
    c.cooldown=Math.max(0,c.cooldown-1);c.flash=Math.max(0,c.flash-1);
    if(f.state!=='shield'&&f.state!=='ko')c.shield=Math.min(p.shield.maximum,c.shield+p.shield.regen);
    if(f.state==='shield') {
      if(!f.grounded){this.idle(f);return false;}
      if(c.shieldStun>0){c.shieldStun--;if(c.shieldStun===0)this.change(f,'shield','Guard');return false;}
      if(f.animation==='GuardOff'){if(ended)this.idle(f);return false;}
      c.shield=Math.max(0,c.shield-p.shield.drain);c.shieldHold=Math.max(0,c.shieldHold-1);
      if(c.shield<=0){this.breakShield(f);return false;}
      if(i.jump&&!prev.jump){this.idle(f);return false;}
      if(f.content.canGrab!==false&&((i.grab&&!prev.grab)||(i.attack&&!prev.attack))){this.grab(f);return false;}
      if(this.dodgeInput(f,i,prev,false))return false;
      if(!i.shield&&c.shieldHold===0){this.change(f,'shield','GuardOff');this.sound(f,127);return false;}
      if(f.animation==='GuardOn'&&ended)this.change(f,'shield','Guard');
      if(f.animation==='Guard'){f.animationFrame=0;f.animationRate=0;}
    } else if(f.state==='dodge') {
      if(ended){f.velocity.x=0;this.idle(f);}
    } else if(f.state==='air-dodge'&&ended) {
      this.change(f,'helpless','Fall');f.specialLandingLag=p.dodge.landing;f.specialMobility=p.dodge.mobility;f.jumpsUsed=f.content.profile.attributes.maxJumps;
    } else if((f.state==='grab'||f.state==='grab-release')&&ended)this.idle(f);
    else if(f.state==='holding'){
      const other=c.partner===null?undefined:this.h.fighters[c.partner];
      if(!other){this.idle(f);return false;}
      if(f.link.hook?.phase==='pull')return false;
      const eat=f.content.inhale;
      if(eat&&f.animation===eat.hold){if(ended){this.change(f,'holding',eat.wait);this.change(other,'captured','CaptureWaitHi');}return false;}
      if(eat&&(f.animation===eat.wait||inhaleWalking(f))){
        // ftKb_EatWait_IASA: A spits the victim out; B or a downward tilt swallows it (the copy is stolen on the swallow release).
        const name=i.attack&&!prev.attack?eat.spit:(i.special&&!prev.special)||(axis(i)<-eat.stickDown&&axis(prev)>=-eat.stickDown)?eat.swallow:undefined;
        if(name){this.change(f,'throw',name);c.throwTarget=other.slot;c.motionFacing=f.facing;f.animationRate=1;this.change(other,'captured','CaptureWaitHi');other.animationRate=1;return false;}
        // ftKb_EatWait_IASA → ftWalkCommon_800DFCA4: the stick walks with the victim kept in the mouth; match.ts drives speed and stride.
        if(Math.abs(i.x)>eat.walkStick){f.facing=i.x>0?1:-1;if(!inhaleWalking(f))this.change(f,'holding',KIRBY_EAT_WALKS[0]);}
        else if(inhaleWalking(f))this.change(f,'holding',eat.wait);
        return false;
      }
      const cargo=f.content.cargo;
      if(cargo&&f.animation===cargo.lift){if(ended)this.change(f,'holding',cargo.wait);return false;}
      if(cargo&&(f.animation===cargo.wait||cargoWalking(f))){
        // ftDk_ThrowFWait_IASA: A or a fresh smash-side stick throws (ThrowFF/FB), up/down tilts
        // throw high/low, and a held stick walks with the victim kept on the shoulder.
        let name:string|undefined;
        if(i.attack&&!prev.attack)name=cargo.throws.f;
        else if(Math.abs(i.x)>=0.8&&Math.abs(prev.x)<0.8)name=i.x*f.facing>0?cargo.throws.f:cargo.throws.b;
        else if(axis(i)>0.5&&axis(prev)<=0.5)name=cargo.throws.hi;
        else if(axis(i)<-0.5&&axis(prev)>=-0.5)name=cargo.throws.lw;
        if(name){this.change(f,'throw',name);c.throwTarget=other.slot;c.motionFacing=f.facing;f.animationRate=1;this.change(other,'captured','CaptureDamageHi');other.animationRate=1;return false;}
        if(i.x!==0){f.facing=i.x>0?1:-1;if(!cargoWalking(f))this.change(f,'holding',cargo.walks[0]);}
        else if(cargoWalking(f))this.change(f,'holding',cargo.wait);
        return false;
      }
      if(f.animation==='CatchAttack'){if(ended){this.change(f,'holding','CatchWait');this.change(other,'captured','CaptureWaitHi');}return false;}
      if(i.attack&&!prev.attack){this.change(f,'holding','CatchAttack');this.change(other,'captured','CaptureDamageHi');}
      else {
        let name:string|undefined;
        if(Math.abs(i.x)>=0.5&&Math.abs(prev.x)<0.5)name=i.x*f.facing>0?'ThrowF':'ThrowB';
        else if(axis(i)>0.5&&axis(prev)<=0.5)name='ThrowHi';
        else if(axis(i)<-0.5&&axis(prev)>=-0.5)name='ThrowLw';
        if(name){
          // ftDk_ThrowF is the cargo lift, not a release throw: the victim moves to the shoulder.
          if(name==='ThrowF'&&f.content.cargo){this.change(f,'holding',f.content.cargo.lift);this.change(other,'captured','CaptureWaitHi');return false;}
          this.change(f,'throw',name);c.throwTarget=other.slot;c.motionFacing=f.facing;
          const index=['ThrowF','ThrowB','ThrowHi','ThrowLw'].indexOf(name);
          f.animationRate=f.content.profile.attributes.independentThrows&(1<<index)?1:1/(other.content.profile.attributes.weight*p.grab.weightScale);
          this.change(other,'captured',name==='ThrowLw'?'DownWaitU':'CaptureDamageHi');other.animationRate=f.animationRate;
        }
      }
    } else if(f.state==='captured') {
      const owner=c.partner===null?undefined:this.h.fighters[c.partner];
      if(!owner||owner.combat.partner!==f.slot){this.release(f);this.idle(f);return false;}
      if(owner.link.hook?.phase==='pull')return true;
      // Monkey Flip: the captive runs Diddy's Taro motions (its own mash-out and fall).
      if(diddyClinging(owner))return stepDiddyCaptive(f,owner,mash(i,prev),{floors:this.h.content.stage.floors,poses:this.h.poses,mash:p.grab.mash,strike:(a,v,hit,point,direction)=>this.h.strike(a,v,hit,point,direction)});
      // ftCo_CaptureKoopa runs the victim's own mash-out while the captor stays inside its special,
      // so a command grab that arms a timer (the Klaw) is escapable; Falcon Dive arms none and is
      // released by its own flow instead.
      const klaw=klawEscape(owner);
      if(owner.state!=='throw'&&(owner.state!=='special'||(klaw!==null&&c.holdTimer>0))){
        // An inhaled victim escapes on Kirby's own timer (ftCo_CaptureWaitKirby/ftCommon_GrabMash).
        const eat=owner.content.inhale&&inhaleHoldActive(owner)?owner.content.inhale:null;
        c.holdTimer-=klaw?klaw.escapeDecay+(mash(i,prev)?klaw.escapeMash:0)
          :eat?eat.holdDecay+(mash(i,prev)?eat.mashResistance:0):p.grab.decay+(mash(i,prev)?p.grab.mash:0);
        if(c.holdTimer<=0){this.release(f);f.grounded=owner.grounded;f.floor=owner.floor;this.change(f,'grab-release','CaptureCut');return false;}
        if(f.animation==='CapturePulledHi'&&ended)this.change(f,'captured','CaptureWaitHi');
      }
      return true;
    } else if(f.state==='throw'&&ended){this.release(f);this.idle(f);}
    else if(f.state==='shield-break'){
      if(ended){f.animation='Fall';f.animationFrame=0;f.animationEpoch++;}
    }else if(f.state==='dizzy'){
      if(f.animation==='FuraSleepStart'&&ended)this.change(f,'dizzy','FuraSleepLoop');
      if(f.animation==='FuraSleepEnd'){if(ended)this.idle(f);return false;}
      c.dizzy-=1+(mash(i,prev)?p.grab.mash:0);
      if(c.dizzy<=0){
        if(f.animation==='FuraSleepStart'||f.animation==='FuraSleepLoop')this.change(f,'dizzy','FuraSleepEnd');
        else this.idle(f);
      }
    }else if(f.state==='frozen'){
      // ftCo_DamageIce_Anim: the block spins while it falls, the timer runs down a frame at a
      // time, and mashing knocks chunks off it. ftCo_80091854 breaks it open.
      const ice=f.ice!;
      if(!f.grounded)ice.angle=Math.fround(ice.angle+ice.spin);
      ice.timer-=p.ice.decay+(mash(i,prev)?p.ice.mash:0);
      if(ice.timer<=0)this.breakIce(f,i);
      return false;
    }else if(f.state==='bury'){
      // ftCo_Bury_Anim: the frozen pose sinks for sinkFrames, then waits on the mash-out timer.
      const b=f.bury!;
      if(b.frames>0){b.frames--;f.y=Math.fround(f.y-b.sink);b.depth=Math.fround(b.depth+b.sink);}
      b.timer-=p.bury.decay+(mash(i,prev)?p.bury.mash:0);
      if(b.timer<=0){
        // ftCo_BuryJump: popping out is an ordinary forward jump from floor level.
        f.y=Math.fround(f.y+b.depth);f.bury=null;
        f.grounded=false;f.floor=null;f.jumpsUsed=1;f.fastFall=false;
        f.velocity=this.h.content.physics.jump(f.slot,{x:0,y:0},0,false);
        this.change(f,'jump','JumpF');
      }
      return true;
    }
    if(f.state==='ledge'||f.state==='ledge-action')return this.ledgeStep(f,i,prev);
    if(f.state==='ledge-jump'&&ended)this.idle(f);
    return false;
  }
  tryAction(f:MatchFighter,i:PlayerInput,prev:PlayerInput):boolean {
    if(!f.grounded&&((i.grab&&!prev.grab)||(i.shield&&i.attack&&!prev.attack))&&beginAirHookshot(f,(state,animation)=>this.change(f,state,animation)))return true;
    if(f.content.canGrab!==false&&f.grounded&&((i.grab&&!prev.grab)||(i.shield&&i.attack&&!prev.attack))){this.grab(f,!!i.walk);return true;}
    if(i.jump&&!prev.jump)return false;
    if(i.shield&&f.grounded){
      if(this.dodgeInput(f,i,prev,!prev.shield))return true;
      this.change(f,'shield','GuardOn');f.combat.shieldHold=this.h.content.combat.shield.minimumHold;this.sound(f,110);return true;
    }
    if(i.shield&&!prev.shield&&!f.grounded){
      this.change(f,'air-dodge','EscapeAir');f.fastFall=false;
      const p=this.h.content.combat.dodge,y=axis(i),moving=Math.abs(i.x)>=p.deadX||Math.abs(y)>=p.deadY,angle=Math.atan2(y,i.x);
      f.velocity={x:moving?Math.fround(p.speed*Math.cos(angle)):0,y:moving?Math.fround(p.speed*Math.sin(angle)):0};return true;
    }
    return false;
  }
  private dodgeInput(f:MatchFighter,i:PlayerInput,prev:PlayerInput,fresh:boolean):boolean {
    const p=this.h.content.combat.dodge;
    let name:string|undefined;
    if(axis(i)<=p.down&&(fresh||axis(prev)>p.down))name='EscapeN';
    else if(Math.abs(i.x)>=p.side&&(fresh||Math.abs(prev.x)<p.side))name=i.x*f.facing>=0?'EscapeF':'EscapeB';
    if(!name)return false;
    this.roll(f,name);return true;
  }
  /** ftCo_800992A8: the shared roll entry. Callers outside the shield (ftCo_8009917C reached
   * from a charging special's IASA) hand in the side the stick chose. */
  roll(f:MatchFighter,name:string):void {
    this.change(f,'dodge',name);f.combat.motionFacing=f.facing;f.velocity={x:0,y:0};
  }
  private grab(f:MatchFighter,walking=false):void{this.change(f,'grab',f.state==='run'&&!walking?'CatchDash':'Catch');}
  physics(f:MatchFighter):boolean {
    if(f.content.hookshot&&f.state==='attack'&&f.animation==='AirCatch'&&!f.grounded){
      const a=f.content.profile.attributes,old=f.velocity.y,v=this.h.content.physics.air(f.slot,f.velocity,f.previous.x,f.fastFall);
      if(!f.fastFall&&f.animationFrame<20&&old<0)v.y=Math.max(-a.terminal,Math.fround(old-a.gravity*.2));f.velocity=v;return true;
    }
    if(f.state==='air-dodge'){
      if(command(f,0)===0){const d=this.h.content.combat.dodge.decay;f.velocity={x:Math.fround(f.velocity.x*d),y:Math.fround(f.velocity.y*d)};return true;}
      f.velocity=this.h.content.physics.air(f.slot,f.velocity,0,false);return true;
    }
    if(f.state==='dodge'&&f.animation!=='EscapeN'){
      const root=rootDelta(f);f.velocity=this.h.content.physics.motion(f.slot,root.z,0,f.combat.motionFacing);return true;
    }
    if(f.state==='ledge-jump'&&f.stateFrame===0)return true;
    return false;
  }
  land(f:MatchFighter):boolean {
    // ftCo_DamageIce_Coll: the block just settles on the floor; the freeze keeps running.
    if(f.state==='frozen'){f.velocity={x:f.velocity.x,y:0};return true;}
    if(f.state==='air-dodge'){this.change(f,'landing','Landing');f.landingFrames=this.h.content.combat.dodge.landing;return true;}
    if(f.state==='shield-break'){this.change(f,'dizzy','FuraFura');f.invulnerable=0;return true;}
    return false;
  }
  private breakShield(f:MatchFighter):void {
    const p=this.h.content.combat.shield;
    this.change(f,'shield-break','DamageFlyN');f.grounded=false;f.floor=null;f.velocity={x:0,y:f.content.profile.attributes.shieldBreakY};
    f.combat.shield=p.restored;f.combat.dizzy=Math.max(0,p.dizzyBase-f.percent)+p.dizzyMinimum;
    this.h.events.push({type:'shield-break',player:f.slot,x:f.x,y:f.y});this.sound(f,130);
  }
  block(a:MatchFighter|null,v:MatchFighter,hit:HitDefinition,point:V3,projectile=false,fromX=0):void {
    const p=this.h.content.combat.shield,c=v.combat;
    c.shield-=Math.max(0,hit.damage+(hit.shieldDamage??0))*p.damageScale+p.damageBase;c.flash=8;
    const result=this.h.content.physics.hit(v.slot,v.percent,hit,false),stun=Math.max(1,Math.floor(hit.damage*p.stunScale+p.stunBase));
    const broke=c.shield<=0;
    if(broke)this.breakShield(v);
    else {this.change(v,'shield','GuardDamage');c.shieldStun=stun;v.animationRate=v.content.clips.get('GuardDamage')!.endFrame/stun;v.velocity.x=Math.sign(v.x-(a?a.x:fromX))*Math.min(p.pushMaximum,stun*p.pushScale);}
    v.hitlag=Math.max(v.hitlag,result.hitlag);if(!projectile&&a)a.hitlag=Math.max(a.hitlag,result.hitlag);
    this.h.events.push({type:'shield',player:v.slot,x:point[0],y:point[1],damage:hit.damage});
    // Shield-hit thunk only on full depletion (shield-break knock); chipped GuardDamage stays silent.
    if(broke)this.sound(v,129);
  }
  /** Kirby's inhale grab box: the victim is pulled toward the mouth before being held. */
  inhale(a:MatchFighter,v:MatchFighter):void {
    if(a.combat.partner!==null||!a.content.inhale||!this.grabbable(v))return;
    beginInhaleCapture(a);this.change(v,'captured','CapturePulledHi');
    a.combat.partner=v.slot;v.combat.partner=a.slot;v.combat.holdTimer=a.content.inhale.holdFrames;
    v.velocity={x:0,y:0};v.knockback={x:0,y:0};v.hitlag=0;v.hitstun=0;v.grounded=false;v.floor=null;v.facing=-a.facing;
    this.h.events.push({type:'grab',player:a.slot,x:v.x,y:v.y});
  }
  /** ftCo_DamageSleep: a sleep-element hit on a grounded victim sways it asleep in place.
   * Element 6 (Nap) holds 103 frames, element 7 412; mashing drains it like the shield dizzy. */
  sleep(v:MatchFighter,frames:number):boolean {
    if(!v.grounded||v.state==='dizzy'||v.state==='bury'||v.combat.partner!==null)return false;
    this.change(v,'dizzy','FuraSleepStart');
    v.velocity={x:0,y:0};v.knockback={x:0,y:0};v.hitstun=0;
    v.combat.dizzy=frames;
    return true;
  }
  /** ftCo_800C0D0C: plant a grounded victim into the floor. The current pose freezes and sinks
   * hip-deep over sinkFrames; the escape timer is the grab formula with bury coefficients. */
  bury(v:MatchFighter):boolean {
    if(!v.grounded||v.state==='bury'||v.combat.partner!==null)return false;
    const b=this.h.content.combat.bury;
    const hip=this.h.poses.point(v,v.content.profile.boneMap[4]!,[0,0,0]);
    const depth=Math.max(1,hip[1]-v.y);
    const animation=v.animation,frame=v.animationFrame;
    this.change(v,'bury',animation);
    v.animationFrame=frame;v.animationRate=0;
    v.velocity={x:0,y:0};v.knockback={x:0,y:0};v.hitstun=0;
    v.bury={depth:0,sink:depth/b.sinkFrames,frames:b.sinkFrames,timer:b.base+v.percent*b.percentScale};
    return true;
  }
  /** ftCo_DamageIce_Init: an ice hit seals the victim inside a block. The pose freezes where it
   * was, the knockback becomes the block's own drift, and the mash-out timer is the hit's own
   * damage times the common scale. ftCo_DamageIce_HitWhileFrozen re-enters without re-arming
   * that timer, so hitting a frozen fighter never extends the freeze. */
  freeze(v:MatchFighter,damage:number,knockback:{x:number;y:number}):void {
    const ice=this.h.content.combat.ice,physics=this.h.content.physics;
    const timer=v.state==='frozen'&&v.ice?v.ice.timer:Math.max(1,damage*ice.timerScale);
    if(v.state!=='frozen'){const frame=v.animationFrame;this.change(v,'frozen',v.animation);v.animationFrame=frame;}
    v.animationRate=0;v.hitstun=0;v.fastFall=false;
    // The launch is handed to the block itself instead of the damage state.
    v.velocity={x:knockback.x,y:knockback.y};v.knockback={x:0,y:0};
    if(v.velocity.y>0.001){v.grounded=false;v.floor=null;v.jumpsUsed=Math.max(1,v.jumpsUsed);}
    v.ice={timer,spin:Math.fround(ice.spinMin+(ice.spinMax-ice.spinMin)*physics.random()),angle:v.ice?.angle??0};
  }
  /** ftCo_DamageIce_OnHit2: damage taken inside the block shortens the freeze, and a fire hit
   * thaws it outright. */
  frozenHit(v:MatchFighter,damage:number,element:number):void {
    const ice=this.h.content.combat.ice;
    if(!v.ice)return;
    v.ice.timer=element===1?0:v.ice.timer-damage*ice.damageScale;
  }
  /** ftCo_80091854 -> ftCo_MS_DamageIceJump: the block shatters and pops the fighter out, drifting
   * with the stick, until the escape timer drops them into a normal fall. */
  private breakIce(f:MatchFighter,i:PlayerInput):void {
    const attrs=f.content.profile.attributes;
    f.ice=null;f.grounded=false;f.floor=null;f.fastFall=false;f.animationRate=1;
    f.velocity={x:Math.fround(i.x*(attrs.iceJumpX??1)),y:attrs.iceJumpY??2.3};
    f.jumpsUsed=Math.max(1,f.jumpsUsed);
    this.change(f,'hitstun','DamageFlyN');
    f.hitstun=Math.max(1,Math.round(this.h.content.combat.ice.jumpFrames));
    this.sound(f,0x123);
  }
  /** Command-grab capture while the attacker stays inside its special (Falcon Dive).
   * The victim cannot mash out; the special's own flow releases through a throw. */
  specialCatch(a:MatchFighter,v:MatchFighter,keepGround=false):boolean {
    if(a.combat.partner!==null||!this.grabbable(v))return false;
    const grounded=v.grounded,floor=v.floor;
    this.change(v,'captured','CapturePulledHi');
    // ftCommon_InitGrab(x4C) for the Klaw; a captor without an escape table holds until its own flow ends.
    a.combat.partner=v.slot;v.combat.partner=a.slot;v.combat.holdTimer=klawEscape(a)?.escapeBase??0;
    v.velocity={x:0,y:0};v.knockback={x:0,y:0};v.hitlag=0;v.hitstun=0;v.grounded=keepGround&&grounded;v.floor=keepGround&&grounded?floor:null;v.facing=-a.facing;
    this.h.events.push({type:'grab',player:a.slot,x:v.x,y:v.y});this.sound(a,527);return true;
  }
  catch(a:MatchFighter,v:MatchFighter):void {
    if(a.combat.partner!==null||!this.grabbable(v))return;
    const hook=a.content.hookshot?a.link.hook:null,animation=hook?a.animation:'CatchWait',frame=a.animationFrame;
    this.change(a,'holding',animation);this.change(v,'captured','CapturePulledHi');
    if(hook){hook.phase='pull';hook.hitDisabled=true;a.link.hook=hook;a.animationFrame=frame;}
    a.combat.partner=v.slot;v.combat.partner=a.slot;v.combat.holdTimer=this.h.content.combat.grab.base+v.percent*this.h.content.combat.grab.percentScale;
    a.velocity={x:0,y:0};v.velocity={x:0,y:0};v.knockback={x:0,y:0};v.hitlag=0;v.hitstun=0;v.grounded=false;v.floor=null;v.facing=-a.facing;
    this.h.events.push({type:'grab',player:a.slot,x:v.x,y:v.y});this.sound(a,527);
  }
  clash(a:MatchFighter,b:MatchFighter):void{this.change(a,'grab-release','CatchCut');this.change(b,'grab-release','CatchCut');}
  syncAnchors():void {
    for(const f of this.h.fighters)if(isLedge(f.state)){this.ledgePose(f);this.h.poses.sample(f,false);}
    this.syncCaptures();
  }
  syncCaptures():void {
    for(const f of this.h.fighters){if(f.state!=='captured'||f.combat.partner===null)continue;const owner=this.h.fighters[f.combat.partner]!;
      // Monkey Flip rides the captive: Diddy moves onto it (SpecialS_ThrowInit's joint glue).
      if(diddyClinging(owner)){glueDiddy(owner,f,this.h.poses);this.h.poses.sample(owner,false);continue;}
      if(owner.state==='special'&&owner.content.inhale){const ox=f.x,oy=f.y;stepInhalePull(owner,f,(x,s,a)=>this.change(x,s,a));if(this.crossesWall(ox,oy,f.x,f.y)){f.x=ox;f.y=oy;}this.h.poses.sample(f,false);continue;}
      const anchor=owner.link.hook?.phase==='pull'?owner.link.hook.tip:this.h.poses.point(owner,owner.content.profile.boneMap[52]!,[0,0,0]);
      const hip=this.h.poses.point(f,f.content.profile.boneMap[4]!,[0,0,0]);
      const nextX=Math.fround(f.x+anchor[0]-hip[0]),nextY=Math.fround(f.y+anchor[1]-hip[1]);
      // A held victim never crosses a wall face with its owner (grabbed through thin
      // rock would otherwise teleport it inside). It stays outside on a blocked drag.
      if(!this.crossesWall(f.x,f.y,nextX,nextY)){f.x=nextX;f.y=nextY;}
      // Restricted flat-floor correction: never bury a captured victim under
      // its captor's supporting floor while substituting the victim pose.
      if(owner.grounded)f.y=Math.max(owner.y,f.y);
      this.h.poses.sample(f,false);
    }
  }
  /** Segment-vs-wall faces from the live stage (no vertex grazes: sealed). */
  private crossesWall(ox:number,oy:number,nx:number,ny:number):boolean {
    if(nx===ox&&ny===oy)return false;
    for(const s of this.h.content.stage.surfaces??[]){
      if(s.kind!=='wall')continue;
      const fx=s.b[0]-s.a[0],fy=s.b[1]-s.a[1],mx=nx-ox,my=ny-oy,denom=mx*fy-my*fx;
      if(Math.abs(denom)<1e-9)continue;
      const ax=s.a[0]-ox,ay=s.a[1]-oy,t=(ax*fy-ay*fx)/denom,u=(ax*my-ay*mx)/denom;
      if(t>=0&&t<=1&&u>=0&&u<=1)return true;
    }
    return false;
  }
  resolve(frozen:readonly boolean[]):void {
    for(const f of this.h.fighters){if(frozen[f.slot]||f.hitlag>0)continue;const c=f.combat;
      if(f.state==='dodge'){
        for(const e of f.content.timelines.get(f.animation)!.events)if(e.frame>c.cursor&&e.frame<=f.animationFrame&&e.type==='flag'&&e.flag===20&&e.value===0)f.facing=-f.facing;
      }
      if(f.state==='holding'||f.state==='throw'){
        const victim=c.partner===null?null:this.h.fighters[c.partner]!;
        // Cargo wait/walk clips carry no attack scripts; only scripted holds scan pummel hits.
        const held=f.content.attacks.get(f.animation);
        if(victim&&held&&f.link.hook?.phase!=='pull'){
          for(const hit of activeHits(held,f.animationFrame)){
            const key=`capture:${hit.group}:${hit.activation}`;if(f.victims.has(key))continue;
            f.victims.add(key);this.h.strike(f,victim,hit,this.h.poses.point(f,hit.bone,hit.offset),f.facing,true);
            const lag=this.h.content.physics.hit(victim.slot,victim.percent,hit,true).hitlag;f.hitlag=Math.max(f.hitlag,lag);victim.hitlag=Math.max(victim.hitlag,lag);
          }
        }
        const eat=f.content.inhale,eatThrow=!!eat&&(f.animation===eat.spit||f.animation===eat.swallow);
        if(f.state==='throw')for(const e of f.content.timelines.get(f.animation)!.events){
          if(e.frame<=c.cursor||e.frame>f.animationFrame)continue;
          // Kirby's spit/swallow scripts release through cmd_vars[0] instead of the throw flag.
          // Falcon Dive's SpecialHiThrow has no release flag: its throw op fires immediately.
          const releases=eatThrow?(e.type==='command'&&e.index===0&&e.value===1):f.animation==='SpecialHiThrow'?(e.type==='throw-hit'&&e.index===0):(e.type==='flag'&&e.flag===20&&e.value===0);
          if(releases&&victim&&c.partner!==null){
            // ftKb_SpecialNDrink_Anim: swallowing steals the victim's neutral special before the release throw.
            if(eatThrow&&f.animation===eat!.swallow)f.copyAbility=copiedAbility(f,victim);
            const def=f.content.attacks.get(f.animation)!.events.find(e=>e.type==='throw-hit'&&e.index===0);
            if(def?.type==='throw-hit'){
              c.partner=null;victim.combat.partner=null;
              if(f.grounded)victim.y=Math.max(f.y,victim.y);
              victim.grounded=false;victim.floor=null;
              this.h.strike(f,victim,def.hit,[victim.x,victim.y,0],f.animation==='ThrowB'?-c.motionFacing:c.motionFacing);
              // Throws use the original knockback function but not ordinary hitlag.
              victim.hitlag=0;f.hitlag=0;
              this.h.events.push({type:'throw',player:f.slot,x:victim.x,y:victim.y,damage:def.hit.damage});
            }
          }
          if(e.type==='flag'&&e.flag===20&&e.value===1)f.facing=-f.facing;
          if(e.type==='flag'&&e.flag===24&&(f.content.profile.kind==='Fx'||f.content.profile.kind==='Fc')&&c.throwTarget!==null){
            const target=this.h.fighters[c.throwTarget]!,shot=this.h.projectiles.spawn(f,'laser',this.h.poses);
            const original=f.content.specials.articles.projectile?.throwHit;if(original)shot.hit={...original};
            const center=this.h.poses.point(target,target.content.profile.boneMap[4]!,[0,0,0]),angle=Math.atan2(center[1]-shot.y,center[0]-shot.x),speed=Math.hypot(shot.vx,shot.vy);
            shot.vx=Math.fround(Math.cos(angle)*speed);shot.vy=Math.fround(Math.sin(angle)*speed);this.sound(f,110109);
          }
        }
      }
      c.cursor=f.animationFrame;
    }
  }
  private rootPosition(f:MatchFighter):{z:number;y:number} {
    const tracks=f.content.clips.get(f.animation)!.joints[f.content.profile.motionRoot]!.tracks,scale=f.content.profile.attributes.modelScale;
    const value=(type:number)=>{const t=tracks.find(t=>t.type===type);return (t?sampleTrack(t.keys,f.animationFrame)??0:0)*scale;};
    return {z:value(7),y:value(6)};
  }
  tryLedge(f:MatchFighter,i:PlayerInput,oldY:number):void {
    if(f.grounded||f.hitlag>0||f.combat.cooldown>0||axis(i)<=-this.h.content.combat.ledge.down||f.velocity.y>0||!['fall','jump','airjump','helpless','special'].includes(f.state))return;
    if(f.special&&!(specialCatchesLedge(f)??(f.special.direction==='up'||f.special.direction==='side')))return;
    const snap=f.content.profile.ledgeSnap,scale=f.content.profile.attributes.modelScale;
    for(const ledge of this.h.content.stage.ledges){
      if(this.h.fighters.some(other=>other!==f&&other.combat.ledge===ledge.id))continue;
      if((f.x-ledge.x)*ledge.facing>0.5||Math.abs(f.x-ledge.x)>snap.x*scale)continue;
      const lower=(snap.y-snap.height/2)*scale,upper=(snap.y+snap.height/2)*scale;
      if(ledge.y-f.y<lower||ledge.y-oldY>upper)continue;
      this.takeLedge(f,ledge.id);return;
    }
  }
  takeLedge(f:MatchFighter,id:number):boolean {
    const ledge=this.h.content.stage.ledges.find(l=>l.id===id);
    if(!ledge||this.h.fighters.some(other=>other!==f&&other.combat.ledge===id))return false;
    this.change(f,'ledge','CliffCatch');f.combat.ledge=id;f.combat.ledgeReady=false;f.facing=ledge.facing;
    f.velocity={x:0,y:0};f.knockback={x:0,y:0};f.fastFall=false;f.jumpsUsed=0;f.capeBoostUsed=false;f.tornadoUsed=false;f.link.tetherUsed=false;
    f.specialLandingLag=0;f.specialMobility=1;f.invulnerable=this.h.content.combat.ledge.invincibility;
    this.ledgePose(f);this.h.events.push({type:'ledge',player:f.slot,x:ledge.x,y:ledge.y});this.sound(f,4);return true;
  }
  private ledgePose(f:MatchFighter):void {
    const ledge=this.h.content.stage.ledges.find(l=>l.id===f.combat.ledge);if(!ledge)return;
    const root=this.rootPosition(f);f.x=Math.fround(ledge.x+root.z*ledge.facing);f.y=Math.fround(ledge.y+root.y);
    f.grounded=f.state==='ledge-action'&&!f.animation.includes('Jump')&&root.z>=0&&root.y>=-0.01;f.floor=f.grounded?ledge.floor:null;
  }
  private ledgeStep(f:MatchFighter,i:PlayerInput,prev:PlayerInput):boolean {
    const p=this.h.content.combat.ledge,c=f.combat,end=f.animationFrame>=f.content.clips.get(f.animation)!.endFrame;
    const ledge=this.h.content.stage.ledges.find(l=>l.id===c.ledge);if(!ledge){this.idle(f);return false;}
    if(f.animation==='CliffCatch'&&end){this.change(f,'ledge','CliffWait');c.ledgeTimer=f.percent<p.slowPercent?p.quickWait:p.slowWait;f.invulnerable=p.invincibility;}
    if(f.state==='ledge'&&f.animation==='CliffWait'){
      c.ledgeTimer--;const neutral=Math.abs(i.x)<p.input&&Math.abs(axis(i))<p.input;
      if(neutral)c.ledgeReady=true;
      let name:string|undefined;
      const suffix=f.percent<p.slowPercent?'Quick':'Slow';
      if(i.jump&&!prev.jump)name=`CliffJump${suffix}1`;
      else if((i.attack&&!prev.attack)||(i.strong&&!prev.strong)||cStickEdge(i,prev))name=`CliffAttack${suffix}`;
      else if(i.shield&&!prev.shield)name=`CliffEscape${suffix}`;
      else if(c.ledgeReady&&(axis(i)>p.input||i.x*ledge.facing>p.input))name=`CliffClimb${suffix}`;
      else if(c.ledgeTimer<=0||(c.ledgeReady&&(axis(i)<-p.input||i.x*ledge.facing<-p.input))){f.grounded=false;this.change(f,'fall','Fall');return false;}
      if(name){this.change(f,'ledge-action',name);f.invulnerable=0;}
    }else if(f.state==='ledge-action'&&end){
      if(f.animation.includes('Jump')){
        const name=f.animation.replace(/1$/,'2');this.change(f,'ledge-jump',name);f.grounded=false;f.floor=null;f.jumpsUsed=1;
        f.velocity={x:f.facing*f.content.profile.attributes.ledgeJumpX,y:f.content.profile.attributes.ledgeJumpY};return false;
      }
      f.grounded=true;f.floor=ledge.floor;f.x=ledge.x+Math.max(0.5,(f.x-ledge.x)*ledge.facing)*ledge.facing;f.y=ledge.y;this.idle(f);return false;
    }
    this.ledgePose(f);return true;
  }
  grabbable(v:MatchFighter):boolean{return v.invulnerable===0&&!['ko','respawn','captured','shield-break','bury','frozen'].includes(v.state)&&v.combat.partner===null&&fighterHurts(v).some(h=>h.grabbable!==false&&hurtEnabled(v,h.bone));}
}
