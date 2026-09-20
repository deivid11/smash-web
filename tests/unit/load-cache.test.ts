import {describe,it,expect} from 'vitest';
import {LoadCache} from '../../lib/hsd/load-cache.ts';
describe('bounded asset load cache',()=>{
  it('coalesces pending work and retains a single completed resource',async()=>{
    const cache=new LoadCache<string,object>(2);let calls=0;const load=async()=>{calls++;await Promise.resolve();return {};};
    const [a,b]=await Promise.all([cache.get('a',load),cache.get('a',load)]);
    expect(a).toBe(b);expect(await cache.get('a',load)).toBe(a);expect(calls).toBe(1);
  });
  it('does not cache failed loads',async()=>{
    const cache=new LoadCache<string,number>(2);await expect(cache.get('a',async()=>{throw Error('offline');})).rejects.toThrow('offline');
    expect(await cache.get('a',async()=>42)).toBe(42);
  });
  it('evicts least recently used values without invalidating held resources',async()=>{
    const cache=new LoadCache<string,object>(2),load=async()=>({});
    const a=await cache.get('a',load),b=await cache.get('b',load);await cache.get('a',load);await cache.get('c',load);
    expect(await cache.get('a',load)).toBe(a);expect(await cache.get('b',load)).not.toBe(b);expect(b).toEqual({});
  });
});
