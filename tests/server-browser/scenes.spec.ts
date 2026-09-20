import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openControllerSettings, openPauseMenu, openSolo, setSeat, goToStage, backToCharacters } from './helpers/battle.ts';

// Run the focused selection/network files with --workers=1: four SwiftShader
// clients in the neighboring suite must not compete with another test file.
test.describe.configure({ mode: 'default', timeout: 120_000 });

async function captureScene(page: Page, label: string): Promise<void> {
  const directory = process.env.SMASH_BROWSER_ARTIFACT_DIR ?? test.info().outputPath('screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${label}.png`), fullPage: true });
}

async function ready(page: Page): Promise<void> {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await openSolo(page);
  await expect(page.locator('.player-seat')).toHaveCount(8);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

// The public diagnostic snapshot reports playback state, not perceived speaker
// loudness or equivalence to the original GameCube mixer.
interface MenuSnapshot {
  played: number; unavailable: number; lastError: string;
  music: import('../../lib/game/music.ts').MusicId | null;
  prepared: string[]; sfxReady: boolean; musicMuted: boolean; musicVolume: number; sfxMuted: boolean;
}
async function menu(page: Page): Promise<MenuSnapshot | null> {
  return page.evaluate(() => (window as Window & { smashMenuSnapshot?: () => MenuSnapshot | null }).smashMenuSnapshot?.() ?? null);
}

async function startSelectedStage(page: Page, stage: 'battlefield' | 'final'): Promise<void> {
  await goToStage(page);
  await page.locator(`[data-stage="${stage}"]`).click();
  await expect(page.locator(`[data-stage="${stage}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#start-match').click();
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 30_000 }).toBe('playing');
  const match = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(match?.stage).toBe(stage);
  if (stage === 'final') expect(match?.stageFloors).toBe(3);
  else expect(match?.stageFloors).toBeGreaterThan(3);
}

test('character and stage scenes preserve selections and start the chosen roster', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  for (const [kind, name] of [['Fx', 'Fox'], ['Mr', 'Mario'], ['Kb', 'Kirby']] as const) {
    await page.locator(`[data-fighter="${kind}"]`).click();
    await expect(page.locator(`[data-fighter="${kind}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#select-seat-0')).toContainText(new RegExp(name, 'i'));
    await expect(page.locator('[data-fighter][aria-pressed="true"]')).toHaveCount(1);
  }
  await expect(page.locator('[data-fighter="Kb"]')).toHaveAttribute('aria-label', /Original Melee fighter/);
  await captureScene(page, 'character-select');
  await setSeat(page, 1, 'human', 'Mr');
  await page.locator('#select-seat-0').click();
  await page.locator('#setup-stocks').selectOption('4');
  await expect(page.locator('#start-match')).toHaveCount(0);
  await goToStage(page);
  await expect(page.locator('[data-stage="battlefield"]')).toBeVisible();
  await expect(page.locator('#select-seat-0')).toBeHidden();
  await page.locator('[data-stage="final"]').click();
  await captureScene(page, 'stage-select');
  await backToCharacters(page);
  await expect(page.locator('[data-fighter="Kb"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#select-seat-1')).toContainText(/Mario/i);
  await expect(page.locator('#seat-kind-1')).toHaveValue('human');
  await expect(page.locator('#setup-stocks')).toHaveValue('4');
  await startSelectedStage(page, 'final');
  const match = await page.evaluate(() => window.smashMatchSnapshot?.());
  expect(match?.fighters.map(fighter => fighter.kind)).toEqual(['Kb', 'Mr']);
  expect(match?.fighters.map(fighter => fighter.stocks)).toEqual([4, 4]);
  await captureScene(page, 'final-local-arena');
  await expect.poll(async () => (await menu(page))?.music).toBe('final');
  await openPauseMenu(page);await page.locator('#change-fighters').click();
  await expect(page.locator('#select-seat-0')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase)).toBe('ready');
  await expect(page.locator('[data-fighter="Kb"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('original menu cues and music follow scenes with independent mute and volume controls', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page);
  await expect.poll(async () => (await menu(page))?.sfxReady).toBe(true);
  // Only the menu track is decoded at boot; stage tracks load when a stage is picked or a match starts.
  await expect.poll(async () => (await menu(page))?.prepared).toEqual(expect.arrayContaining(['menu']));
  const loadedRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/assets/')) loadedRequests.push(request.url()); });
  for (const kind of ['Fx', 'Mr']) {
    const before = (await menu(page))!.played;
    await page.locator(`[data-fighter="${kind}"]`).click();
    await expect.poll(async () => (await menu(page))?.played ?? 0).toBeGreaterThan(before);
  }
  await expect.poll(async () => (await menu(page))?.music).toBe('menu');
  // Native range keyboard input exercises React's change handler and preserves focus.
  await openControllerSettings(page);
  await page.locator('#music-volume').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#music-volume')).toHaveValue('0.1');
  await expect.poll(async () => (await menu(page))?.musicVolume).toBe(0.1);
  await page.locator('#music-enabled').uncheck();
  await expect.poll(async () => (await menu(page))?.musicMuted).toBe(true);
  await expect(page.locator('#sound-enabled')).toBeChecked();
  await page.locator('#music-enabled').check();
  await expect.poll(async () => (await menu(page))?.musicMuted).toBe(false);
  await page.locator('#sound-enabled').uncheck();
  await expect.poll(async () => (await menu(page))?.sfxMuted).toBe(true);
  await expect(page.locator('#music-enabled')).toBeChecked();
  await page.getByRole('button', { name: 'Close options', exact: true }).click();
  await startSelectedStage(page, 'battlefield');
  await expect.poll(async () => (await menu(page))?.music).toBe('battlefield');
  await openPauseMenu(page);await page.locator('#change-fighters').click();
  await expect.poll(async () => (await menu(page))?.music).toBe('menu');
  await startSelectedStage(page, 'final');
  await expect.poll(async () => (await menu(page))?.music).toBe('final');
  await expect.poll(async () => (await menu(page))?.musicVolume).toBe(0.1);
  expect((await menu(page))?.lastError).toBe('');
  expect((await menu(page))?.unavailable).toBe(0);
  // Background roster/scene loads are deliberate. Only already-prepared menu/name cues
  // must stay cached; stage music is decoded on demand and is not a boot prerequisite.
  expect(loadedRequests.filter(url => ['/api/assets/audio/us/nr_name.ssm', '/api/assets/audio/menu01.hps'].includes(decodeURIComponent(new URL(url).pathname)))).toEqual([]);
  expect((await menu(page))?.prepared).toEqual(expect.arrayContaining(['menu', 'battlefield', 'final']));
  expect(errors).toEqual([]);
});

test('selection scenes remain keyboard operable and fit a mobile viewport', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const fighter = page.locator('[data-fighter="Mr"]');
  await fighter.focus(); await page.keyboard.press('Enter');
  await expect(fighter).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await goToStage(page);
  const stage = page.locator('[data-stage="final"]');
  await stage.focus(); await page.keyboard.press('Space');
  await expect(stage).toHaveAttribute('aria-pressed', 'true');
  await captureScene(page, 'mobile-stage-select');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await backToCharacters(page);
  await expect(fighter).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
