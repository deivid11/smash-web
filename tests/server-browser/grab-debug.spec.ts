import { test, expect, type Page } from '@playwright/test';
import { openSolo, chooseFighter, setSeat, startBattle } from './helpers/battle.ts';
const frames = (page: Page, count: number) => page.clock.runFor(count * 17);

async function ready(page: Page, kind: 'Lk' | 'Cl' | 'Mr') {
  await page.clock.install(); await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await openSolo(page); await chooseFighter(page, 0, kind); await setSeat(page, 1, 'human', 'Mr');
  await startBattle(page, 'final'); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

for (const kind of ['Lk', 'Cl', 'Mr'] as const) test(`${kind} standing grab actually catches an adjacent Mario`, async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, kind);
  // Walk P1 toward P2 until close, then grab.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.down('KeyD'); await frames(page, 5); await page.keyboard.up('KeyD'); await frames(page, 1);
    const gap = await page.evaluate(() => { const s = window.smashMatchSnapshot?.(); return s ? Math.abs(s.fighters[1].x - s.fighters[0].x) : 999; });
    if (gap < 12) break;
  }
  await frames(page, 20);
  await page.keyboard.down('KeyI'); await frames(page, 2); await page.keyboard.up('KeyI');
  let grabbedBy: number | null = null;
  for (let i = 0; i < 40 && grabbedBy === null; i++) {
    await frames(page, 1);
    grabbedBy = await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[1].grabbedBy ?? null);
  }
  expect(errors).toEqual([]);
  expect(grabbedBy).toBe(0);
});

for (const kind of ['Lk', 'Cl'] as const) test(`${kind} throws the held bomb downward with down+attack in the air`, async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, kind);
  // Pull a bomb on the ground.
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyL'); await frames(page, 2);
  await page.keyboard.up('KeyL'); await page.keyboard.up('KeyS'); await frames(page, 42);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.filter(p => p.kind === 'link-bomb').length)).toBe(1);
  // Jump, then press down+attack while airborne.
  await page.keyboard.down('Space'); await frames(page, 10); await page.keyboard.up('Space'); await frames(page, 3);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].grounded)).toBe(false);
  await page.keyboard.down('KeyS'); await page.keyboard.down('KeyJ'); await frames(page, 3);
  await page.keyboard.up('KeyJ'); await page.keyboard.up('KeyS');
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0].animation)).toMatch(/^LightThrowAirLw/);
  let vy = 0;
  for (let i = 0; i < 30 && vy >= 0; i++) {
    await frames(page, 1);
    vy = await page.evaluate(() => window.smashMatchSnapshot?.()?.projectiles.find(p => p.kind === 'link-bomb')?.vy ?? 0);
  }
  expect(vy).toBeLessThan(0);
  expect(errors).toEqual([]);
});
