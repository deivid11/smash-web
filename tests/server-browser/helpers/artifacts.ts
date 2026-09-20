import { test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Read-only diagnostics; never alter simulation state to manufacture a capture. */
export async function captureBattle(page: Page, label: string): Promise<void> {
  const root = process.env.SMASH_BROWSER_ARTIFACT_DIR ?? test.info().outputPath('screenshots');
  const directory = join(root, test.info().title.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 110));
  await mkdir(directory, { recursive: true });
  const snapshot = await page.evaluate(() => ({
    match: window.smashMatchSnapshot?.(), network: window.smashNetworkSnapshot?.(),
    setup: window.smashSetupSnapshot?.(), app: document.querySelector('.game-app')?.className,
    status: document.querySelector('#load-progress')?.textContent,
    roomError: document.querySelector('.room-error')?.textContent,
    viewport: { width: innerWidth, height: innerHeight },
    seats: [...document.querySelectorAll('.player-seat')].map(seat => ({ id: seat.getAttribute('data-seat-id'), control: seat.getAttribute('data-control'), text: seat.textContent })),
  }));
  await writeFile(join(directory, `${label}.json`), JSON.stringify(snapshot, null, 2));
  await page.screenshot({ path: join(directory, `${label}.png`), fullPage: false, timeout: 15_000 });
}
