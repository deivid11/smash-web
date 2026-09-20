import { test, expect } from '@playwright/test';
import { openSolo, goToStage } from './helpers/battle.ts';

// Mute City's dynamic road (lib/game/mutecity.ts): the scripted area cycle runs
// live in the browser — the first stop adds the surrounding road, the 2273
// flight drops the traveling deck. Polls the match snapshot (no screenshots).
test.describe.configure({ mode: 'default', timeout: 300_000 });

test('mute city road cycles areas and the traveling deck', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 180_000 });
  await openSolo(page);
  // Nine stocks and five minutes: idle fighters may ride the deck off and fall
  // before the flight section arrives; the road must outlast them.
  await page.locator('#setup-stocks').selectOption('9');
  await page.locator('#setup-seconds').selectOption('300');
  await goToStage(page);
  await page.locator('[data-stage="mute-city"]').click();
  await expect(page.locator('[data-stage="mute-city"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#start-match').click();
  await expect
    .poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 30_000 })
    .toBe('playing');
  const road = () => page.evaluate(() => window.smashMatchSnapshot?.()?.muteCity ?? null);
  // Start pad plus the deck slot, deck live.
  await expect.poll(() => road(), { timeout: 15_000 }).toMatchObject({ deck: true });
  // First stop (~877 road frames in): surrounding road enables around the deck.
  await expect
    .poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.muteCity?.areas), { timeout: 40_000 })
    .toEqual([0, 3, 4, 7, 8]);
  // Flight section (~2273 road frames in, delayed by script waits): the deck
  // drops and only the start pad remains. Headless SwiftShader renders well
  // below 60 fps, so wall-clock budgets stay generous.
  await expect
    .poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.muteCity), { timeout: 200_000 })
    .toMatchObject({ areas: [3], deck: false });
  expect(errors).toEqual([]);
});
