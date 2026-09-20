import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openPauseMenu, openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
const frames=(page:Page,n:number)=>page.clock.runFor(n*17);
async function capture(page:Page,name:string){const dir=process.env.SMASH_SERVER_ARTIFACT_DIR;if(dir){await mkdir(dir,{recursive:true});await page.screenshot({path:join(dir,`falcon-${name}.png`)});}}
async function ready(page:Page,mirror=false){
  await page.clock.install();await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});
  await openSolo(page);await chooseFighter(page,0,'Ca');await setSeat(page,1,'human',mirror?'Ca':'Mr');
  await startBattle(page,'final');await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
  await page.clock.pauseAt(new Date(Date.now()+1000));
}
test('Captain Falcon selects both slots with own portraits, HUD and clean switch back',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page,true);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Ca','Ca']);
  await expect(page.locator('#fighter-name-0')).toHaveText('CAPTAIN FALCON');await expect(page.locator('#fighter-name-1')).toHaveText('CAPTAIN FALCON');
  await capture(page,'mirrors');await openPauseMenu(page);await page.locator('#change-fighters').click();await expect(page.locator('[data-fighter="Ca"] img')).toHaveCount(1);
  await capture(page,'select');await chooseFighter(page,0,'Fx');await chooseFighter(page,1,'Mr');await startBattle(page,'final');await frames(page,220);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Fx','Mr']);expect(errors).toEqual([]);
});
for(const [direction,key,animation] of [['neutral',null,'SpecialN'],['side','KeyD','SpecialSStart'],['up','KeyW','SpecialHi'],['down','KeyS','SpecialLw']] as const)test(`Falcon ${direction} uses original clips through browser controls without per-frame assets`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);let reads=0;page.on('request',r=>{if(r.url().includes('/api/assets/'))reads++;});
  if(key)await page.keyboard.down(key);await page.keyboard.down('KeyL');await frames(page,10);
  const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(f?.special?.direction).toBe(direction);expect(f?.animation).toBe(animation);
  await capture(page,direction);await page.keyboard.up('KeyL');if(key)await page.keyboard.up(key);await frames(page,130);
  expect(reads).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.projectiles.length)).toBe(0);
});
test('Falcon Kick ends through its original ending animation and returns to neutral',async({page})=>{
  await ready(page);await page.keyboard.down('KeyS');await page.keyboard.down('KeyL');await frames(page,6);
  await page.keyboard.up('KeyL');await page.keyboard.up('KeyS');await frames(page,50);
  await capture(page,'kick-end');await frames(page,80);
  const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);
  expect(f?.special).toBeNull();expect(['idle','walk','run','fall','crouch']).toContain(f!.state);
});
test('Captain Falcon roster portrait is visible on a narrow viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});await openSolo(page);await chooseFighter(page,0,'Ca');
  await expect(page.locator('[data-fighter="Ca"] img')).toBeVisible();await capture(page,'mobile');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
test('Falcon asset transport exposes only verified neutral costume/actions/effects/audio',async({request})=>{
  const manifest=await(await request.get('/api/source')).json();expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for(const name of ['PlCa.dat','PlCaAJ.dat','PlCaNr.dat','EfCaData.dat','audio/us/captain.ssm'])expect((await request.get(`/api/assets/${encodeURIComponent(name)}`,{headers:{Range:'bytes=0-15'}})).status()).toBe(206);
  for(const name of ['PlCaGy.dat','PlCaRe.dat','PlGn.dat','audio/captain.ssm','main.dol'])expect((await request.get(`/api/assets/${encodeURIComponent(name)}`)).status()).toBe(404);
});
