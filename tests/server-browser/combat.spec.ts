import { test,expect,type Page } from '@playwright/test';
import { openPauseMenu, openSolo, resumeFromPause, setSeat, startBattle } from './helpers/battle.ts';

async function ready(page:Page){
 await page.clock.install();await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:30000});
 await openSolo(page);await setSeat(page,1,'human');await startBattle(page);await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
 await page.clock.pauseAt(new Date(Date.now()+1000));
}
const frames=(page:Page,n:number)=>page.clock.runFor(n*17);
async function closePlayers(page:Page){await page.keyboard.down('ArrowDown');await frames(page,1);await page.keyboard.up('ArrowDown');await frames(page,85);}

test('holds a visible shield with decreasing HUD energy and exits on release',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 await page.keyboard.down('KeyU');await frames(page,25);
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].state)).toBe('shield');
 expect(Number(await page.locator('#shield-0').getAttribute('value'))).toBeLessThan(60);
 await page.keyboard.up('KeyU');await frames(page,30);
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].state)).toBe('idle');expect(errors).toEqual([]);
});

test('uses down+shield for spot dodge and sideways+shield for a roll',async({page})=>{
 await ready(page);await page.keyboard.down('KeyU');await page.keyboard.down('KeyS');await frames(page,5);
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('EscapeN');
 await page.keyboard.up('KeyS');await frames(page,35);
 const x=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].x??0);
 await page.keyboard.down('KeyD');await frames(page,10);
 const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(f?.animation).toBe('EscapeF');expect(f!.x).toBeGreaterThan(x);
});

test('air dodges with keyboard direction and does not turn it into an attack',async({page})=>{
 await ready(page);await page.keyboard.down('Space');await frames(page,10);await page.keyboard.up('Space');
 await page.keyboard.down('KeyU');await page.keyboard.down('KeyD');await frames(page,8);
 const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(f?.animation).toBe('EscapeAir');expect(f?.grounded).toBe(false);
});

test('grabs through shield, pummels and throws with ordinary keyboard input',async({page})=>{
 test.setTimeout(45000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);await closePlayers(page);
 await page.keyboard.down('ShiftRight');await page.keyboard.down('KeyI');await frames(page,12);await page.keyboard.up('KeyI');
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[1].grabbedBy)).toBe(0);
 await page.keyboard.down('KeyJ');await frames(page,1);await page.keyboard.up('KeyJ');await frames(page,35);
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[1].percent)).toBe(3);
 await page.keyboard.down('KeyW');await frames(page,3);await page.keyboard.up('KeyW');
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('ThrowHi');
 await frames(page,20);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[1].grabbedBy)).toBeNull();expect(errors).toEqual([]);
});

test('touch shield and grab buttons retain a tap through the next simulation tick',async({page})=>{
 await ready(page);await openPauseMenu(page);if(await page.locator('#touch-toggle').getAttribute('aria-pressed')==='false')await page.locator('#touch-toggle').click();await resumeFromPause(page);
 await page.getByRole('button',{name:'Shield or air dodge',exact:true}).click();await frames(page,2);
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].state)).toBe('shield');
 await frames(page,30);await page.getByRole('button',{name:'Grab',exact:true}).click();await frames(page,2);
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].state)).toBe('grab');
});

test('catches an actual stage ledge using slow gamepad movement and climbs back',async({page})=>{
 test.setTimeout(60000);
 await page.addInitScript(()=>{
   const pad={id:'Xbox 360 Controller (STANDARD GAMEPAD)',index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0,touched:false}))};
   (window as unknown as {testPad:typeof pad}).testPad=pad;Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});
 });
 await ready(page);
 await page.evaluate(()=>{(window as unknown as {testPad:{axes:number[]}}).testPad.axes[0]=-0.3;});
 for(let n=0;n<220;n++){await frames(page,1);if(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].ledge!==null))break;}
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].ledge)).not.toBeNull();
 await page.evaluate(()=>{(window as unknown as {testPad:{axes:number[]}}).testPad.axes[0]=0;});await frames(page,15);
 await page.keyboard.down('KeyW');await frames(page,3);await page.keyboard.up('KeyW');
 expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('CliffClimbQuick');
 await frames(page,40);const f=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(f?.grounded).toBe(true);expect(f?.ledge).toBeNull();
});
