import { holdStick, releaseStick } from './helpers/touch.ts';
import { test,expect,type Page } from '@playwright/test';
import { openPauseMenu, openSolo, resumeFromPause, setSeat, startBattle } from './helpers/battle.ts';
async function ready(page:Page){
 await page.clock.install();await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:30000});
 await openSolo(page);await setSeat(page,1,'human');await startBattle(page);await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');await page.clock.pauseAt(new Date(Date.now()+1000));
}
const frames=(page:Page,n:number)=>page.clock.runFor(17*n);
async function nextSimulationFrame(page:Page){
 const before=await page.evaluate(()=>window.smashMatchSnapshot?.()?.frame);
 for(let ms=0;ms<50;ms++){await page.clock.runFor(1);if(await page.evaluate(before=>window.smashMatchSnapshot?.()?.frame!==before,before))return;}
 throw Error('No simulation tick after the latched input.');
}

test('both keyboard players can walk with their modifier instead of dashing',async({page})=>{
 await ready(page);await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyD');await page.keyboard.down('Slash');await page.keyboard.down('ArrowRight');await frames(page,12);
 let fighters=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters);
 expect(fighters?.every(f=>f.state==='walk'&&f.animation.startsWith('Walk'))).toBe(true);
 expect(fighters![0].vx).toBeLessThan(1.61);expect(fighters![1].vx).toBeLessThan(1.11);
 await page.keyboard.up('ShiftLeft');await page.keyboard.up('Slash');await frames(page,3);
 fighters=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters);expect(fighters?.every(f=>f.state==='run')).toBe(true);
});

test('the walk-mode button also affects touch movement and survives pause without stuck direction',async({page})=>{
 await ready(page);await openPauseMenu(page);if(await page.locator('#touch-toggle').getAttribute('aria-pressed')==='false')await page.locator('#touch-toggle').click();
 await page.locator('#walk-mode').click();await expect(page.locator('#walk-mode')).toHaveAttribute('aria-pressed','true');
 await resumeFromPause(page);
 await holdStick(page,1,0);await nextSimulationFrame(page);
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].state)).toBe('walk');await releaseStick(page);
 await page.keyboard.press('Escape');await frames(page,10);await expect(page.locator('#walk-mode')).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('Escape');await frames(page,20);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].vx)).toBe(0);
 await openPauseMenu(page);
 await page.locator('#walk-mode').click();await expect(page.locator('#walk-mode')).toHaveAttribute('aria-pressed','false');
});

for(const [slot,key]of [[0,'KeyK'],[1,'KeyM']]as const)test(`holds and releases the original side smash for player ${slot+1}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 let requests=0;page.on('request',r=>{if(r.url().includes('/api/'))requests++;});
 await page.keyboard.down(key);await frames(page,22);
 const before=await page.evaluate(slot=>window.smashMatchSnapshot?.()?.fighters[slot],slot);
 expect(before?.smash?.phase).toBe('charging');await expect(page.locator(`#charge-${slot}`)).toBeVisible();
 await frames(page,15);const held=await page.evaluate(slot=>window.smashMatchSnapshot?.()?.fighters[slot],slot);
 expect(held?.animationFrame).toBe(before?.animationFrame);expect(held!.smash!.frames).toBeGreaterThan(before!.smash!.frames);
 await page.keyboard.up(key);await frames(page,5);
 const released=await page.evaluate(slot=>window.smashMatchSnapshot?.()?.fighters[slot],slot);
 expect(released?.smash?.phase).toBe('released');expect(released!.animationFrame).toBeGreaterThan(held!.animationFrame);
 expect(errors).toEqual([]);expect(requests).toBe(0);
});

test('maximum charge releases automatically, uses one charge cue and deals boosted damage',async({page})=>{
 test.setTimeout(45000);await ready(page);await page.keyboard.down('ArrowDown');await frames(page,1);await page.keyboard.up('ArrowDown');await frames(page,85);
 await page.keyboard.down('KeyK');await frames(page,88);
 const state=await page.evaluate(()=>window.smashMatchSnapshot?.());expect(state?.fighters[1].percent).toBeGreaterThan(20);expect(state?.fighters[0].smash?.frames).toBe(60);
 const audio=await page.evaluate(()=>window.smashAudioSnapshot?.());expect(audio?.lastError).toBe('');expect(audio?.recentIds.filter(id=>id===123)).toHaveLength(1);
 await frames(page,60);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].state)).toBe('idle');
});

test('pause freezes charge time and releasing while paused cannot leave it stuck',async({page})=>{
 await ready(page);await page.keyboard.down('KeyK');await frames(page,22);await page.keyboard.press('Escape');
 const before=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].smash);
 await page.keyboard.up('KeyK');await frames(page,20);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].smash)).toEqual(before);
 await page.keyboard.press('Escape');await frames(page,4);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].smash?.phase)).toBe('released');
});
