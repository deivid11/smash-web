import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { holdStick, releaseStick } from './helpers/touch.ts';
import { openControllerSettings, openPauseMenu, openSolo, resumeFromPause, setSeat, startBattle } from './helpers/battle.ts';

async function load(page: Page): Promise<void> {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 30_000 });
  await openSolo(page);
  await openControllerSettings(page);
  await page.locator('#sound-enabled').uncheck();
  await page.getByRole('button', { name: 'Close options', exact: true }).click();
}
async function start(page: Page, stocks = '3'): Promise<void> {
  await load(page); await setSeat(page, 1, 'human'); await page.locator('#setup-stocks').selectOption(stocks);
  await startBattle(page);
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
}
async function frames(page: Page, count: number): Promise<void> {
  const start = await page.evaluate(() => window.smashMatchSnapshot?.()?.frame ?? 0);
  await page.waitForFunction(({ start, count }) => (window.smashMatchSnapshot?.()?.frame ?? 0) >= start + count, { start, count });
}

test('loads a ready playable prototype from the server without a client ISO', async ({ page }) => {
  const errors: string[] = [], assets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.url().includes('/api/assets/')) assets.push(decodeURIComponent(new URL(request.url()).pathname.replace('/api/assets/', ''))); });
  await page.goto('/');
  await expect(page).toHaveURL(/\/play\.html$/u);
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 30_000 });
  await expect(page.locator('#game-status')).toHaveText('READY TO PLAY');
  await expect(page.locator('#mode-solo')).toBeEnabled();
  await expect(page.locator('#mode-lan')).toBeEnabled();
  await expect(page.locator('#start-match')).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  expect(assets).toContain('PlCo.dat'); for (const asset of assets) expect(SERVER_ASSETS).toContain(asset);
  expect(errors).toEqual([]);
});

test('keyboard movement and jumping update the match with no per-frame server requests', async ({ page }, testInfo) => {
  await start(page);
  const before = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  let requests = 0; page.on('request', (request) => { if (request.url().includes('/api/')) requests++; });
  await page.keyboard.down('KeyD'); await frames(page, 10);
  expect((await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].x))!).toBeGreaterThan(before!.x + 10);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => (window.smashMatchSnapshot?.()?.fighters[0].vy ?? 0) > 0.5);
  await page.keyboard.up('KeyD'); await frames(page, 5); await page.keyboard.up('Space');
  const player = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(player!.grounded).toBe(false); expect(player!.y).toBeGreaterThan(1); expect(requests).toBe(0);
  const artifacts = process.env.SMASH_PLAY_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: artifacts ? join(artifacts, 'tested-play-jump.png') : testInfo.outputPath('play-jump.png'), fullPage: true });
});

test('a short keyboard tap triggers an original jab and damages the other player', async ({ page }) => {
  await start(page);
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => { const player = window.smashMatchSnapshot?.()?.fighters[1]; return player?.grounded && player.y < 1; });
  await page.keyboard.up('ArrowDown'); await frames(page, 20);
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => (window.smashMatchSnapshot?.()?.fighters[1].percent ?? 0) > 0, null, { timeout: 5000 });
  expect((await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[1].percent))!).toBe(4);
  await expect(page.locator('#percent-1')).toContainText('4');
});

test('loses the last stock, declares a winner, and resets on rematch', async ({ page }) => {
  await start(page, '1'); await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'ended', null, { timeout: 10_000 });
  await page.keyboard.up('KeyD');
  await expect(page.locator('#overlay-title')).toHaveText('Mario wins.');
  expect((await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].stocks))!).toBe(0);
  await page.locator('#reset-match').click();
  expect((await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].stocks))!).toBe(1);
  await expect(page.locator('#game-status')).toHaveText('GET READY');
});

test('pauses both simulation and the clock when focus is lost', async ({ page }) => {
  await start(page); await frames(page, 5);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#game-status')).toHaveText('PAUSED');
  const snapshot = await page.evaluate(() => window.smashMatchSnapshot?.());
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.())).toEqual(snapshot);
  await page.locator('#start-match').click(); await frames(page, 5);
  await expect(page.locator('#game-status')).toHaveText('LOCAL MATCH');
});

test('touch buttons retain taps until the next simulation tick', async ({ page }) => {
  await start(page);
  await openPauseMenu(page);
  if (await page.locator('#touch-toggle').getAttribute('aria-pressed') === 'false') await page.locator('#touch-toggle').click();
  await resumeFromPause(page);
  const x = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].x ?? 0);
  await holdStick(page, 1, 0);
  await page.waitForFunction((x) => (window.smashMatchSnapshot?.()?.fighters[0].x ?? 0) > x, x);
  await releaseStick(page);
  await page.getByRole('button', { name: 'Jump', exact: true }).click();
  await page.waitForFunction(() => (window.smashMatchSnapshot?.()?.fighters[0].y ?? 0) > 1);
});

test('refuses to fake gameplay when its C/WASM core is missing', async ({ page }) => {
  await page.route('**/wasm/melee-gameplay.wasm', (route) => route.fulfill({ status: 404 }));
  await page.goto('/play.html');
  await expect(page.locator('#game-status')).toHaveText('UNAVAILABLE');
  await expect(page.locator('#mode-solo')).toBeDisabled();
  await expect(page.locator('#mode-lan')).toBeDisabled();
  await expect(page.locator('#start-match')).toHaveCount(0);
  await expect(page.locator('#play-canvas')).toHaveCount(0);
});

test('fits a mobile viewport and exposes touch controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await startBattle(page);
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeVisible();
});
