import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openControllerSettings, openPauseMenu, openSolo, openLan, setSeat, startBattle, goToStage } from './helpers/battle.ts';

test.describe.configure({ mode: 'default', timeout: 90_000 });
interface MockPad { index: number; id: string; mapping: string; connected: boolean; axes: number[]; buttons: {pressed: boolean; value: number}[] }
interface MockControllers { pads: Array<MockPad | null>; denied: boolean }
declare global { interface Window { controllerTest: MockControllers } }
const xbox = (index = 0): MockPad => ({index, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({pressed: false, value: 0}))});
const ps = (index = 2): MockPad => ({...xbox(index), id: 'DualSense Wireless Controller (Vendor: 054c Product: 0ce6)'});
const wii = (): MockPad => ({index: 0, id: 'Nintendo RVL-CNT-01 Wii Remote test-private-identifier', mapping: '', connected: true, axes: [], buttons: Array.from({length: 11}, () => ({pressed: false, value: 0}))});
async function mock(page: Page, pads: Array<MockPad | null>, denied = false) {
  await page.addInitScript(({pads, denied}) => {
    window.controllerTest = {pads, denied};
    Object.defineProperty(navigator, 'getGamepads', {configurable: true, value: () => {
      if (window.controllerTest.denied) throw new DOMException('Gamepads denied for test', 'SecurityError');
      return window.controllerTest.pads;
    }});
  }, {pads, denied});
}
async function ready(page: Page, clock = true) {
  if (clock) await page.clock.install();
  await page.goto('/play.html'); await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', {timeout: 60_000});
  if (clock) await openSolo(page);
}
async function panel(page: Page) { await openControllerSettings(page); await expect(page.locator('.controller-panel')).toBeVisible(); }
const frames = (page: Page, n = 1) => page.clock.runFor(n * 17);
async function button(page: Page, index: number, pressed: boolean, padIndex = 0) {
  await page.evaluate(({index, pressed, padIndex}) => { const button = window.controllerTest.pads[padIndex]!.buttons[index]!; button.pressed = pressed; button.value = +pressed; }, {index, pressed, padIndex});
}
async function start(page: Page) {
  await page.getByRole('button', {name: 'Close options', exact: true}).click();
  await startBattle(page); await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000)); await frames(page, 2);
}

test('detects actual mocked Xbox/PlayStation records in menus, displays live controls and assigns one/two local HUMAN sources', async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mock(page, [xbox(), null, ps()]); await ready(page); await panel(page);
  const first = page.locator('[data-controller-index="0"]'), second = page.locator('[data-controller-index="2"]');
  await expect(first.getByRole('heading')).toContainText('Xbox'); await expect(second.getByRole('heading')).toContainText('PlayStation');
  await expect(first.getByRole('combobox')).toHaveValue('0'); await expect(second.getByRole('combobox')).toHaveValue('');
  await expect(first.getByRole('combobox').locator('option')).toHaveCount(2); // unassigned + local YOU
  await second.locator('.controller-panel__tester summary').click(); await button(page, 0, true, 2); await frames(page, 10);
  await expect(second.locator('[data-button-index="0"]')).toHaveAttribute('data-pressed', 'true'); await expect(second.locator('[data-button-index="0"]')).toContainText('Cross');
  await button(page, 0, false, 2); await page.getByRole('button', {name: 'Close options', exact: true}).click(); await setSeat(page, 1, 'human'); await panel(page);
  await expect(first.getByRole('combobox')).toHaveValue('0'); await expect(second.getByRole('combobox')).toHaveValue('1');
  await second.getByRole('combobox').selectOption('0'); await expect(first.getByRole('combobox')).toHaveValue('');
  await expect(second.getByRole('combobox')).toHaveValue('0'); expect(errors).toEqual([]);
  const directory = process.env.SMASH_CONTROLLER_ARTIFACT_DIR;
  if (directory) {
    await mkdir(directory, {recursive: true});
    await page.locator('.controller-panel').evaluate(element => element.scrollIntoView({block: 'start'}));
    await page.screenshot({path: `${directory}/controller-desktop.png`});
  }
  await page.setViewportSize({width: 390, height: 844}); await frames(page, 10);
  await page.locator('.controller-panel').evaluate(element => element.scrollIntoView({block: 'start'}));
  expect(await page.locator('.controller-panel').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  if (directory) await page.screenshot({path: `${directory}/controller-mobile.png`});
});

