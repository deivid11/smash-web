import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';


// Smoke-test Rift Descent against the real server ISO: seeded setup + Mirror,
// starting blessing, descent map, room intro, a started floor with the rogue
// HUD (run panel, pockets, status layer) and the pause build viewer.
// Lifecycle/boon/map/event rules are covered by unit tests in
// tests/unit/roguelike-*.test.ts; this file only proves the web wiring.
test.describe.configure({ mode: 'default', timeout: 180_000 });

test('rift descent opens from the mode screen and starts a seeded floor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The offline service worker is not part of the served asset allowlist.
    if (message.type() === 'error' && !message.text().includes('fetching the script')) errors.push(message.text());
  });
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });

  await page.locator('#mode-rogue').click();
  // Setup is a small screen router (hub → champion · loadout · mirror · rules); no screen scrolls.
  await expect(page.locator('.rogue-screen-hub')).toBeVisible();
  const noScroll = () => page.evaluate(() => { const layer = document.querySelector('.menu-layer:not([hidden])') as HTMLElement | null; return layer ? layer.scrollHeight - layer.clientHeight : 0; });
  expect(await noScroll(), 'rogue hub fits the viewport').toBeLessThanOrEqual(2);
  await expect(page.locator('#rogue-begin')).toBeVisible();

  const shots = process.env.SMASH_BROWSER_ARTIFACT_DIR ?? test.info().outputPath('screenshots');
  await mkdir(shots, { recursive: true });
  await page.locator('#rogue-locale-es').click();
  await expect(page.locator('#rogue-begin')).toContainText('ENTRAR');
  await page.screenshot({ path: join(shots, 'rogue-setup-es.png'), fullPage: false });
  await page.locator('#rogue-locale-en').click();
  await expect(page.locator('#rogue-begin')).toContainText('ENTER');

  // The Mirror of the Rift is its own screen with its talents; Escape returns to the hub.
  await page.locator('#rogue-mirror-open').click();
  await expect(page.locator('.rogue-mirror-talent')).toHaveCount(8);
  expect(await noScroll(), 'mirror fits the viewport').toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rogue-screen-hub')).toBeVisible();

  // Permanent unlocks: champion mastery + aspects, relic vault with one starter equipped.
  await page.locator('#rogue-loadout-open').click();
  await expect(page.locator('.rogue-loadout')).toBeVisible();
  await expect(page.locator('.rogue-relic')).toHaveCount(13);
  await expect(page.locator('.rogue-aspect')).toHaveCount(4);
  await page.locator('#rogue-relic-lucky-coin').click();
  await expect(page.locator('#rogue-relic-lucky-coin')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rogue-relic-slots')).toContainText('1/1');
  await page.locator('.rogue-back').click();

  // Descent rules: seed, wrath, heat and the act-1 map preview.
  await page.locator('#rogue-rules-open').click();
  await page.locator('#rogue-seed').fill('RIFT-SMOKE');
  await expect(page.locator('#rogue-heat-value')).toHaveText('0');
  await expect(page.locator('.rogue-tower .rogue-actmap')).toBeVisible();
  await page.locator('.rogue-back').click();

  // Champion: the whole roster on one screen; tiles enable as the background download lands.
  await page.locator('#rogue-champion-open').click();
  expect(await page.locator('.rogue-roster-tile').count()).toBeGreaterThan(3);
  await expect(page.locator('[data-fighter="Kb"]')).toBeEnabled({ timeout: 90_000 });
  await page.locator('[data-fighter="Kb"]').click();
  await expect(page.locator('[data-fighter="Kb"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await noScroll(), 'champion select fits the viewport').toBeLessThanOrEqual(2);
  await page.locator('#rogue-fighter-confirm').click();
  await expect(page.locator('#rogue-champion-open')).toContainText('KIRBY');
  await page.screenshot({ path: join(shots, 'rogue-setup.png'), fullPage: false });
  await page.locator('#rogue-begin').click();

  // Starting blessing (Slay the Spire's Neow): three choices.
  await expect(page.locator('.rogue-blessing-card')).toHaveCount(3);
  await page.screenshot({ path: join(shots, 'rogue-blessing.png'), fullPage: false });
  await page.locator('.rogue-blessing-card').first().click();

  // Descent map: the whole first row is reachable.
  await expect(page.locator('.rogue-map-panel')).toBeVisible();
  await expect(page.locator('.rogue-node.reachable')).toHaveCount(3);
  await page.screenshot({ path: join(shots, 'rogue-map.png'), fullPage: false });
  await page.locator('#rogue-enter').click();

  await expect(page.locator('#rogue-fight')).toBeVisible();
  await page.locator('#rogue-fight').click();

  // A deferred start (fighter/stage download) shows the preparing panel first.
  await expect(page.locator('.rogue-run-hud')).toBeVisible({ timeout: 90_000 });
  await expect
    .poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 30_000 })
    .toMatch(/countdown|playing/);
  // The in-fight overlay is one small run chip; the full run lives on the pause RUN view.
  await expect(page.locator('.rogue-run-hud')).toContainText('1/50');
  const chip = await page.locator('.rogue-run-hud').boundingBox();
  expect(chip!.height, 'run chip stays small').toBeLessThan(40);
  await expect(page.locator('.rogue-pockets')).toHaveCount(1);
  await expect(page.locator('.rogue-fx-layer')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 30_000 })
    .toBe('playing');

  // Pause stays the Melee-style camera pause with a RUN · BUILD pill; the
  // pill (or I) opens the full-screen run view, Esc returns to the pause.
  await page.keyboard.press('Escape');
  await expect(page.locator('#rogue-run-open')).toBeVisible();
  await expect(page.locator('#rogue-run-screen')).toHaveCount(0);
  await page.locator('#rogue-run-open').click();
  await expect(page.locator('#rogue-run-screen')).toBeVisible();
  await expect(page.locator('#rogue-run-screen .rogue-buildgrid')).toBeVisible();
  await page.locator('#rogue-tab-run').click();
  await expect(page.locator('#rogue-run-screen .rogue-run-stats-grid')).toBeVisible();
  await page.locator('#rogue-tab-loadout').click();
  await expect(page.locator('#rogue-run-screen .rogue-loadout-relic-row')).toHaveCount(1);
  await page.locator('#rogue-tab-run').click();
  await page.screenshot({ path: join(shots, 'rogue-run-screen.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.locator('#rogue-run-screen')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-game-phase', 'paused');
  await page.keyboard.press('KeyI');
  await expect(page.locator('#rogue-run-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#rogue-run-open')).toHaveCount(0);
  expect(errors).toEqual([]);
});
