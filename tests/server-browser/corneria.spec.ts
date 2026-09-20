import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openPauseMenu, openSolo, chooseFighter, setSeat, goToStage, startBattle } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
const frames = (page: Page, n: number) => page.clock.runFor(n * 17);
async function capture(page: Page, name: string) { const dir = process.env.SMASH_SERVER_ARTIFACT_DIR; if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `corneria-${name}.png`) }); } }
async function ready(page: Page): Promise<void> {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page); await chooseFighter(page, 0, 'Ca'); await setSeat(page, 1, 'human', 'Fx');
  await startBattle(page, 'corneria'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
test('Corneria loads its 21 static floors (hull and nose) and both fighters spawn grounded on the slopes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  const snapshot = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(snapshot?.stage).toBe('corneria'); expect(snapshot?.stageFloors).toBe(21); // hull (area 3) plus the nose floor (area 4) that grcorneria.c keeps enabled
  expect(snapshot?.fighters.every(f => f.grounded)).toBe(true);
  await capture(page, 'spawn');
  await page.keyboard.down('KeyA'); await frames(page, 60); await page.keyboard.up('KeyA');
  const walked = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(walked?.grounded).toBe(true);
  await capture(page, 'deck-walk'); expect(errors).toEqual([]);
});
test('Corneria keeps playing without per-frame asset reads and returns cleanly to Battlefield', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page); let reads = 0; page.on('request', request => { if (request.url().includes('/api/assets/')) reads++; });
  await frames(page, 180);
  expect(reads).toBe(0);
  await openPauseMenu(page);await page.locator('#change-fighters').click();
  await startBattle(page, 'battlefield'); await frames(page, 200);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.stage)).toBe('battlefield');
  expect(errors).toEqual([]);
});
test('Corneria is disabled for five or more seats by the prototype spawn cap', async ({ page }) => {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page);
  for (const seat of [2, 3, 4]) await setSeat(page, seat, 'cpu');
  await goToStage(page);
  await expect(page.locator('[data-stage="corneria"]')).toBeDisabled();
  await expect(page.locator('[data-stage="battlefield"]')).toBeEnabled();
  await capture(page, 'five-seat-cap');
});
test('Corneria asset transport exposes only the stage archive and its music', async ({ request }) => {
  const manifest = await (await request.get('/api/source')).json();
  expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for (const name of ['GrCn.dat', 'audio/corneria.hps']) expect((await request.get(`/api/assets/${encodeURIComponent(name)}`, { headers: { Range: 'bytes=0-15' } })).status()).toBe(206);
  for (const name of ['GrCn.usd', 'audio/vl_corneria.hps', 'audio/corneria.ssm']) expect((await request.get(`/api/assets/${encodeURIComponent(name)}`)).status()).toBe(404);
});
