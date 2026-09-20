import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, rosterPlayers, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { RollbackDriver, normalizeInput } from '../../lib/game/rollback.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { DK_ACTION_KEYS } from '../../lib/game/dk-data.ts';
import { dkHits } from '../../lib/game/dk.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Donkey Kong registration',()=>{
  it('reserves a stable selector slot, native Dk kind, own narrator and bounded assets',()=>{
    expect(ROSTER_CHOICES).toContain('Dk');expect(ROSTER_CHOICES.indexOf('Dk')).toBe(8);expect(ROOM_FIGHTERS).toContain('Dk');
    expect(parseClientMessage(JSON.stringify({type:'choose',token:'t',fighter:'Dk'}))).toMatchObject({fighter:'Dk'});
    for(const name of ['PlDk.dat','PlDkAJ.dat','PlDkNr.dat','EfDkData.dat','audio/us/dk.ssm'])expect(SERVER_ASSETS).toContain(name);
    for(const name of ['PlDkDViWaitAJ.dat','audio/us/donkey.ssm'])expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.donkey).toBe(0x7c831);expect(new Set(DK_ACTION_KEYS.map(e=>e.key)).size).toBe(19);
  });
});
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Donkey Kong original ISO integration',()=>{
  let base:GameContent,content:GameContent,rig:GameRigs,game:LocalMatch;
  const make=(mirror=false,gap=50)=>{
    rig?.dispose();content=rosterPair(base,'Dk',mirror?'Dk':'Mr');rig=new GameRigs(content);
    game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();
    game.fighters.forEach((f,i)=>{f.x=(i?1:-1)*gap/2;f.y=0;f.grounded=true;f.floor=content.stage.floors.find(floor=>!floor.oneWay)!.id;rig.sample(f);});
  };
  const step=(a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>game.step([{...neutralInput(),...a},{...neutralInput(),...b}]);
  const ticks=(n:number,a:Partial<PlayerInput>={})=>{for(let i=0;i<n;i++)step(a);};
  const f=()=>game.fighters[0];
  const air=(y=100)=>{f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().y=y;};
  const params=()=>{const p=f().content.specials.parameters;if(p.kind!=='Dk')throw Error('missing');return p;};
  beforeAll(async()=>{const disc=await openDisc(iso!);try{base=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer,undefined,'final');}finally{await disc.close();}},30000);
  beforeEach(()=>make());afterEach(()=>rig?.dispose());
  it('loads the 75-joint skeleton, 114 weight and its own animations without phantom jab3/articles',()=>{
    const dk=f().content;expect(dk.profile.name).toBe('Donkey Kong');expect(dk.profile.boneCount).toBe(75);expect(dk.profile.attributes.weight).toBe(114);
    expect(dk.profile.attributes.runSpeed).toBeCloseTo(1.6);expect(dk.model.stats.meshes).toBe(61);expect(dk.moves.jab2).toBe('Attack12');expect(dk.moves.jab3).toBeUndefined();expect(dk.specials.articles).toEqual({});
    for(const clip of dk.clips.values())expect(clip.joints).toHaveLength(75);
    for(const name of Object.values(dk.moves))expect(dk.attacks.get(name)!.events.some(e=>e.type==='create')).toBe(true);
    expect(base.sound.cues(dk.specials.sounds.ko).length).toBeGreaterThan(0);
    const p=params();expect(p.neutral.maxSwings).toBe(10);expect(p.neutral.damagePerSwing).toBe(2);
    expect(p.neutral.punchSpeed).toBeCloseTo(0.12);expect(p.up.landing).toBe(40);expect(p.neutral.landing).toBe(20);
  });
  it('keeps the shared punch figatree with distinct normal and full release scripts',()=>{
    const dk=f().content;expect(dk.clips.get('SpecialN')!.name).toBe(dk.clips.get('SpecialNFull')!.name);
    expect(dk.timelines.get('SpecialN')!.events).not.toEqual(dk.timelines.get('SpecialNFull')!.events);
    expect(dk.clips.get('SpecialLwEnd')!.name).toBe(dk.clips.get('SpecialLwEnd1')!.name);
    expect(dk.attacks.get('SpecialN')!.events.some(e=>e.type==='create')).toBe(true);
    expect(dk.attacks.get('SpecialNFull')!.events.some(e=>e.type==='create')).toBe(true);
  });
  it('poses every normal hitbox in both facings with correct original bones',()=>{
    for(const name of Object.values(f().content.moves))for(const facing of [-1,1]){
      const move=f().content.attacks.get(name)!,first=move.events.find(e=>e.type==='create')!;
      f().animation=name;f().animationFrame=first.frame;f().facing=facing;rig.sample(f());
      for(const hit of activeHits(move,first.frame))expect(rig.point(f(),hit.bone,hit.offset).every(Number.isFinite)).toBe(true);
    }
  });
  it('connects its own jab and allows shield, grab and original throw',()=>{
    make(false,14);step({attack:true});ticks(14);expect(game.fighters[1].percent).toBeGreaterThan(0);
    make(false,10);step({shield:true});expect(f().state).toBe('shield');
    // Forward throw is the cargo lift in the original data; the ported generic throw uses the back throw here.
    make(false,10);step({grab:true});ticks(12);expect(f().state).toBe('holding');step({x:-1});ticks(60);expect(game.fighters[1].percent).toBeGreaterThan(0);expect(f().combat.partner).toBeNull();
  });
  it('lifts a grabbed victim into the cargo carry, walks with it and throws from the shoulder',()=>{
    make(false,10);const mario=game.fighters[1];
    step({grab:true});ticks(12);expect(f().state).toBe('holding');
    step({x:1});expect(f().state).toBe('holding');expect(f().animation).toBe('ThrowF');expect(mario.state).toBe('captured');
    for(let i=0;i<60&&f().animation==='ThrowF';i++)step();
    expect(f().animation).toBe('ThrowFWait');
    const startX=f().x;
    ticks(25,{x:0.4});
    expect(f().state).toBe('holding');expect(['ThrowFWalkSlow','ThrowFWalkMiddle','ThrowFWalkFast']).toContain(f().animation);
    expect(f().x).toBeGreaterThan(startX);expect(mario.state).toBe('captured');expect(mario.combat.partner).toBe(0);
    step();expect(f().animation).toBe('ThrowFWait');
    step({y:1});expect(f().state).toBe('throw');expect(f().animation).toBe('ThrowFHi');
    for(let i=0;i<60&&mario.state==='captured';i++)step();
    expect(mario.state).toBe('hitstun');expect(mario.percent).toBeGreaterThan(0);expect(f().combat.partner).toBeNull();
    for(let i=0;i<60&&f().state==='throw';i++)step();
    expect(['idle','fall']).toContain(f().state);
  });
  it('buries a grounded victim with the grounded Headbutt; mashing pops it out sooner and a hit launches it',()=>{
    const buryVictim=()=>{
      make(false,12);const mario=game.fighters[1];
      step({special:true,specialDirection:'side'});
      for(let i=0;i<80&&mario.state!=='bury';i++)step();
      expect(mario.state).toBe('bury');expect(mario.bury).not.toBeNull();expect(mario.animationRate).toBe(0);
      return mario;
    };
    const escape=(mashing:boolean)=>{
      const mario=buryVictim();
      for(let i=0;i<20;i++)step();
      expect(mario.y).toBeLessThan(-0.5); // the frozen pose sank below the floor
      let frames=0;
      while(mario.state==='bury'&&frames<900){step({},mashing?{attack:frames%2===0}:{});frames++;}
      expect(mario.state).toBe('jump');expect(mario.bury).toBeNull();
      expect(mario.y).toBeGreaterThanOrEqual(-0.01);expect(mario.velocity.y).toBeGreaterThan(0);
      return frames;
    };
    const patient=escape(false),mashed=escape(true);
    expect(mashed).toBeLessThan(patient);
    // The aerial Headbutt keeps its normal element; only the grounded hit plants (element 9).
    expect(f().content.attacks.get('SpecialS')!.events.some(e=>e.type==='create'&&e.hit.element===9)).toBe(true);
    expect(f().content.attacks.get('SpecialAirS')!.events.some(e=>e.type==='create'&&e.hit.element===9)).toBe(false);
    // Any ordinary hit frees a buried victim into normal hitstun at floor level.
    const mario=buryVictim();
    ticks(30);
    game.fighters[0].x=mario.x-9;game.fighters[0].state='idle';game.fighters[0].animation='Wait1';game.fighters[0].special=null;
    for(let i=0;i<30&&mario.state==='bury';i++)step({attack:i===0});
    expect(mario.state).toBe('hitstun');expect(mario.bury).toBeNull();expect(mario.y).toBeGreaterThanOrEqual(-0.01);
  });
  it('banks one Giant Punch swing per wind-up loop and adds 2 damage each on release',()=>{
    step({special:true,specialDirection:'neutral'});
    const loop=f().content.clips.get('SpecialNLoop')!.endFrame;
    ticks(f().content.clips.get('SpecialNStart')!.endFrame+2+Math.ceil(loop)*3,{special:true});
    const banked=f().dkPunchCharge;expect(banked).toBeGreaterThanOrEqual(2);expect(f().special?.phase).toBe('loop');
    step();step({special:true});expect(f().special?.phase).toBe('end');expect(f().animation).toBe('SpecialN');
    expect(f().special?.dk?.swings).toBe(banked);expect(f().dkPunchCharge).toBe(0);
    const move=f().content.attacks.get('SpecialN')!,first=move.events.find(e=>e.type==='create')!;
    const hits=dkHits(f(),activeHits(move,first.frame));
    expect(hits[0]!.damage).toBe(activeHits(move,first.frame)[0]!.damage+banked*2);
    ticks(120);expect(f().special).toBeNull();expect(f().state).not.toBe('helpless');
  });
  it('shield-cancels the wind-up keeping the banked swings and auto-stops when full',()=>{
    step({special:true,specialDirection:'neutral'});
    ticks(f().content.clips.get('SpecialNStart')!.endFrame+2,{special:true});
    const loop=Math.ceil(f().content.clips.get('SpecialNLoop')!.endFrame);
    ticks(loop*2,{special:true,shield:true});
    expect(['travel',undefined]).toContain(f().special?.phase);
    const banked=f().dkPunchCharge;expect(banked).toBeGreaterThanOrEqual(1);
    ticks(90);expect(f().special).toBeNull();expect(f().dkPunchCharge).toBe(banked);
    // Charging to the maximum leaves the state on its own with a full bank.
    make();f().dkPunchCharge=9;step({special:true,specialDirection:'neutral'});
    ticks(f().content.clips.get('SpecialNStart')!.endFrame+2+loop+2,{special:true});
    expect(f().dkPunchCharge).toBe(10);expect(f().special).toBeNull();
  });
  it('releases the full punch immediately from a full bank with its own script and launch',()=>{
    f().dkPunchCharge=10;step({special:true,specialDirection:'neutral'});
    expect(f().special?.dk?.full).toBe(true);expect(f().dkPunchCharge).toBe(0);
    step();expect(f().animation).toBe('SpecialNFull');
    const move=f().content.attacks.get('SpecialNFull')!,first=move.events.find(e=>e.type==='create')!;
    expect(dkHits(f(),activeHits(move,first.frame))).toEqual(activeHits(move,first.frame));
    // The 0.12 × 10 launch decays under original ground friction from the very next tick.
    ticks(first.frame+2);expect(Math.abs(f().velocity.x)).toBeGreaterThan(0.5);
    expect(Math.abs(f().velocity.x)).toBeLessThanOrEqual(1.2);
    ticks(120);expect(f().special).toBeNull();
  });
  it('loses the banked punch on KO but keeps it through hitstun',()=>{
    // A hit interrupts without draining the bank.
    make(false,14);f().dkPunchCharge=7;step({},{attack:true});ticks(14,{});
    expect(f().percent).toBeGreaterThan(0);expect(f().dkPunchCharge).toBe(7);
    f().y=content.stage.blast.bottom-5;f().grounded=false;f().floor=null;step();
    expect(f().dkPunchCharge).toBe(0);
  });
  it('aerial Giant Punch ends helpless with the original 20-frame special landing lag',()=>{
    air(80);f().dkPunchCharge=3;step({special:true,specialDirection:'neutral'});
    ticks(Math.ceil(f().content.clips.get('SpecialAirNStart')!.endFrame)+2,{special:true});
    expect(f().special?.phase).toBe('loop');
    step();step({special:true});expect(f().animation).toBe('SpecialAirN');
    // Hold altitude so the whole punch resolves airborne instead of landing first.
    for(let i=0;i<Math.ceil(f().content.clips.get('SpecialAirN')!.endFrame)+2;i++){f().y=80;f().velocity.y=0;step();}
    expect(f().state).toBe('helpless');expect(f().specialLandingLag).toBe(20);
  });
  it('Headbutt hovers until its script drops it and never leaves DK helpless',()=>{
    air(90);step({special:true,specialDirection:'side',x:1});
    expect(f().animation).toBe('SpecialAirS');expect(f().velocity.y).toBe(0);
    const y0=f().y;step();expect(f().y).toBeCloseTo(y0,1);
    ticks(Math.ceil(f().content.clips.get('SpecialAirS')!.endFrame)+2);
    expect(f().special).toBeNull();expect(f().state).not.toBe('helpless');
    make(false,14);step({special:true,specialDirection:'side',x:1});ticks(20);expect(game.fighters[1].percent).toBeGreaterThan(0);
  });
  it('Spinning Kong launches at 0.675, consumes jumps, drifts and ends helpless in the air',()=>{
    air(120);f().velocity.x=2;step({special:true,specialDirection:'up',y:1});
    // The 0.675 launch already lost one tick of the scaled 0.007 gravity by the first observable frame.
    expect(f().animation).toBe('SpecialAirHi');expect(f().velocity.y).toBeGreaterThan(0.66);expect(f().velocity.y).toBeLessThanOrEqual(0.675);
    expect(Math.abs(f().velocity.x)).toBeLessThanOrEqual(0.85+1e-4);expect(f().jumpsUsed).toBe(f().content.profile.attributes.maxJumps);
    const start=f().y;ticks(25);expect(f().y).toBeGreaterThan(start);
    ticks(Math.ceil(f().content.clips.get('SpecialAirHi')!.endFrame));
    expect(f().state).toBe('helpless');expect(f().specialLandingLag).toBe(40);
  });
  it('grounded Spinning Kong slides under its caps and ends standing, and landing continues the spin',()=>{
    step({special:true,specialDirection:'up',y:1});expect(f().animation).toBe('SpecialHi');
    ticks(10,{x:1});expect(Math.abs(f().velocity.x)).toBeLessThanOrEqual(0.85+1e-4);expect(f().grounded).toBe(true);
    ticks(Math.ceil(f().content.clips.get('SpecialHi')!.endFrame)+5);
    expect(f().special).toBeNull();expect(['idle','landing']).toContain(f().state);
    // Aerial spin that reaches the floor keeps spinning as the grounded variant.
    make();air(6);f().velocity.y=-1;step({special:true,specialDirection:'up'});
    f().velocity.y=-3;ticks(8);
    expect(f().grounded).toBe(true);expect(f().special?.direction).toBe('up');expect(f().animation).toBe('SpecialHi');
  });
  it('Hand Slap is ground-only, loops on B and hits only grounded opponents',()=>{
    air(50);step({special:true,specialDirection:'down',down:true});expect(f().special).toBeNull();
    make(false,16);step({special:true,specialDirection:'down',down:true});
    expect(f().animation).toBe('SpecialLwStart');
    ticks(Math.ceil(f().content.clips.get('SpecialLwStart')!.endFrame)+1,{special:true,down:true});
    expect(f().animation).toBe('SpecialLwLoop');
    const loop=Math.ceil(f().content.clips.get('SpecialLwLoop')!.endFrame);
    step();step({special:true});ticks(loop,{});
    expect(['SpecialLwLoop','SpecialLwEnd']).toContain(f().animation);
    ticks(loop+Math.ceil(f().content.clips.get('SpecialLwEnd')!.endFrame)+4);
    expect(f().special).toBeNull();
    const slap=f().content.attacks.get('SpecialLwLoop')!;
    for(const e of slap.events)if(e.type==='create')expect(e.hit.airborne).toBe(false);
  });
  it('never emits projectiles for any special and restores hashes exactly',()=>{
    for(const direction of ['neutral','side','up','down'] as const){make();step({special:true,specialDirection:direction});ticks(60);expect(game.projectiles.items).toHaveLength(0);const state=game.captureState(),hash=game.stateHash();game.restoreState(state);expect(game.stateHash()).toBe(hash);}
  });
  it('restores mid-punch state deterministically including the bank',()=>{
    step({special:true,specialDirection:'neutral'});ticks(60,{special:true});
    const state=game.captureState(),charge=f().dkPunchCharge;ticks(30);const hash=game.stateHash();
    game.restoreState(state);expect(f().dkPunchCharge).toBe(charge);ticks(30);expect(game.stateHash()).toBe(hash);
  });
  it.each([2,4])('reconciles late DK special inputs in %i slots with confirmed events exactly once',count=>{
    const selected=rosterPlayers(base,Array.from({length:count},()=> 'Dk' as const)),ra=new GameRigs(selected),rb=new GameRigs(selected);
    try{
      const match=new LocalMatch(selected,ra,{opponent:'human',countdown:0,seed:17}),reference=new LocalMatch(selected,rb,{opponent:'human',countdown:0,seed:17});match.start();reference.start();
      const driver=new RollbackDriver(match,0,count,{maxPrediction:6,historyLimit:32}),pending:Array<{due:number;frame:number;slot:number;input:PlayerInput}>=[];
      const expected:Array<{frame:number;events:unknown}>=[],emitted:Array<{frame:number;events:unknown}>=[];
      const input=(frame:number,slot:number)=>normalizeInput({...neutralInput(),special:frame>=slot*3&&frame<70+slot,specialDirection:'neutral'});
      for(let tick=0;tick<250;tick++){
        for(let i=pending.length-1;i>=0;i--)if(pending[i]!.due<=tick){const p=pending.splice(i,1)[0]!;driver.receive(p.frame,p.slot,p.input);}
        if(reference.frame<130){const frame=driver.frame,local=input(frame,0);if(driver.advance(local)){driver.receive(frame,0,local);const inputs=Array.from({length:count},(_,slot)=>input(frame,slot));reference.step(inputs);expected.push({frame,events:structuredClone(reference.events)});for(let slot=1;slot<count;slot++)pending.push({due:tick+1+(frame+slot)%4,frame,slot,input:inputs[slot]!});}}
        emitted.push(...driver.drainConfirmedEvents().map(({frame,events})=>({frame,events})));if(reference.frame===130&&pending.length===0)break;
      }
      expect(driver.confirmedFrame).toBe(129);expect(match.stateHash()).toBe(reference.stateHash());expect(emitted).toEqual(expected);expect(driver.stats.rollbacks).toBeGreaterThan(0);expect(driver.drainConfirmedEvents()).toEqual([]);
    }finally{ra.dispose();rb.dispose();}
  });
});
