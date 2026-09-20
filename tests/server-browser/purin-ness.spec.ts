import { test, expect, type Page } from '@playwright/test';
import { openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
const frames = (page: Page, count: number) => page.clock.runFor(count * 17);

async function ready(page: Page, kind: 'Pr' | 'Ns') {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await openSolo(page); await chooseFighter(page, 0, kind); await setSeat(page, 1, 'human', 'Mr');
  await startBattle(page, 'final'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

test('Jigglypuff charges and releases Rollout through the real keyboard flow', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, 'Pr');
  // Multi-jump first, from the clean spawn: the unit suite counts all six exactly.
  await page.keyboard.down('Space'); await frames(page, 8); await page.keyboard.up('Space');
  for (let i = 0; i < 6; i++) { await frames(page, 6); await page.keyboard.down('Space'); await frames(page, 3); await page.keyboard.up('Space'); }
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].jumpsUsed)).toBeGreaterThanOrEqual(3);
  await frames(page, 120);
  await page.keyboard.down('KeyL'); await frames(page, 30);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].state)).toBe('special');
  await page.keyboard.up('KeyL'); await frames(page, 8);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toMatch(/SpecialN(Release|Turn|Hit|End)/);
  await frames(page, 240);
  expect(await page.evaluate(() => ['idle', 'fall', 'helpless', 'landing', 'walk', 'run', 'ko', 'respawn'].includes(window.smashMatchSnapshot?.()?.fighters[0].state ?? ''))).toBe(true);
  expect(errors).toEqual([]);
});

test('Ness fires PK Fire and holds PSI Magnet through the real keyboard flow', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, 'Ns');
  await page.keyboard.down('KeyD'); await page.keyboard.down('KeyL'); await frames(page, 4);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyD'); await frames(page, 20);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'pk-fire' || p.kind === 'pk-fire-pillar'))).toBe(true);
  await frames(page, 120);
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyL'); await frames(page, 10);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toMatch(/^SpecialLw/);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyS'); await frames(page, 80);
  expect(await page.evaluate(() => ['idle', 'fall', 'landing', 'walk'].includes(window.smashMatchSnapshot?.()?.fighters[0].state ?? ''))).toBe(true);
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyL'); await frames(page, 25);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyW');
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'pk-thunder'))).toBe(true);
  await frames(page, 200);
  expect(errors).toEqual([]);
});
