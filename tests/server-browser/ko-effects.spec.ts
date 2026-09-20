import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openSolo, setSeat, startBattle } from './helpers/battle.ts';

test('serves the exact native KO bank with bounded ranges and denies other disc resources', async ({ request }) => {
  const manifest = await (await request.get('/api/source')).json();
  expect(manifest.files.some((file: {path:string}) => file.path === 'EfCoData.dat')).toBe(true);
  const response = await request.get('/api/assets/EfCoData.dat', {headers:{Range:'bytes=0-31'}});
  expect(response.status()).toBe(206); expect((await response.body()).length).toBe(32);
  for(const name of ['EfAll.dat','main.dol','game.iso']) expect((await request.get(`/api/assets/${name}`)).status()).toBe(404);
});

test('plays and finishes a native KO beam and large quake after the final stock without advancing the ended match', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [], banks: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if(request.url().includes('/api/assets/EfCoData.dat')) banks.push(request.url()); });
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready','true',{timeout:30_000});
  expect(banks).toHaveLength(1); // Common hit effects and KO reuse the same archive read.
  await openSolo(page); await setSeat(page,1,'human');
  await page.locator('#setup-stocks').selectOption('1'); await startBattle(page);
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => (window.smashEffectsSnapshot?.()?.koBeams ?? 0) > 0, null, {timeout:15_000});
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => (window.smashEffectsSnapshot?.()?.shake.y ?? 0) < -0.3);
  await expect(page.locator('#center-overlay')).not.toBeVisible();
  const capture = await page.locator('#play-canvas').evaluate(canvas => {
    const sample = document.createElement('canvas'); sample.width=360; sample.height=240;
    const ctx=sample.getContext('2d')!;ctx.drawImage(canvas as HTMLCanvasElement,0,0,360,240);
    const pixels=ctx.getImageData(0,0,360,240).data;let red=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]!>180&&pixels[i]!>pixels[i+1]!+15&&pixels[i]!>pixels[i+2]!+15)red++;
    return {red, image:(canvas as HTMLCanvasElement).toDataURL('image/png')};
  });
  expect(capture.red).toBeGreaterThan(150); // P1 pale-pink core/red fringe, not an off-screen live model.
  expect(await page.evaluate(() => window.smashEffectsSnapshot?.()?.koParticles)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.smashEffectsSnapshot?.()?.koWarnings)).toEqual([]);
  // Capture synchronously with the pixel assertion; screenshot's font/layout waits
  // can otherwise outlive the deliberately short original beam animation.
  const imagePath=testInfo.outputPath('last-stock-native-ko.png');await mkdir(dirname(imagePath),{recursive:true});
  await writeFile(imagePath,Buffer.from(capture.image.split(',')[1]!, 'base64'));
  const frame = await page.evaluate(() => window.smashMatchSnapshot?.()?.frame);
  await page.waitForFunction(() => {const effects=window.smashEffectsSnapshot?.();return effects?.koBeams===0&&effects.shake.x===0&&effects.shake.y===0;});
  await expect(page.locator('#center-overlay')).toBeVisible();
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.phase)).toBe('ended');
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.frame)).toBe(frame);
  await page.locator('#reset-match').click();
  expect(await page.evaluate(() => window.smashEffectsSnapshot?.()?.koBeams)).toBe(0);
  expect(errors).toEqual([]);
});
