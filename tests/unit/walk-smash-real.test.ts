import { afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent,type GameContent } from '../../lib/game/load.ts';
import { LocalMatch,neutralInput,type PlayerInput } from '../../lib/game/match.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { beginSmash,chargedHits } from '../../lib/game/smash.ts';

const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original walking and smash charge',()=>{
 let content:GameContent,game:LocalMatch,rig:GameRigs;
 const make=(gap=80)=>{rig?.dispose();rig=new GameRigs(content);game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();game.fighters.forEach((f,i)=>{f.x=(i===0?-1:1)*gap/2;f.y=0;f.grounded=true;f.floor=1;rig.sample(f);});};
 const step=(a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>game.step([{...neutralInput(),...a},{...neutralInput(),...b}]);
 const ticks=(n:number,a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>{for(let i=0;i<n;i++)step(a,b);};
 const hold=(slot=0,low=false)=>{const a=[{},{}];a[slot]={strong:true,down:low};for(let i=0;i<30&&game.fighters[slot]!.smash?.phase!=='charging';i++)step(a[0],a[1]);expect(game.fighters[slot]!.smash?.phase).toBe('charging');};
 beforeAll(async()=>{const disc=await openDisc(iso!);try{content=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer);}finally{await disc.close();}});
 beforeEach(()=>make());afterEach(()=>rig?.dispose());
 it('loads all native walking clips and the original charge commands',()=>{
  for(const f of content.fighters){for(const name of ['WalkSlow','WalkMiddle','WalkFast'])expect(f.clips.get(name)?.endFrame).toBeGreaterThan(0);
   for(const name of [f.moves.strong,f.moves.downSmash]){const charge=beginSmash(f.attacks.get(name)!);expect(charge?.maxFrames).toBe(60);expect(charge?.multiplier).toBeGreaterThan(1.3);}
  }
  expect(content.common.walkThreshold).toBeCloseTo(0.18);expect(content.common.dashThreshold).toBeCloseTo(0.8);
  expect(beginSmash(content.fighters[0].attacks.get('AttackS4')!)?.at).toBe(7);
 });
 it.each([0,1])('uses original C walk acceleration, speed cap, and stride thresholds for slot %s',(slot)=>{
  const a=content.fighters[slot]!.profile.attributes;
  let v=0;for(let i=0;i<240;i++)v=content.physics.walk(slot,v,1);
  expect(v).toBeCloseTo(a.walkSpeed,4);expect(v).toBeLessThan(a.runSpeed);
  expect(content.physics.walkType(slot,a.walkSpeed*0.2)).toBe(0);expect(content.physics.walkType(slot,a.walkSpeed*0.5)).toBe(1);expect(content.physics.walkType(slot,a.walkSpeed)).toBe(2);
  expect(content.physics.walk(slot,0,0)).toBe(0);
 });
 it('walks from a gentle stick without the initial dash impulse',()=>{
  step({x:0.3});expect(game.fighters[0].state).toBe('walk');expect(game.fighters[0].velocity.x).toBeCloseTo(0.16,5);
  ticks(20,{x:0.3});expect(game.fighters[0].animation).toBe('WalkSlow');expect(game.fighters[0].velocity.x).toBeLessThan(0.5);
 });
 it('honors the native low walking threshold rather than the old 0.28 deadzone',()=>{
  step({x:0.2});expect(game.fighters[0].state).toBe('walk');expect(game.fighters[0].x).toBeGreaterThan(-40);
  make();step({x:0.1});expect(game.fighters[0].state).toBe('idle');expect(game.fighters[0].x).toBe(-40);
 });
 it('uses slow/middle/fast walk clips and travels less than running',()=>{
  const names=new Set<string>();for(let i=0;i<45;i++){step({x:1,walk:true});names.add(game.fighters[0].animation);}
  expect([...names]).toEqual(['WalkSlow','WalkMiddle','WalkFast']);
  make();ticks(20,{x:1,walk:true});const walked=game.fighters[0].x;
  make();ticks(20,{x:1});expect(game.fighters[0].state).toBe('run');expect(game.fighters[0].x).toBeGreaterThan(walked+10);
 });
 it('switches run to walk with friction, then resumes running and stops on neutral',()=>{
  ticks(10,{x:1});const fast=game.fighters[0].velocity.x;
  step({x:1,walk:true});expect(game.fighters[0].state).toBe('walk');expect(game.fighters[0].velocity.x).toBeLessThan(fast);
  ticks(8,{x:1,walk:true});step({x:1});expect(game.fighters[0].state).toBe('run');ticks(35);expect(game.fighters[0].state).toBe('idle');expect(game.fighters[0].velocity.x).toBe(0);
 });
 it('walks both directions without negative animation rates',()=>{
  ticks(12,{x:1,walk:true});ticks(12,{x:-1,walk:true});expect(game.fighters[0].velocity.x).toBeLessThan(0);expect(game.fighters[0].facing).toBe(-1);expect(game.fighters[0].animationFrame).toBeGreaterThanOrEqual(0);
 });
 it('walking keeps standing jab/grab selection and allows shields/jumps',()=>{
  // Walking with a side stick attacks with the side tilt (Fox/Mario now map AttackS3S);
  // standing with no side input keeps the neutral jab.
  ticks(15,{x:1,walk:true});step({x:1,walk:true,attack:true});expect(game.fighters[0].animation).toBe(game.fighters[0].content.moves.sideTilt ?? 'Attack11');
  make();step({attack:true});expect(game.fighters[0].animation).toBe('Attack11');
  make();ticks(10,{x:1,walk:true});step({walk:true,grab:true});expect(game.fighters[0].animation).toBe('Catch');
  make();step({x:0.3});step({shield:true});expect(game.fighters[0].state).toBe('shield');
  make();step({x:0.3});step({jump:true,walk:true});expect(game.fighters[0].state).toBe('squat');
 });
 it('plays native footstep cues without emitting them on every render/tick',()=>{
  const sounds:number[]=[];for(let i=0;i<100;i++){step({walk:true,x:i<50?0.5:-0.5});sounds.push(...game.events.filter(e=>e.type==='sound').map(e=>e.sound!));}
  expect(sounds.length).toBeGreaterThan(1);expect(sounds.length).toBeLessThan(20);expect(sounds).toContain(401);
 });
 it.each([0,1])('freezes the native charge pose without active hitboxes for slot %s',(slot)=>{
  hold(slot);const f=game.fighters[slot]!,frame=f.animationFrame,pose=rig.actors[slot]!.poseSignature();
  const inputs=[{},{}];inputs[slot]={strong:true};ticks(20,inputs[0],inputs[1]);
  expect(f.animationFrame).toBe(frame);expect(f.smash?.frames).toBe(20);expect(f.animationRate).toBe(0);expect(rig.actors[slot]!.poseSignature()).toEqual(pose);
  expect(chargedHits(f,activeHits(f.content.attacks.get(f.animation)!,frame),content.physics)).toEqual([]);
 });
 it('plays the original charge sound once and automatically releases at the original maximum',()=>{
  const ids:number[]=[];for(let n=0;n<80;n++){step({strong:true});ids.push(...game.events.filter(e=>e.type==='sound').map(e=>e.sound!));}
  expect(ids.filter(id=>id===123)).toHaveLength(1);expect(game.fighters[0].smash?.frames).toBe(60);expect(game.fighters[0].smash?.phase).toBe('released');expect(game.fighters[0].animationRate).toBe(1);
  ticks(70,{strong:true});expect(game.fighters[0].state).toBe('idle');expect(game.fighters[0].attackSerial).toBe(1);
 });
 it('keeps a quick tap uncharged and makes release resume the attack only once',()=>{
  step({strong:true});ticks(10);expect(game.fighters[0].smash?.frames).toBe(0);expect(game.fighters[0].animationRate).toBe(1);
  make();hold();ticks(12,{strong:true});step();const frames=game.fighters[0].smash!.frames;
  ticks(3,{strong:true});expect(game.fighters[0].smash?.frames).toBe(frames);expect(game.fighters[0].smash?.phase).toBe('released');
 });
 it.each([0,1])('increases actual lateral-smash damage and knockback using original C scaling for slot %s',(slot)=>{
  const strike=(held:number)=>{make(10);let damage=0,frames=0,speed=0;
   for(let n=0;n<150;n++){const inputs=[{},{}];inputs[slot]={strong:n<held};step(inputs[0],inputs[1]);const event=game.events.find(e=>e.type==='hit'&&e.player===1-slot);if(event){damage=event.damage!;frames=game.fighters[slot]!.smash!.frames;speed=Math.hypot(game.fighters[1-slot]!.knockback.x,game.fighters[1-slot]!.knockback.y);break;}}
   return {damage,frames,speed};};
  const tap=strike(1),partial=strike(28),full=strike(140);
  expect(tap.damage).toBeGreaterThan(0);expect(partial.damage).toBeGreaterThan(tap.damage);expect(full.damage).toBeGreaterThan(partial.damage);expect(full.speed).toBeGreaterThan(tap.speed);expect(full.frames).toBe(60);
  const s=beginSmash(content.fighters[slot]!.attacks.get(content.fighters[slot]!.moves.strong)!)!;
  expect(full.damage).toBe(content.physics.smashDamage(slot,tap.damage,60,60,s.multiplier));
 });
 it('scales late hit damage on copies, without mutating shared move data',()=>{
  const f=game.fighters[0],move=f.content.attacks.get(f.content.moves.strong)!,before=JSON.stringify(move);
  f.smash=beginSmash(move);f.smash!.phase='released';f.smash!.frames=30;
  const raw=activeHits(move,18),scaled=chargedHits(f,raw,content.physics);expect(scaled[0]!.damage).toBeGreaterThan(raw[0]!.damage);expect(JSON.stringify(move)).toBe(before);
 });
 it('also respects original charge gates for the existing down smashes',()=>{hold(0,true);expect(game.fighters[0].animation).toBe('AttackLw4');step();expect(game.fighters[0].smash?.phase).toBe('released');});
 it('freezes the charge clock during hitlag and clears it on interruption or KO',()=>{
  hold();const f=game.fighters[0];f.hitlag=4;ticks(4,{strong:true});expect(f.smash?.frames).toBe(0);step({strong:true});expect(f.smash?.frames).toBe(1);
  f.x=content.stage.blast.left-1;step({strong:true});expect(f.state).toBe('ko');expect(f.smash).toBeNull();
  make(10);hold();step({strong:true},{attack:true});for(let n=0;n<10&&game.fighters[0].state!=='hitstun';n++)step({strong:true});expect(game.fighters[0].state).toBe('hitstun');expect(game.fighters[0].smash).toBeNull();
 });
 it('uses the original extra knockback vulnerability of charging',()=>{
  const hit=activeHits(content.fighters[0].attacks.get('Attack11')!,3)[0]!;
  const normal=content.physics.hit(0,0,hit,false),charged=content.physics.hit(0,0,hit,false,content.common.chargeVulnerability);
  expect(charged.knockback).toBeCloseTo(normal.knockback*1.2,4);expect(charged.hitstun).toBeGreaterThan(normal.hitstun);
 });
 it('does not charge aerial attacks or keep a ground charge after falling off',()=>{
  const f=game.fighters[0];f.grounded=false;f.floor=null;f.state='fall';f.animation='Fall';f.y=40;step({strong:true});expect(f.smash).toBeNull();expect(f.animation).toBe('AttackAirF');
  make();hold();game.fighters[0].x=content.stage.mainRight+1;step({strong:true});expect(game.fighters[0].state).toBe('fall');expect(game.fighters[0].smash).toBeNull();expect(game.fighters[0].animationRate).toBe(1);
 });
 it('locks the chosen side through charge and resets state on rematch',()=>{
  step({x:-1,strong:true});ticks(12,{strong:true,x:1});expect(game.fighters[0].facing).toBe(-1);expect(game.fighters[0].smash?.phase).toBe('charging');
  make();expect(game.fighters.every(f=>f.smash===null&&f.animationRate===1)).toBe(true);
 });
});
