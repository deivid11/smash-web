import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';

// Zero exists only when the server registered the ACE 2.0 extension disc.
test.skip(!process.env.MELEE_ACE_ISO, 'Set MELEE_ACE_ISO to run the Zero browser cases.');

const frames = (page: Page, n: number) => page.clock.runFor(n * 17);
async function capture(page: Page, name: string) { const dir = process.env.SMASH_SERVER_ARTIFACT_DIR; if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `zero-${name}.png`) }); } }
async function ready(page: Page) {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page); await chooseFighter(page, 0, 'Zx'); await setSeat(page, 1, 'human', 'Mr');
  await startBattle(page, 'final'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

test('Zero appears on the roster, loads both slots and fights with his own clips', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await ready(page);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(f => f.kind))).toEqual(['Zx', 'Mr']);
  await expect(page.locator('#fighter-name-0')).toHaveText('ZERO');
  await capture(page, 'match');
  await page.keyboard.down('KeyJ'); await frames(page, 4); await page.keyboard.up('KeyJ');
  const jab = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(jab?.animation).toBe('Attack11');
  await frames(page, 60); expect(errors).toEqual([]);
});

test('the ACE wave (Toad, Meta Knight, Sonic) selects and fights with its own content', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page);
  for (const kind of ['Td', 'Mk', 'Sn'] as const) await expect(page.locator(`[data-fighter="${kind}"]`)).toHaveCount(1);
  await chooseFighter(page, 0, 'Mk'); await setSeat(page, 1, 'human', 'Sn');
  await startBattle(page, 'final'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(f => f.kind))).toEqual(['Mk', 'Sn']);
  await expect(page.locator('#fighter-name-0')).toHaveText('META KNIGHT');
  await expect(page.locator('#fighter-name-1')).toHaveText('SONIC');
  await page.keyboard.down('KeyL'); await frames(page, 14);
  const mk = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(['SpecialNStart', 'SpecialNSpin']).toContain(mk?.animation);
  await page.keyboard.up('KeyL'); await frames(page, 120);
  await capture(page, 'ace-wave');
  expect(errors).toEqual([]);
});

test('Z-Buster charges through the browser and fires a live projectile without per-frame assets', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await ready(page);
  let reads = 0; page.on('request', r => { if (r.url().includes('/api/assets/')) reads++; });
  await page.keyboard.down('KeyL'); await frames(page, 20);
  const charging = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(charging?.special?.direction).toBe('neutral');
  expect(['SpecialNStart', 'SpecialNLoop']).toContain(charging?.animation);
  await capture(page, 'charge');
  await page.keyboard.up('KeyL'); await frames(page, 4);
  const kinds = await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.map(p => p.kind));
  expect(kinds).toContain('buster');
  await capture(page, 'shot');
  await frames(page, 120);
  expect(reads).toBe(0); expect(errors).toEqual([]);
});
