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
import { ROY_ACTION_KEYS } from '../../lib/game/roy-data.ts';
import { royHits, royCounter, triggerRoyCounter } from '../../lib/game/roy.ts';
import { beginSpecial, command } from '../../lib/game/specials.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Roy registration',()=>{
  it('reserves public-roster selector5, native Fe kind, own narrator and bounded assets',()=>{
    expect(ROSTER_CHOICES[5]).toBe('Fe');expect(ROOM_FIGHTERS).toContain('Fe');
    expect(parseClientMessage(JSON.stringify({type:'choose',token:'t',fighter:'Fe'}))).toMatchObject({fighter:'Fe'});
    for(const name of ['PlFe.dat','PlFeAJ.dat','PlFeNr.dat','EfFeData.dat','audio/us/emblem.ssm'])expect(SERVER_ASSETS).toContain(name);
    for(const name of ['audio/emblem.ssm'])expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.roy).toBe(0x7c83c);expect(new Set(ROY_ACTION_KEYS.map(e=>e.key)).size).toBe(32);
  });
});
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Roy original ISO integration',()=>{
  let base:GameContent,content:GameContent,rig:GameRigs,game:LocalMatch;
  const make=(mirror=false,gap=50)=>{
    rig?.dispose();content=rosterPair(base,'Fe',mirror?'Fe':'Mr');rig=new GameRigs(content);
    game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();
    game.fighters.forEach((f,i)=>{f.x=(i?1:-1)*gap/2;f.y=0;f.grounded=true;f.floor=content.stage.floors.find(floor=>!floor.oneWay)!.id;rig.sample(f);});
  };
  const step=(a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>game.step([{...neutralInput(),...a},{...neutralInput(),...b}]);
  const ticks=(n:number,a:Partial<PlayerInput>={})=>{for(let i=0;i<n;i++)step(a);};
  const f=()=>game.fighters[0];
  const air=(y=100)=>{f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().y=y;};
  beforeAll(async()=>{const disc=await openDisc(iso!);try{base=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer,undefined,'final');}finally{await disc.close();}},30000);
  beforeEach(()=>make());afterEach(()=>rig?.dispose());
  it('loads Roy92-joint skeleton,85weight and own animations without phantom jab2/articles',()=>{
    const fe=f().content;expect(fe.profile.name).toBe('Roy');expect(fe.profile.boneCount).toBe(92);expect(fe.profile.attributes.weight).toBe(85);
    expect(fe.profile.attributes.runSpeed).toBeCloseTo(1.61);expect(fe.model.stats.meshes).toBe(121);expect(fe.moves.jab2).toBeUndefined();expect(fe.specials.articles).toEqual({});
    for(const clip of fe.clips.values()){expect(clip.joints).toHaveLength(92);expect(clip.name).toContain('Emblem');}
    for(const name of Object.values(fe.moves))expect(fe.attacks.get(name)!.events.some(e=>e.type==='create')).toBe(true);
    expect(base.sound.cues(fe.specials.sounds.ko).length).toBeGreaterThan(0);
    expect(base.sound.cues(310120).length).toBeGreaterThan(0);
  });
  it('keeps shared figatree release scripts distinct and original full-charge recoil',()=>{
    const fe=f().content;expect(fe.clips.get('SpecialNEnd')!.name).toBe(fe.clips.get('SpecialNEndFull')!.name);
    expect(activeHits(fe.attacks.get('SpecialNEnd')!,5)[0]?.damage).toBe(6);
    expect(activeHits(fe.attacks.get('SpecialNEndFull')!,9)[0]?.damage).toBe(50);
    expect(fe.timelines.get('SpecialNEndFull')!.events).toContainEqual({type:'self-damage',frame:9,damage:10});
    expect(fe.timelines.get('SpecialAirNEndFull')!.events).toEqual(fe.timelines.get('SpecialNEndFull')!.events);
    expect(fe.timelines.get('SpecialS4Lw')!.events.filter(e=>e.type==='clear')).toHaveLength(5);
  });
  it('poses every normal hitbox in both facings with correct original bones',()=>{
    for(const name of Object.values(f().content.moves))for(const facing of [-1,1]){
      const move=f().content.attacks.get(name)!,first=move.events.find(e=>e.type==='create')!;
      f().animation=name;f().animationFrame=first.frame;f().facing=facing;rig.sample(f());
      for(const hit of activeHits(move,first.frame))expect(rig.point(f(),hit.bone,hit.offset).every(Number.isFinite)).toBe(true);
    }
  });
  it('connects its own jab and allows shield, grab and original throw',()=>{
    make(false,12);step({attack:true});ticks(12);expect(game.fighters[1].percent).toBeGreaterThan(0);
    make(false,10);step({shield:true});expect(f().state).toBe('shield');
    make(false,10);step({grab:true});ticks(12);expect(f().state).toBe('holding');step({x:1});ticks(45);expect(game.fighters[1].percent).toBeGreaterThan(0);expect(f().combat.partner).toBeNull();
  });
  it('releases partial Flare Blade with integer30-frame charge scaling and no recoil',()=>{
    step({special:true,specialDirection:'neutral'});ticks(75,{special:true});const charge=f().special!.roy!.charge;expect(charge).toBeGreaterThan(60);
    step();ticks(5);expect(f().special?.phase).toBe('end');const hits=royHits(f(),activeHits(f().content.attacks.get(f().animation)!,5));
    expect(hits[0]?.damage).toBe(6+Math.trunc((charge+1)/30)*5);expect(f().percent).toBe(0);ticks(40);expect(f().special).toBeNull();
  });
  it('auto-releases full Flare Blade, deals50 and applies10self-damage exactly once across restore',()=>{
    make(false,120);step({special:true,specialDirection:'neutral'});ticks(225,{special:true});
    expect(f().special?.roy?.full).toBe(true);expect(f().animation).toBe('SpecialNEndFull');
    const state=game.captureState();ticks(15);expect(f().percent).toBe(10);const hash=game.stateHash();
    game.restoreState(state);ticks(15);expect(f().percent).toBe(10);expect(game.stateHash()).toBe(hash);ticks(30);expect(f().percent).toBe(10);expect(f().special).toBeNull();
  });
  it.each(['Hi','S','Lw'])('chains Double-Edge Dance to directional4%s only inside script windows',branch=>{
    step({special:true,specialDirection:'side'});ticks(8);expect(command(f(),0)).toBe(1);
    step({special:true,y:1});expect(f().animation).toBe('SpecialS2Hi');ticks(16);
    step({special:true,y:branch==='Hi'?1:branch==='Lw'?-1:0});expect(f().animation).toBe(`SpecialS3${branch}`);
    const next=branch==='Hi'?17:branch==='Lw'?22:15;ticks(next);
    step({special:true,y:branch==='Hi'?1:branch==='Lw'?-1:0});expect(f().animation).toBe(`SpecialS4${branch}`);expect(f().special?.roy?.stage).toBe(4);
    ticks(5);step({special:true});expect(f().special?.roy?.stage).toBe(4);ticks(130);expect(f().special).toBeNull();
  });
  it('rejects an early side-special tap rather than buffering a free chain',()=>{
    step({special:true,specialDirection:'side'});step();step({special:true});expect(f().special?.roy?.failed).toBe(true);ticks(10);step({special:true});expect(f().special?.roy?.stage).toBe(1);ticks(40);expect(f().special).toBeNull();
  });
  it('only grants the1.2aerial side boost once per airtime and resets on landing',()=>{
    air();beginSpecial(f(),'side',{...neutralInput(),special:true});expect(f().velocity.y).toBeCloseTo(1.2);expect(f().roySideBoostUsed).toBe(true);
    beginSpecial(f(),'side',{...neutralInput(),special:true});expect(f().velocity.y).toBe(0);
    ticks(140);expect(f().roySideBoostUsed).toBe(false);
  });
  it.each([false,true])('Blazer uses original ground/air root motion then helpless (air=%s)',aerial=>{
    if(aerial)air(50);step({special:true,specialDirection:'up',y:1});const start=f().y;ticks(20);
    expect(f().y).toBeGreaterThan(start+10);expect(f().grounded).toBe(false);expect(f().jumpsUsed).toBe(2);
    expect(f().animation).toBe(aerial?'SpecialAirHi':'SpecialHi');ticks(40);expect(['helpless','landing','idle']).toContain(f().state);
  });
  it('Counter follows cmd1 frames8–20 and native integer1.5damage without a fake minimum',()=>{
    step({special:true,specialDirection:'down'});expect(royCounter(f())).toBeNull();ticks(8);expect(royCounter(f())?.radius).toBe(8.5);
    const hit=activeHits(f().content.attacks.get('Attack11')!,5)[0]??{...activeHits(f().content.attacks.get('SpecialNEnd')!,5)[0]!,damage:3.9};
    hit.damage=3.9;expect(triggerRoyCounter(f(),hit,100)).toBe(true);expect(f().special?.counterDamage).toBe(4);
    expect(royHits(f(),activeHits(f().content.attacks.get('SpecialLwHit')!,3))[0]?.damage).toBe(4);
    make();step({special:true,specialDirection:'down'});ticks(21);expect(royCounter(f())).toBeNull();
  });
  it('Counter catches an incoming jab through its native sphere without damage',()=>{
    make(false,12);step({special:true,specialDirection:'down'});ticks(8);step({}, {attack:true});ticks(8);
    expect(f().special?.phase).toBe('hit');expect(f().percent).toBe(0);expect(f().special?.counterDamage).toBeGreaterThan(0);
  });
  it('grabs beat Counter and do not trigger a retaliation state',()=>{
    make(false,10);step({special:true,specialDirection:'down'});ticks(8);step({}, {grab:true});ticks(10);expect(f().state).toBe('captured');expect(f().special).toBeNull();
  });
  it('never emits projectiles for any Roy special or article-free restore',()=>{
    for(const direction of ['neutral','side','up','down'] as const){make();step({special:true,specialDirection:direction});ticks(60);expect(game.projectiles.items).toHaveLength(0);const state=game.captureState(),hash=game.stateHash();game.restoreState(state);expect(game.stateHash()).toBe(hash);}
  });
  it.each([2,4])('reconciles late Roy special inputs in%i slots with confirmed events exactly once',count=>{
    const selected=rosterPlayers(base,Array.from({length:count},()=> 'Fe' as const)),ra=new GameRigs(selected),rb=new GameRigs(selected);
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
