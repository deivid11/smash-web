import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openPauseMenu, openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
const frames = (page: Page, n: number) => page.clock.runFor(n * 17);
async function ready(page: Page, mirror = false) {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await openSolo(page); await chooseFighter(page, 0, 'Pk'); await setSeat(page, 1, 'human', mirror ? 'Pk' : 'Mr');
  await startBattle(page, 'final'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
async function capture(page: Page, name: string) {
  const directory = process.env.SMASH_SERVER_ARTIFACT_DIR;
  if (directory) { await mkdir(directory, { recursive: true }); await page.screenshot({ path: join(directory, `pikachu-${name}.png`) }); }
}
test('Pikachu selects both slots with original portraits, correct HUD and rematch cleanup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await ready(page, true);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(f => f.kind))).toEqual(['Pk', 'Pk']);
  await expect(page.locator('#fighter-name-0')).toHaveText('PIKACHU'); await expect(page.locator('#fighter-name-1')).toHaveText('PIKACHU');
  await capture(page, 'profiles'); await openPauseMenu(page);await page.locator('#change-fighters').click();
  await expect(page.locator('[data-fighter="Pk"] img')).toHaveCount(1); await capture(page, 'select');
  await chooseFighter(page, 0, 'Fx'); await chooseFighter(page, 1, 'Mr'); await startBattle(page, 'final');
  await frames(page, 220);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(f => f.kind))).toEqual(['Fx', 'Mr']); expect(errors).toEqual([]);
});
for (const [direction,key] of [['neutral',null],['side','KeyD'],['up','KeyW'],['down','KeyS']] as const) test(`Pikachu ${direction} special uses browser inputs without per-frame asset reads`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await ready(page);
  let reads = 0; page.on('request', r => { if (r.url().includes('/api/assets/')) reads++; });
  if (key) await page.keyboard.down(key); await page.keyboard.down('KeyL'); await frames(page, 16);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].special?.direction)).toBe(direction);
  if (direction === 'side') { await frames(page, 30); await page.keyboard.up('KeyL'); await page.keyboard.up('KeyD'); await frames(page, 5); }
  else if (direction === 'neutral') await frames(page, 10);
  else if (direction === 'down') await frames(page, 21);
  await capture(page, direction);
  await page.keyboard.up('KeyL'); if (key) await page.keyboard.up(key); await frames(page, 100);
  expect(reads).toBe(0); expect(errors).toEqual([]);
});
test('Thunder Jolt and linked Thunder appear as their own projectile kinds', async ({ page }) => {
  await ready(page); await page.keyboard.press('KeyL'); await frames(page, 24);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'tjolt'))).toBe(true);
  await frames(page, 85); await page.keyboard.down('KeyS'); await page.keyboard.press('KeyL'); await page.keyboard.up('KeyS'); await frames(page, 24);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.filter(p => p.kind === 'thunder').length)).toBe(4);
  await capture(page, 'thunder-segments'); await frames(page, 110);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'thunder'))).toBe(false);
});
test('Pikachu transport keeps costume, copy, alternate audio and executable files private', async ({ request }) => {
  const manifest = await (await request.get('/api/source')).json(); expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for (const file of ['PlPk.dat','PlPkAJ.dat','PlPkNr.dat','EfPkData.dat','audio/us/pikachu.ssm']) expect((await request.get(`/api/assets/${encodeURIComponent(file)}`, { headers: { Range: 'bytes=0-15' } })).status()).toBe(206);
  for (const file of ['PlPkRe.dat','PlKbCpPk.dat','audio/pikachu.ssm','main.dol']) expect((await request.get(`/api/assets/${encodeURIComponent(file)}`)).status()).toBe(404);
});
