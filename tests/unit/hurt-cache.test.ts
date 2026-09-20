import {describe,it,expect} from 'vitest';
import {hurtSweepCandidate} from '../../lib/game/hurt-cache.ts';
import {segmentDistanceSquared} from '../../lib/game/collision.ts';
import type {V3} from '../../lib/hsd/model.ts';
describe('conservative projectile broad phase',()=>{
  it('retains crossing and tangent sweeps and rejects definite misses',()=>{
    const h={capsules:[{a:[0,0,0] as V3,b:[0,2,0] as V3,radius:1}],min:[-1,-1,-1] as V3,max:[1,3,1] as V3};
    expect(hurtSweepCandidate(h,[-50,0,0],[50,0,0],.5)).toBe(true);
    expect(hurtSweepCandidate(h,[-50,3.5,0],[50,3.5,0],.5)).toBe(true);
    expect(hurtSweepCandidate(h,[-50,20,0],[50,20,0],.5)).toBe(false);
    expect(hurtSweepCandidate({...h,capsules:[]},[0,0,0],[0,0,0],1)).toBe(false);
  });
  it('never rejects a narrow-phase hit over deterministic varied sweeps',()=>{
    let seed=7;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const point=():V3=>[(rand()-.5)*100,(rand()-.5)*100,(rand()-.5)*100];
    for(let i=0;i<5000;i++){
      const a=point(),b=point(),p=point(),q=point(),r=rand()*8,s=rand()*8;
      const h={capsules:[{a,b,radius:r}],min:a.map((v,k)=>Math.min(v,b[k]!)-r) as V3,max:a.map((v,k)=>Math.max(v,b[k]!)+r) as V3};
      if(segmentDistanceSquared(p,q,a,b)<=(r+s)**2)expect(hurtSweepCandidate(h,p,q,s)).toBe(true);
    }
  });
});
