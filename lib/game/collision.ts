import type { V3 } from '../hsd/model.ts';
export function pointSegmentDistanceSquared(point: V3, a: V3, b: V3): number {
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=dx*dx+dy*dy+dz*dz;
  const t=length>0?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy+(point[2]-a[2])*dz)/length)):0;
  return (point[0]-a[0]-dx*t)**2+(point[1]-a[1]-dy*t)**2+(point[2]-a[2]-dz*t)**2;
}
export function segmentDistanceSquared(p1:V3,q1:V3,p2:V3,q2:V3):number {
  const d1=q1.map((v,i)=>v-p1[i]!) as V3,d2=q2.map((v,i)=>v-p2[i]!) as V3,r=p1.map((v,i)=>v-p2[i]!) as V3;
  const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],a=dot(d1,d1),e=dot(d2,d2),f=dot(d2,r),clamp=(n:number)=>Math.max(0,Math.min(1,n));
  let s=0,t=0;
  if(a<=1e-10&&e<=1e-10)return dot(r,r);
  if(a<=1e-10)t=clamp(f/e);
  else {const c=dot(d1,r);if(e<=1e-10)s=clamp(-c/a);else{const b=dot(d1,d2),denom=a*e-b*b;s=denom!==0?clamp((b*f-c*e)/denom):0;t=(b*s+f)/e;if(t<0){t=0;s=clamp(-c/a);}else if(t>1){t=1;s=clamp((b-c)/a);}}}
  const delta=r.map((v,i)=>v+d1[i]!*s-d2[i]!*t) as V3;return dot(delta,delta);
}
