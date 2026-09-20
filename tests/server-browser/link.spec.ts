import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
const frames = (page: Page, count: number) => page.clock.runFor(count * 17);

for (const kind of ['Lk', 'Cl'] as const) test(`${kind} original powers survive browser input, article transitions and bomb throws`, async ({ page }) => {
  // This exercises three complete move/article lifecycles under software rendering.
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await openSolo(page); await chooseFighter(page, 0, kind); await setSeat(page, 1, 'human', 'Mr');
  await startBattle(page, 'final'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  // Pull a bomb, recover while holding it, then use the actual normal-attack key to throw.
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyL'); await frames(page, 2);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyS'); await frames(page, 42);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.filter(p => p.kind === 'link-bomb').length)).toBe(1);
  await page.keyboard.down('KeyJ'); await frames(page, 2);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('LightThrowF');
  await page.keyboard.up('KeyJ'); await frames(page, 8);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.find(p => p.kind === 'link-bomb')?.vx)).toBeGreaterThan(0);
  await frames(page, 70);
  // A full bow release creates its own native arrow with the correct base damage.
  await page.keyboard.down('KeyL'); await frames(page, 75); await page.keyboard.up('KeyL');
  let arrowDamage: number | undefined;
  for (let tick = 0; tick < 10 && arrowDamage === undefined; tick++) {
    await frames(page, 1);
    arrowDamage = await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.find(p => p.kind === 'arrow')?.damage);
  }
  expect(arrowDamage).toBe(kind === 'Lk' ? 18 : 15);
  await frames(page, 70);
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyL'); await frames(page, 29);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'boomerang'))).toBe(true);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyD'); await frames(page, 180);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'boomerang'))).toBe(false);
  expect(errors).toEqual([]);
});

test('Link bow and hookshot render through the real keyboard flow without runtime errors',async({page})=>{
  test.setTimeout(90_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();await page.goto('/play.html');await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:60_000});
  await openSolo(page);await chooseFighter(page,0,'Lk');await setSeat(page,1,'human','Mr');await startBattle(page,'final');await page.waitForFunction(()=>window.smashMatchSnapshot?.()?.phase==='playing');
  await page.clock.pauseAt(new Date(Date.now()+1000));
  const capture=async(name:string)=>{const dir=process.env.SMASH_SERVER_ARTIFACT_DIR;if(dir){await mkdir(dir,{recursive:true});await page.screenshot({path:join(dir,`link-${name}.png`)});}};
  await page.keyboard.down('KeyL');await frames(page,25);expect(await page.evaluate(()=>window.smashMatchSnapshot?.()?.fighters[0].special?.direction)).toBe('neutral');await capture('bow');
  await page.keyboard.up('KeyL');await frames(page,75);
  await page.keyboard.down('KeyA');await frames(page,10);await page.keyboard.up('KeyA');await page.keyboard.down('KeyD');await frames(page,1);await page.keyboard.up('KeyD');await frames(page,2);
  await page.keyboard.down('KeyI');await frames(page,16);await page.keyboard.up('KeyI');
  expect(await page.evaluate(()=>['Catch','CatchDash','CatchWait'].includes(window.smashMatchSnapshot?.()?.fighters[0].animation??''))).toBe(true);await capture('hookshot');
  await frames(page,100);expect(errors).toEqual([]);
});
