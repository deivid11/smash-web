import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('remaining Link native mechanics',()=>{
  let base:GameContent,game:LocalMatch,rig:GameRigs;
  const f=()=>game.fighters[0];
  const make=(kind:'Lk'|'Cl'='Lk')=>{
    rig?.dispose();const content=rosterPair(base,kind,'Mr');rig=new GameRigs(content);game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();
    game.fighters.forEach((v,i)=>{v.x=i?50:-50;v.y=0;v.grounded=true;v.floor=content.stage.floors.find(x=>!x.oneWay)!.id;rig.sample(v);});
  };
  const step=(input:Partial<PlayerInput>={})=>game.step([{...neutralInput(),...input},neutralInput()]);
  const pose=(name:string,frame:number,air=false)=>{
    f().state='attack';f().animation=name;f().attackName=name;f().animationFrame=frame;f().jab=null;
    f().grounded=!air;if(air){f().floor=null;f().y=100;}rig.sample(f());
  };
  beforeAll(async()=>{
    const disc=await openDisc(iso!);try{base=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer,undefined,'final');}finally{await disc.close();}
  },30000);
  afterEach(()=>rig?.dispose());
  it.each([0,12,13,64,65,80])('uses down-air cmd0 autocancel at authored frame %i',frame=>{
    make();pose('AttackAirLw',frame,true);f().y=.001;f().velocity.y=-1;step();
    const active=frame>=13&&frame<65;
    expect(f().animation).toBe(active?'LandingAirLw':'Landing');expect(f().landingFrames).toBe(active?50:f().content.profile.attributes.landingLag);
    expect(f().animationRate).toBeCloseTo(active?60.1/50:1,5);
  });
  it.each([0,1,6,7,8])('honors the native L-cancel input-age boundary %i',age=>{
    make();pose('AttackAirLw',20,true);f().y=.001;f().velocity.y=-1;
    if(age>0){f().previous.shield=true;f().link.shieldAge=age-1;}
    step({shield:true});expect(base.common.lCancel).toEqual({window:7,divisor:2});
    expect(f().landingFrames).toBe(age<7?25:50);expect(f().animationRate).toBeCloseTo(60.1/f().landingFrames,5);
  });
  it.each([['AttackAirN',36],['AttackAirB',30],['AttackAirHi',60],['AttackAirLw',80],['AttackS42',50],['AttackLw3',32]] as const)('%s accepts a fresh attack at native IASA %i, not before', (name,gate)=>{
    make();const air=name.startsWith('AttackAir');pose(name,gate-1,air);step({attack:true});expect(f().animationFrame).toBe(gate);
    make();pose(name,gate,air);step({attack:true});expect(f().animationFrame).toBe(1);expect(f().animation).toBe(air?'AttackAirN':'Attack11');
  });
  it('does not end an idle IASA pose or grant unsupported aerial special/dodge cancels',()=>{
    for(const input of [{},{special:true},{shield:true}]){make();pose('AttackAirN',36,true);step(input);expect(f().animation).toBe('AttackAirN');expect(f().animationFrame).toBe(37);}
  });
  it('allows the grounded second-smash special/jump/shield interrupt set',()=>{
    for(const [input,state] of [[{special:true},'special'],[{jump:true},'squat'],[{shield:true},'shield']] as const){make();pose('AttackS42',50);step(input);expect(f().state).toBe(state);}
  });
  it.each([-2,2])('uses original overspeed ground friction for Spin entry at vx=%i',velocity=>{
    make();f().velocity.x=velocity;step({special:true,specialDirection:'up'});expect(f().velocity.x).toBeCloseTo(velocity-Math.sign(velocity)*.2,5);
  });
  it('retimes special landing to its original 24-frame recovery',()=>{
    make();f().state='fall';f().animation='Fall';f().grounded=false;f().floor=null;f().y=30;
    step({special:true,specialDirection:'up'});f().y=.001;f().velocity.y=-1;step();expect(f().animation).toBe('Landing');expect(f().landingFrames).toBe(24);expect(f().animationRate).toBeCloseTo(30.1/24,5);
  });
  it.each(['Lk','Cl'] as const)('%s binds native hook tip139 and pulls a ranged victim into pummel/throw',kind=>{
    make(kind);const victim=game.fighters[1];victim.x=f().x+27;rig.sample(victim);
    step({grab:true});expect(f().state).toBe('grab');
    for(let i=0;i<35&&f().state!=='holding';i++)step();
    expect(f().state).toBe('holding');expect(victim.state).toBe('captured');
    for(let i=0;i<25&&f().link.hook;i++)step();
    expect(f().animation).toBe('CatchWait');expect(f().link.hook).toBeNull();
    step({attack:true});for(let i=0;i<25;i++)step();expect(victim.percent).toBeGreaterThan(0);
    step({x:1});for(let i=0;i<70;i++)step();expect(f().combat.partner).toBeNull();expect(victim.combat.partner).toBeNull();
  });
  it.each(['Lk','Cl'] as const)('%s whiffs at native chain range and never substitutes a hand at tip139',kind=>{
    make(kind);step({grab:true});for(let i=0;i<12;i++)step();
    const hook=f().link.hook!;expect(hook.active).toBe(true);expect(hook.points.length).toBe(kind==='Lk'?15:10);
    const point=rig.point(f(),139,[0,0,0]);expect(point).toEqual(hook.tip);
    const hand=hook.points.at(-1)!;expect(Math.hypot(point[0]-hand[0],point[1]-hand[1])).toBeGreaterThan(f().content.hookshot!.segmentLength);
    const saved=game.captureState();for(let i=0;i<8;i++)step();const hash=game.stateHash();game.restoreState(saved);for(let i=0;i<8;i++)step();expect(game.stateHash()).toBe(hash);
    for(let i=0;i<100;i++)step();expect(f().link.hook).toBeNull();expect(f().state).toBe('idle');
  });
  it('allows one aerial hookshot per airtime, with native attack damage and bounded recovery',()=>{
    make();f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().y=100;
    step({grab:true});expect(f().animation).toBe('AirCatch');expect(f().link.tetherUsed).toBe(true);
    for(let i=0;i<12;i++)step();expect(f().link.hook?.mode).toBe('air');expect(f().link.hook?.points.length).toBe(22);
    f().state='fall';f().animation='Fall';step();step({grab:true});expect(f().animation).toBe('Fall');
  });
  it('latches an aerial hook to a map wall, reels with A and releases into native cliff-jump recovery',()=>{
    make();game.content.stage={...game.content.stage,surfaces:[{id:999,a:[0,-80],b:[0,0],oneWay:false,kind:'wall'}]};
    f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().x=24;f().y=-40;f().facing=-1;rig.sample(f());
    step({grab:true});for(let i=0;i<30&&f().state!=='tether';i++)step();
    expect(f().state).toBe('tether');expect(f().link.hook?.wall).toBe(999);
    const saved=game.captureState();step({attack:true});for(let i=0;i<30&&f().state==='tether';i++)step();const hash=game.stateHash();
    expect(['ledge-jump','ledge']).toContain(f().state);expect(f().link.hook).toBeNull();
    game.restoreState(saved);step({attack:true});for(let i=0;i<30&&f().state==='tether';i++)step();expect(game.stateHash()).toBe(hash);
  });
  it('restores L-cancel input history and retimed landing deterministically',()=>{
    make();pose('AttackAirLw',20,true);step({shield:true});const state=game.captureState();
    const land=()=>{f().y=.001;f().velocity.y=-1;step();};land();const hash=game.stateHash();game.restoreState(state);land();expect(game.stateHash()).toBe(hash);expect(f().landingFrames).toBe(25);
  });
});
