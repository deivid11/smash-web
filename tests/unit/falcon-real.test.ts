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
import { FALCON_ACTION_KEYS } from '../../lib/game/falcon-data.ts';
import { falconRaptorDetect, falconDiveActive } from '../../lib/game/falcon.ts';
import { command } from '../../lib/game/specials.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Captain Falcon registration',()=>{
  it('reserves public-roster selector7, native Ca kind, own narrator and bounded assets',()=>{
    expect(ROSTER_CHOICES[7]).toBe('Ca');expect(ROOM_FIGHTERS).toContain('Ca');
    expect(parseClientMessage(JSON.stringify({type:'choose',token:'t',fighter:'Ca'}))).toMatchObject({fighter:'Ca'});
    for(const name of ['PlCa.dat','PlCaAJ.dat','PlCaNr.dat','EfCaData.dat','audio/us/captain.ssm'])expect(SERVER_ASSETS).toContain(name);
    for(const name of ['audio/captain.ssm'])expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.falcon).toBe(0x7c830);expect(new Set(FALCON_ACTION_KEYS.map(e=>e.key)).size).toBe(18);
  });
});
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Captain Falcon original ISO integration',()=>{
  let base:GameContent,content:GameContent,rig:GameRigs,game:LocalMatch;
  const make=(mirror=false,gap=50)=>{
    rig?.dispose();content=rosterPair(base,'Ca',mirror?'Ca':'Mr');rig=new GameRigs(content);
    game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();
    game.fighters.forEach((f,i)=>{f.x=(i?1:-1)*gap/2;f.y=0;f.grounded=true;f.floor=content.stage.floors.find(floor=>!floor.oneWay)!.id;rig.sample(f);});
  };
  const step=(a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>game.step([{...neutralInput(),...a},{...neutralInput(),...b}]);
  const ticks=(n:number,a:Partial<PlayerInput>={})=>{for(let i=0;i<n;i++)step(a);};
  const f=()=>game.fighters[0];
  const air=(y=100)=>{f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().y=y;};
  beforeAll(async()=>{const disc=await openDisc(iso!);try{base=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer,undefined,'final');}finally{await disc.close();}},30000);
  beforeEach(()=>make());afterEach(()=>rig?.dispose());
  it('loads the 63-joint skeleton, full jab chain and no phantom articles',()=>{
    const ca=f().content;expect(ca.profile.name).toBe('Captain Falcon');expect(ca.profile.boneCount).toBe(63);
    expect(ca.model.stats.meshes).toBe(98);expect(ca.moves.jab3).toBe('Attack13');expect(ca.moves.rapidLoop).toBe('Attack100Loop');
    expect(ca.specials.articles).toEqual({});
    for(const clip of ca.clips.values()){expect(clip.joints).toHaveLength(63);expect(clip.name).toContain('Captain');}
    for(const name of Object.values(ca.moves))if(!name.startsWith('Attack100'))expect(ca.attacks.get(name)!.events.some(e=>e.type==='create')).toBe(true);
    expect(base.sound.cues(ca.specials.sounds.ko).length).toBeGreaterThan(0);
  });
  it('keeps original Falcon Punch windows and the aerial redirect commands',()=>{
    const ca=f().content;
    expect(activeHits(ca.attacks.get('SpecialN')!,53)[0]?.damage).toBe(27);
    expect(activeHits(ca.attacks.get('SpecialN')!,58)).toHaveLength(0);
    const airEvents=ca.timelines.get('SpecialAirN')!.events;
    expect(airEvents).toContainEqual({type:'command',frame:50,index:0,value:1});
    expect(airEvents).toContainEqual({type:'command',frame:65,index:1,value:2});
  });
  it('poses every normal hitbox in both facings with correct original bones',()=>{
    for(const name of Object.values(f().content.moves))for(const facing of [-1,1]){
      const move=f().content.attacks.get(name)!,first=move.events.find(e=>e.type==='create');
      if(!first)continue;
      f().animation=name;f().animationFrame=first.frame;f().facing=facing;rig.sample(f());
      for(const hit of activeHits(move,first.frame))expect(rig.point(f(),hit.bone,hit.offset).every(Number.isFinite)).toBe(true);
    }
  });
  it('connects its own jab and allows shield, grab and original throw',()=>{
    make(false,12);step({attack:true});ticks(12);expect(game.fighters[1].percent).toBeGreaterThan(0);
    make(false,10);step({shield:true});expect(f().state).toBe('shield');
    make(false,10);step({grab:true});ticks(12);expect(f().state).toBe('holding');step({x:1});ticks(45);expect(game.fighters[1].percent).toBeGreaterThan(0);expect(f().combat.partner).toBeNull();
  });
  it('redirects the aerial Falcon Punch once at the script command',()=>{
    air(150);step({special:true,specialDirection:'neutral'});
    ticks(52,{y:1});
    expect(f().animation).toBe('SpecialAirN');
    expect(f().velocity.x).toBeGreaterThan(0.5);expect(f().velocity.y).toBeGreaterThan(0.2);
    ticks(80);expect(f().special).toBeNull();
  });
  it('turns Raptor Boost contact into the uppercut through the elem-11 detect window',()=>{
    make(false,14);step({special:true,specialDirection:'side'});
    ticks(12);expect(falconRaptorDetect(f())).toBe(false);
    ticks(5);expect(f().special?.phase==='hit'||command(f(),0)===1).toBe(true);
    ticks(20);
    expect(f().special?.phase).toBe('hit');expect(f().animation).toBe('SpecialS');
    ticks(12);expect(game.fighters[1].percent).toBeGreaterThan(0);expect(f().percent).toBe(0);
    ticks(60);expect(f().special).toBeNull();
  });
  it('leaves a missed aerial Raptor Boost helpless with the original 20-frame lag',()=>{
    air(80);step({special:true,specialDirection:'side'});
    expect(f().animation).toBe('SpecialAirSStart');
    ticks(110);expect(['helpless','landing','idle','fall']).toContain(f().state);
    expect(f().state==='helpless'?f().specialLandingLag:20).toBe(20);
  });
  it('Falcon Dive grabs, throws with the original release explosion and never goes helpless after a catch',()=>{
    make(false,8);step({special:true,specialDirection:'up'});
    expect(falconDiveActive(f())).toBe(true);expect(f().jumpsUsed).toBe(f().content.profile.attributes.maxJumps);
    ticks(16);
    expect(f().special?.phase).toBe('hit');expect(f().animation).toBe('SpecialHiCatch');
    expect(game.fighters[1].state).toBe('captured');expect(f().combat.partner).toBe(1);
    ticks(30);
    expect(['throw','fall','idle','landing','special']).toContain(f().state);
    ticks(30);
    expect(game.fighters[1].percent).toBeGreaterThanOrEqual(12);
    expect(f().combat.partner).toBeNull();expect(f().state).not.toBe('helpless');
  });
  it('a whiffed Falcon Dive ends helpless with 30-frame landing lag and 0.72 mobility',()=>{
    air(120);step({special:true,specialDirection:'up'});
    expect(f().animation).toBe('SpecialAirHi');
    ticks(70);
    expect(['helpless','landing','idle']).toContain(f().state);
    if(f().state==='helpless'){expect(f().specialLandingLag).toBe(30);expect(f().specialMobility).toBeCloseTo(0.72,2);}
  });
  it('Falcon Kick slows by the original 0.6 multiplier per landed hit and ends grounded',()=>{
    make(false,12);step({special:true,specialDirection:'down'});
    expect(f().animation).toBe('SpecialLw');
    ticks(20);
    expect(game.fighters[1].percent).toBeGreaterThan(0);
    expect(f().special?.falcon?.slow).toBeCloseTo(0.6,3);
    ticks(60);expect(f().special).toBeNull();expect(['idle','fall']).toContain(f().state);
  });
  it('the aerial Falcon Kick lands into its ending with landing hitboxes and no helpless state',()=>{
    make(false,60);air(30);step({special:true,specialDirection:'down'});
    expect(f().animation).toBe('SpecialAirLw');
    let sawEnd=false;
    for(let i=0;i<90&&f().special;i++){step();if(f().animation==='SpecialAirLwEnd')sawEnd=true;}
    expect(sawEnd).toBe(true);
    expect(f().state).not.toBe('helpless');
    expect(activeHits(f().content.attacks.get('SpecialAirLwEnd')!,2)[0]?.damage).toBe(9);
  });
  it('never emits projectiles for any Falcon special and restores byte-identical state',()=>{
    for(const direction of ['neutral','side','up','down'] as const){make();step({special:true,specialDirection:direction});ticks(60);expect(game.projectiles.items).toHaveLength(0);const state=game.captureState(),hash=game.stateHash();game.restoreState(state);expect(game.stateHash()).toBe(hash);}
  });
  it.each([2,4])('reconciles late Falcon special inputs in %i slots with confirmed events exactly once',count=>{
    const selected=rosterPlayers(base,Array.from({length:count},()=> 'Ca' as const)),ra=new GameRigs(selected),rb=new GameRigs(selected);
    try{
      const match=new LocalMatch(selected,ra,{opponent:'human',countdown:0,seed:23}),reference=new LocalMatch(selected,rb,{opponent:'human',countdown:0,seed:23});match.start();reference.start();
      const driver=new RollbackDriver(match,0,count,{maxPrediction:6,historyLimit:32}),pending:Array<{due:number;frame:number;slot:number;input:PlayerInput}>=[];
      const expected:Array<{frame:number;events:unknown}>=[],emitted:Array<{frame:number;events:unknown}>=[];
      const directions=['up','down','side','neutral'] as const;
      const input=(frame:number,slot:number)=>normalizeInput({...neutralInput(),special:frame>=slot*3&&frame<70+slot,specialDirection:directions[slot%4]});
      for(let tick=0;tick<250;tick++){
        for(let i=pending.length-1;i>=0;i--)if(pending[i]!.due<=tick){const p=pending.splice(i,1)[0]!;driver.receive(p.frame,p.slot,p.input);}
        if(reference.frame<130){const frame=driver.frame,local=input(frame,0);if(driver.advance(local)){driver.receive(frame,0,local);const inputs=Array.from({length:count},(_,slot)=>input(frame,slot));reference.step(inputs);expected.push({frame,events:structuredClone(reference.events)});for(let slot=1;slot<count;slot++)pending.push({due:tick+1+(frame+slot)%4,frame,slot,input:inputs[slot]!});}}
        emitted.push(...driver.drainConfirmedEvents().map(({frame,events})=>({frame,events})));if(reference.frame===130&&pending.length===0)break;
      }
      expect(driver.confirmedFrame).toBe(129);expect(match.stateHash()).toBe(reference.stateHash());expect(emitted).toEqual(expected);expect(driver.stats.rollbacks).toBeGreaterThan(0);expect(driver.drainConfirmedEvents()).toEqual([]);
    }finally{ra.dispose();rb.dispose();}
  });
});
