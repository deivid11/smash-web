import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Scene,PerspectiveCamera} from 'three';
import {openDisc} from '../../scripts/node-disc.ts';
import {verifyMeleeDisc} from '../../lib/disc.ts';
import {HsdAssetSession} from '../../lib/hsd/session.ts';
import {loadGameContent,type GameContent} from '../../lib/game/load.ts';
import {rosterPair} from '../../lib/game/roster.ts';
import {LocalMatch,neutralInput,type MatchEvent} from '../../lib/game/match.ts';
import {HIT_EFFECT_IDS,COMMON_PARTICLE_EFFECTS} from '../../lib/game/common-effects.ts';
import {ParticlePlayer} from '../../lib/hsd/particle-player.ts';
import {GameRigs} from '../../web/src/render/game-rig.ts';
import {CommonEffects} from '../../web/src/render/common-effects.ts';
import {PlayEffects} from '../../web/src/render/play-effects.ts';
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original shared hit/fire/dust VFX',()=>{
  let content:GameContent,rig:GameRigs|undefined,effects:CommonEffects|undefined;
  beforeAll(async()=>{const disc=await openDisc(iso!);try{content=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer,undefined,'final');}finally{await disc.close();}},30000);
  afterEach(()=>{effects?.dispose();effects=undefined;rig?.dispose();rig=undefined;});
  const make=()=>{const data=rosterPair(content,'Mr','Lk');rig=new GameRigs(data);const match=new LocalMatch(data,rig,{countdown:0,opponent:'human'});match.start();match.fighters.forEach((f,i)=>{f.x=i?35:-35;f.y=0;f.grounded=true;f.floor=data.stage.floors.find(f=>!f.oneWay)!.id;rig!.sample(f);});effects=new CommonEffects(new Scene(),data.commonEffects,rig,new PerspectiveCamera());return match;};
  it('uses the original element table rather than an attacker-name fire whitelist',()=>{
    expect(HIT_EFFECT_IDS.slice(0,6)).toEqual([1000,1002,1001,1004,1145,1005]);expect(HIT_EFFECT_IDS[8]).toBeNull();
    expect(content.roster.get('Mr')!.specials.articles.projectile!.hit!.element).toBe(1);
    expect(content.roster.get('Cl')!.specials.articles.projectile!.hit!.element).toBe(1);
    expect(content.roster.get('Lk')!.specials.articles.projectile!.hit!.element).toBe(3);
    expect(content.roster.get('Lk')!.specials.articles.link!.boomerang.hit!.element).toBe(3);
    expect(content.roster.get('Lk')!.specials.articles.link!.explosion.hit!.element).toBe(1);
    expect(content.roster.get('Ca')!.timelines.get('SpecialN')!.events.some(e=>e.type==='create'&&e.hit.element===1)).toBe(true);
  });
  it('reads native reaction durations, joint-generator cues and embedded relative banks',()=>{
    const data=content.commonEffects!;
    expect(data.burns.map(b=>b.life)).toEqual([28,56,112,152]);
    expect(data.burns[0]!.events.filter(e=>e.type==='particle').map(e=>e.generator)).toEqual([55,55,55,55,225,225,225,225]);
    expect(data.models.get(10)!.particles.map(p=>p.generator)).toEqual([306,307]);
    expect(data.particles.definition(263)).toMatchObject({type:0,texture:32,generatorLife:1});
    expect(()=>data.particles.definition(99999)).toThrow();expect(()=>data.particles.texture(32,-1)).toThrow();
  });
  it('plays the selected native particle scripts and texture frames without unsupported commands',()=>{
    const data=content.commonEffects!,ids=new Set([...COMMON_PARTICLE_EFFECTS.values(),55,225,...[...data.models.values()].flatMap(m=>m.particles.map(p=>p.generator))]);
    for(const id of ids){const player=new ParticlePlayer(data.particles);player.spawn(id,[0,0,0]);let visible=0;
      for(let tick=0;tick<180;tick++){player.step();for(const p of player.particles){expect(p.position.every(Number.isFinite)).toBe(true);if(p.frame>=0){const texture=data.particles.texture(p.definition.texture,p.frame,p.palette);expect(texture.pixels.length).toBe(texture.width*texture.height*4);visible++;}}}
      expect([...player.unsupported],`generator ${id}`).toEqual([]);expect(visible,`generator ${id}`).toBeGreaterThan(0);expect(player.particles).toHaveLength(0);
    }
  });
  it('bounds cosmetic particles and replays their local seed independently',()=>{
    const player=new ParticlePlayer(content.commonEffects!.particles,24);
    const run=()=>{for(let i=0;i<80;i++)player.spawn(20,[0,0,0]);for(let i=0;i<8;i++){player.step();expect(player.particles.length).toBeLessThanOrEqual(24);}return player.particles.map(p=>({position:p.position,frame:p.frame,color:p.color}));};
    const expected=run();player.clear();expect(run()).toEqual(expected);
  });
  it('keeps world-space hit emitters separate from facing-rotated dust emitters',()=>{
    const world=new ParticlePlayer(content.commonEffects!.particles),facing=new ParticlePlayer(content.commonEffects!.particles);
    world.spawn(306,[10,20,30]);facing.spawn(306,[10,20,30],1);world.step();facing.step();
    const a=world.particles[0]!,b=facing.particles[0]!;expect(a.position).toEqual(b.position);
    expect(world.worldPosition(a)).toEqual([10+a.position[0],20+a.position[1],30+a.position[2]]);
    expect(facing.worldPosition(b)).toEqual([10+b.position[2],20+b.position[1],30-b.position[0]]);
  });
  it('uses raw Landing submotion 35, not the empty dead-camera Landing placeholder',()=>{
    for(const kind of ['Mr','Fx','Ca','Lk','Cl'] as const){const f=content.roster.get(kind)!;
      expect(f.timelines.get('Landing')!.events).toContainEqual(expect.objectContaining({type:'gfx',frame:0,effect:1028,groundOnly:true}));
      expect(f.timelines.get('Run')!.events.some(e=>e.type==='gfx'&&e.effect===1022)).toBe(true);
      expect(f.effectBones).toHaveLength(5);
    }
  });
  it('emits run dust once per authored cue and landing dust once on contact',()=>{
    const match=make();let dust=0;
    for(let i=0;i<20;i++){match.step([{...neutralInput(),x:1},neutralInput()]);dust+=match.events.filter(e=>e.type==='gfx'&&e.effect===1022).length;effects!.events(match.events,match);effects!.update(match,1);}
    expect(dust).toBeGreaterThan(0);const f=match.fighters[0];f.grounded=false;f.floor=null;f.state='fall';f.animation='Fall';f.y=1;f.velocity={x:0,y:-2};
    let landing=0;for(let i=0;i<5;i++){match.step([neutralInput(),neutralInput()]);landing+=match.events.filter(e=>e.type==='gfx'&&e.effect===1028).length;effects!.events(match.events,match);effects!.update(match,1);}
    expect(landing).toBe(1);expect(effects!.stats.spawnedDust).toBeGreaterThan(dust);expect(effects!.warnings).toEqual([]);
  });
  it('burns the victim with native colors/bone emissions, expires, and never changes match state',()=>{
    const match=make(),victim=match.fighters[1],event:MatchEvent={type:'hit',player:1,x:victim.x,y:8,element:1,damage:8,knockback:0};
    const before=match.stateHash();effects!.events([event],match);effects!.update(match,1);
    expect(effects!.stats.burning).toBe(1);expect(rig!.actors[1]!.damageOverlay.w).toBeGreaterThan(0);expect(rig!.actors[0]!.damageOverlay.w).toBe(0);
    const heldColor=rig!.actors[1]!.damageOverlay.toArray(),heldStats={...effects!.stats};
    for(let i=0;i<10;i++)effects!.update(match,0);
    expect(rig!.actors[1]!.damageOverlay.toArray()).toEqual(heldColor);expect(effects!.stats).toEqual(heldStats);
    for(let i=0;i<5;i++)effects!.update(match,1);expect(effects!.stats.particles).toBeGreaterThan(0);expect(match.stateHash()).toBe(before);
    for(let i=0;i<180;i++)effects!.update(match,1);
    expect(effects!.stats.burning).toBe(0);expect(effects!.stats.particles).toBe(0);expect(rig!.actors[1]!.damageOverlay.w).toBe(0);expect(effects!.warnings).toEqual([]);
  });
  it('does not apply burn colors to normal or slash hits and renders native impact particles',()=>{
    const match=make();effects!.events([{type:'hit',player:1,x:35,y:8,element:0,damage:10},{type:'hit',player:1,x:35,y:8,element:3,damage:8}],match);
    for(let i=0;i<3;i++)effects!.update(match,1);
    // Normal/slash victims flash white (common script 4), never the orange fire scripts.
    expect(effects!.stats.burning).toBe(1);expect(rig!.actors[1]!.damageOverlay.toArray().slice(0,3)).toEqual([1,1,1]);
    expect(effects!.stats.particles).toBeGreaterThan(0);expect(effects!.warnings).toEqual([]);
    for(let i=0;i<10;i++)effects!.update(match,1);expect(effects!.stats.burning).toBe(0);
    effects!.reset();expect(effects!.stats.particles).toBe(0);expect(effects!.stats.models).toBe(0);
  });
  it('reads the original hit spark thresholds and every element color script',()=>{
    const data=content.commonEffects!;
    expect(data.sparkFlashKnockback).toBe(180);expect(data.sparkExtraOdds).toBe(4);expect(COMMON_PARTICLE_EFFECTS.get(1007)).toBe(66);
    // Common script 4: the white hit flash (255,255,255,170) blending down to alpha 20 over six frames.
    expect(data.hitColors.normal.life).toBe(8);
    expect(data.hitColors.normal.events).toEqual([{frame:0,type:'color',rgba:[0,0,0,0]},{frame:1,type:'color',rgba:[255,255,255,170]},{frame:2,type:'blend',rgba:[255,255,255,20],frames:6},{frame:8,type:'color',rgba:[0,0,0,0]}]);
    // Electric 15..18 loop generator 0x13 (efAsync 0x412) on the cycling effect part; dark 35..38 reuse the fire cadence with generator 406.
    for(const script of data.hitColors.electric){expect(script.events.some(e=>e.type==='particle'&&e.generator===19&&e.bone===0x8d)).toBe(true);expect(script.life).toBeGreaterThan(0);}
    expect(data.hitColors.dark.map(s=>s.life)).toEqual([28,56,112,152]);expect(data.hitColors.dark[0]!.events.some(e=>e.type==='particle'&&e.generator===406)).toBe(true);
    expect(data.hitColors.ice[0]!.life).toBe(2);
    expect(content.roster.get('Mr')!.profile.hitSparkVariant).toBe(0);
  });
  it('flashes the victim white on a normal hit and fades it out on the original cadence',()=>{
    const match=make();effects!.events([{type:'hit',player:1,x:35,y:8,element:0,damage:10,knockback:20,severity:0}],match);
    effects!.update(match,1);expect(rig!.actors[1]!.damageOverlay.w).toBe(0); // frame 0 clears, the white lands on frame 1
    effects!.update(match,1);expect(rig!.actors[1]!.damageOverlay.toArray()).toEqual([1,1,1,170/255]);
    for(let i=0;i<4;i++)effects!.update(match,1);
    const mid=rig!.actors[1]!.damageOverlay.w;expect(mid).toBeLessThan(170/255);expect(mid).toBeGreaterThan(20/255);
    for(let i=0;i<6;i++)effects!.update(match,1);expect(rig!.actors[1]!.damageOverlay.w).toBe(0);expect(effects!.stats.burning).toBe(0);
  });
  it('selects the original normal spark by knockback and adds the severity sparkle at the PlCo odds',()=>{
    const ids=()=>((effects as unknown as {player:ParticlePlayer}).player.particles.map(p=>p.definition.id));
    let match=make();effects!.events([{type:'hit',player:1,x:35,y:8,element:0,damage:10,knockback:20,severity:0}],match);effects!.update(match,1);
    expect(ids().some(id=>id===306||id===307)).toBe(true);expect(ids()).not.toContain(11);expect(ids()).not.toContain(66);
    effects!.reset();match=make();effects!.events([{type:'hit',player:1,x:35,y:8,element:0,damage:10,knockback:180,severity:0}],match);effects!.update(match,1);
    expect(ids()).toContain(11);expect(ids().some(id=>id===306||id===307)).toBe(false);
    effects!.reset();match=make();let sparkles=0;
    const player=(effects as unknown as {player:ParticlePlayer}).player;
    for(let i=0;i<40;i++){
      const last=Math.max(0,...player.particles.map(p=>p.id));
      effects!.events([{type:'hit',player:1,x:35,y:8,element:0,damage:10,knockback:20,severity:1}],match);effects!.update(match,1);
      if(player.particles.some(p=>p.definition.id===66&&p.id>last))sparkles++;
      effects!.update(match,14); // let the burst and any sparkle die before the next hit
    }
    expect(sparkles).toBeGreaterThan(2);expect(sparkles).toBeLessThan(30);
    expect(effects!.warnings).toEqual([]);
  });
  it('runs the electric color script with body arcs on the victim',()=>{
    const match=make();effects!.events([{type:'hit',player:1,x:35,y:8,element:2,damage:10,knockback:20}],match);
    let arcs=0;for(let i=0;i<12;i++){effects!.update(match,1);arcs+=((effects as unknown as {player:ParticlePlayer}).player.particles.some(p=>p.definition.id===19))?1:0;}
    expect(effects!.stats.burning).toBe(1);expect(arcs).toBeGreaterThan(0);expect(effects!.warnings).toEqual([]);
  });
  it('stretches trail sprites from their previous position like psDispSubMakePolygon',()=>{
    const match=make();effects!.events([{type:'hit',player:1,x:35,y:8,element:0,damage:10,knockback:20}],match);effects!.update(match,1);
    const player=(effects as unknown as {player:ParticlePlayer}).player,trails=player.particles.filter(p=>p.kind&0x100000&&Math.hypot(...player.worldVelocity(p))>0.5);
    expect(trails.length).toBeGreaterThan(0);
    const scene=(effects as unknown as {scene:Scene}).scene;
    for(const p of trails){const mesh=scene.children.find(o=>o.name===`Native particle ${p.definition.id}`)!;expect(Math.abs(mesh.scale.y)).toBeGreaterThan(Math.abs(mesh.scale.x));}
  });
  it('does not add generic fire halos to Link arrows or boomerangs',()=>{
    const match=make(),scene=new Scene(),play=new PlayEffects(scene,match.content,rig!,new PerspectiveCamera());
    try{match.projectiles.spawn(match.fighters[1],'arrow',rig!);match.projectiles.spawn(match.fighters[1],'boomerang',rig!);play.update(match);expect(play.stats.halos).toBe(0);expect(scene.children.some(o=>o.name==='Supplemental fire halo')).toBe(false);}finally{play.dispose();}
  });
});
