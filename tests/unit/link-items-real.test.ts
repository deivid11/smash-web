import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Scene,PerspectiveCamera} from 'three';
import {openDisc} from '../../scripts/node-disc.ts';
import {verifyMeleeDisc} from '../../lib/disc.ts';
import {HsdAssetSession} from '../../lib/hsd/session.ts';
import {loadGameContent,type GameContent} from '../../lib/game/load.ts';
import {LocalMatch,neutralInput,type PlayerInput} from '../../lib/game/match.ts';
import {rosterPair} from '../../lib/game/roster.ts';
import {GameRigs} from '../../web/src/render/game-rig.ts';
import {LinkEffects} from '../../web/src/render/link-effects.ts';
import type {ModelInstance} from '../../web/src/render/model-instance.ts';
import {ITEM_COMMON} from '../../lib/game/item-common.ts';
import {activeHits} from '../../lib/game/moves.ts';
import {passiveLinkShield} from '../../lib/game/link-actions.ts';
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Link item lifecycle and native props',()=>{
  let base:GameContent,game:LocalMatch,rig:GameRigs;let nativeGlobals:number[]=[];
  const f=()=>game.fighters[0];
  const make=(kind:'Lk'|'Cl'='Lk',rival:'Mr'|'Lk'|'Cl'='Mr')=>{
    rig?.dispose();const content=rosterPair(base,kind,rival);rig=new GameRigs(content);game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();
    game.fighters.forEach((v,i)=>{v.x=i?50:-50;v.y=0;v.grounded=true;v.floor=content.stage.floors.find(x=>!x.oneWay)!.id;rig.sample(v);});
  };
  const step=(a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>game.step([{...neutralInput(),...a},{...neutralInput(),...b}]);
  const ticks=(n:number)=>{for(let i=0;i<n;i++)step();};
  beforeAll(async()=>{
    const d=await openDisc(iso!);try{const s=new HsdAssetSession(d,await verifyMeleeDisc(d));base=await loadGameContent(s,new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer,undefined,'final');const a=await s.archive('ItCo.dat'),p=a.pointer(a.symbol('itPublicData'));nativeGlobals=[0x4c,0x58,0x5c,0x60,0xf8].map(o=>a.f32(p+o));}finally{await d.close();}
  },30000);
  afterEach(()=>rig?.dispose());
  it('uses verified original item-common half-life, shield bounce and cleanup values',()=>{
    expect(nativeGlobals).toEqual([ITEM_COMMON.reflectedLife,ITEM_COMMON.shieldBounceX,ITEM_COMMON.shieldBounceY,ITEM_COMMON.shieldBounceLift,ITEM_COMMON.explosionLife]);
  });
  it('Z-drops and recatches a bomb in air without spending the hookshot',()=>{
    make();f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().y=50;rig.sample(f());
    const bomb=game.projectiles.spawn(f(),'link-bomb',rig);step();step({grab:true});
    expect(f().link.bomb).toBeNull();expect(bomb.link?.phase).toBe('flight');expect(f().link.tetherUsed).toBe(false);
    step();step({grab:true});expect(f().link.bomb).toBe(bomb.id);expect(bomb.link?.phase).toBe('held');expect(f().link.tetherUsed).toBe(false);
  });
  it('lets Mario pick up and throw a Link bomb using his own item animations without resetting its fuse',()=>{
    make();const other=game.fighters[1],bomb=game.projectiles.spawn(f(),'link-bomb',rig);f().link.bomb=null;bomb.link!.phase='ground';bomb.link!.floor=other.floor;bomb.x=other.x-3;bomb.y=0;bomb.life=200;
    step({}, {attack:true});expect(other.state).toBe('item-pickup');expect(other.animation).toBe('LightGet');expect(other.link.bomb).toBe(bomb.id);expect(bomb.owner).toBe(1);expect(bomb.life).toBe(199);
    for(let i=0;i<60&&other.state==='item-pickup';i++)step();step({}, {attack:true});expect(other.animation).toBe('LightThrowF');
    ticks(9);expect(bomb.link?.phase).toBe('flight');expect(bomb.vx).toBeLessThan(0);expect(other.link.bomb).toBeNull();
  });
  it('supports the original ground dash throw and fresh horizontal smash throw',()=>{
    make();let bomb=game.projectiles.spawn(f(),'link-bomb',rig);f().state='run';f().animation='Run';f().previous.x=1;f().link.sideTicks=20;
    step({attack:true,x:1});expect(f().animation).toBe('LightThrowDash');ticks(12);expect(bomb.link?.phase).toBe('flight');
    make();bomb=game.projectiles.spawn(f(),'link-bomb',rig);step({attack:true,x:1});expect(f().animation).toBe('LightThrowF4');ticks(10);expect(bomb.vx).toBeGreaterThan(3);
  });
  it('bounces a slow bomb off a fighter rather than detonating it on every contact',()=>{
    make();const other=game.fighters[1],bomb=game.projectiles.spawn(f(),'link-bomb',rig);f().link.bomb=null;bomb.link!.phase='flight';bomb.x=other.x;bomb.y=other.y+9;bomb.vx=.1;bomb.vy=0;
    step();expect(other.percent).toBeGreaterThan(0);expect(bomb.link?.phase).toBe('flight');expect(bomb.life).toBe(299);expect(bomb.vx).toBeLessThan(0);expect(bomb.vy).toBeCloseTo(.67,5);
  });
  it('uses item-common shield bounce instead of immediately exploding a fast bomb',()=>{
    make();const other=game.fighters[1],bomb=game.projectiles.spawn(f(),'link-bomb',rig);f().link.bomb=null;bomb.link!.phase='flight';bomb.x=other.x-2;bomb.y=other.y+9;bomb.vx=3;bomb.vy=0;
    step({}, {shield:true});expect(other.percent).toBe(0);expect(bomb.link?.phase).toBe('flight');expect(bomb.life).toBe(299);expect(bomb.vx).toBeCloseTo(-.3,5);expect(bomb.vy).toBeGreaterThan(1);
  });
  it('detonates a bomb struck through its original hurt capsule and publishes the native explosion effect',()=>{
    make();f().state='attack';f().animation=f().content.moves.sideTilt!;f().attackName=f().animation;f().animationFrame=16;rig.sample(f());
    const hit=activeHits(f().content.attacks.get(f().animation)!,f().animationFrame)[0]!;expect(hit).toBeDefined();const point=rig.point(f(),hit.bone,hit.offset);
    const bomb=game.projectiles.spawn(f(),'link-bomb',rig);f().link.bomb=null;bomb.link!.phase='flight';bomb.x=point[0];bomb.y=point[1];
    step();expect(bomb.link?.phase).toBe('explosion');expect(bomb.link!.damageTaken).toBeGreaterThanOrEqual(6);expect(game.events.some(e=>e.type==='gfx'&&e.effect===0x40e)).toBe(true);
  });
  it('allows an arrow to damage a bomb and consumes the arrow at that collision',()=>{
    make();const bomb=game.projectiles.spawn(f(),'link-bomb',rig);f().link.bomb=null;bomb.link!.phase='ground';bomb.link!.floor=f().floor;bomb.x=0;bomb.y=0;
    const arrow=game.projectiles.spawn(f(),'arrow',rig,false,0,{player:0,kind:'arrow',rawCharge:60});arrow.x=-3;arrow.y=1;
    step();step();expect(game.projectiles.items).not.toContain(arrow);expect(bomb.link?.phase).toBe('explosion');
  });
  it('embeds arrows in floors for their separate harmless 50-tick timer',()=>{
    make();const arrow=game.projectiles.spawn(f(),'arrow',rig);arrow.x=0;arrow.y=.01;arrow.vy=-1;
    step();expect(arrow.link?.phase).toBe('stuck');expect(arrow.life).toBe(50);expect(arrow.vx).toBe(0);expect(arrow.vy).toBe(0);expect(arrow.link?.active).toBe(false);
    const saved=game.captureState();ticks(5);const hash=game.stateHash();game.restoreState(saved);ticks(5);expect(game.stateHash()).toBe(hash);ticks(45);expect(game.projectiles.items.some(p=>p.id===arrow.id)).toBe(false);
  });
  it('embeds arrows in native wall geometry without invalid vertical-floor math',()=>{
    make();game.content.stage={...game.content.stage,surfaces:[{id:999,a:[0,-80],b:[0,0],kind:'wall',oneWay:false}]};
    const arrow=game.projectiles.spawn(f(),'arrow',rig);arrow.x=-.1;arrow.y=-30;
    step();expect(arrow.link?.phase).toBe('stuck');expect(arrow.x).toBeCloseTo(0,5);expect(Number.isFinite(arrow.y)).toBe(true);
  });
  it('attaches a blocked arrow to a moving shield without dealing repeated damage',()=>{
    make();const v=game.fighters[1],arrow=game.projectiles.spawn(f(),'arrow',rig);arrow.x=v.x-2;arrow.y=v.y+9;
    step({}, {shield:true});expect(arrow.link?.phase).toBe('stuck');expect(arrow.link?.stuckTo).toBe(1);expect(v.percent).toBe(0);
    const shield=v.combat.shield;v.x+=3;rig.sample(v);const expected=rig.point(v,v.content.profile.shieldBone,[0,0,0])[0]+arrow.link!.stuckOffset[0];step({}, {shield:true});expect(arrow.x).toBeCloseTo(expected,5);expect(v.combat.shield).toBe(shield);
  });
  it.each(['Lk','Cl'] as const)('%s blocks with its passive shield in native idle stance without spending shield HP',kind=>{
    make('Lk',kind);step();const v=game.fighters[1],bubble=passiveLinkShield(v,rig)!;expect(bubble).not.toBeNull();
    const arrow=game.projectiles.spawn(f(),'arrow',rig);arrow.x=bubble.center[0]-1;arrow.y=bubble.center[1];const shield=v.combat.shield;
    step();expect(v.percent).toBe(0);expect(v.state).toBe('idle');expect(v.combat.shield).toBe(shield);expect(game.events.some(e=>e.type==='sound'&&e.sound===(kind==='Lk'?160106:70106))).toBe(true);
    game.projectiles.spawn(v,'link-bomb',rig);step();expect(passiveLinkShield(v,rig)).toBeNull();
  });
  it('renders native bow/drawn arrow and hook chain props without mutating simulation state or leaking objects',()=>{
    make();const scene=new Scene(),effects=new LinkEffects(scene,rig,new PerspectiveCamera());
    try{
      step({special:true,specialDirection:'neutral'});for(let i=0;i<22;i++)step({special:true});
      const hash=game.stateHash();effects.update(game);expect(effects.stats.bows).toBe(1);expect(effects.stats.arrows).toBe(1);
      const props=Reflect.get(effects,'props') as Map<string,{model:ModelInstance}>,bow=props.get('bow:0')!.model;
      const hand=rig.actors[0].jointPoint(f().content.profile.boneMap[49]!,[0,0,0]);
      expect(f().content.specials.articles.link!.bows[0]!.attachmentBone).toBe(1);expect(bow.jointPoint(1,[0,0,0]).distanceTo(hand)).toBeLessThan(0.0001);
      const drawingHand=rig.actors[0].jointPoint(f().content.profile.boneMap[31]!,[0,0,0]);expect(props.get('drawn-arrow:0')!.model.jointPoint(1,[0,0,0]).distanceTo(drawingHand)).toBeLessThan(0.0001);
      effects.update(game);expect(game.stateHash()).toBe(hash);
      f().state='idle';f().animation='Wait1';f().special=null;f().attackName=null;effects.update(game);expect(effects.stats.models).toBe(0);
      step({grab:true});ticks(12);effects.update(game);expect(effects.stats.hookLinks).toBeGreaterThan(2);
      effects.reset();expect(effects.stats.models).toBe(0);expect(scene.children).toHaveLength(0);
    }finally{effects.dispose();}
  });
});
