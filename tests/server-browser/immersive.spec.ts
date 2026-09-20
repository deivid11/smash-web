import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openControllerSettings, openPauseMenu, openSolo, resumeFromPause, setSeat, startBattle } from './helpers/battle.ts';

test.describe.configure({ timeout: 60_000 });
async function capture(page: Page, name: string): Promise<void> {
  const screenshots = process.env.SMASH_PLAY_ARTIFACT_DIR ? resolve(process.env.SMASH_PLAY_ARTIFACT_DIR) : test.info().outputPath('screenshots');
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, `immersive-${name}.png`), fullPage: false });
}
async function load(page: Page): Promise<void> {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 30_000 });
  await openSolo(page);
  await expect(page.locator('.game-app')).toHaveClass(/scene-characters/u);
  await expect(page.locator('#go-stage')).toBeEnabled();
  await expect(page.locator('#start-match')).toHaveCount(0);
}
async function start(page: Page): Promise<void> {
  await setSeat(page, 1, 'human');
  await startBattle(page);
  await expect(page.locator('.game-app')).toHaveClass(/in-match/u);
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await expect(page.locator('.menu-layer')).toBeHidden();
}
async function viewportArena(page: Page): Promise<void> {
  // The arena fills the viewport; the canvas fills the game view (.canvas-host), which
  // portrait touch layouts shorten to make room for the control panel below it.
  await expect.poll(() => page.evaluate(() => {
    const arena = document.querySelector('#arena')!.getBoundingClientRect(), host = document.querySelector('.canvas-host')!.getBoundingClientRect(), canvas = document.querySelector('#play-canvas')!.getBoundingClientRect();
    const fillsViewport = Math.abs(arena.x) <= 1 && Math.abs(arena.y) <= 1 && Math.abs(arena.width - innerWidth) <= 1 && Math.abs(arena.height - innerHeight) <= 1;
    const fillsHost = Math.abs(canvas.x - host.x) <= 1 && Math.abs(canvas.y - host.y) <= 1 && Math.abs(canvas.width - host.width) <= 1 && Math.abs(canvas.height - host.height) <= 1 && host.width >= innerWidth - 1 && host.height >= innerHeight * 0.55;
    return fillsViewport && fillsHost;
  }), { message: 'Arena must fill the viewport and the canvas must fill the game view, not a letterboxed document panel.' }).toBe(true);
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth))).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
}
async function readableHud(page: Page) {
  await expect(page.locator('#arena .fighters-hud')).toBeVisible();
  await expect(page.locator('#arena .fighter-card')).toHaveCount(2);
  await expect(page.locator('#match-clock')).toHaveText(/^\d+:\d{2}$/u);
  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector)!, rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fontSize: parseFloat(style.fontSize), color: style.color, opacity: Number(style.opacity), position: style.position };
    };
    return { width: innerWidth, height: innerHeight, arenaBottom: document.querySelector('#play-canvas')!.getBoundingClientRect().bottom, hud: bounds('#arena .fighters-hud'), clock: bounds('#match-clock'), percents: [bounds('#percent-0'), bounds('#percent-1')], cards: [bounds('.player-one'), bounds('.player-two')] };
  });
  for (const box of [geometry.hud, geometry.clock, ...geometry.percents, ...geometry.cards]) {
    expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(geometry.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(geometry.height + 1);
    expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
  }
  expect(['absolute', 'fixed']).toContain(geometry.hud.position);
  expect(geometry.clock.fontSize).toBeGreaterThanOrEqual(24);
  for (const percent of geometry.percents) { expect(percent.fontSize).toBeGreaterThanOrEqual(28); expect(percent.opacity).toBe(1); expect(percent.color).not.toBe('rgba(0, 0, 0, 0)'); }
  expect(Math.abs(geometry.clock.x + geometry.clock.width / 2 - geometry.width / 2)).toBeLessThanOrEqual(2);
  expect(geometry.clock.y).toBeLessThan(80);
  // The HUD anchors to the bottom of the game view; portrait touch layouts reserve a control panel below it.
  expect(geometry.arenaBottom - geometry.hud.y - geometry.hud.height).toBeLessThan(80);
  return geometry;
}

test('selection has no body overflow and the local arena/HUD stay viewport anchored through resize', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 }); await load(page);
  await expect(page.locator('.menu-layer')).toBeVisible(); await expect(page.locator('#arena .fighters-hud')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeHidden();
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth))).toBeLessThanOrEqual(1440);
  await capture(page, 'desktop-menu'); await start(page); await viewportArena(page);
  await expect(page.locator('#pause-match')).toBeVisible();
  await expect(page.locator('#touch-toggle')).toHaveCount(0);
  await expect(page.locator('#fullscreen-toggle')).toHaveCount(0);
  const initial = await readableHud(page); await capture(page, 'desktop-arena');
  await page.setViewportSize({ width: 1024, height: 768 }); await viewportArena(page);
  const resized = await readableHud(page);
  // HUD follows viewport edges, rather than retaining the old document y-position.
  expect(Math.abs((initial.height - initial.hud.y - initial.hud.height) - (resized.height - resized.hud.y - resized.hud.height))).toBeLessThanOrEqual(12);
  expect(Math.abs(initial.clock.y - resized.clock.y)).toBeLessThanOrEqual(12);
  await page.mouse.wheel(0, 900); await viewportArena(page); await readableHud(page);
  await capture(page, 'resized-arena'); expect(errors).toEqual([]);
});

