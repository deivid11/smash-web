import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { openLan } from './battle.ts';
import { captureBattle } from './artifacts.ts';

export type NetworkSnapshot = ReturnType<NonNullable<Window['smashNetworkSnapshot']>>;
export const network = (page: Page): Promise<NetworkSnapshot | null> => page.evaluate(() => window.smashNetworkSnapshot?.() ?? null);

/** Independent browser contexts: never emulate peers with shared match memory. */
export async function withLanPeers(browser: Browser, baseURL: string | undefined, count: number, run: (pages: Page[]) => Promise<void>): Promise<void> {
  if (!baseURL) throw new Error('The real-ISO server browser base URL must be configured.');
  const contexts: BrowserContext[] = [], pages: Page[] = [], errors: string[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const context = await browser.newContext({ baseURL, viewport: { width: 900, height: 700 } });
      contexts.push(context);
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(`P${index + 1}: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') errors.push(`P${index + 1}: ${message.text()}`); });
      await page.goto('/play.html');
      await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
      await openLan(page);
      await page.locator('#player-name').fill(`Browser ${index + 1}`);
      expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    }
    expect(new Set(pages.map(page => page.context())).size).toBe(count);
    await run(pages);
    expect(errors).toEqual([]);
  } catch (error) {
    for (const [index, page] of pages.entries()) {
      if (page.isClosed()) continue;
      await test.info().attach(`mixed-peer-${index + 1}`, {
        contentType: 'application/json', body: Buffer.from(JSON.stringify({ errors, network: await network(page), match: await page.evaluate(() => window.smashMatchSnapshot?.()) }, null, 2)),
      }).catch(() => {});
      await captureBattle(page, `failure-peer-${index + 1}`).catch(() => {});
    }
    throw error;
  } finally { await Promise.all(contexts.map(context => context.close())); }
}

export async function createAndJoin(pages: Page[]): Promise<string> {
  const host = pages[0]!;
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect.poll(async () => (await network(host))?.room?.code).toMatch(/^[A-Z2-9]{6}$/u);
  const code = (await network(host))!.room!.code;
  for (const page of pages.slice(1)) {
    await page.locator('#room-code').fill(code);
    await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect.poll(async () => (await network(page))?.room?.code).toBe(code);
  }
  for (const [slot, page] of pages.entries()) {
    await expect.poll(async () => (await network(page))?.room?.players.length).toBe(pages.length);
    expect((await network(page))?.slot).toBe(slot);
    await expect(page.locator('#select-seat-0')).toBeVisible();
  }
  return code;
}

/** Exact common confirmed POST-input-frame checkpoints, not live snapshots
 * sampled at different frames. Same bounds as the all-human integration suite. */
export async function confirmedConsensus(pages: Page[], after = 120): Promise<number> {
  let shared: { frame: number; snapshots: NetworkSnapshot[] } | undefined;
  await expect.poll(async () => {
    const snapshots = (await Promise.all(pages.map(page => network(page)))).filter((snapshot): snapshot is NetworkSnapshot => snapshot !== null);
    if (snapshots.length !== pages.length) return -1;
    const lastReported = Math.min(...snapshots.map(snapshot => snapshot.confirmedFrame));
    const common = snapshots[0]!.confirmedHashes.map(checkpoint => checkpoint.frame).filter(frame => frame > after && frame <= lastReported && snapshots.every(snapshot => snapshot.confirmedHashes.some(checkpoint => checkpoint.frame === frame)));
    if (!common.length) return -1;
    shared = { frame: Math.max(...common), snapshots }; return shared.frame;
  }, { timeout: 30_000, message: 'All independent peers must retain a common confirmed state checkpoint' }).toBeGreaterThan(after);
  const { frame, snapshots } = shared!;
  const hashes = snapshots.map(snapshot => snapshot.confirmedHashes.find(checkpoint => checkpoint.frame === frame)!.hash);
  for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  for (const snapshot of snapshots) {
    expect(snapshot.confirmedFrame).toBeGreaterThanOrEqual(frame);
    expect(snapshot.error).toBe('');
    expect(snapshot.rollbacks).toBeGreaterThanOrEqual(0);
    expect(snapshot.resimulatedFrames).toBeGreaterThanOrEqual(0);
    expect(snapshot.predictionFrames).toBeGreaterThanOrEqual(0);
    expect(snapshot.predictionFrames).toBeLessThanOrEqual(8);
    expect(snapshot.confirmedHashes.length).toBeLessThanOrEqual(8);
  }
  expect(new Set(hashes).size).toBe(1);
  return frame;
}
