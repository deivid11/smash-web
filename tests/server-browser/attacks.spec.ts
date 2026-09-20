import { test, expect, type Page } from '@playwright/test';
import { openSolo, setSeat, startBattle } from './helpers/battle.ts';

async function ready(page: Page) {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 30000 });
  await openSolo(page); await setSeat(page, 1, 'human'); await startBattle(page);
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
const tick = (page: Page, frames: number) => page.clock.runFor(frames * 17);

for (const [slot, key, expected] of [[0, 'KeyJ', 'Attack100Loop'], [1, 'KeyN', 'Attack13']] as const) {
  test(`repeated normal input advances ${slot === 0 ? 'Fox' : 'Mario'} jab chains`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await ready(page);
    let requests = 0; page.on('request', r => { if (r.url().includes('/api/')) requests++; });
    const names = new Set<string>();
    for (let i = 0; i < (slot === 0 ? 18 : 5); i++) {
      await page.keyboard.down(key); await tick(page, 2); await page.keyboard.up(key); await tick(page, 2);
      names.add((await page.evaluate(slot => window.smashMatchSnapshot?.()?.fighters[slot]?.animation, slot))!);
    }
    expect(names.has('Attack11')).toBe(true); expect(names.has('Attack12')).toBe(true); expect(names.has(expected)).toBe(true);
    await tick(page, 70);
    expect(await page.evaluate(slot => window.smashMatchSnapshot?.()?.fighters[slot]?.animation, slot)).toBe('Wait1');
    expect(errors).toEqual([]); expect(requests).toBe(0);
  });
}

test('down+quick and down+strong select low attacks without dropping during the attack', async ({ page }) => {
  await ready(page);
  await page.keyboard.down('ArrowDown'); await page.keyboard.down('KeyN'); await tick(page, 3);
  const low = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[1]);
  expect(low?.animation).toBe('AttackLw3'); expect(low?.grounded).toBe(true);
  await page.keyboard.up('KeyN'); await tick(page, 42);
  await page.keyboard.down('KeyM'); await tick(page, 3);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[1].animation)).toBe('AttackLw4');
});

test('down+quick in the air plays the down aerial and original landing animation', async ({ page }) => {
  await ready(page); await page.keyboard.down('Space'); await tick(page, 10); await page.keyboard.up('Space');
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyJ'); await tick(page, 3); await page.keyboard.up('KeyJ');
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toBe('AttackAirLw');
  let landed = false;
  for (let i = 0; i < 50; i++) { await tick(page, 1); if (await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation === 'LandingAirLw')) { landed = true; break; } }
  expect(landed).toBe(true);
});
