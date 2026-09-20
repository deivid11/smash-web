import { test, expect, type Page } from '@playwright/test';
import { openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
const frames = (page: Page, count: number) => page.clock.runFor(count * 17);

async function ready(page: Page, kind: 'Kp' | 'Pe') {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await openSolo(page); await chooseFighter(page, 0, kind); await setSeat(page, 1, 'human', 'Mr');
  await startBattle(page, 'final'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

test('Bowser breathes fire and spins the Fortress through the real keyboard flow', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, 'Kp');
  await page.keyboard.down('KeyL'); await frames(page, 40);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'koopa-flame'))).toBe(true);
  await page.keyboard.up('KeyL'); await frames(page, 60);
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyL'); await frames(page, 4);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyW');
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toMatch(/^Special(Air)?Hi/);
  await frames(page, 120);
  expect(errors).toEqual([]);
});

test('Peach pulls a turnip and floats through the real keyboard flow', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, 'Pe');
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyL'); await frames(page, 4);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyS');
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toMatch(/^SpecialLw/);
  await frames(page, 60);
  await page.keyboard.down('KeyJ'); await frames(page, 3); await page.keyboard.up('KeyJ'); await frames(page, 4);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.some(p => p.kind === 'turnip'))).toBe(true);
  await frames(page, 60);
  // Double jump then hold jump for the float.
  await page.keyboard.down('Space'); await frames(page, 8); await page.keyboard.up('Space'); await frames(page, 3);
  await page.keyboard.down('Space'); await frames(page, 3); await page.keyboard.up('Space'); await frames(page, 14);
  await page.keyboard.down('Space'); await frames(page, 25);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('Fuwafuwa');
  await page.keyboard.up('Space'); await frames(page, 100);
  expect(errors).toEqual([]);
});
