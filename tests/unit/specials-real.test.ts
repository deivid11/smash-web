import { beforeAll,afterEach,describe,expect,it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent,type GameContent } from '../../lib/game/load.ts';
import { LocalMatch,neutralInput,type PlayerInput } from '../../lib/game/match.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { ModelInstance } from '../../web/src/render/model-instance.ts';
import { segmentDistanceSquared } from '../../lib/game/collision.ts';
import { textureTevShader } from '../../web/src/render/texture-tev.ts';
import { PlayEffects } from '../../web/src/render/play-effects.ts';
import { PerspectiveCamera, Scene, Mesh, ShaderMaterial } from 'three';

describe('swept projectile capsule geometry',()=>{
 it('detects crossing segments even when endpoints miss',()=>expect(segmentDistanceSquared([-10,0,0],[10,0,0],[0,-5,0],[0,5,0])).toBe(0));
 it('includes depth separation',()=>expect(segmentDistanceSquared([-10,0,3],[10,0,3],[0,-5,0],[0,5,0])).toBe(9));
 it('handles point-like segments',()=>expect(segmentDistanceSquared([0,0,0],[0,0,0],[2,0,0],[2,0,0])).toBe(4));
});
const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original-data Fox and Mario specials',()=>{
 let content:GameContent,rig:GameRigs,game:LocalMatch;
 const make=(distance=25)=>{rig?.dispose();rig=new GameRigs(content);game=new LocalMatch(content,rig,{opponent:'human',countdown:0});game.start();game.fighters.forEach((f,i)=>{f.x=i===0?-distance:distance;f.y=0;f.grounded=true;f.floor=1;});return game;};
 const step=(a:Partial<PlayerInput>={},b:Partial<PlayerInput>={})=>{game.step([{...neutralInput(),...a},{...neutralInput(),...b}]);};
 beforeAll(async()=>{const disc=await openDisc(iso!);try{content=await loadGameContent(new HsdAssetSession(disc,await verifyMeleeDisc(disc)),new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm',import.meta.url))).buffer);}finally{await disc.close();}});
 afterEach(()=>rig?.dispose());
 it('loads original projectile, reflector and effect resources',()=>{make();expect(content.fighters[0].specials.articles.projectile!.hit?.damage).toBe(3);expect(content.fighters[1].specials.articles.projectile!.hit?.damage).toBe(6);expect(content.fighters[0].specials.parameters.kind).toBe('Fx');expect(content.fighters[0].specials.effects.size).toBe(5);expect(content.fighters[1].specials.effects.size).toBe(2);});
 it('can animate every original item/effect model without substitute meshes',()=>{make();for(const fighter of content.fighters){for(const data of [...fighter.specials.effects.values(),...Object.values(fighter.specials.articles).filter((a)=>a && 'model' in a).map((a)=>(a as import('../../lib/game/special-data.ts').ArticleData).model)]){expect(data.stats.meshes).toBeGreaterThan(0);const instance=new ModelInstance(data);instance.update(8);instance.dispose();}}});
 it('retains and compiles the original fireball orange TEV palette',()=>{
  const data=content.fighters[1].specials.articles.projectile!.model;
  const tev=data.roots.flatMap(r=>r.parts).flatMap(p=>p.material.textures).find(t=>t.tev)?.tev;
  expect(tev?.colorIn).toEqual([133,128,8,15]); expect(tev?.alphaIn).toEqual([7,7,7,4]);
  expect(tev?.constant).toEqual([1,0.4,0,0]); expect(tev?.register0).toEqual([1,0.2,0,0]);
  expect(textureTevShader(tev)).toContain('mix(tevRegister0.rgb, tevConstant.rgb, t.rgb)');
 });
 it('fades the final composite instead of overriding original material alpha before texture blending',()=>{
  const data=content.fighters[1].specials.articles.projectile!.model,instance=new ModelInstance(data,false,true);
  instance.update(8);
  const draws=instance.group.children.filter((m):m is Mesh<never,ShaderMaterial>=>m instanceof Mesh);
  const alphas=draws.map(m=>m.material.uniforms.opacity!.value);
  instance.opacityMultiplier=0.2;instance.update(8);
  expect(draws.map(m=>m.material.uniforms.opacity!.value)).toEqual(alphas);
  expect(draws.every(m=>m.material.uniforms.fade!.value===0.2)).toBe(true);instance.dispose();
 });
 it('bounds supplemental Reflector accents and removes them on reset',()=>{
  make();const scene=new Scene(),effects=new PlayEffects(scene,content,rig,new PerspectiveCamera());
  for(let i=0;i<60;i++){step({special:true,specialDirection:'down'});effects.update(game);}
  expect(effects.stats.halos).toBe(1); const count=scene.children.length;
  effects.update(game); expect(scene.children.length).toBe(count);
  effects.reset();expect(scene.children.length).toBe(0);expect(effects.stats.halos).toBe(0);effects.dispose();
 });
 it('fires one non-flinching laser for a held initial press',()=>{make();let shots=0;for(let i=0;i<90;i++){step({special:i<60,specialDirection:'neutral'});shots+=game.events.filter(e=>e.type==='shot').length;}expect(shots).toBe(1);expect(game.fighters[1].percent).toBe(3);expect(game.fighters[1].x).toBe(25);expect(game.fighters[1].hitstun).toBe(0);});
 it('queues additional blaster taps during the loop window',()=>{make();let shots=0;for(let i=0;i<70;i++){step({special:[0,12,22].includes(i),specialDirection:'neutral'});shots+=game.events.filter(e=>e.type==='shot').length;}expect(shots).toBeGreaterThan(1);});
 it('moves Fox using original Illusion root motion and supports shortening',()=>{
  const travel=(shorten:boolean)=>{make();let maximum=0,shortened=false;for(let i=0;i<55;i++){const cut=shorten&&!shortened&&game.fighters[0].special?.phase==='travel';if(cut)shortened=true;step({special:i===0||cut,specialDirection:'side'});maximum=Math.max(maximum,game.fighters[0].x+25);}return maximum;};
  const full=travel(false),short=travel(true);expect(full).toBeGreaterThan(70);expect(short).toBeLessThan(full);
 });
 it('aims Fire Fox diagonally and enters helpless fall',()=>{make();let maxX=0,maxY=0,helpless=false;for(let i=0;i<100;i++){step({special:i===0,specialDirection:'up',x:1,y:1});maxX=Math.max(maxX,game.fighters[0].x+25);maxY=Math.max(maxY,game.fighters[0].y);helpless ||=game.fighters[0].state==='helpless';}expect(maxX).toBeGreaterThan(30);expect(maxY).toBeGreaterThan(30);expect(helpless).toBe(true);});
 it('holds Reflector, returns a fireball with increased damage and protects Fox',()=>{make();let reflected=false;for(let i=0;i<110;i++){step({special:true,specialDirection:'down'},{special:i===0,specialDirection:'neutral'});reflected ||=game.events.some(e=>e.type==='reflect'&&e.player===0);}expect(reflected).toBe(true);expect(game.fighters[0].percent).toBe(0);expect(game.fighters[1].percent).toBe(9);});
 it('allows jump-cancelling Reflector',()=>{make();let jumped=false;for(let i=0;i<18;i++){step({special:i<10,specialDirection:'down',jump:i>=5&&i<12});jumped ||=game.events.some(e=>e.type==='jump');}expect(jumped).toBe(true);expect(game.fighters[0].special).toBeNull();expect(game.fighters[0].y).toBeGreaterThan(0);});
 it('spawns a bouncing Mario fireball and deals its original damage',()=>{make();let bounced=false;for(let i=0;i<90;i++){step({}, {special:i===0,specialDirection:'neutral'});bounced ||=game.events.some(e=>e.type==='bounce');}expect(bounced).toBe(true);expect(game.fighters[0].percent).toBe(6);});
 it('reflects a laser with Cape, changing ownership and multiplying damage',()=>{make();let reflected=false;for(let i=0;i<90;i++){step({special:i===0,specialDirection:'neutral'},{special:i===0,specialDirection:'side'});reflected ||=game.events.some(e=>e.type==='reflect'&&e.player===1);}expect(reflected).toBe(true);expect(game.fighters[0].percent).toBe(4.5);expect(game.fighters[1].percent).toBe(0);});
 it('turns an opponent hit by Cape without normal knockback',()=>{make(6);for(let i=0;i<40;i++)step({}, {special:i===0,specialDirection:'side'});expect(game.fighters[0].facing).toBe(-1);expect(game.fighters[0].percent).toBe(10);expect(game.fighters[0].hitstun).toBe(0);});
 it('launches Super Jump Punch using original root motion',()=>{make();let highest=0,helpless=false;for(let i=0;i<85;i++){step({}, {special:i===0,specialDirection:'up',y:1});highest=Math.max(highest,game.fighters[1].y);helpless ||=game.fighters[1].state==='helpless';}expect(highest).toBeGreaterThan(30);expect(helpless).toBe(true);});
 it('gains more Tornado height from repeated special presses',()=>{const peak=(mash:boolean)=>{make();let height=0;for(let i=0;i<75;i++){step({}, {special:i===0||(mash&&i%6===0),specialDirection:'down'});height=Math.max(height,game.fighters[1].y);}return height;};expect(peak(true)).toBeGreaterThan(peak(false)+10);});
 it('resolves and decodes original move sound samples',()=>{make();for(const id of [110103,110094,180007,180037,225]){const cues=content.sound.cues(id);expect(cues.length).toBeGreaterThan(0);const sample=content.sound.sample(cues[0]!.sample)!;expect(sample.channels[0]!.length).toBeGreaterThan(100);expect(sample.channels[0]!.some((n)=>n!==0)).toBe(true);}});
 it('supports choosing Mario as the solo human-controlled fighter',()=>{make();game=new LocalMatch(content,rig,{opponent:'bot',player:1,countdown:0});game.start();step({special:true,specialDirection:'side'});expect(game.fighters[1].special?.direction).toBe('side');});
});