test('fullscreen control requests and exits native fullscreen via ordinary click gestures', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await load(page); await start(page); await openPauseMenu(page);
  test.skip(!await page.evaluate(() => document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function'), 'Native fullscreen is not supported by this browser.');
  const toggle = page.locator('#fullscreen-toggle'); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await page.waitForFunction(() => document.fullscreenElement === document.querySelector('.game-app'));
  await expect(toggle).toHaveAttribute('aria-pressed', 'true'); await viewportArena(page); await readableHud(page);
  await capture(page, 'native-fullscreen');
  await toggle.click(); await page.waitForFunction(() => document.fullscreenElement === null);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false'); await viewportArena(page); await readableHud(page);
  await capture(page, 'fullscreen-exited'); expect(errors).toEqual([]);
});

test('options pause/resume local play and retain audio/touch settings across dialog and scene changes', async ({ page }) => {
  await load(page); await start(page); await openPauseMenu(page);
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GAME OPTIONS' }); await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.paused)).toBe(true);
  const before = await page.evaluate(() => window.smashMatchSnapshot?.()), clock = await page.locator('#match-clock').textContent();
  await dialog.locator('#sound-enabled').uncheck(); await dialog.locator('#music-enabled').uncheck();
  const volume = dialog.getByRole('slider', { name: 'Music volume' }); await volume.focus(); await volume.press('Home');
  for (let i = 0; i < 3; i++) await volume.press('ArrowRight');
  await expect(volume).toHaveValue('0.15');
  await dialog.getByRole('checkbox', { name: 'On-screen touch controls' }).check();
  // Let real animation callbacks run while the local simulation is explicitly paused.
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.smashMatchSnapshot?.())).toEqual(before); await expect(page.locator('#match-clock')).toHaveText(clock!);
  expect(await page.evaluate(() => window.smashMenuSnapshot?.())).toMatchObject({ musicMuted: true, sfxMuted: true, musicVolume: 0.15 });
  await capture(page, 'options-dialog');
  await dialog.getByRole('button', { name: 'BACK TO GAME', exact: true }).click(); await expect(dialog).toBeHidden();
  // Options opened from the pause menu stay paused on close.
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.paused)).toBe(true);
  await resumeFromPause(page);
  await page.waitForFunction(frame => window.smashMatchSnapshot?.()?.paused === false && (window.smashMatchSnapshot?.()?.frame ?? 0) > frame, before!.frame);
  await openPauseMenu(page);
  await expect(page.locator('#touch-toggle')).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeVisible();
  await page.locator('#touch-toggle').click(); await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Game options', exact: true }).click(); await expect(dialog).toBeVisible();
  await expect(dialog.locator('#sound-enabled')).not.toBeChecked(); await expect(dialog.locator('#music-enabled')).not.toBeChecked(); await expect(volume).toHaveValue('0.15');
  await expect(dialog.getByRole('checkbox', { name: 'On-screen touch controls' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Close options', exact: true }).click();
  await page.locator('#change-fighters').click(); await expect(page.locator('.menu-layer')).toBeVisible();
  await openControllerSettings(page);
  await expect(page.locator('#sound-enabled')).not.toBeChecked(); await expect(page.locator('#music-enabled')).not.toBeChecked(); await expect(page.locator('#music-volume')).toHaveValue('0.15');
  await dialog.getByRole('button', { name: 'Close options', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeHidden();
});

test('mobile selection hides touch controls and the optional card HUD avoids them in a full-viewport match', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page);
  // Phones deliberately default to overhead labels. This geometry case exercises
  // the optional card HUD, so select it through the same settings UI as a player.
  await openControllerSettings(page);
  await expect(page.locator('#hud-mode-setting')).toBeChecked();
  await page.locator('#hud-mode-setting').uncheck();
  await page.getByRole('button', { name: 'Close options', exact: true }).click();
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth))).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeHidden(); await capture(page, 'mobile-menu');
  await start(page); await viewportArena(page); await readableHud(page); await openPauseMenu(page);
  await expect(page.locator('#touch-toggle')).toHaveAttribute('aria-pressed', 'true');
  await resumeFromPause(page);
  await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Special', exact: true })).toBeVisible(); await expect(page.locator('#touch-stick')).toBeVisible();
  const touchLayout = await page.evaluate(() => {
    const rect = (node: Element) => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
    return { width: innerWidth, height: innerHeight, hud: rect(document.querySelector('#arena .fighters-hud')!), buttons: [...document.querySelectorAll('#touch-controls button, #touch-stick')].map(button => ({ ...rect(button), label: button.getAttribute('aria-label') })) };
  });
  expect(touchLayout.buttons).toHaveLength(8);
  for (const button of touchLayout.buttons) {
    expect(button.width, `${button.label} touch target width`).toBeGreaterThanOrEqual(44);
    expect(button.height, `${button.label} touch target height`).toBeGreaterThanOrEqual(44);
    expect(button.x).toBeGreaterThanOrEqual(0); expect(button.y).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(touchLayout.width);
    expect(button.y + button.height).toBeLessThanOrEqual(touchLayout.height);
    const hud = touchLayout.hud;
    expect(button.x < hud.x + hud.width && button.x + button.width > hud.x && button.y < hud.y + hud.height && button.y + button.height > hud.y, `${button.label} must not overlap the fighter HUD`).toBe(false);
  }
  await capture(page, 'mobile-arena'); await openPauseMenu(page);
  await page.locator('#touch-toggle').click(); await expect(page.getByRole('button', { name: 'Jump', exact: true })).toBeHidden();
  await viewportArena(page); await readableHud(page); await capture(page, 'mobile-clean-arena');
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GAME OPTIONS' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('slider', { name: 'Music volume' })).toBeVisible();
  await capture(page, 'mobile-options');
});
