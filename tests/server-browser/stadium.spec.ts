import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openSolo, chooseFighter, setSeat, startBattle, goToStage } from './helpers/battle.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
const frames = (page: Page, n: number) => page.clock.runFor(n * 17);
async function capture(page: Page, name: string) { const dir = process.env.SMASH_SERVER_ARTIFACT_DIR; if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `stadium-${name}.png`) }); } }
async function ready(page: Page) {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page); await chooseFighter(page, 0, 'Fx'); await setSeat(page, 1, 'human', 'Mr');
  await startBattle(page, 'stadium'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
test('Stadium loads in normal form with the original transformation clock running', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  const snapshot = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(snapshot?.stage).toBe('stadium');
  expect(snapshot?.stageFloors).toBe(7);
  expect(snapshot?.stadium).toMatchObject({ form: 'normal', phase: 'wait' });
  expect(snapshot!.stadium!.timer).toBeGreaterThan(3000);
  for (const fighter of snapshot!.fighters) expect(fighter.grounded).toBe(true);
  await frames(page, 30);
  const later = await page.evaluate(() => window.smashMatchSnapshot?.()?.stadium);
  expect(later!.timer).toBeLessThan(snapshot!.stadium!.timer);
  await capture(page, 'normal');
  expect(errors).toEqual([]);
});
test('Stadium transforms in the browser: terrain, collision and fighters survive', async ({ page }) => {
  test.setTimeout(360_000); // rides the full original wait window under SwiftShader
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page); let reads = 0; page.on('request', r => { if (r.url().includes('/api/assets/')) reads++; });
  // Park both fighters inside x ∈ [15, 50]: that band keeps ground in every form.
  // The left side legitimately opens a pit in the fire form — idling there SHOULD cost a stock.
  const x = async (slot: number) => (await page.evaluate(s => window.smashMatchSnapshot?.()?.fighters[s]?.x, slot))!;
  for (const [slot, right, left] of [[0, 'KeyD', 'KeyA'], [1, 'ArrowRight', 'ArrowLeft']] as const) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const at = await x(slot);
      if (at >= 15 && at <= 50) break;
      const key = at < 15 ? right : left;
      await page.keyboard.down(key); await frames(page, 8); await page.keyboard.up(key); await frames(page, 4);
    }
    expect(await x(slot)).toBeGreaterThanOrEqual(12);
    expect(await x(slot)).toBeLessThanOrEqual(55);
  }
  await frames(page, 30);
  const start = await page.evaluate(() => window.smashMatchSnapshot?.()?.stadium);
  // Run to just past the warn+shrink+pause boundary of the authoritative clock.
  const distance = start!.timer + 300 + 120 + 60 + 30;
  for (let advanced = 0; advanced < distance; advanced += 600) await frames(page, Math.min(600, distance - advanced));
  const snapshot = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(snapshot?.stadium?.form).not.toBe('normal');
  expect(snapshot?.stageFloors).toBeGreaterThan(7);
  await frames(page, 150);
  const settled = await page.evaluate(() => window.smashMatchSnapshot?.());
  for (const fighter of settled!.fighters) { expect(fighter.stocks).toBe(3); expect(fighter.grounded).toBe(true); }
  await capture(page, `variant-${snapshot!.stadium!.form}`);
  expect(reads).toBe(0); expect(errors).toEqual([]);
});
test('Stadium stage preview renders and the card is enabled for eight seats', async ({ page }) => {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page);
  for (const seat of [1, 2, 3, 4, 5, 6, 7]) await setSeat(page, seat, 'cpu');
  await goToStage(page);
  await expect(page.locator('[data-stage="stadium"] img')).toBeVisible();
  await expect(page.locator('[data-stage="stadium"]')).toBeEnabled();
  await capture(page, 'select');
});
test('Stadium asset transport exposes exactly the five archives and its music', async ({ request }) => {
  const manifest = await (await request.get('/api/source')).json(); expect(manifest.files).toHaveLength(SERVER_ASSETS.length);
  for (const name of ['GrPs.dat', 'GrPs1.dat', 'GrPs2.dat', 'GrPs3.dat', 'GrPs4.dat', 'audio/pokesta.hps']) expect((await request.get(`/api/assets/${encodeURIComponent(name)}`, { headers: { Range: 'bytes=0-15' } })).status()).toBe(206);
  for (const name of ['GrPs.usd', 'GrPu.dat', 'audio/pokemon.hps', 'audio/pstadium.hps', 'main.dol']) expect((await request.get(`/api/assets/${encodeURIComponent(name)}`)).status()).toBe(404);
});
