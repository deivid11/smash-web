import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openPauseMenu, openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
const frames=(page:Page,n:number)=>page.clock.runFor(n*17);
async function capture(page:Page,name:string){const dir=process.env.SMASH_SERVER_ARTIFACT_DIR;if(dir){await mkdir(dir,{recursive:true});await page.screenshot({path:join(dir,`dk-${name}.png`)});}}
async function ready(page:Page,mirror=false){
  await page.clock.install();await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});
  await openSolo(page);await chooseFighter(page,0,'Dk');await setSeat(page,1,'human',mirror?'Dk':'Mr');
  await startBattle(page,'final');await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
  await page.clock.pauseAt(new Date(Date.now()+1000));
}
test('Donkey Kong selects both slots with own portraits, HUD and clean switch back',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page,true);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Dk','Dk']);
  await expect(page.locator('#fighter-name-0')).toHaveText('DONKEY KONG');await expect(page.locator('#fighter-name-1')).toHaveText('DONKEY KONG');
  await capture(page,'mirrors');await openPauseMenu(page);await page.locator('#change-fighters').click();await expect(page.locator('[data-fighter="Dk"] img')).toHaveCount(1);
  await capture(page,'select');await chooseFighter(page,0,'Fx');await chooseFighter(page,1,'Mr');await startBattle(page,'final');await frames(page,220);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Fx','Mr']);expect(errors).toEqual([]);
});
for(const [direction,key,animations] of [['neutral',null,['SpecialNStart','SpecialNLoop']],['side','KeyD',['SpecialS']],['up','KeyW',['SpecialHi']],['down','KeyS',['SpecialLwStart','SpecialLwLoop']]] as const)test(`Donkey Kong ${direction} uses original clips through browser controls without per-frame assets`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);let reads=0;page.on('request',r=>{if(r.url().includes('/api/assets/'))reads++;});
  if(key)await page.keyboard.down(key);await page.keyboard.down('KeyL');await frames(page,16);
  const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(f?.special?.direction).toBe(direction);expect(animations).toContain(f?.animation);
  await capture(page,direction);await page.keyboard.up('KeyL');if(key)await page.keyboard.up(key);await frames(page,140);
  expect(reads).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.projectiles.length)).toBe(0);
});
test('Giant Punch banks to ten swings, survives the wind-down and releases the full punch',async({page})=>{
  test.setTimeout(120_000); // 400 simulated frames under SwiftShader exceed the default budget.
  await ready(page);await page.keyboard.down('KeyL');await frames(page,400);
  await page.keyboard.up('KeyL');await frames(page,40);
  const banked=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);
  expect(banked?.dkPunchCharge).toBe(10);expect(banked?.special).toBeNull();
  await capture(page,'charged');
  await page.keyboard.down('KeyL');await frames(page,4);
  const punch=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);
  expect(punch?.animation).toBe('SpecialNFull');expect(punch?.dkPunchCharge).toBe(0);
  await capture(page,'full-punch');await page.keyboard.up('KeyL');await frames(page,120);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].special)).toBeNull();
});
test('Donkey Kong roster portrait is visible on a narrow viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});await openSolo(page);await chooseFighter(page,0,'Dk');
  await expect(page.locator('[data-fighter="Dk"] img')).toBeVisible();await capture(page,'mobile');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
test('Donkey Kong asset transport exposes only the verified neutral costume/actions/effects/audio',async({request})=>{
  const manifest=await(await request.get('/api/source')).json();expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for(const name of ['PlDk.dat','PlDkAJ.dat','PlDkNr.dat','EfDkData.dat','audio/us/dk.ssm'])expect((await request.get(`/api/assets/${encodeURIComponent(name)}`,{headers:{Range:'bytes=0-15'}})).status()).toBe(206);
  for(const name of ['PlDkRe.dat','PlDkBk.dat','PlDkGr.dat','PlDkDViWaitAJ.dat','audio/us/donkey.ssm','main.dol'])expect((await request.get(`/api/assets/${encodeURIComponent(name)}`)).status()).toBe(404);
});
