import { test, expect } from '@playwright/test';
import { openLan } from './helpers/battle.ts';

/** Room browser: discover and join an open lobby without typing its code.
 * Transport-only lobby check with real game builds; no match is started. */
test('room browser lists open lobbies and joins without typing a code', async ({ browser, baseURL }) => {
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [host, guest] = pages as [import('@playwright/test').Page, import('@playwright/test').Page];
  try {
    for (const [slot, page] of pages.entries()) {
      await page.goto('/play.html');
      await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
      await openLan(page);
      await page.locator('#player-name').fill(slot === 0 ? 'Browser host' : 'Browser guest');
    }
    await expect(guest!.locator('#room-browser')).toBeVisible();
    await host!.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect
      .poll(async () => host!.evaluate(() => window.smashNetworkSnapshot?.()?.room?.code), { timeout: 15_000 })
      .toMatch(/^[A-Z2-9]{6}$/u);
    const code = (await host!.evaluate(() => window.smashNetworkSnapshot?.()?.room?.code))!;
    await expect(host!.locator('#active-room-code')).toHaveText(code);
    // The guest discovers the room through the browser list, never the code field.
    await expect
      .poll(async () => guest!.locator(`#room-browser [data-room="${code}"]`).count(), { timeout: 20_000 })
      .toBe(1);
    await guest!.locator(`#join-room-${code}`).click();
    await expect
      .poll(async () => guest!.evaluate(() => window.smashNetworkSnapshot?.()?.room?.code), { timeout: 15_000 })
      .toBe(code);
    await expect
      .poll(async () => host!.evaluate(() => window.smashNetworkSnapshot?.()?.room?.players.length), { timeout: 15_000 })
      .toBe(2);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
