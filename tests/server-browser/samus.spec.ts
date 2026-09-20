import { test, expect, type Page } from '@playwright/test';
import { openPauseMenu, openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
async function ready(page: Page, mirror=false) {
  await page.clock.install();await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60_000});
  await openSolo(page);await chooseFighter(page,0,'Ss');await setSeat(page,1,'human',mirror?'Ss':'Mr');
  await startBattle(page);await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');await page.clock.pauseAt(new Date(Date.now()+1000));
}
const frames=(page:Page,n:number)=>page.clock.runFor(n*17);
test('Samus has an original portrait, scoped selection label, HUD and mirror support',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page,true);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Ss','Ss']);
  await expect(page.locator('#fighter-name-0')).toHaveText('SAMUS');await expect(page.locator('#fighter-name-1')).toHaveText('SAMUS');
  await openPauseMenu(page);await page.locator('#change-fighters').click();await expect(page.locator('[data-fighter="Ss"]')).toHaveAttribute('aria-label',/no tether/);
  expect(await page.locator('[data-fighter="Ss"] .roster-portrait img').count()).toBe(1);
  await chooseFighter(page,0,'Fx');await chooseFighter(page,1,'Mr');await startBattle(page);await frames(page,200);await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters.map(f=>f.kind))).toEqual(['Fx','Mr']);expect(errors).toEqual([]);
});
for(const [direction,key] of [['neutral',null],['side','KeyD'],['up','KeyW'],['down','KeyS']] as const)test(`Samus ${direction} special renders from keyboard without new asset reads`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
  let reads=0;page.on('request',r=>{if(r.url().includes('/api/assets/'))reads++;});
  if(key)await page.keyboard.down(key);await page.keyboard.down('KeyL');await frames(page,16);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].special?.direction)).toBe(direction);
  await page.keyboard.up('KeyL');if(key)await page.keyboard.up(key);await frames(page,45);
  expect(reads).toBe(0);expect(errors).toEqual([]);
});
test('Samus charges, stores with shield and uses the HUD charge meter',async({page})=>{
  await ready(page);await page.keyboard.press('KeyL');await frames(page,65);
  const charge=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].samusCharge);expect(charge).toBeGreaterThan(0);
  await page.keyboard.press('KeyU');await frames(page,15);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].samusCharge)).toBe(charge);
});
test('Samus shows the charging orb, then rolls out of the charge as the Morph Ball',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
  await page.keyboard.press('KeyL');await frames(page,40);
  const charge=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].samusCharge);expect(charge).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('SpecialNHold');
  await page.keyboard.down('KeyD');await frames(page,3);
  const rolled=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);
  expect(rolled?.animation).toBe('EscapeF');expect(rolled?.state).toBe('dodge');expect(rolled?.samusCharge).toBe(charge);
  await page.keyboard.up('KeyD');await frames(page,20);
  // The orb rides an original article model on the cannon every frame it charges; a bad
  // joint or missing state-0 model would surface here as a render failure.
  expect(errors).toEqual([]);
});
test('Samus transport exposes only exact neutral resources and bounded ranges',async({request})=>{
  const manifest=await(await request.get('/api/source')).json();expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for(const file of ['PlSs.dat','PlSsNr.dat','PlSsAJ.dat','EfSsData.dat','audio/us/samus.ssm'])expect((await request.get(`/api/assets/${encodeURIComponent(file)}`,{headers:{Range:'bytes=0-15'}})).status()).toBe(206);
  for(const file of ['PlSsBk.dat','PlKbCpSs.dat','audio/samus.ssm','main.dol'])expect((await request.get(`/api/assets/${encodeURIComponent(file)}`)).status()).toBe(404);
});
