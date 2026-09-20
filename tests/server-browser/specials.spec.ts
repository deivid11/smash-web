import { holdStick, releaseStick } from './helpers/touch.ts';
import { test,expect,type Page } from '@playwright/test';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { openPauseMenu, openSolo, chooseFighter, resumeFromPause, setSeat, startBattle } from './helpers/battle.ts';

async function ready(page:Page,player='0'){
 await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:30000});
 await openSolo(page);if(player!=='0'){await chooseFighter(page,0,'Mr');await setSeat(page,1,'cpu','Fx');}
 await startBattle(page);await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
}

test('fires Fox blaster with original sound samples and no per-frame asset requests',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 let requests=0;page.on('request',r=>{if(r.url().includes('/api/'))requests++;});
 await page.keyboard.press('KeyL');
 await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.projectiles.some(p=>p.kind==='laser'));
 await page.waitForFunction(()=>(window.smashAudioSnapshot?.()?.played??0)>0);
 expect(await page.evaluate(()=>window.smashAudioSnapshot?.()?.lastError)).toBe('');
 expect((await page.evaluate(()=>window.smashAudioSnapshot?.()?.recentIds))!).toContain(110103);
 expect(requests).toBe(0);expect(errors).toEqual([]);
});

test('supports Mario as the solo fighter and touch-triggered Cape',async({page})=>{
 await ready(page,'1');expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.controlledPlayer)).toBe(0);
 await openPauseMenu(page);
 if(await page.locator('#touch-toggle').getAttribute('aria-pressed')==='false')await page.locator('#touch-toggle').click();
 await resumeFromPause(page);
 await holdStick(page,1,0);await page.getByRole('button',{name:'Special',exact:true}).click();
 await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.fighters[0].special?.direction==='side');await releaseStick(page);
 await expect(page.locator('#p1-label')).toHaveText('YOU');
});

test('holds Reflector and jump-cancels it through normal inputs',async({page})=>{
 await ready(page);await page.keyboard.down('KeyS');await page.keyboard.down('KeyL');
 await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.fighters[0].special?.phase==='loop');
 await page.keyboard.down('Space');
 await page.waitForFunction(()=>{const p=window.smashMatchSnapshot?.()?.fighters[0];return p?.special===null&&p.jumpsUsed>0;});
 await page.keyboard.up('Space');await page.keyboard.up('KeyS');await page.keyboard.up('KeyL');
});

test('aims Fire Fox during charge and launches diagonally',async({page})=>{
 await ready(page);await page.keyboard.down('KeyW');await page.keyboard.down('KeyD');await page.keyboard.press('KeyL');
 await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.fighters[0].special?.phase==='travel');
 const p=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(p!.vx).toBeGreaterThan(1);expect(p!.vy).toBeGreaterThan(1);
 await page.keyboard.up('KeyW');await page.keyboard.up('KeyD');
});

test('taps Tornado repeatedly to gain height as Mario',async({page})=>{
 await page.clock.install();await ready(page,'1');await page.clock.pauseAt(new Date(Date.now() + 1000));
 await openPauseMenu(page);
 if(await page.locator('#touch-toggle').getAttribute('aria-pressed')==='false')await page.locator('#touch-toggle').click();
 await resumeFromPause(page);
 const initial=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].y??0);
 await holdStick(page,0,-1);await page.getByRole('button',{name:'Special',exact:true}).click();await page.clock.runFor(8*17);
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'Special',exact:true}).click();await page.clock.runFor(6*17);}
 await releaseStick(page);
 const p=await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0]);expect(p!.special?.direction).toBe('down');expect(p!.y).toBeGreaterThan(initial+3);
});

test('limits streamed audio/effect data to the requested character resources',async({request})=>{
 const manifest=await(await request.get('/api/source')).json();expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
 expect((await request.get('/api/assets/audio%2Fus%2Ffox.ssm',{headers:{Range:'bytes=0-15'}})).status()).toBe(206);
 expect((await request.get('/api/assets/EfMrData.dat',{headers:{Range:'bytes=0-31'}})).status()).toBe(206);
 for(const path of ['audio/us/peach.ssm','EfPeData.dat','game.iso'])expect((await request.get(`/api/assets/${encodeURIComponent(path)}`)).status()).toBe(404);
});
