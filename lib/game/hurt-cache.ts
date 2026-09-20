import type { MatchFighter, PoseProvider } from './match.ts';
import type { V3 } from '../hsd/model.ts';
import { fighterHurts, hurtEnabled } from './specials.ts';
export interface WorldHurt { a:V3;b:V3;radius:number }
interface Entry { revision:number|undefined;state:string;animation:string;frame:number;epoch:number;direction:string|undefined;phase:string|undefined;capsules:WorldHurt[];min:V3;max:V3 }
/** Phase-local cache only. Never serialized, retained across ticks or used to
 * replace the narrow phase. Providers without a revision are evaluated afresh. */
export class HurtboxCache {
  private entries=new Map<MatchFighter,Entry>();
  constructor(private poses:PoseProvider){}
  get(f:MatchFighter):Entry {
    const revision=this.poses.revision?.(f),old=this.entries.get(f);
    if(revision!==undefined&&old&&old.revision===revision&&old.state===f.state&&old.animation===f.animation&&Object.is(old.frame,f.animationFrame)&&old.epoch===f.animationEpoch&&old.direction===f.special?.direction&&old.phase===f.special?.phase)return old;
    const capsules:WorldHurt[]=[],min:V3=[Infinity,Infinity,Infinity],max:V3=[-Infinity,-Infinity,-Infinity];
    for(const hurt of fighterHurts(f))if(hurtEnabled(f,hurt.bone)){
      const a=this.poses.point(f,hurt.bone,hurt.a),b=this.poses.point(f,hurt.bone,hurt.b);capsules.push({a,b,radius:hurt.radius});
      for(let i=0;i<3;i++){min[i]=Math.min(min[i]!,a[i]!-hurt.radius,b[i]!-hurt.radius);max[i]=Math.max(max[i]!,a[i]!+hurt.radius,b[i]!+hurt.radius);}
    }
    const entry:Entry={revision,state:f.state,animation:f.animation,frame:f.animationFrame,epoch:f.animationEpoch,direction:f.special?.direction,phase:f.special?.phase,capsules,min,max};
    this.entries.set(f,entry);return entry;
  }
}
/** Inclusive, inflated swept AABB: fast projectiles crossing the fighter remain
 * candidates even when both endpoints are outside. Shields/counters run first. */
export function hurtSweepCandidate(hurts:Pick<Entry,'capsules'|'min'|'max'>,a:V3,b:V3,radius:number):boolean {
  if(!hurts.capsules.length)return false;
  for(let i=0;i<3;i++){
    const margin=radius+1e-7*(1+Math.abs(a[i]!)+Math.abs(b[i]!)+Math.abs(hurts.min[i]!)+Math.abs(hurts.max[i]!));
    if(Math.max(a[i]!,b[i]!)+margin<hurts.min[i]!||Math.min(a[i]!,b[i]!)-margin>hurts.max[i]!)return false;
  }
  return true;
}
