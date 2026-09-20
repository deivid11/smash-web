import {test,expect,type Page} from '@playwright/test';
import {openPauseMenu,openSolo,chooseFighter,resumeFromPause,setSeat,startBattle} from './helpers/battle.ts';
const frames=(page:Page,n:number)=>page.clock.runFor(n*17);
async function ready(page:Page,stage:'final'|'stadium'='final'){
  await page.clock.install();await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});
  await openSolo(page);await chooseFighter(page,0,'Mr');await setSeat(page,1,'human','Fx');
  await startBattle(page,stage);await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
  await page.clock.pauseAt(new Date(Date.now()+1000));
}
const canvasRatio=(page:Page)=>page.evaluate(()=>{const c=document.querySelector<HTMLCanvasElement>('#play-canvas')!;return c.width/c.clientWidth;});
const snapshot=(page:Page)=>page.evaluate(()=>window.smashEffectsSnapshot?.());
/** Pins one screen-space effect through the options menu (auto/on/off). */
async function setEffect(page:Page,effect:string,choice:'auto'|'on'|'off'){
  await openPauseMenu(page);
  await page.getByRole('button',{name:'Game options',exact:true}).click();
  const details=page.locator('.effects-settings');
  if(!await details.evaluate(node=>(node as HTMLDetailsElement).open))await details.locator('summary').click();
  await page.locator(`#effect-${effect}`).selectOption(choice);
  await page.getByRole('button',{name:'Close options',exact:true}).click();
  await resumeFromPause(page);
}
async function choose(page:Page,quality:string){
  await openPauseMenu(page);
  await page.getByRole('button',{name:'Game options',exact:true}).click();
  await page.locator('#graphics-quality').selectOption(quality);
  await page.getByRole('button',{name:'Close options',exact:true}).click();
  await resumeFromPause(page);
}
test('graphics presets rescale the canvas, budget particles and persist without touching the simulation',async({page})=>{
  test.setTimeout(240000);await ready(page);
  await expect(page.locator('#graphics-quality')).toBeHidden();
  expect((await snapshot(page))!.graphics).toBe('high');
  const before=await page.evaluate(()=>window.smashMatchSnapshot?.());
  const highRatio=await canvasRatio(page);
  // Extra high first, then Low: the page ends on the cheapest preset so SwiftShader teardown stays fast.
  await choose(page,'ultra');await frames(page,2);
  const ultra=(await snapshot(page))!;expect(ultra.graphics).toBe('ultra');expect(ultra.particleLimit).toBeNull();
  expect(await canvasRatio(page)).toBeGreaterThan(highRatio);
  expect(await page.evaluate(()=>localStorage.getItem('smash-web.graphics'))).toBe('ultra');
  await choose(page,'low');await frames(page,2);
  const low=(await snapshot(page))!;expect(low.graphics).toBe('low');expect(low.particleLimit).toBe(96);
  expect(await canvasRatio(page)).toBeLessThan(highRatio);
  expect(await page.evaluate(()=>localStorage.getItem('smash-web.graphics'))).toBe('low');
  // Presets are cosmetic: the match only advanced by the frames this test ran and its fighters are untouched.
  const after=await page.evaluate(()=>window.smashMatchSnapshot?.());
  expect(after!.fighters.map(f=>f.kind)).toEqual(before!.fighters.map(f=>f.kind));
  expect(after!.frame-before!.frame).toBeGreaterThanOrEqual(0);expect(after!.frame-before!.frame).toBeLessThanOrEqual(6);
});
test('low preset slows the Stadium display feed to every eighth frame',async({page})=>{
  await ready(page,'stadium');
  await choose(page,'low');
  const start=(await snapshot(page))!.stadiumCaptures;const frame0=(await page.evaluate(()=>window.smashMatchSnapshot?.()?.frame))!;
  await frames(page,24);
  const end=(await snapshot(page))!.stadiumCaptures;const frame1=(await page.evaluate(()=>window.smashMatchSnapshot?.()?.frame))!;
  const advanced=frame1-frame0;expect(advanced).toBeGreaterThan(8);
  expect(end-start).toBeLessThanOrEqual(Math.ceil(advanced/8)+1);expect(end-start).toBeGreaterThan(0);
});

test('screen-space effects follow the preset and each one can be pinned on or off',async({page})=>{
  test.setTimeout(240000);await ready(page);
  // Extra high runs the full chain; Low keeps only the cheapest pass.
  await choose(page,'ultra');await frames(page,2);
  expect([...(await snapshot(page))!.effects].sort()).toEqual(['ao','bloom','grade','sharpen','vignette']);
  await choose(page,'low');await frames(page,2);
  expect((await snapshot(page))!.effects).toEqual(['sharpen']);
  // A pinned choice overrides the preset in both directions and is persisted.
  await setEffect(page,'bloom','on');await setEffect(page,'sharpen','off');await frames(page,2);
  expect((await snapshot(page))!.effects).toEqual(['bloom']);
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('smash-web.effects'))??'{}')).toEqual({bloom:'on',sharpen:'off'});
  // Everything off means the chain steps aside and the arena keeps rendering.
  await setEffect(page,'bloom','off');await frames(page,2);
  expect((await snapshot(page))!.effects).toEqual([]);
  expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.phase)).toBe('playing');
});

test('a stored preset is applied at boot before any battle starts',async({page})=>{
  test.setTimeout(90000);
  await page.addInitScript(()=>{localStorage.setItem('smash-web.graphics','low');});
  await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60000});
  await openSolo(page);await page.getByRole('button',{name:'OPTIONS',exact:true}).click();
  await expect(page.locator('#graphics-quality')).toHaveValue('low');
  await page.getByRole('button',{name:'Close options',exact:true}).click();
  // The renderer exists once the game is ready, so the boot path already applied the stored preset.
  const stats=(await snapshot(page))!;expect(stats.graphics).toBe('low');expect(stats.particleLimit).toBe(96);
});
