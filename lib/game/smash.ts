import type { MatchFighter } from './match.ts';
import type { AttackDefinition, ActiveHit } from './moves.ts';
import type { MeleePhysics } from './physics.ts';

export interface SmashRuntime {
  name:string; phase:'startup'|'charging'|'released'; at:number; frames:number;
  maxFrames:number; multiplier:number; resumeRate:number; sounded:boolean;
}
export function beginSmash(move:AttackDefinition):SmashRuntime|null {
  const gate=move.events.find(e=>e.type==='charge');
  return gate?.type==='charge'?{name:move.name,phase:'startup',at:gate.frame,frames:0,maxFrames:gate.maxFrames,multiplier:gate.multiplier,resumeRate:1,sounded:false}:null;
}
/** Restricted PreCharge/Charging/Release adapter from ft_0DF0.c.
 * Called only on unfrozen simulation ticks. Opcode 56 owns the hold point,
 * duration and multiplier; animation/script time is separate from hold time. */
export function stepSmash(f:MatchFighter,held:boolean,soundFrame:number):boolean {
  const s=f.smash;if(!s)return false;
  if(f.state!=='attack'||f.attackName!==s.name||!f.grounded){f.smash=null;f.animationRate=s.resumeRate;return false;}
  if(s.phase==='startup'&&f.animationFrame>=s.at){
    if(held){s.phase='charging';s.resumeRate=f.animationRate;f.animationFrame=s.at;f.animationRate=0;}
    else s.phase='released';
  }else if(s.phase==='charging'){
    // As in the original animation/IASA ordering, count the elapsed hold tick
    // before processing release. A released press never restarts this hold.
    s.frames=Math.min(s.maxFrames,s.frames+1);
    if(!held||s.frames>=s.maxFrames){s.phase='released';f.animationRate=s.resumeRate;}
  }
  if(s.frames>=soundFrame&&s.frames>0&&!s.sounded){s.sounded=true;return true;}
  return false;
}
export function chargedHits(f:MatchFighter,hits:ActiveHit[],physics:MeleePhysics):ActiveHit[] {
  const s=f.smash;
  if(s?.phase==='charging')return [];
  if(!s||s.phase!=='released'||s.frames===0)return hits;
  return hits.map(hit=>({...hit,damage:physics.smashDamage(f.slot,hit.damage,s.frames,s.maxFrames,s.multiplier)}));
}
