import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openPauseMenu, openSolo, goToStage } from './helpers/battle.ts';

// One boot, then a real stock match on each of the fourteen imported stages.
// Proves model + collision + music + spawn wiring end to end; per-stage
// screenshots land in the test output for visual review (e.g. no Randall
// cloud parked on Yoshi's Story).
test.describe.configure({ mode: 'default', timeout: 600_000 });

const STAGES = [
  'yoshi-story', 'dream-land', 'peach-castle', 'onett', 'mute-city',
  'yoshi-island', 'green-greens', 'venom', 'jungle-japes', 'fourside',
  'brinstar', 'kongo-jungle', 'fountain-of-dreams', 'mushroom-kingdom',
] as const;

async function shot(page: Page, label: string): Promise<void> {
  const directory = process.env.SMASH_BROWSER_ARTIFACT_DIR ?? test.info().outputPath('screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${label}.png`), fullPage: false });
}

test('all fourteen imported stages start real matches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 180_000 });
  await openSolo(page);
  for (const [index, stage] of STAGES.entries()) {
    if (index > 0) {
      await openPauseMenu(page);await page.locator('#change-fighters').click();
      await expect(page.locator('#seat-kind-0')).toBeVisible();
    }
    await goToStage(page);
    await page.locator(`[data-stage="${stage}"]`).click();
    await expect(page.locator(`[data-stage="${stage}"]`)).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#start-match').click();
    await expect
      .poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 30_000 })
      .toBe('playing');
    const match = await page.evaluate(() => window.smashMatchSnapshot?.());
    expect(match?.stage).toBe(stage);
    expect(match?.stageFloors).toBeGreaterThan(0);
    await shot(page, `stage-${stage}`);
  }
  expect(errors).toEqual([]);
});
