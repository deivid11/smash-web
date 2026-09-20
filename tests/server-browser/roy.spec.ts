import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openPauseMenu, openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
const frames=(page:Page,n:number)=>page.clock.runFor(n*17);
async function capture(page:Page,name:string){const dir=process.env.SMASH_SERVER_ARTIFACT_DIR;if(dir){await mkdir(dir,{recursive:true});await page.screenshot({path:join(dir,`roy-${name}.png`)});}}
async function ready(page:Page,mirror=false){
  await page.clock.install();await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});
  await openSolo(page);await chooseFighter(page,0,'Fe');await setSeat(page,1,'human',mirror?'Fe':'Mr');
  await startBattle(page,'final');await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
  await page.clock.pauseAt(new Date(Date.now()+1000));
}
test('Roy selects both slots with own portraits, HUD and clean switch back',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page,true);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Fe','Fe']);
  await expect(page.locator('#fighter-name-0')).toHaveText('ROY');await expect(page.locator('#fighter-name-1')).toHaveText('ROY');
  await capture(page,'mirrors');await openPauseMenu(page);await page.locator('#change-fighters').click();await expect(page.locator('[data-fighter="Fe"] img')).toHaveCount(1);
  await capture(page,'select');await chooseFighter(page,0,'Fx');await chooseFighter(page,1,'Mr');await startBattle(page,'final');await frames(page,220);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Fx','Mr']);expect(errors).toEqual([]);
});
for(const [direction,key,animation] of [['neutral',null,'SpecialNLoop'],['side','KeyD','SpecialS1'],['up','KeyW','SpecialHi'],['down','KeyS','SpecialLw']] as const)test(`Roy ${direction} uses original clips through browser controls without per-frame assets`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);let reads=0;page.on('request',r=>{if(r.url().includes('/api/assets/'))reads++;});
  if(key)await page.keyboard.down(key);await page.keyboard.down('KeyL');await frames(page,16);
  const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(f?.special?.direction).toBe(direction);expect(f?.animation).toBe(animation);
  await capture(page,direction);await page.keyboard.up('KeyL');if(key)await page.keyboard.up(key);await frames(page,110);
  expect(reads).toBe(0);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.projectiles.length)).toBe(0);
});
test('full Flare Blade uses its distinct release and ten-percent recoil once',async({page})=>{
  await ready(page);await page.keyboard.down('KeyL');await frames(page,226);
  const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(f?.animation).toBe('SpecialNEndFull');
  await frames(page,15);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].percent)).toBe(10);await capture(page,'full-flare');
  await page.keyboard.up('KeyL');await frames(page,60);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].percent)).toBe(10);
});
test('Roy roster portrait is visible on a narrow viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});await openSolo(page);await chooseFighter(page,0,'Fe');
  await expect(page.locator('[data-fighter="Fe"] img')).toBeVisible();await capture(page,'mobile');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
test('Roy asset transport exposes only verified neutral costume/actions/effects/audio',async({request})=>{
  const manifest=await(await request.get('/api/source')).json();expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for(const name of ['PlFe.dat','PlFeAJ.dat','PlFeNr.dat','EfFeData.dat','audio/us/emblem.ssm'])expect((await request.get(`/api/assets/${encodeURIComponent(name)}`,{headers:{Range:'bytes=0-15'}})).status()).toBe(206);
  for(const name of ['PlFeRe.dat','PlMs.dat','PlKbCpFe.dat','audio/emblem.ssm','main.dol'])expect((await request.get(`/api/assets/${encodeURIComponent(name)}`)).status()).toBe(404);
});
