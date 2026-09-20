import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openSolo, goToStage } from './helpers/battle.ts';

const frames = (page: Page, n: number) => page.clock.runFor(n * 17);
async function capture(page: Page, name: string) {
  const dir = process.env.SMASH_SERVER_ARTIFACT_DIR;
  if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: join(dir, `onett-${name}.png`) }); }
}
async function ready(page: Page) {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60000 });
  await openSolo(page);
  await goToStage(page);
  await page.locator('[data-stage="onett"]').click();
  await expect(page.locator('[data-stage="onett"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#start-match').click();
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

test('Onett loads with full collision, parked cars and the hazard runtime live', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await ready(page);
  const snapshot = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(snapshot?.stage).toBe('onett');
  expect(snapshot?.stageFloors).toBe(48);
  expect(snapshot?.onett).toMatchObject({ warning: 0, building: 0 });
  expect(snapshot?.onett?.cars).toHaveLength(2);
  // Rest pose: both machines parked and hidden, street empty.
  for (const car of snapshot!.onett!.cars) expect(car.visible).toBe(false);
  await expect(page.locator('#onett-warning')).toBeHidden();
  await capture(page, 'rest');
  expect(errors).toEqual([]);
});

test('Onett warns, shows and drives the hazard car through the street', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await ready(page);
  // First crossing clears its 450+400 waits, then the nose hits x = 580 and
  // the 60-frame banner goes up (un_802FD604(yakumono_param->x60)). Drive the
  // fake clock; the match only advances while it runs.
  let warning = 0;
  for (let i = 0; i < 12 && warning === 0; i++) {
    await frames(page, 300);
    warning = await page.evaluate(() => window.smashMatchSnapshot?.()?.onett?.warning ?? 0);
  }
  expect(warning).toBeGreaterThan(0);
  await expect(page.locator('#onett-warning')).toBeVisible();
  const crossing = await page.evaluate(() => window.smashMatchSnapshot?.()?.onett);
  expect(crossing?.cars?.some(car => car.visible)).toBe(true);
  await capture(page, 'warning');
  for (let i = 0; i < 4 && warning !== 0; i++) {
    await frames(page, 100);
    warning = await page.evaluate(() => window.smashMatchSnapshot?.()?.onett?.warning ?? -1);
  }
  expect(warning).toBe(0);
  await expect(page.locator('#onett-warning')).toBeHidden();
  expect(errors).toEqual([]);
});