test('controller input drives original gameplay, never shifts P2 on unplug, reconnects neutral, and Start pauses the local match once', async ({page}) => {
  await mock(page, [xbox(), null, ps()]); await ready(page); await setSeat(page, 1, 'human'); await panel(page); await start(page);
  const before = await page.evaluate(() => window.smashMatchSnapshot!()!.fighters.map(fighter => fighter.x));
  await page.evaluate(() => { window.controllerTest.pads[0]!.connected = false; window.controllerTest.pads[2]!.axes[0] = -0.3; }); await frames(page, 10);
  const moved = await page.evaluate(() => window.smashMatchSnapshot!()!.fighters);
  expect(moved[0].x).toBe(before[0]); expect(moved[1].x).toBeLessThan(before[1]!);
  await page.evaluate(() => { window.controllerTest.pads[2]!.axes[0] = 0; window.controllerTest.pads[0]!.connected = true; }); await button(page, 3, true); await frames(page, 8);
  expect(await page.evaluate(() => window.smashMatchSnapshot!()!.fighters[0].jumpsUsed)).toBe(0);
  // Smash layout: Y (north) jumps.
  await button(page, 3, false); await frames(page, 2); await button(page, 3, true); await frames(page, 8);
  expect(await page.evaluate(() => window.smashMatchSnapshot!()!.fighters[0].jumpsUsed)).toBe(1);
  // Start pauses like Smash (no options dialog); holding it never toggles twice.
  await button(page, 3, false); await button(page, 9, true); await frames(page, 5);
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot!()!.paused)).toBe(true); await expect(page.locator('.options-dialog')).not.toBeVisible();
  await frames(page, 15); expect(await page.evaluate(() => window.smashMatchSnapshot!()!.paused)).toBe(true);
  await button(page, 9, false); await frames(page, 2); await button(page, 9, true); await frames(page, 5);
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot!()!.paused)).toBe(false); await expect(page.locator('.options-dialog')).not.toBeVisible();
});

test('axisless raw Wii calibration binds D-pad/actions, affects gameplay, and saved raw profiles need explicit confirmation after reload', async ({page}) => {
  await mock(page, [wii()]); await ready(page); await panel(page);
  const card = page.locator('[data-controller-index="0"]'); await expect(card).toContainText('Not sending gameplay input');
  await expect(card.getByRole('button', {name: 'Confirm browser-standard layout'})).toHaveCount(0);
  await card.getByRole('button', {name: 'Calibrate raw buttons', exact: true}).click();
  const actions = ['Jump', 'Quick attack', 'Strong attack', 'Special', 'Shield / dodge', 'Grab', 'D-pad left', 'D-pad right', 'D-pad up', 'D-pad down'];
  for (const [index, action] of actions.entries()) {
    await card.getByRole('button', {name: `Listen for ${action}`, exact: true}).click(); await button(page, index, true); await frames(page, 2); await button(page, index, false); await frames(page, 2);
  }
  await expect(card.getByRole('button', {name: 'Save & enable mapping'})).toBeEnabled(); await card.getByRole('button', {name: 'Save & enable mapping'}).click();
  await expect(card).toContainText('Custom mapping enabled');
  const saved = await page.evaluate(() => localStorage.getItem('smash.controller-mappings.v1'));
  expect(saved).not.toContain('test-private-identifier'); expect(saved).not.toContain('RVL-CNT-01');
  await start(page); const x = await page.evaluate(() => window.smashMatchSnapshot!()!.fighters[0].x);
  await button(page, 6, true); await frames(page, 8); expect(await page.evaluate(() => window.smashMatchSnapshot!()!.fighters[0].x)).toBeLessThan(x);
  await button(page, 6, false); await button(page, 0, true); await frames(page, 8); expect(await page.evaluate(() => window.smashMatchSnapshot!()!.fighters[0].jumpsUsed)).toBe(1);
  // No guessed Menu binding: raw button9 is the calibrated D-pad down.
  await button(page, 9, true); await frames(page, 2); await expect(page.locator('.options-dialog')).not.toBeVisible();
  await page.clock.resume(); await page.reload(); await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', {timeout: 60_000}); await openSolo(page); await panel(page);
  await expect(card).toContainText('Not sending gameplay input'); await card.getByRole('button', {name: 'Use saved profile · verify first', exact: true}).click(); await expect(card).toContainText('Custom mapping enabled');
});

