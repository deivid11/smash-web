import { test, expect } from '@playwright/test';
import { openLan, goToStage } from './helpers/battle.ts';

/** Host stage follow + per-player readiness on the stage screen.
 * When the host picks a stage, every browser still on setup screens moves to
 * the stage screen, which lists each player as Ready / Not ready. */
test('host stage pick moves all screens and shows per-player readiness', async ({ browser, baseURL }) => {
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [host, guest] = pages as [import('@playwright/test').Page, import('@playwright/test').Page];
  try {
    for (const [slot, page] of pages.entries()) {
      await page.goto('/play.html');
      await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
      await openLan(page);
      await page.locator('#player-name').fill(slot === 0 ? 'Stage host' : 'Stage guest');
    }
    await host!.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect
      .poll(async () => host!.evaluate(() => window.smashNetworkSnapshot?.()?.room?.code), { timeout: 15_000 })
      .toMatch(/^[A-Z2-9]{6}$/u);
    const code = (await host!.evaluate(() => window.smashNetworkSnapshot?.()?.room?.code))!;
    await guest!.locator('#room-code').fill(code);
    await guest!.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect
      .poll(async () => guest!.evaluate(() => window.smashNetworkSnapshot?.()?.room?.code), { timeout: 15_000 })
      .toBe(code);
    for (const page of pages) {
      await expect.poll(async () => page.evaluate(() => window.smashNetworkSnapshot?.()?.room?.players.length), { timeout: 15_000 }).toBe(2);
      await expect(page.locator('#go-stage')).toBeVisible();
    }
    // Host goes to the stage screen and picks; the guest follows untouched.
    await goToStage(host!, 'final');
    await expect
      .poll(async () => guest!.locator('[data-stage="battlefield"]').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect(guest!.locator('[data-stage="final"]')).toHaveAttribute('aria-pressed', 'true');
    // Both stage screens list every player with live readiness.
    for (const page of pages) {
      await expect(page.locator('#stage-ready-0')).toContainText('Stage host');
      await expect(page.locator('#stage-ready-0')).toContainText('Not ready');
      await expect(page.locator('#stage-ready-1')).toContainText('Stage guest');
      await expect(page.locator('#stage-ready-1')).toContainText('Not ready');
    }
    await guest!.getByRole('button', { name: 'Ready', exact: true }).click();
    await expect(host!.locator('#stage-ready-1')).toContainText('Ready', { timeout: 15_000 });
    await expect(guest!.locator('#stage-ready-1')).toContainText('Ready');
    await expect(guest!.locator('#stage-ready-0')).toContainText('Not ready');
    await host!.getByRole('button', { name: 'Ready', exact: true }).click();
    for (const page of pages) {
      await expect(page.locator('#stage-ready-0')).toContainText('Ready', { timeout: 15_000 });
      await expect(page.locator('#stage-ready-1')).toContainText('Ready');
    }
    await expect(host!.locator('#start-match')).toBeEnabled();
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
