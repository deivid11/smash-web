import { expect,it,vi } from 'vitest';
import type { MatchFighter,PlayerInput } from '../../lib/game/match.ts';
const hooks=vi.hoisted(()=>({allowed:vi.fn(()=>false)}));
vi.mock('../../lib/custom/registry.ts',()=>({requireCustomCharacter:()=>({specials:{allowed:hooks.allowed}})}));
import { beginSpecial } from '../../lib/game/specials.ts';
it('rejects a custom special before consuming facing, momentum, serial or action state',()=>{
 const f={content:{profile:{kind:'custom:test.fighter'},specials:{parameters:{kind:'custom'}}},grounded:false,facing:1,velocity:{x:1.5,y:-1},special:null,specialSerial:9,animation:'Fall',animationRate:1,state:'fall',fastFall:true} as unknown as MatchFighter;
 const input={x:-1,y:0,jump:false,attack:false,special:true} as PlayerInput,before=JSON.stringify(f);
 beginSpecial(f,'side',input);expect(JSON.stringify(f)).toBe(before);expect(hooks.allowed).toHaveBeenCalledWith(f,'side',input);
});