test('reports actual Gamepad permission denial, retains keyboard input and retries detection after permission recovery', async ({page}) => {
  await mock(page, [xbox()], true); await ready(page); await panel(page);
  await expect(page.locator('.controller-panel__status')).toContainText('Browser policy denied'); await expect(page.locator('.controller-panel__device')).toHaveCount(0);
  await start(page); await page.keyboard.down('KeyD'); await frames(page, 10); await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => window.smashMatchSnapshot!()!.fighters[0].vx)).toBeGreaterThan(0);
  await openPauseMenu(page);
  await page.getByRole('button', {name: 'Game options', exact: true}).click(); await page.evaluate(() => { window.controllerTest.denied = false; });
  await page.getByRole('button', {name: 'Connect / detect', exact: true}).click(); await expect(page.locator('.controller-panel__device')).toHaveCount(1);
  await expect(page.locator('.controller-panel__status')).toContainText('exposed by this browser');
});

test('online uses only one local controller slot and Menu never pauses the shared match', async ({browser, baseURL}) => {
  const contexts = [await browser.newContext({baseURL}), await browser.newContext({baseURL})];
  try {
    const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
    await mock(host!, [xbox(), ps(1)]);
    for (const page of [host!, guest!]) {
      await ready(page, false); await openLan(page);
    }
    await host!.getByRole('button', {name: 'Create room', exact: true}).click(); await expect(host!.locator('#active-room-code')).toHaveText(/^[A-Z2-9]{6}$/u);
    await guest!.locator('#room-code').fill((await host!.locator('#active-room-code').textContent())!); await guest!.getByRole('button', {name: 'Join room', exact: true}).click();
    for (const page of [host!, guest!]) { await expect.poll(() => page.evaluate(() => window.smashNetworkSnapshot?.()?.room?.players.length)).toBe(2); await page.getByRole('button', {name: 'Ready', exact: true}).click(); }
    await goToStage(host!); await expect(host!.locator('#start-match')).toBeEnabled(); await host!.locator('#start-match').click();
    await expect.poll(() => host!.evaluate(() => window.smashMatchSnapshot?.()?.phase), {timeout: 30_000}).toBe('playing');
    await button(host!, 9, true); await expect(host!.locator('.options-dialog')).toBeVisible();
    await expect(host!.locator('.controller-panel')).toContainText('Online: only one local controller slot');
    const assignments = host!.locator('.controller-panel__assignment select'); await expect(assignments).toHaveCount(2);
    await expect(assignments.nth(0).locator('option')).toHaveCount(2); await expect(assignments.nth(1)).toHaveValue('');
    const before = await host!.evaluate(() => window.smashNetworkSnapshot!()!.confirmedFrame);
    await expect.poll(() => host!.evaluate(() => window.smashNetworkSnapshot!()!.confirmedFrame), {timeout: 10_000}).toBeGreaterThan(before + 10);
    expect(await host!.evaluate(() => window.smashMatchSnapshot!()!.paused)).toBe(false); expect(await guest!.evaluate(() => window.smashNetworkSnapshot!()!.error)).toBe('');
    await button(host!, 9, false);
    // Wait for observed release, not an assumed 40ms render cadence under SwiftShader.
    await expect(host!.locator('[data-controller-index="0"] [data-button-index="9"]')).toHaveAttribute('data-pressed', 'false');
    await button(host!, 9, true); await expect(host!.locator('.options-dialog')).not.toBeVisible();
    await host!.getByRole('button', {name: 'Return to lobby', exact: true}).first().click();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
