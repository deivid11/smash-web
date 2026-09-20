import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, rosterPlayers, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { ModelInstance } from '../../web/src/render/model-instance.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { RollbackDriver, normalizeInput } from '../../lib/game/rollback.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { PIKACHU_ACTION_KEYS } from '../../lib/game/pikachu-data.ts';
import { pikachuHits } from '../../lib/game/pikachu.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Pikachu registration', () => {
  it('appends public-roster selector 4, room kind and only verified assets', () => {
    expect(ROSTER_CHOICES[4]).toBe('Pk'); expect(ROOM_FIGHTERS).toContain('Pk');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Pk' }))).toMatchObject({ fighter: 'Pk' });
    for (const name of ['PlPk.dat', 'PlPkAJ.dat', 'PlPkNr.dat', 'EfPkData.dat', 'audio/us/pikachu.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/pikachu.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.pikachu).toBe(0x7c84d);
    expect(new Set(PIKACHU_ACTION_KEYS.map(e => e.key)).size).toBe(PIKACHU_ACTION_KEYS.length);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Pikachu original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 35) => {
    rig?.dispose(); content = rosterPair(base, 'Pk', mirror ? 'Pk' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i=0;i<n;i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('reads the 53-joint model, native attributes and real Wait idle without a fabricated jab2', () => {
    const pk=f().content, p=pk.profile;
    expect(p.name).toBe('Pikachu'); expect(p.boneCount).toBe(53); expect(p.partJoints).toHaveLength(53);
    expect(p.attributes.weight).toBe(80); expect(p.attributes.maxJumps).toBe(2);
    expect(pk.model.stats.meshes).toBe(52); expect(pk.clips.get('Wait1')!.name).toContain('ACTION_Wait_');
    expect(pk.moves.jab2).toBeUndefined(); expect(pk.clips.get('Wait1')!.endFrame).toBe(430);
    for(const clip of pk.clips.values()){expect(clip.joints).toHaveLength(53);expect(clip.name).toContain('PlyPikachu5K_');}
    for(const name of Object.values(pk.moves)) expect(pk.attacks.get(name)!.events.some(e=>e.type==='create')).toBe(true);
    for(const h of p.hurts) expect(h.bone).toBeLessThan(53);
  });
  it('keeps the original aerial goto scripts, first/second zip damage and thunder burst', () => {
    const pk=f().content;
    expect(activeHits(pk.attacks.get('SpecialAirHiStart')!,13)[0]?.damage).toBe(3);
    expect(activeHits(pk.attacks.get('SpecialAirHiTravel')!,13)[0]?.damage).toBe(2);
    expect(activeHits(pk.attacks.get('SpecialAirLwHit')!,0)[0]?.damage).toBe(17);
    expect(pk.timelines.get('SpecialAirN')!.events).toEqual(pk.timelines.get('SpecialN')!.events);
    expect(pk.specials.articles.projectile!.model.stats.meshes).toBe(0); // native spark is particle-only
    expect(pk.specials.articles.pikachu!.groundJolt.model.stats.meshes).toBeGreaterThan(0);
    expect(pk.specials.articles.pikachu!.thunder.hit?.damage).toBe(10);
    expect(base.sound.cues(pk.specials.sounds.ko).length).toBeGreaterThan(0);
    expect(base.sound.cues(240076).length).toBeGreaterThan(0);
  });
  it('uses the original ground-wave joint6 animation as its authoritative path', () => {
    const pk=f().content.specials.articles.pikachu!, model=new ModelInstance(pk.groundJolt.model);
    try {for(const frame of [0,3,6,9,12,18,24]){model.update(frame);const point=model.jointPoint(6,[0,0,0]).multiplyScalar(pk.groundJolt.scale);pk.groundPath[frame]!.forEach((value,i)=>expect(value).toBeCloseTo(point.toArray()[i]!,4));}}finally{model.dispose();}
    expect(pk.groundPath[6]![1]).toBeGreaterThan(10);expect(pk.groundPath[12]![2]).toBeGreaterThan(18);
  });
  it('runs every normal through the posed original skeleton for both facings', () => {
    for(const name of Object.values(f().content.moves)) for(const facing of [-1,1]) {
      const move=f().content.attacks.get(name)!, first=move.events.find(e=>e.type==='create');if(!first)continue;
      f().animation=name;f().animationFrame=first.frame;f().facing=facing;rig.sample(f());
      for(const hit of activeHits(move,first.frame)) expect(rig.point(f(),hit.bone,hit.offset).every(Number.isFinite)).toBe(true);
    }
  });
  it('connects its own jab and supports shield, grab and throw actions', () => {
    make(false,10);step({attack:true});ticks(10);expect(game.fighters[1].percent).toBeGreaterThan(0);
    make(false,10);step({shield:true});expect(f().state).toBe('shield');
    make(false,10);step({grab:true});ticks(9);expect(f().state).toBe('holding');
    step({x:1});ticks(45);expect(game.fighters[1].percent).toBeGreaterThan(0);expect(f().combat.partner).toBeNull();
  });
  it('restarts Attack11 at its original combo gate on every buffered tap', () => {
    const pk=f().content, move=pk.attacks.get(pk.moves.jab)!;
    const gate=move.events.find(e=>e.type==='jab'&&e.kind==='combo'&&e.enabled)!.frame;
    expect(gate).toBe(5);expect(gate).toBeLessThan(pk.clips.get(pk.moves.jab)!.endFrame);
    step({attack:true});
    for(let cycle=0;cycle<6;cycle++) {
      const serial=f().attackSerial;
      step();step({attack:true}); // Queue the next tap before the script permits it.
      while(f().animationFrame<gate){expect(f().attackSerial).toBe(serial);step();}
      expect(f().attackSerial).toBe(serial);
      step();
      expect(f().animation).toBe('Attack11');expect(f().animationFrame).toBe(1);
      expect(f().attackSerial).toBe(serial+1);expect(f().jab!.queued).toBe(false);
      expect(f().jab!.window).toBe(pk.profile.attributes.jab2Window);
    }
  });
  it('does not auto-repeat a held attack or an unqueued jab', () => {
    const duration=f().content.clips.get('Attack11')!.endFrame;
    step({attack:true});ticks(duration*3,{attack:true});
    expect(f().attackSerial).toBe(1);expect(f().state).toBe('idle');
    step();step({attack:true});ticks(duration*3);
    expect(f().attackSerial).toBe(2);expect(f().state).toBe('idle');
  });
  it('retains repeat taps during hitlag and deterministically restores the jab queue', () => {
    step({attack:true});step();f().hitlag=3;
    const frame=f().animationFrame, window=f().jab!.window;
    step({attack:true});
    expect(f().animationFrame).toBe(frame);expect(f().jab!.window).toBe(window);
    expect(f().jab!.queued).toBe(true);
    const saved=game.captureState();
    ticks(12);const hash=game.stateHash();expect(f().attackSerial).toBe(2);
    game.restoreState(saved);ticks(12);expect(game.stateHash()).toBe(hash);
  });
  it('fires once on cmd0 frame18, transitions into the original ground article, and restores it', () => {
    step({special:true,specialDirection:'neutral'}); ticks(16); expect(game.projectiles.items).toHaveLength(0);
    ticks(5); expect(game.projectiles.items.filter(p=>p.kind==='tjolt')).toHaveLength(1);
    ticks(4);const p=game.projectiles.items.find(p=>p.kind==='tjolt')!;
    expect(p.pikachu?.grounded).toBe(true);expect(p.hit.damage).toBe(7);expect(p.data).toBe(f().content.specials.articles.pikachu!.groundJolt);
    const state=game.captureState();const hash=game.stateHash();ticks(3);game.restoreState(state);expect(game.stateHash()).toBe(hash);
    expect(game.projectiles.items[0]!.data).toBe(f().content.specials.articles.pikachu!.groundJolt);
  });
  it('launches an aerial jolt from the original offsets without turning it into a fireball', () => {
    f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().y=80;
    step({special:true,specialDirection:'neutral'});ticks(20);
    const p=game.projectiles.items.find(p=>p.kind==='tjolt')!;expect(p).toBeDefined();expect(p.pikachu?.grounded).toBe(false);
    expect(p.hit.damage).toBe(10);expect(p.vy).toBeLessThan(0);expect(p.data.gravity).toBeGreaterThanOrEqual(0);
  });
  it('charges Skull Bash using its own damage and launch parameters then exits', () => {
    step({special:true,specialDirection:'side'});ticks(40,{special:true});
    expect(f().special?.phase).toBe('loop');const charge=f().special!.pikachu!.charge;expect(charge).toBeGreaterThan(20);
    step();ticks(5);expect(f().special?.pikachu?.launched).toBe(true);expect(f().velocity.x).toBeGreaterThan(1.4);expect(f().grounded).toBe(false);
    const hits=pikachuHits(f(),activeHits(f().content.attacks.get(f().attackName!)!,f().animationFrame));expect(hits[0]!.damage).toBeGreaterThan(10);
    ticks(110);expect(f().special).toBeNull();
  });
  it('performs two differently aimed Quick Attack zips and never grants a third', () => {
    step({special:true,specialDirection:'up',y:1});ticks(16,{y:1});
    expect(f().special?.phase).toBe('travel');expect(f().special?.pikachu?.zipCount).toBe(1);expect(f().y).toBeGreaterThan(15);
    ticks(15,{x:1});expect(f().special?.pikachu?.zipCount).toBe(2);
    ticks(15,{x:-1});expect(f().special?.pikachu?.zipCount).toBe(2);
    expect(f().jumpsUsed).toBe(2);ticks(70);expect(f().special).toBeNull();
  });
  it('rejects same-direction second zip using the original 38-degree threshold', () => {
    step({special:true,specialDirection:'up',y:1});ticks(40,{y:1});
    expect(f().special?.pikachu?.zipCount).toBe(1);expect(f().special?.phase).toBe('end');
  });
  it('spawns four delayed linked thunder segments and enters the 17% self-contact burst', () => {
    step({special:true,specialDirection:'down'});ticks(23);
    expect(game.projectiles.items.filter(p=>p.kind==='thunder')).toHaveLength(4);
    const state=game.captureState();const hash=game.stateHash();ticks(4);game.restoreState(state);expect(game.stateHash()).toBe(hash);
    let hit=false;for(let i=0;i<50;i++){step();if(f().special?.phase==='hit')hit=true;}
    expect(hit).toBe(true);ticks(80);expect(game.projectiles.items.filter(p=>p.kind==='thunder')).toHaveLength(0);expect(f().special).toBeNull();
  });
  it('does not burst if Pikachu moves away from its summoned thunder', () => {
    step({special:true,specialDirection:'down'});ticks(24);f().x+=35;
    let hit=false;for(let i=0;i<100;i++){step();if(f().special?.phase==='hit')hit=true;}
    expect(hit).toBe(false);expect(f().special).toBeNull();
  });
  it.each([2,4])('reconciles late Pikachu specials in %i slots with exactly-once confirmed events', count => {
    const selected=rosterPlayers(base,Array.from({length:count},()=> 'Pk' as const));
    const ra=new GameRigs(selected),rb=new GameRigs(selected);
    try {
      const match=new LocalMatch(selected,ra,{opponent:'human',countdown:0,seed:17}),reference=new LocalMatch(selected,rb,{opponent:'human',countdown:0,seed:17});match.start();reference.start();
      const driver=new RollbackDriver(match,0,count,{maxPrediction:6,historyLimit:32});
      const pending:Array<{due:number;frame:number;slot:number;input:PlayerInput}>=[];
      const expected:Array<{frame:number;events:unknown}>=[],emitted:Array<{frame:number;events:unknown}>=[];
      const input=(frame:number,slot:number)=>normalizeInput({...neutralInput(),special:frame===slot*3||frame===55+slot,specialDirection:frame<40?'down':'neutral'});
      for(let tick=0;tick<200;tick++) {
        for(let i=pending.length-1;i>=0;i--)if(pending[i]!.due<=tick){const p=pending.splice(i,1)[0]!;driver.receive(p.frame,p.slot,p.input);}
        if(reference.frame<100){const frame=driver.frame,local=input(frame,0);if(driver.advance(local)){
          driver.receive(frame,0,local);const inputs=Array.from({length:count},(_,slot)=>input(frame,slot));reference.step(inputs);
          expected.push({frame,events:structuredClone(reference.events)});
          for(let slot=1;slot<count;slot++)pending.push({due:tick+1+(frame+slot)%4,frame,slot,input:inputs[slot]!});
        }}
        emitted.push(...driver.drainConfirmedEvents().map(({frame,events})=>({frame,events})));
        if(reference.frame===100&&pending.length===0)break;
      }
      expect(driver.confirmedFrame).toBe(99);expect(match.stateHash()).toBe(reference.stateHash());expect(emitted).toEqual(expected);expect(driver.stats.rollbacks).toBeGreaterThan(0);expect(driver.drainConfirmedEvents()).toEqual([]);
    } finally {ra.dispose();rb.dispose();}
  });
  it('has deterministic special/projectile replay in four fighter slots', () => {
    rig.dispose();content=rosterPlayers(base,['Pk','Mr','Pk','Fx']);rig=new GameRigs(content);game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();
    const commands=Array.from({length:100},(_,i)=>[...Array(4)].map((_,slot)=>({...neutralInput(),special:(slot===0&&i===0)||(slot===2&&i===5),specialDirection:'down' as const})));
    const saved=game.captureState();for(const inputs of commands)game.step(inputs);const hash=game.stateHash();game.restoreState(saved);for(const inputs of commands)game.step(inputs);expect(game.stateHash()).toBe(hash);
  });
});
