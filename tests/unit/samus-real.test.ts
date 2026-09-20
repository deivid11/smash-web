import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { RollbackDriver, normalizeInput } from '../../lib/game/rollback.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { ORIGINAL_FIGHTERS } from '../../lib/game/data.ts';
import { samusPartVisibility } from '../../lib/game/samus.ts';
import { fighterHurts } from '../../lib/game/specials.ts';
import { SAMUS_ACTION_KEYS } from '../../lib/game/samus-data.ts';
import { parseClientMessage } from '../../lib/net/protocol.ts';

describe('Samus registration', () => {
  it('uses independent native and selector IDs, with bounded exact assets', () => {
    expect(ORIGINAL_FIGHTERS.Ss).toEqual({ name: 'Samus', nativeKind: 13 }); expect(ROSTER_CHOICES[3]).toBe('Ss');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Ss' }))).toMatchObject({ fighter: 'Ss' });
    for (const file of ['PlSs.dat','PlSsAJ.dat','PlSsNr.dat','EfSsData.dat','audio/us/samus.ssm']) expect(SERVER_ASSETS).toContain(file);
    for (const file of ['audio/samus.ssm']) expect(SERVER_ASSETS).not.toContain(file);
    expect(SAMUS_ACTION_KEYS.find(k => k.key === 'SpecialLw')?.index).toBe(261);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Samus original-data prototype', () => {
  let base: GameContent, rigs: GameRigs, game: LocalMatch;
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))); } finally { await disc.close(); } });
  const make = (mirror = false) => {
    rigs?.dispose(); const content = rosterPair(base, 'Ss', mirror ? 'Ss' : 'Mr'); rigs = new GameRigs(content); game = new LocalMatch(content, rigs, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = i ? 55 : -35; f.y = 0; f.grounded = true; f.floor = 1; rigs.sample(f); });
  };
  beforeEach(() => make()); afterEach(() => rigs?.dispose());
  const step = (input: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, neutralInput()]);
  const ticks = (n: number, input: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(input); };
  it('loads her 60-joint model, own idle, two-hit jab and normal attacks', () => {
    const f = game.fighters[0], c = f.content;
    expect(c.profile.boneCount).toBe(60); expect(c.profile.attributes.weight).toBe(110); expect(c.profile.attributes.maxJumps).toBe(2);
    expect(c.clips.get('Wait1')?.name).toContain('Samus'); expect(c.clips.get('Wait1')?.name).toContain('_ACTION_Wait_');
    for (const name of Object.values(c.moves)) { expect(c.clips.get(name!)?.joints).toHaveLength(60); expect(c.attacks.get(name!)?.events.some(e => e.type === 'create')).toBe(true); }
    expect(c.moves.jab3).toBeUndefined(); expect(c.canGrab).toBe(false);
    step({ grab: true }); expect(f.state).toBe('idle');
  });
  it('uses script-driven transition and Morph Ball draw sets without changing the pose for presentation', () => {
    const f=game.fighters[0];step({special:true,specialDirection:'down'});f.animation='SpecialLw';
    for(const [frame,alternative] of [[0,0],[3,1],[10,2],[43,1],[49,0]]) {
      f.animationFrame=frame!;expect(samusPartVisibility(f)).toEqual([alternative]);rigs.sample(f);
      const visible=new Set(f.content.model.roots[0]!.parts.filter(p=>!rigs.actors[0].hiddenDobjs.has(p.dobjIndex)).map(p=>p.dobjIndex));
      expect([...visible].sort((a,b)=>a-b)).toEqual([...f.content.profile.partVisibility.groups[0]![alternative!]!].sort((a,b)=>a-b));
    }
    f.animationFrame=10;expect(fighterHurts(f)).toEqual([{bone:2,a:[0,0,0],b:[0,0,0],radius:3,grabbable:false}]);
    f.animationFrame=43;expect(fighterHurts(f)).toBe(f.content.profile.hurts);
  });
  it('reads distinct charge levels, missile variants and bomb hit definitions', () => {
    const s = game.fighters[0].content.specials.articles.samus!;
    expect(s.charges).toHaveLength(8); expect(s.charges.map(a => a.hit!.damage)).toEqual([3,5,8,11,14,18,21,25]);
    expect(s.charges[0]!.speed).toBe(1.5); expect(s.charges[7]!.speed).toBe(3);
    expect(s.missile.hit?.damage).toBe(5); expect(s.superMissile.hit?.damage).toBe(12);
    expect(s.bomb.lifetime).toBe(72); expect(s.explosion.hit?.damage).toBeGreaterThan(0);
    expect(base.sound.cues(game.fighters[0].content.specials.sounds.ko).length).toBeGreaterThan(0);
    // The held orb is item state 0: the same article, no hitbox, and the charged sizes are its ramp.
    expect(s.hold.hit).toBeNull(); expect(s.charges.map(a => a.scale)).toEqual([.5,.5+1.5/7,.5+3/7,.5+4.5/7,.5+6/7,.5+7.5/7,.5+9/7,2].map(Math.fround));
    // effSamusDataTable entry 0 (efAlt 0x482/kind 0x7D0) is the Screw Attack model, not a particle descriptor.
    const screw = game.fighters[0].content.specials.effects.get('screw-attack');
    expect(screw?.roots).toHaveLength(1);
    // Its root joint carries a baked lift that lb_8000C1C0's position constraint replaces with the
    // attach joint; the renderer re-anchors joint 0 instead of adding it, or the screw floats overhead.
    expect(screw!.roots[0]!.joints[0]!.translation[1]).toBeGreaterThan(5);
    // Every Samus article model is anchored at its own origin, so those need no such re-anchoring.
    for (const article of [s.hold, s.charges[0]!, s.charges[7]!, s.missile, s.bomb]) expect(article.model.roots[0]!.joints[0]!.translation).toEqual([0,0,0]);
  });
  it('charges automatically, stores on shield cancel and fires stored charge once', () => {
    const f = game.fighters[0]; step({ special: true }); ticks(65); expect(f.animation).toBe('SpecialNHold'); expect(f.samusCharge).toBeGreaterThan(0);
    const charge = f.samusCharge; step({ shield: true }); ticks(12); expect(f.special).toBeNull(); expect(f.samusCharge).toBe(charge);
    step({ special: true }); ticks(16); step({ special: true });
    let shots = game.events.filter(e=>e.type==='shot').length; for (let i=0;i<40;i++){step();shots+=game.events.filter(e=>e.type==='shot').length;}
    expect(shots).toBe(1); expect(f.samusCharge).toBe(0);
  });
  it('re-cues the charge loop at the level reached so far', () => {
    const cues: number[] = []; step({ special: true });
    for (let i = 0; i < 120; i++) { step(); cues.push(...game.events.filter(e => e.type === 'sound' && e.sound! >= 260006 && e.sound! <= 260018).map(e => e.sound!)); }
    expect(cues.length).toBeGreaterThan(5);
    expect(cues.every(cue => [260006, 260009, 260012, 260015, 260018].includes(cue))).toBe(true);
    expect(cues[0]).toBe(260006); expect(cues.at(-1)!).toBeGreaterThan(cues[0]!); // the cue climbs with the stored level
    for (const cue of new Set(cues)) expect(base.sound.cues(cue).length).toBeGreaterThan(0);
  });
  it('rolls out of the charge as the Morph Ball on a fresh sideways smash, keeping the level', () => {
    const f = game.fighters[0]; step({ special: true }); ticks(65); expect(f.animation).toBe('SpecialNHold');
    const charge = f.samusCharge; expect(charge).toBeGreaterThan(0);
    step({ x: 1 }); expect(f.special).toBeNull(); expect(f.state).toBe('dodge'); expect(f.animation).toBe('EscapeF');
    expect(f.samusCharge).toBe(charge);
    ticks(5); expect(samusPartVisibility(f)[0]).toBe(2); // the roll's ball alternative
    expect(game.projectiles.items.some(p => p.kind === 'charge')).toBe(false);
  });
  it('rolls backwards away from the stick, takes the C-stick and ignores a stale sideways hold', () => {
    const f = game.fighters[0]; step({ special: true }); ticks(20);
    step({ x: -1 }); expect(f.animation).toBe('EscapeB');
    make(); const c = game.fighters[0]; step({ special: true }); ticks(20, { cX: 1 });
    expect(c.animation).toBe('EscapeF'); // ftCo_800DF8B0 takes a held C-stick, with no freshness window
    make(); const g = game.fighters[0]; ticks(10, { x: 1, walk: true }); step({ special: true }); ticks(30, { x: 1, walk: true });
    expect(g.animation).toBe('SpecialNHold'); expect(g.special?.direction).toBe('neutral');
  });
  it('finishes full charge and fires immediately on the next neutral special', () => {
    const f=game.fighters[0]; step({special:true});ticks(150);expect(f.samusCharge).toBe(7);expect(f.special).toBeNull();
    step({special:true});let chargeShot=false;for(let i=0;i<40;i++){step();if(game.projectiles.items.some(p=>p.kind==='charge'&&p.hit.damage===25))chargeShot=true;}expect(chargeShot).toBe(true);
  });
  it('fires aerial neutral without entering a grounded charge loop', () => {
    const f=game.fighters[0];f.grounded=false;f.floor=null;f.y=90;step({special:true});ticks(30);expect(f.samusCharge).toBe(0);expect(game.projectiles.items.some(p=>p.kind==='charge')).toBe(true);
  });
  it.each([false,true])('selects missiles using horizontal stick age (smash=%s)', smash => {
    if(!smash)ticks(5,{x:1,walk:true});step({x:1,special:true});ticks(24);expect(game.projectiles.items.some(p=>p.kind===(smash?'super-missile':'missile'))).toBe(true);
  });
  it('launches ground Screw Attack with original root motion, then becomes helpless', () => {
    const f=game.fighters[0];step({special:true,specialDirection:'up'});ticks(12);expect(f.grounded).toBe(false);expect(f.y).toBeGreaterThan(5);ticks(45);expect(['helpless','landing']).toContain(f.state);
  });
  it('uses the distinct aerial Screw Attack impulse and can reverse once', () => {
    const f=game.fighters[0];f.grounded=false;f.floor=null;f.y=70;step({special:true,specialDirection:'up'});expect(f.velocity.y).toBeCloseTo(2.434,3);step({x:-1});expect(f.facing).toBe(-1);step({x:1});expect(f.facing).toBe(-1);
  });
  it('drops a timed bomb that survives its owner leaving the move, explodes and expires', () => {
    step({special:true,specialDirection:'down'});ticks(20);const bomb=game.projectiles.items.find(p=>p.kind==='bomb');expect(bomb).toBeDefined();
    ticks(55);expect(game.fighters[0].special).toBeNull();let exploded=false;for(let i=0;i<50;i++){step();if(game.projectiles.items.some(p=>p.kind==='bomb'&&p.exploded))exploded=true;}expect(exploded).toBe(true);expect(game.projectiles.items).toHaveLength(0);
  });
  it('restores stored charge and every Samus article without sharing runtime state', () => {
    make(true);const f=game.fighters[0];f.samusCharge=4;
    for(const kind of ['charge','missile','super-missile','bomb'] as const)game.projectiles.spawn(f,kind,rigs,false,6);
    const state=game.captureState(), initial=game.stateHash();ticks(20);const result=game.stateHash();game.restoreState(state);expect(game.stateHash()).toBe(initial);ticks(20);expect(game.stateHash()).toBe(result);
    expect(game.fighters[1].samusCharge).toBe(0);
  });
  it.each([2,4])('replays delayed Samus inputs for %i independent peers with exactly-once confirmed events', count => {
    const selected=rosterPlayers(base,Array.from({length:count},()=> 'Ss' as const));
    const ra=new GameRigs(selected), rb=new GameRigs(selected);
    try {
      const a=new LocalMatch(selected,ra,{opponent:'human',countdown:0,seed:321}),b=new LocalMatch(selected,rb,{opponent:'human',countdown:0,seed:321});a.start();b.start();
      const driver=new RollbackDriver(a,0,count,{maxPrediction:6,historyLimit:32});
      const input=(frame:number,slot:number)=>normalizeInput({...neutralInput(),special:[0,40,90,160,220].includes(frame-slot),specialDirection:frame-slot>=220?'up':frame-slot>=160?'side':frame-slot>=90?'down':'neutral',x:frame-slot===160?1:0});
      const pending:Array<{due:number;frame:number;slot:number;input:PlayerInput}>=[],hashes=new Map<number,string>();
      const emitted:number[]=[],expectedEvents:unknown[]=[],actualEvents:unknown[]=[];
      for(let tick=0;tick<300;tick++) {
        for(let i=pending.length-1;i>=0;i--)if(pending[i]!.due<=tick){const p=pending.splice(i,1)[0]!;driver.receive(p.frame,p.slot,p.input);}
        if(b.frame<260){const frame=driver.frame,local=input(frame,0);if(driver.advance(local)){driver.receive(frame,0,local);const inputs=Array.from({length:count},(_,slot)=>input(frame,slot));b.step(inputs);hashes.set(frame,b.stateHash());expectedEvents.push(structuredClone(b.events));for(let slot=1;slot<count;slot++)pending.push({due:tick+1+(frame+slot)%5,frame,slot,input:inputs[slot]!});}}
        for(const batch of driver.drainConfirmedEvents()){expect(driver.stateHash(batch.frame)).toBe(hashes.get(batch.frame));emitted.push(batch.frame);actualEvents.push(batch.events);}
        if(b.frame===260&&!pending.length)break;
      }
      expect(driver.confirmedFrame).toBe(259);expect(a.stateHash()).toBe(b.stateHash());expect(actualEvents).toEqual(expectedEvents);expect(new Set(emitted).size).toBe(emitted.length);expect(driver.stats.rollbacks).toBeGreaterThan(0);expect(driver.drainConfirmedEvents()).toEqual([]);
    } finally {ra.dispose();rb.dispose();}
  });
  it('clears charge on KO and new matches', () => {
    const f=game.fighters[0];f.samusCharge=7;f.x=base.stage.blast.right+20;step();expect(f.state).toBe('ko');expect(f.samusCharge).toBe(0);make();expect(game.fighters[0].samusCharge).toBe(0);
  });
});
