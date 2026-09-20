import { test, expect, type Page } from '@playwright/test';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import type { RoomFighter } from '../../lib/net/protocol.ts';
import { openPauseMenu, openSolo, setSeat, chooseFighter, startBattle } from './helpers/battle.ts';

async function loaded(page: Page): Promise<void> {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
}
const playing = (page: Page) => page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
/** Kirby on seat 0 (P1 keys) against an idle human rival on seat 1 (P2 keys). The mock clock keeps the original
 * startup timing: it is installed before load and paused only once the match reports `playing`. */
async function ready(page: Page, rival: RoomFighter = 'Mr', clock = true): Promise<void> {
  if (clock) await page.clock.install();
  await loaded(page); await openSolo(page);
  await chooseFighter(page, 0, 'Kb'); await setSeat(page, 1, 'human', rival);
  await startBattle(page); await playing(page);
  if (clock) await page.clock.pauseAt(new Date(Date.now() + 1000));
}
const frames = (page: Page, n: number) => page.clock.runFor(n * 17);

test('selects original Kirby in solo mode with his portrait, HUD name and announcer cue', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await loaded(page); await openSolo(page);
  await chooseFighter(page, 0, 'Kb');
  await expect(page.locator('[data-fighter="Kb"]')).toHaveAttribute('aria-label', /Original Melee fighter/);
  expect(await page.locator('[data-fighter="Kb"] img').count()).toBe(1);
  await expect(page.locator('#select-seat-0')).toHaveAttribute('aria-label', 'Select player 1: Kirby');
  expect(await page.locator('#select-seat-0 img.portrait-Kb').count()).toBe(1);
  await startBattle(page); await playing(page);
  const state = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(state?.fighters[0]).toMatchObject({ name: 'Kirby', kind: 'Kb', custom: false }); expect(state?.controlledPlayer).toBe(0);
  await expect(page.locator('#fighter-name-0')).toHaveText('KIRBY');
  expect(errors).toEqual([]);
});
for (const [direction, key] of [['neutral', null], ['side', 'KeyD'], ['up', 'KeyW'], ['down', 'KeyS']] as const) test(`Kirby ${direction} special runs from browser controls without asset requests`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await ready(page);
  let requests = 0; page.on('request', (r) => { if (r.url().includes('/api/')) requests++; });
  if (key) await page.keyboard.down(key); await page.keyboard.down('KeyL'); await frames(page, 16);
  const f = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(f?.special?.direction).toBe(direction);
  if (direction === 'side') expect(f?.animation).toBe('SpecialS');
  if (direction === 'down') expect(f?.animation).toBe('SpecialLw1');
  if (direction === 'up') expect(f?.animation).toBe('SpecialHi1');
  if (direction === 'neutral') expect(['SpecialN', 'SpecialNLoop']).toContain(f?.animation);
  expect(requests).toBe(0); expect(errors).toEqual([]);
});
test('Final Cutter fires its beam and Stone holds with armor in a real browser match', async ({ page }) => {
  test.setTimeout(60_000); await ready(page);
  await page.keyboard.down('KeyW'); await page.keyboard.press('KeyL'); await page.keyboard.up('KeyW');
  await frames(page, 70);
  const cut = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(cut?.projectiles.some((p) => p.kind === 'cutter') || cut?.fighters[0].special?.phase === 'end' || cut?.fighters[0].special === null).toBe(true);
  await frames(page, 60);
  await page.keyboard.down('KeyS'); await page.keyboard.press('KeyL'); await page.keyboard.up('KeyS'); await frames(page, 34);
  const stone = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(stone?.special).toEqual({ direction: 'down', phase: 'loop' }); expect(stone?.animation).toBe('SpecialLw');
});
test('swallows Mario and fires his fireball with the copied ability and hat', async ({ page }) => {
  test.setTimeout(60_000); await ready(page);
  await page.keyboard.press('ArrowDown'); await frames(page, 90); // Mario (seat 1, P2 keys) drops beside Kirby
  await page.keyboard.down('KeyL'); await frames(page, 45); await page.keyboard.up('KeyL');
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('EatWait');
  await page.keyboard.down('KeyS'); await frames(page, 4); await page.keyboard.up('KeyS'); await frames(page, 40);
  const copied = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(copied?.copyAbility).toBe('Mr'); expect(copied?.holding).toBeNull();
  await expect(page.locator('#combat-0')).toHaveText('COPY · MARIO');
  await page.keyboard.press('KeyL'); await frames(page, 30);
  const after = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(after?.projectiles.some((p) => p.kind === 'fireball' && p.owner === 0) || after?.fighters[1].percent! > 8).toBe(true);
});
test('chains five air jumps from the keyboard', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Space'); await frames(page, 6);
  for (let jump = 0; jump < 5; jump++) { await frames(page, 30); await page.keyboard.press('Space'); await frames(page, 2); }
  const f = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]);
  expect(f?.jumpsUsed).toBe(6);
});
test('supports Kirby mirrors and switching back to Fox and Mario without stale attributes', async ({ page }) => {
  test.setTimeout(60_000); await ready(page, 'Kb', false);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.every((f) => f.kind === 'Kb'))).toBe(true);
  await openPauseMenu(page);await page.locator('#change-fighters').click(); await expect(page.locator('#seat-kind-0')).toBeVisible();
  await chooseFighter(page, 0, 'Fx'); await chooseFighter(page, 1, 'Mr');
  await startBattle(page); await playing(page);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map((f) => f.kind))).toEqual(['Fx', 'Mr']);
  await expect(page.locator('#fighter-name-0')).toHaveText('FOX'); await expect(page.locator('#fighter-name-1')).toHaveText('MARIO');
});
test('streams only Kirby base resources and the Fox/Mario copy archives, never other copy files', async ({ request }) => {
  const manifest = await (await request.get('/api/source')).json(); expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for (const path of ['PlKb.dat', 'PlKbNr.dat', 'EfKbData.dat', 'audio/us/kirby.ssm', 'PlKbCpFx.dat', 'PlKbCpMr.dat']) expect((await request.get(`/api/assets/${encodeURIComponent(path)}`, { headers: { Range: 'bytes=0-15' } })).status()).toBe(206);
  for (const path of ['PlKbCpKp.dat', 'PlKbNrCpDk.dat', 'PlKbYe.dat', 'EfKbFx.dat', 'EfKbMr.dat', 'audio/us/kirbytm.ssm']) expect((await request.get(`/api/assets/${encodeURIComponent(path)}`)).status()).toBe(404);
});
