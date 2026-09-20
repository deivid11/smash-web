import { test, expect, type Page } from '@playwright/test';
import { openSolo, goToStage } from './helpers/battle.ts';

async function infectedCount(page: Page): Promise<number> {
  return page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.filter(fighter => fighter.infected).length ?? -1);
}

/** Zombies infection (local solo): a lost last stock joins the horde with a
 * permanent stock instead of ending the match, flagged on the HUD. P1 walks
 * off Battlefield at one stock; whoever falls first proves the rule. */
test('last-stock KO infects instead of ending the match', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await openSolo(page);
  await page.locator('#setup-match-type').selectOption('zombies');
  await expect(page.locator('.battle-rule-title')).toContainText('ZOMBIES');
  await page.locator('#setup-stocks').selectOption('1');
  await expect(page.locator('#setup-teams')).toBeDisabled();
  await goToStage(page, 'battlefield');
  await page.locator('#start-match').click();
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 45_000 }).toBe('playing');
  await expect(page.locator('#mode-label')).toContainText('ZOMBIES');
  // Walk off the side: the first blast KO must infect, never eliminate.
  await page.keyboard.down('KeyD');
  try {
    await expect.poll(() => infectedCount(page), { timeout: 90_000 }).toBe(1);
  } finally {
    await page.keyboard.up('KeyD');
  }
  // A versus match would have ended on that KO; the horde plays on.
  expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.phase)).toBe('playing');
  await expect(page.locator('.zombie-badge')).toHaveCount(1);
  await expect(page.locator('.fighter-card', { has: page.locator('.zombie-badge') }).locator('.stock-dots')).toContainText('∞');
  expect(errors).toEqual([]);
});
