import { afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent,type GameContent } from '../../lib/game/load.ts';
import { LocalMatch,neutralInput,type PlayerInput } from '../../lib/game/match.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { shieldBubble } from '../../lib/game/combat.ts';
import { hurtEnabled } from '../../lib/game/specials.ts';

const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original-data defense, grabs and ledges',()=>{
 let content:GameContent,game:LocalMatch,rig:GameRigs;
 const make=(gap=10)=>{rig?.dispose();rig=new GameRigs(content);game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();game.fighters.forEach((f,i)=>{f.x=(i===0?-1:1)*gap/2;f.y=0;f.grounded=true;f.floor=1;rig.sample(f);});};
 const step=(a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>game.step([{...neutralInput(),...a},{...neutralInput(),...b}]);
 const ticks=(n:number,a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>{for(let i=0;i<n;i++)step(a,b);};
 const catchVictim=(slot=0)=>{const inputs=[{},{}];inputs[slot]={grab:true};step(inputs[0],inputs[1]);for(let i=0;i<15&&game.fighters[slot]!.state!=='holding';i++)step();expect(game.fighters[slot]!.state).toBe('holding');};
 const ledge=(side=0)=>{const l=content.stage.ledges[side]!,f=game.fighters[0];f.x=l.x-l.facing*4;f.y=l.y-10;f.velocity={x:0,y:-0.5};f.grounded=false;f.floor=null;f.state='fall';f.animation='Fall';f.facing=l.facing;return l;};
 const hang=()=>{const l=ledge();step();expect(game.fighters[0].animation).toBe('CliffCatch');ticks(12);expect(game.fighters[0].animation).toBe('CliffWait');return l;};
 beforeAll(async()=>{const disc=await openDisc(iso!);try{content=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer);}finally{await disc.close();}});
 beforeEach(()=>make());afterEach(()=>rig?.dispose());
 it('reads original full-shield, airdodge and ledge values',()=>{
  expect(content.combat.shield.maximum).toBe(60);expect(content.combat.shield.drain).toBeCloseTo(0.28);
  expect(content.combat.shield.regen).toBeCloseTo(0.07);expect(content.combat.dodge.speed).toBeCloseTo(3.1);
  expect(content.combat.dodge.landing).toBe(10);expect(content.combat.ledge.cooldown).toBe(30);
  expect(content.stage.ledges).toHaveLength(2);expect(content.stage.ledges.map(l=>l.x).sort((a,b)=>a-b)).toEqual([content.stage.mainLeft,content.stage.mainRight]);
 });
 it('drains and shrinks a held shield, then regenerates it after release',()=>{
  step({shield:true});const full=shieldBubble(game.fighters[0],content,rig)!.radius;
  ticks(40,{shield:true});expect(game.fighters[0].animation).toBe('Guard');expect(game.fighters[0].combat.shield).toBeLessThan(50);
  expect(shieldBubble(game.fighters[0],content,rig)!.radius).toBeLessThan(full);
  const hp=game.fighters[0].combat.shield;ticks(40);expect(game.fighters[0].state).toBe('idle');expect(game.fighters[0].combat.shield).toBeGreaterThan(hp);
 });
 it('blocks an original jab with shield damage, shieldstun and hitlag instead of percent',()=>{
  step({attack:true},{shield:true});let blocked=false,stun=false;
  for(let i=0;i<18;i++){step({}, {shield:true});blocked ||=game.events.some(e=>e.type==='shield');stun ||=game.fighters[1].combat.shieldStun>0;}
  expect(blocked).toBe(true);expect(stun).toBe(true);expect(game.fighters[1].percent).toBe(0);expect(game.fighters[1].combat.shield).toBeLessThan(58);
 });
 it('blocks and consumes a laser without damage behind the shield',()=>{
  make(50);let blocked=false;for(let i=0;i<70;i++){step({special:i===0,specialDirection:'neutral'},{shield:true});blocked ||=game.events.some(e=>e.type==='shield');}
  expect(blocked).toBe(true);expect(game.fighters[1].percent).toBe(0);expect(game.projectiles.items).toHaveLength(0);
 });
 it('blocks a bouncing fireball',()=>{
  make(50);let blocked=false;for(let i=0;i<90;i++){step({shield:true},{special:i===0,specialDirection:'neutral'});blocked ||=game.events.some(e=>e.type==='shield');}
  expect(blocked).toBe(true);expect(game.fighters[0].percent).toBe(0);
 });
 it('breaks a depleted shield and permits mashing out of dizziness',()=>{
  game.fighters[0].combat.shield=0.1;step({shield:true});step({shield:true});expect(game.fighters[0].state).toBe('shield-break');
  for(let i=0;i<100&&game.fighters[0].state!=='dizzy';i++)step();expect(game.fighters[0].state).toBe('dizzy');
  for(let i=0;i<200&&game.fighters[0].state==='dizzy';i++)step({attack:i%2===0});expect(game.fighters[0].state).not.toBe('dizzy');ticks(40);expect(game.fighters[0].state).toBe('idle');
 });
 it('can jump or grab out of shield but cannot act during shieldstun',()=>{
  step({shield:true});step({shield:true,jump:true});expect(game.fighters[0].state).toBe('squat');
  make();step({shield:true});step({shield:true,attack:true});expect(game.fighters[0].state).toBe('grab');
  make();step({shield:true});game.fighters[0].combat.shieldStun=5;step({shield:true,jump:true,grab:true});expect(game.fighters[0].state).toBe('shield');
 });
 it.each([0,1])('uses original spot-dodge intangible frames and ends invulnerability for slot %s',(slot)=>{
  const inputs=[{},{}];inputs[slot]={shield:true,down:true};step(inputs[0],inputs[1]);const f=game.fighters[slot]!;expect(f.animation).toBe('EscapeN');
  let intangible=0;for(let i=0;i<40;i++){if(!hurtEnabled(f,f.content.profile.boneMap[4]!))intangible++;step();}
  expect(intangible).toBeGreaterThan(5);expect(intangible).toBeLessThan(30);expect(hurtEnabled(f,f.content.profile.boneMap[4]!)).toBe(true);
 });
 it.each([1,-1])('rolls with original root motion in direction %s, without repeating a held direction',(direction)=>{
  make(70);const x=game.fighters[0].x;step({shield:true,x:direction});expect(game.fighters[0].animation).toBe(direction===1?'EscapeF':'EscapeB');
  ticks(40,{shield:true,x:direction});expect((game.fighters[0].x-x)*direction).toBeGreaterThan(10);expect(game.fighters[0].state).toBe('shield');
 });
 it('uses a normalized directional air dodge, script immunity, decay and helpless recovery',()=>{
  const f=game.fighters[0];f.y=100;f.grounded=false;f.floor=null;f.state='fall';f.animation='Fall';
  step({shield:true,x:1,y:1});expect(f.state).toBe('air-dodge');expect(Math.hypot(f.velocity.x,f.velocity.y)).toBeCloseTo(3.1*0.9,4);
  ticks(5);expect(hurtEnabled(f,f.content.profile.boneMap[4]!)).toBe(false);
  ticks(30);expect(hurtEnabled(f,f.content.profile.boneMap[4]!)).toBe(true);
  ticks(20);expect(f.state).toBe('helpless');step({shield:true,jump:true});expect(f.state).toBe('helpless');
 });
 it('does not buffer a forbidden fast-fall through the air-dodge animation',()=>{
  const f=game.fighters[0];f.y=180;f.grounded=false;f.floor=null;f.state='fall';f.animation='Fall';
  step({shield:true,down:true});ticks(12,{down:true});expect(f.fastFall).toBe(false);ticks(45);expect(f.fastFall).toBe(false);
 });
 it('lands from an air dodge with 10 frames of lag and retains sliding momentum',()=>{
  const f=game.fighters[0];f.y=3;f.grounded=false;f.floor=null;f.state='fall';f.animation='Fall';
  step({shield:true,x:1,y:-1});step();expect(f.state).toBe('landing');expect(f.landingFrames).toBe(10);expect(f.velocity.x).toBeGreaterThan(1);
 });
 it('cannot grab a dodging opponent during the native intangible window',()=>{
  step({grab:true},{shield:true,down:true});ticks(12);expect(game.fighters[0].state).toBe('grab');expect(game.fighters[1].state).toBe('dodge');
 });
 it('grabs through a shield, binds the pair, and suppresses movement',()=>{
  step({grab:true},{shield:true});for(let i=0;i<12&&game.fighters[0].state!=='holding';i++)step({}, {shield:true});
  expect(game.fighters[1].state).toBe('captured');expect(game.fighters[0].combat.partner).toBe(1);expect(game.fighters[1].combat.partner).toBe(0);
  const x=game.fighters[1].x;ticks(4,{}, {x:1,jump:true,special:true});expect(Math.abs(game.fighters[1].x-x)).toBeLessThan(5);expect(game.fighters[1].state).toBe('captured');
 });
 it('pummels once per hit activation without throwing or breaking the pair',()=>{
  catchVictim();step({attack:true});ticks(28);expect(game.fighters[1].percent).toBe(3);expect(game.fighters[1].state).toBe('captured');expect(game.fighters[0].state).toBe('holding');
 });
 it('times out an unmashing grab and accelerates escape with fresh presses',()=>{
  const duration=(mash:boolean)=>{make();catchVictim();let n=0;for(;n<160&&game.fighters[1].state==='captured';n++)step({}, {attack:mash&&n%2===0});return n;};
  expect(duration(true)).toBeLessThan(duration(false));expect(game.fighters.every(f=>f.combat.partner===null)).toBe(true);
 });
 it.each([0,1])('plays all four throws with original release events, damage and independent links for slot %s',(slot)=>{
  for(const [name,dir]of [['ThrowF',{x:slot===0?1:-1}],['ThrowB',{x:slot===0?-1:1}],['ThrowHi',{y:1}],['ThrowLw',{down:true}]] as const){
    make();catchVictim(slot);const inputs=[{},{}];inputs[slot]=dir;step(inputs[0],inputs[1]);expect(game.fighters[slot]!.animation).toBe(name);
    let thrown=false;for(let i=0;i<140;i++){step();thrown ||=game.events.some(e=>e.type==='throw'&&e.player===slot);}
    expect(thrown,name).toBe(true);expect(game.fighters[1-slot]!.percent,name).toBeGreaterThan(0);expect(game.fighters.every(f=>f.combat.partner===null),name).toBe(true);
  }
 });
 it('uses Mario forward throw damage/direction and the distinct original throw-laser hit data',()=>{
  catchVictim(1);step({}, {x:-1});let released=false;
  for(let i=0;i<40&&!released;i++){step();released=game.events.some(e=>e.type==='throw');}
  expect(released).toBe(true);expect(game.fighters[0].percent).toBe(9);expect(game.fighters[0].knockback.x).toBeLessThan(0);
  expect(content.fighters[0].specials.articles.projectile!.throwHit?.damage).toBe(2);
  expect(content.fighters[0].specials.articles.projectile!.hit?.damage).toBe(3);
 });
 it('does not privilege player order when simultaneous grabs clash',()=>{
  step({grab:true},{grab:true});ticks(7);expect(game.fighters.every(f=>f.combat.partner===null)).toBe(true);expect(game.fighters.every(f=>f.state==='grab-release')).toBe(true);
 });
 it('releases the partner when the captor is interrupted or loses a stock',()=>{
  catchVictim();game.fighters[0].x=content.stage.blast.right+1;step();expect(game.fighters[0].state).toBe('ko');expect(game.fighters[1].state).not.toBe('captured');expect(game.fighters.every(f=>f.combat.partner===null)).toBe(true);
 });
 it.each([0,1])('catches stage ledge %s, hangs without falling, and restores jump resources',(side)=>{
  const l=ledge(side),f=game.fighters[0];f.jumpsUsed=2;step();expect(f.combat.ledge).toBe(l.id);expect(f.grounded).toBe(false);expect(f.jumpsUsed).toBe(0);
  ticks(50);expect(f.animation).toBe('CliffWait');expect(Math.abs(f.x-l.x)).toBeLessThan(15);expect(f.invulnerable).toBe(0);
 });
 it('does not catch while holding down, rising, or near a pass-through platform',()=>{
  ledge();step({down:true});expect(game.fighters[0].combat.ledge).toBeNull();
  make();ledge();game.fighters[0].velocity.y=2;step();expect(game.fighters[0].combat.ledge).toBeNull();
  make();const floor=content.stage.floors.find(f=>f.oneWay)!,f=game.fighters[0];f.x=floor.a[0]-2;f.y=floor.a[1]-10;f.grounded=false;f.state='fall';f.velocity.y=-1;step();expect(f.combat.ledge).toBeNull();
 });
 it('enforces ledge occupancy and the regrab cooldown after letting go',()=>{
  const l=hang(),a=game.fighters[0],b=game.fighters[1];b.x=l.x-l.facing*3;b.y=l.y-10;b.grounded=false;b.floor=null;b.state='fall';b.velocity.y=-1;step();expect(b.combat.ledge).toBeNull();
  step({down:true});expect(a.combat.ledge).toBeNull();expect(a.combat.cooldown).toBeGreaterThan(0);step();expect(a.combat.ledge).toBeNull();
 });
 it.each(['climb','attack','roll','jump'])('completes a ledge %s option and releases the ledge',(option)=>{
  hang();const f=game.fighters[0];step(option==='climb'?{x:f.facing}:option==='attack'?{attack:true}:option==='roll'?{shield:true}:{jump:true});expect(f.state).toBe('ledge-action');
  let hit=false;for(let n=0;n<120;n++){step();hit ||=game.events.some(e=>e.type==='hit');if(f.combat.ledge===null&&f.state!=='ledge-jump')break;}
  expect(f.combat.ledge).toBeNull();expect(['idle','fall','landing','jump']).toContain(f.state);void hit;
 });
 it('deals original get-up-attack damage to an opponent waiting at the edge',()=>{
  const l=hang(),v=game.fighters[1];v.x=l.x+l.facing*15;v.y=l.y;v.grounded=true;v.floor=l.floor;rig.sample(v);
  step({attack:true});ticks(90);expect(v.percent).toBeGreaterThan(0);
 });
 it('a fresh match resets shield, grab links, cooldowns and aerial restrictions',()=>{
  catchVictim();game.fighters[0].combat.shield=4;game.fighters[0].combat.cooldown=30;make();
  expect(game.fighters.every(f=>f.combat.partner===null&&f.combat.shield===60&&f.combat.cooldown===0&&f.state==='idle')).toBe(true);
 });
 it('uses slower original ledge options at 100 percent',()=>{hang();game.fighters[0].percent=100;step({x:game.fighters[0].facing});expect(game.fighters[0].animation).toBe('CliffClimbSlow');});
 it('seals an ice-hit victim in a block they mash out of, then pops them loose',()=>{
  const ice=content.combat.ice,v=game.fighters[1];
  game.combat.freeze(v,9,{x:0,y:0});
  expect(v.state).toBe('frozen');expect(v.ice!.timer).toBeCloseTo(9*ice.timerScale,4);expect(v.animationRate).toBe(0);
  // ftCo_DamageIce_IASA is empty: nothing the victim presses is an action.
  ticks(5,{},{attack:true,jump:true,shield:true});expect(v.state).toBe('frozen');
  const mashed=v.ice!.timer;
  game.combat.freeze(v,9,{x:0,y:0});expect(v.ice!.timer).toBeCloseTo(mashed,4); // a second ice hit never re-arms it
  const quiet=make(),plain=(()=>{const w=game.fighters[1];game.combat.freeze(w,9,{x:0,y:0});ticks(5);return w.ice!.timer;})();
  expect(mashed).toBeLessThan(plain); // mashing takes chunks off
  void quiet;
 });
 it('thaws on the original timer and on fire, and keeps the block through a landing',()=>{
  const ice=content.combat.ice,v=game.fighters[1];
  game.combat.freeze(v,20,{x:0,y:1.5});
  expect(v.grounded).toBe(false);
  for(let i=0;i<120&&!v.grounded;i++)step();
  expect(v.grounded).toBe(true);
  expect(v.state).toBe('frozen'); // ftCo_DamageIce_Coll: the block settles and keeps counting
  // ftCo_DamageIce_OnHit2: damage shortens the freeze, fire ends it.
  const before=v.ice!.timer;game.combat.frozenHit(v,10,0);expect(v.ice!.timer).toBeCloseTo(before-10*ice.damageScale,4);
  game.combat.frozenHit(v,1,1);expect(v.ice!.timer).toBe(0);
  expect(game.combat.grabbable(v)).toBe(false); // ftColl_HurtboxInit marks the block ungrabbable
  step();
  expect(v.state).toBe('hitstun');expect(v.ice).toBeNull();
  const attrs=v.content.profile.attributes;
  expect(v.velocity.y).toBeCloseTo(attrs.iceJumpY!-attrs.gravity,4); // the hop, already one frame of gravity in
 });
 it('carries the frozen block through snapshot and rollback',()=>{
  const v=game.fighters[1];game.combat.freeze(v,9,{x:0,y:0});ticks(4);
  const state=game.captureState(),hash=game.stateHash();ticks(20);const later=game.stateHash();
  game.restoreState(state);expect(game.stateHash()).toBe(hash);expect(game.fighters[1].ice!.timer).toBeGreaterThan(0);
  ticks(20);expect(game.stateHash()).toBe(later);
 });
 it('keeps state and resource cleanup deterministic across repeated defense input runs',()=>{
  const run=()=>{make();for(let n=0;n<900;n++)step({shield:n%90<20,grab:n%100===50,x:Math.sin(n/50)>0?1:-1,jump:n%71===0},{attack:n%25===0,shield:n%80<12,down:n%80<3});return game.snapshot();};expect(run()).toEqual(run());
 });
});
