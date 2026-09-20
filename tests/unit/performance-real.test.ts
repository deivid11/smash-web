import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Scene,PerspectiveCamera,Mesh,ShaderMaterial} from 'three';
import {openDisc} from '../../scripts/node-disc.ts';
import {verifyMeleeDisc} from '../../lib/disc.ts';
import {HsdAssetSession} from '../../lib/hsd/session.ts';
import {loadGameContent,type GameContent} from '../../lib/game/load.ts';
import {rosterPair} from '../../lib/game/roster.ts';
import {LocalMatch,neutralInput} from '../../lib/game/match.ts';
import {RollbackDriver,normalizeInput} from '../../lib/game/rollback.ts';
import {HurtboxCache} from '../../lib/game/hurt-cache.ts';
import {GameRigs} from '../../web/src/render/game-rig.ts';
import {ModelInstance} from '../../web/src/render/model-instance.ts';
import {CommonEffects} from '../../web/src/render/common-effects.ts';
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('performance optimizations preserve native state and resources',()=>{
  let base:GameContent,session:HsdAssetSession,disc:Awaited<ReturnType<typeof openDisc>>,reads=0;
  const disposables:Array<{dispose():void}>=[];
  beforeAll(async()=>{disc=await openDisc(iso!);const info=await verifyMeleeDisc(disc);session=new HsdAssetSession({size:disc.size,read:async(o,n)=>{reads++;return disc.read(o,n);}},info);base=await loadGameContent(session,new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer,undefined,'final');},30000);
  afterAll(async()=>{await disc?.close();});afterEach(()=>{for(const d of disposables.splice(0))d.dispose();vi.restoreAllMocks();});
  const make=()=>{const content=rosterPair(base,'Mr','Fx'),rig=new GameRigs(content);disposables.push(rig);return {rig,match:new LocalMatch(content,rig,{opponent:'human',countdown:0,seconds:600,seed:44})};};
  it('memoizes the same figatree range, including concurrent callers',async()=>{
    const table=await session.actionTable('Mr'),action=table.find(a=>a.name==='Wait1')!;
    const before=reads,[a,b]=await Promise.all([session.clip('Mr',action),session.clip('Mr',action)]);
    expect(a).toBe(b);expect(reads-before).toBeLessThanOrEqual(1);
    const after=reads;expect(await session.clip('Mr',action)).toBe(a);expect(reads).toBe(after);
    const [x,y]=await Promise.all([session.archive('EfLkData.dat'),session.archive('EfLkData.dat')]);expect(x).toBe(y);
  });
  it('collision-only evaluation matches full poses and prepared draw palettes exactly',()=>{
    const content=base.roster.get('Mr')!,a=new ModelInstance(content.model),b=new ModelInstance(content.model);disposables.push(a,b);
    a.setAnimation(content.clips.get('Attack11')!);b.setAnimation(content.clips.get('Attack11')!);
    for(const frame of [0,1,2,4,8,15]){a.update(frame);b.update(frame,false);expect(b.poseSignature()).toEqual(a.poseSignature());b.prepare(frame);
      const palettes=(m:ModelInstance)=>m.group.children.filter((v):v is Mesh=>v instanceof Mesh).map(v=>(v.material as ShaderMaterial).uniforms.palette!.value.map((p:{elements:number[]})=>[...p.elements]));
      expect(palettes(b)).toEqual(palettes(a));
    }
  });
  it('shares immutable GPU storage but not mutable material or palette state',()=>{
    const model=base.roster.get('Mr')!.model,a=new ModelInstance(model),b=new ModelInstance(model);disposables.push(a,b);
    const am=a.group.children.find(v=>v instanceof Mesh&&(v.material as ShaderMaterial).uniforms.image?.value) as Mesh;
    const bm=b.group.children[a.group.children.indexOf(am)] as Mesh;
    expect(am.geometry).toBe(bm.geometry);expect(am.material).not.toBe(bm.material);
    const au=(am.material as ShaderMaterial).uniforms,bu=(bm.material as ShaderMaterial).uniforms;
    expect(au.image!.value).toBe(bu.image!.value);expect(au.palette!.value).not.toBe(bu.palette!.value);
    const geometry=vi.spyOn(am.geometry,'dispose'),texture=vi.spyOn(au.image!.value,'dispose');
    a.dispose();expect(geometry).not.toHaveBeenCalled();expect(texture).not.toHaveBeenCalled();b.update(7);
    b.dispose();expect(geometry).toHaveBeenCalledOnce();expect(texture).toHaveBeenCalledOnce();
  });
  it('reuses local poses while updating world placement and render-only visibility',()=>{
    const {rig,match}=make(),f=match.fighters[0],actor=rig.actors[0],update=vi.spyOn(actor,'update'),prepare=vi.spyOn(actor,'prepare');
    rig.sample(f);rig.sample(f);expect(update).not.toHaveBeenCalled();expect(prepare).toHaveBeenCalledTimes(2);
    const before=rig.point(f,0,[0,0,0]);f.x+=10;rig.sample(f,false);expect(update).not.toHaveBeenCalled();expect(rig.point(f,0,[0,0,0])[0]).toBeCloseTo(before[0]+10,12);
    f.animationFrame++;rig.sample(f,false);expect(update).toHaveBeenCalledTimes(1);rig.sample(f);expect(update).toHaveBeenCalledTimes(1);
    actor.update(7);rig.sample(f,false);expect(update).toHaveBeenCalledTimes(3); // external evaluation invalidates the stamp
  });
  it('invalidates cached hurt geometry on pose revisions and hurt-state changes',()=>{
    const {rig,match}=make(),f=match.fighters[0],cache=new HurtboxCache(rig),point=vi.spyOn(rig,'point');
    const initial=cache.get(f),calls=point.mock.calls.length;expect(calls).toBeGreaterThan(0);expect(cache.get(f)).toBe(initial);expect(point).toHaveBeenCalledTimes(calls);
    f.x++;rig.sample(f,false);expect(cache.get(f)).not.toBe(initial);f.state='shield-break';expect(cache.get(f).capsules).toHaveLength(0);
  });
  it('keeps every retained post-frame hash available via cheap eager live hashes',()=>{
    const {match}=make();
    // Reference uses a separate rig/world; it must not alter the driver's derived poses.
    const otherRig=new GameRigs(match.content);disposables.push(otherRig);const other=new LocalMatch(match.content,otherRig,{opponent:'human',countdown:0,seconds:600,seed:44});other.start();
    // Phase 4: hashes are captured eagerly with the clone-free live hash at
    // simulate time (keyframed snapshots only clone every 3rd frame), so every
    // retained frame stays hashable and the clone-based stateHash is never
    // needed on the hot path. liveStateHash must agree with stateHash exactly.
    const driver=new RollbackDriver(match,0,2),hashSpy=vi.spyOn(match,'stateHash'),liveSpy=vi.spyOn(match,'liveStateHash'),expected:string[]=[];
    for(let frame=0;frame<12;frame++){const input={...neutralInput(),x:frame<5?1:0};driver.receive(frame,1,neutralInput());driver.advance(input);driver.drainConfirmedEvents();other.step([normalizeInput(input),normalizeInput(neutralInput())]);expected.push(other.stateHash());}
    expect(hashSpy).not.toHaveBeenCalled();expect(liveSpy).toHaveBeenCalledTimes(12);for(let frame=0;frame<12;frame++)expect(driver.stateHash(frame)).toBe(expected[frame]);
    expect(hashSpy).not.toHaveBeenCalled();expect(liveSpy).toHaveBeenCalledTimes(12);driver.stateHash(3);expect(liveSpy).toHaveBeenCalledTimes(12);
  });
  it('reuses particle materials across bursts and releases them on disposal',()=>{
    const {rig,match}=make(),scene=new Scene(),effects=new CommonEffects(scene,base.commonEffects,rig,new PerspectiveCamera());
    const burst=()=>{effects.events([{type:'hit',player:0,x:0,y:10,damage:8,element:1}],match);for(let i=0;i<200;i++)effects.update(match,1);};
    burst();expect(effects.stats.pooledMaterials).toBeGreaterThan(0);const created=effects.stats.spriteMaterialsCreated;
    burst();expect(effects.stats.spriteMaterialsCreated).toBeLessThanOrEqual(created+8);expect(effects.warnings).toEqual([]);effects.dispose();expect(effects.stats.pooledMaterials).toBe(0);expect(scene.children).toHaveLength(0);
  });
});
