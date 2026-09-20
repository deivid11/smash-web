import { expect, type Page } from '@playwright/test';
import type { RoomFighter } from '../../../lib/net/protocol.ts';

export type SeatControl = 'human' | 'cpu' | 'off';
export type BattleStage = 'battlefield' | 'final' | 'corneria' | 'temple' | 'stadium';

/** UI-only setup. Never bypass the match countdown, inject simulation state, or
 * advance the mock clock: mechanics tests retain their original startup timing. */
/** Opens Options scrolled to the controller panel. Scene headers keep it inside
 * the settings cog menu; the home screen shows the entry directly. */
export async function openControllerSettings(page: Page): Promise<void> {
  const cog = page.locator('#system-menu-toggle');
  if (await cog.isVisible()) await cog.click();
  await page.locator('#controller-settings').click();
}

export async function openSolo(page: Page): Promise<void> {
  await page.locator('#mode-solo').click();
  await expect(page.locator('#seat-kind-0')).toBeVisible();
}

export async function openLan(page: Page): Promise<void> {
  await page.locator('#mode-lan').click();
  await expect(page.locator('#player-name')).toBeVisible();
}

export async function chooseFighter(page: Page, seat: number, fighter: RoomFighter): Promise<void> {
  await page.locator(`#select-seat-${seat}`).click();
  await page.locator(`[data-fighter="${fighter}"]`).click();
  await expect(page.locator(`[data-fighter="${fighter}"]`)).toHaveAttribute('aria-pressed', 'true');
}

export async function setSeat(page: Page, seat: number, control: SeatControl, fighter?: RoomFighter): Promise<void> {
  await page.locator(`#seat-kind-${seat}`).selectOption(control);
  await expect(page.locator(`#seat-kind-${seat}`)).toHaveValue(control);
  if (fighter) await chooseFighter(page, seat, fighter);
}

export async function goToStage(page: Page, stage?: BattleStage): Promise<void> {
  await page.locator('#go-stage').click();
  await expect(page.locator('[data-stage="battlefield"]')).toBeVisible();
  if (stage) {
    await page.locator(`[data-stage="${stage}"]`).click();
    await expect(page.locator(`[data-stage="${stage}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
}

/** From character select only; start-match deliberately does not live there. */
export async function startBattle(page: Page, stage?: BattleStage): Promise<void> {
  await goToStage(page, stage);
  await page.locator('#start-match').click();
}

export async function backToCharacters(page: Page): Promise<void> {
  await page.locator('#back-to-characters').click();
  await expect(page.locator('#seat-kind-0')).toBeVisible();
}

/** Local match actions (rematch / fighters / toggles / options) live in the
 * Melee-style pause menu while a match runs: pause first, then act. */
export async function openPauseMenu(page: Page): Promise<void> {
  if (await page.locator('#pause-overlay').isVisible()) return;
  await page.locator('#pause-match').click();
  await expect(page.locator('#pause-overlay')).toBeVisible();
}

/** Resume live play after acting in the pause menu. */
export async function resumeFromPause(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-overlay')).toBeHidden();
}
