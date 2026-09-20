import { test, expect, type Page } from '@playwright/test';

// King of the Hill enters through its own mode button with Hyrule Temple
// preselected, infinite lives, and zones A+B scoring on the clock.
test.describe.configure({ mode: 'default', timeout: 120_000 });

async function ready(page: Page): Promise<void> {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
}

async function enterHill(page: Page): Promise<void> {
  await page.locator('#mode-hill').click();
  await expect(page.locator('#setup-match-type')).toHaveValue('hill');
}

async function startHillMatch(page: Page): Promise<void> {
  await page.locator('#go-stage').click();
  await expect(page.locator('[data-stage="temple"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#start-match').click();
  await expect(page.locator('#hill-hud')).toBeVisible({ timeout: 30_000 });
}

test('hill draft preselects temple with zones and infinite lives', async ({ page }) => {
  await ready(page);
  await enterHill(page);
  await expect(page.locator('#setup-hill-zones')).toBeVisible();
  await expect(page.locator('#setup-teams')).toBeVisible();
  await expect(page.locator('#setup-stocks')).toHaveCount(0);
  await expect(page.locator('#setup-hill-lives')).toContainText('∞ LIVES');
});

test('hill match on temple scores zones A+B with respawns', async ({ page }) => {
  await ready(page);
  await enterHill(page);
  await startHillMatch(page);
  await expect(page.locator('#hill-zone-A')).toBeVisible();
  await expect(page.locator('#hill-zone-B')).toBeVisible();
  await expect(page.locator('#stocks-0')).toContainText('∞');
  await expect(page.locator('#mode-label')).toContainText('KOTH');
  const hill = await page.evaluate(() => window.smashMatchSnapshot?.()?.hill);
  expect(hill).not.toBeNull();
  expect(hill?.zones.map((zone: { id: string }) => zone.id)).toEqual(['A', 'B']);
  expect(hill?.points).toHaveLength(2);
  expect(hill?.relocateIn).toBeGreaterThan(0);
});

test('hill teams score RED against BLUE', async ({ page }) => {
  await ready(page);
  await enterHill(page);
  await page.locator('#setup-teams').selectOption('teams');
  await startHillMatch(page);
  await expect(page.locator('#hill-teams')).toContainText('RED');
  await expect(page.locator('#hill-teams')).toContainText('BLUE');
  await expect(page.locator('#mode-label')).toContainText('RED VS BLUE');
  const hill = await page.evaluate(() => window.smashMatchSnapshot?.()?.hill);
  expect(hill?.teams).toBe(true);
  expect(hill?.teamPoints).toHaveLength(2);
});
