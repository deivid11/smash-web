import { test, expect, type Page } from '@playwright/test';
import { confirmedConsensus, createAndJoin, network, withLanPeers } from './helpers/online.ts';
import { goToStage, backToCharacters } from './helpers/battle.ts';

// Two software-rendered browsers plus a full reload and replay of a real match.
test.describe.configure({ mode: 'default', timeout: 240_000 });

declare global { interface Window { __roomSockets?: WebSocket[] } }

/** Records the page's room sockets so the test can cut one the way a flaky network would. */
async function trackSockets(page: Page): Promise<void> {
  await page.evaluate(() => {
    const Native = window.WebSocket; window.__roomSockets = [];
    window.WebSocket = class extends Native { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); window.__roomSockets!.push(this); } } as typeof WebSocket;
  });
}
async function startMatch(pages: Page[]): Promise<void> {
  const host = pages[0]!;
  await goToStage(host, 'final'); await backToCharacters(host);
  for (const page of pages) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  for (const page of pages) await expect.poll(async () => (await network(page))?.room?.players.every(player => player.ready), { timeout: 120_000 }).toBe(true);
  await goToStage(host); await host.locator('#start-match').click();
  for (const page of pages) {
    await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 45_000 }).toBe('playing');
    await expect.poll(async () => (await network(page))?.confirmedFrame ?? -1, { timeout: 30_000 }).toBeGreaterThan(120);
  }
}

test('a dropped socket reconnects into the running match and a reloaded browser replays its way back', async ({ browser, baseURL }) => {
  await withLanPeers(browser, baseURL, 2, async pages => {
    const [host, guest] = pages as [Page, Page];
    const clientLog: string[] = [];
    try { await scenario(pages, host, guest, clientLog); }
    catch (error) {
      // The shared helper keeps no per-peer state on failure: say exactly where each simulation stood.
      for (const [index, page] of pages.entries()) console.log(`peer ${index + 1}:`, JSON.stringify(await network(page).catch(() => null)), await page.locator('#network-notice').textContent().catch(() => null));
      console.log(clientLog.join('\n')); throw error;
    }
  });
});

async function scenario(pages: Page[], host: Page, guest: Page, clientLog: string[]): Promise<void> {
  {
    for (const [index, page] of pages.entries()) page.on('console', message => { if (/room|relay|resume|reconnect/iu.test(message.text())) clientLog.push(`P${index + 1} console: ${message.text()}`); });
    await trackSockets(guest);
    await createAndJoin(pages); await startMatch(pages);
    const before = await confirmedConsensus(pages);
    expect((await network(host))?.inputDelay).toBeGreaterThanOrEqual(1);

    // 1) Transient drop: the page survives, only its socket dies.
    await guest.evaluate(() => window.__roomSockets?.at(-1)?.close());
    await expect.poll(async () => (await network(host))?.room?.players.find(player => player.slot === 1)?.connected, { timeout: 10_000 }).not.toBe(false);
    const afterDrop = await confirmedConsensus(pages, before + 60);
    for (const page of pages) { const snapshot = await network(page); expect(snapshot?.lastEnd).toBeNull(); expect(snapshot?.room?.phase).toBe('playing'); }

    // 2) Browser restart: a full reload loses the whole simulation. The held seat, the stored
    // credential and the relay's input log bring it back to the same confirmed state.
    await guest.reload();
    await expect(host.locator('#network-notice')).toContainText(/Waiting for Browser 2/u, { timeout: 15_000 });
    await expect(guest.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 90_000 });
    await expect.poll(() => guest.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 90_000 }).toBe('playing');
    await expect.poll(async () => (await network(guest))?.catchUp ?? null, { timeout: 90_000 }).toBeNull();
    const afterReload = await confirmedConsensus(pages, afterDrop + 60);
    expect(afterReload).toBeGreaterThan(afterDrop);
    await expect(host.locator('#network-notice')).toHaveCount(0);
    for (const page of pages) { const snapshot = await network(page); expect(snapshot?.lastEnd).toBeNull(); expect(snapshot?.error).toBe(''); expect(snapshot?.room?.phase).toBe('playing'); }
  }
}
