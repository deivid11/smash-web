import { test, expect, type Page } from '@playwright/test';

// Normal stock battles can run RED VS BLUE: teammates share a side,
// direct strikes and grabs never connect between them, and the surviving
// side takes the match.
test.describe.configure({ mode: 'default', timeout: 120_000 });

async function ready(page: Page): Promise<void> {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
}

test('stock draft offers teams without hill zones', async ({ page }) => {
  await ready(page);
  await page.locator('#mode-solo').click();
  await expect(page.locator('#setup-teams')).toBeVisible();
  await expect(page.locator('#setup-stocks')).toBeVisible();
  await expect(page.locator('#setup-hill-zones')).toHaveCount(0);
  await page.locator('#setup-teams').selectOption('teams');
  await expect(page.locator('.battle-rule-title')).toContainText('TEAMS');
});

test('stock teams match shows sides and team victory rules', async ({ page }) => {
  await ready(page);
  await page.locator('#mode-solo').click();
  await page.locator('#setup-teams').selectOption('teams');
  await page.locator('#go-stage').click();
  await expect(page.locator('[data-stage="battlefield"]')).toBeVisible();
  await page.locator('#start-match').click();
  await expect(page.locator('#team-dot-0')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#team-dot-1')).toBeVisible();
  await expect(page.locator('#mode-label')).toContainText('STOCK TEAMS');
  // No hill scoreboard in a stock battle, stocks still count down from full.
  await expect(page.locator('#hill-hud')).toHaveCount(0);
  await expect(page.locator('#stocks-0')).not.toContainText('∞');
  const mode = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(mode?.phase).not.toBe('ready');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: test.info().outputPath('stock-teams.png') });
});
