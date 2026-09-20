import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import { openPauseMenu, openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
const frames=(page:Page,n:number)=>page.clock.runFor(n*17);
async function ready(page:Page,kind:'Mr'|'Cl'|'Lk'|'Ca'){
  await page.clock.install();await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});
  // Link's passive Hylian shield blocks an idle-facing fireball, so Mario's fire-hit target is Fox.
  await openSolo(page);await chooseFighter(page,0,kind);await setSeat(page,1,'human',kind==='Mr'?'Fx':'Mr');
  await startBattle(page,'final');await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
  await page.clock.pauseAt(new Date(Date.now()+1000));
}
async function capture(page:Page,name:string){const dir=process.env.SMASH_SERVER_ARTIFACT_DIR;if(dir){await mkdir(dir,{recursive:true});await page.screenshot({path:join(dir,`vfx-${name}.png`)});}}
function errors(page:Page){const list:string[]=[];page.on('pageerror',e=>list.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|THREE/i.test(m.text()))list.push(m.text());});return list;}
async function untilBurn(page:Page,budget=100){
  for(let tick=0;tick<budget;tick++){await frames(page,1);if((await page.evaluate(()=>window.smashEffectsSnapshot?.()?.burning??0))>0)return;}
  throw Error('No fire-hit reaction appeared through actual controls.');
}
test('native running/landing dust and Mario fire-hit reaction through keyboard controls',async({page})=>{
  test.setTimeout(120000);const faults=errors(page);await ready(page,'Mr');
  await page.keyboard.down('KeyD');await frames(page,12);await page.keyboard.up('KeyD');
  expect((await page.evaluate(()=>window.smashEffectsSnapshot?.()))!.spawnedDust).toBeGreaterThan(0);await capture(page,'running-dust');
  await page.keyboard.down('Space');await frames(page,5);await page.keyboard.up('Space');
  let airborne=false,landed=false;
  for(let i=0;i<100;i++){await frames(page,1);const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);airborne||=!f!.grounded;if(airborne&&f!.grounded){landed=true;break;}}
  expect(landed).toBe(true);await frames(page,2);await capture(page,'landing-dust');await frames(page,20);
  await page.keyboard.down('KeyL');await frames(page,2);await page.keyboard.up('KeyL');await untilBurn(page);await frames(page,3);await capture(page,'mario-burn');
  const stats=await page.evaluate(()=>window.smashEffectsSnapshot?.());expect(stats!.particles).toBeGreaterThan(0);expect(stats!.warnings).toEqual([]);expect(faults).toEqual([]);
});
test('normal hits use native impact sprites instead of the generic line star',async({page})=>{
  test.setTimeout(120000);const faults=errors(page);await ready(page,'Mr');
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyD');for(let i=0;i<120;i++){await frames(page,1);const fs=(await page.evaluate(()=>window.smashMatchSnapshot?.()))!.fighters;if(fs[1].x-fs[0].x<12)break;}await page.keyboard.up('KeyD');await page.keyboard.up('ShiftLeft');
  await frames(page,8);await page.keyboard.down('KeyJ');
  let hit=false;for(let i=0;i<30;i++){await frames(page,1);if((await page.evaluate(()=>window.smashEffectsSnapshot?.()?.spawnedHits??0))>0){hit=true;break;}}
  await page.keyboard.up('KeyJ');expect(hit).toBe(true);await frames(page,2);await capture(page,'normal-hit');
  const stats=await page.evaluate(()=>window.smashEffectsSnapshot?.());expect(stats!.particles).toBeGreaterThan(0);expect(stats!.burning).toBe(0);expect(stats!.warnings).toEqual([]);expect(faults).toEqual([]);
});
test('Young Link fire arrows burn the struck fighter with native particles',async({page})=>{
  test.setTimeout(120000);const faults=errors(page);await ready(page,'Cl');
  // Put the target inside the arrow's real ballistic reach using movement only.
  await page.keyboard.down('KeyD');for(let i=0;i<50;i++){await frames(page,1);const fs=(await page.evaluate(()=>window.smashMatchSnapshot?.()))!.fighters;if(fs[1].x-fs[0].x<32)break;}await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyL');await frames(page,75);await page.keyboard.up('KeyL');await untilBurn(page);await frames(page,3);await capture(page,'young-link-fire-arrow');
  expect((await page.evaluate(()=>window.smashMatchSnapshot?.()))!.fighters[1].percent).toBeGreaterThan(0);
  expect((await page.evaluate(()=>window.smashEffectsSnapshot?.()))!.warnings).toEqual([]);expect(faults).toEqual([]);
});
test('Captain Falcon fire attacks use the shared native victim reaction',async({page})=>{
  test.setTimeout(120000);const faults=errors(page);await ready(page,'Ca');
  await page.keyboard.down('KeyD');for(let i=0;i<35;i++){await frames(page,1);const fs=(await page.evaluate(()=>window.smashMatchSnapshot?.()))!.fighters;if(fs[1].x-fs[0].x<15)break;}await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyL');await frames(page,2);await page.keyboard.up('KeyL');await untilBurn(page);await frames(page,3);await capture(page,'falcon-burn');
  expect((await page.evaluate(()=>window.smashEffectsSnapshot?.()))!.warnings).toEqual([]);expect(faults).toEqual([]);
});
test('Link bomb fire affects its owner and is cleared on rematch',async({page})=>{
  test.setTimeout(120000);const faults=errors(page);await ready(page,'Lk');
  await page.keyboard.down('KeyS');await page.keyboard.down('KeyL');await frames(page,2);await page.keyboard.up('KeyL');await page.keyboard.up('KeyS');
  await frames(page,290);await untilBurn(page,40);await frames(page,3);await capture(page,'link-bomb-burn');
  expect((await page.evaluate(()=>window.smashEffectsSnapshot?.()))!.warnings).toEqual([]);
  await openPauseMenu(page);await page.locator('#change-fighters').click();expect((await page.evaluate(()=>window.smashEffectsSnapshot?.()))!.burning).toBe(0);expect(faults).toEqual([]);
});
