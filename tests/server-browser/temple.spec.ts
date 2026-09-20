import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openSolo, chooseFighter, setSeat, startBattle, goToStage } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
const frames = (page: Page, n: number) => page.clock.runFor(n * 17);
async function capture(page: Page, name: string) { const dir = process.env.SMASH_SERVER_ARTIFACT_DIR; if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `temple-${name}.png`) }); } }
async function ready(page: Page) {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page); await chooseFighter(page, 0, 'Fx'); await setSeat(page, 1, 'human', 'Mr');
  await startBattle(page, 'temple'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
test('Temple loads its original collision set and spawns fighters grounded', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  const snapshot = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(snapshot?.stage).toBe('temple');
  await expect(page.locator('.match-identity h1')).toHaveText('HYRULE TEMPLE');
  expect(snapshot?.stageFloors).toBe(42);
  for (const fighter of snapshot!.fighters) expect(fighter.grounded).toBe(true);
  await capture(page, 'spawn');
  expect(errors).toEqual([]);
});
test('fighters walk on Temple slopes through browser controls without per-frame assets', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page); let reads = 0; page.on('request', r => { if (r.url().includes('/api/assets/')) reads++; });
  const before = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  // 30 frames climbs the courtyard ramp without running off the far ledge.
  await page.keyboard.down('KeyD'); await frames(page, 30); await page.keyboard.up('KeyD'); await frames(page, 10);
  const after = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(after!.x).toBeGreaterThan(before!.x + 20);
  expect(after!.grounded).toBe(true);
  expect(after!.y).not.toBe(before!.y); // spawn shelf leads onto sloped ground at a different height
  await capture(page, 'slope-walk');
  expect(reads).toBe(0); expect(errors).toEqual([]);
});
test('Temple is selectable with four fighters but disabled for five or more', async ({ page }) => {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page);
  for (const seat of [1, 2, 3]) await setSeat(page, seat, 'cpu');
  await goToStage(page);
  await expect(page.locator('[data-stage="temple"]')).toBeEnabled();
  await page.locator('#back-to-characters').click();
  await setSeat(page, 4, 'cpu');
  await goToStage(page);
  await expect(page.locator('[data-stage="temple"]')).toBeDisabled();
  await expect(page.locator('[data-stage="battlefield"]')).toBeEnabled();
  await capture(page, 'five-player-cap');
});
test('Temple stage preview renders and music track is registered', async ({ page }) => {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page); await goToStage(page);
  await expect(page.locator('[data-stage="temple"] img')).toBeVisible();
  await capture(page, 'preview');
});
test('Temple asset transport exposes only the stage archive and its music', async ({ request }) => {
  const manifest = await (await request.get('/api/source')).json(); expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for (const name of ['GrSh.dat', 'audio/shrine.hps']) expect((await request.get(`/api/assets/${encodeURIComponent(name)}`, { headers: { Range: 'bytes=0-15' } })).status()).toBe(206);
  for (const name of ['GrZe.dat', 'GrGb.dat', 'audio/saria.hps', 'audio/hyaku.hps', 'main.dol']) expect((await request.get(`/api/assets/${encodeURIComponent(name)}`)).status()).toBe(404);
});
