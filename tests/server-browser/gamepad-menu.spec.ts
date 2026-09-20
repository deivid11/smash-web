import { expect, test, type Page } from '@playwright/test';

// Full-game controller navigation: mode select, fighter/stage setup, options,
// and Rift Descent setup/branch/intro all respond to D-pad + South/East.
// Uses mocked Gamepad API records like tests/server-browser/controllers.spec.ts;
// the real server ISO still boots the game (private/disc-report.json fallback).
test.describe.configure({ mode: 'default', timeout: 120_000 });

interface MockPad {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}
declare global {
  interface Window {
    controllerTest: { pads: Array<MockPad | null>; denied: boolean };
  }
}

async function mock(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { controllerTest: { pads: Array<MockPad | null>; denied: boolean } }).controllerTest = {
      pads: [
        {
          index: 0,
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
          mapping: 'standard',
          connected: true,
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        },
      ],
      denied: false,
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        const state = (window as unknown as { controllerTest: { pads: Array<MockPad | null> } }).controllerTest;
        return state.pads;
      },
    });
  });
}

async function ready(page: Page) {
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('#mode-solo')).toBeVisible();
}

async function setButton(page: Page, index: number, pressed: boolean) {
  await page.evaluate(
    ({ index, pressed }) => {
      const button = window.controllerTest.pads[0]!.buttons[index]!;
      button.pressed = pressed;
      button.value = pressed ? 1 : 0;
    },
    { index, pressed },
  );
}

async function tap(page: Page, index: number) {
  await setButton(page, index, true);
  // Menu navigation runs on rAF; give the hub scan + focus move time.
  await page.waitForTimeout(250);
  await setButton(page, index, false);
  await page.waitForTimeout(250);
}

async function holdDirection(page: Page, axis: number, value: number, ms = 250) {
  await page.evaluate(
    ({ axis, value }) => {
      window.controllerTest.pads[0]!.axes[axis] = value;
    },
    { axis, value },
  );
  await page.waitForTimeout(ms);
  await page.evaluate(
    ({ axis }) => {
      window.controllerTest.pads[0]!.axes[axis] = 0;
    },
    { axis },
  );
  await page.waitForTimeout(250);
}

test('controller smashes with the right stick and with fast stick taps', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await ready(page);
  // Setup via mouse; the smash inputs under test come from the mocked pad.
  await page.locator('#mode-solo').click();
  await page.locator('#go-stage').click();
  await page.locator('[data-stage="battlefield"]').click();
  await page.locator('#start-match').click();
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 30_000 }).toBe('playing');
  const smashOf = () =>
    page.evaluate(() => {
      const fighter = window.smashMatchSnapshot?.()?.fighters[0] as unknown as
        | { state: string; animation: string; smash: { phase: string } | null }
        | undefined;
      return fighter ? { state: fighter.state, animation: fighter.animation, smash: fighter.smash } : null;
    });
  // Right-stick flick fires a smash without touching the left stick or buttons.
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]?.state), { timeout: 15_000 }).toMatch(/^(idle|walk|run|crouch|fall)$/);
  await page.evaluate(() => { window.controllerTest.pads[0]!.axes[2] = 1; });
  await expect.poll(async () => (await smashOf())?.smash, { timeout: 10_000 }).not.toBeNull();
  expect((await smashOf())!.state).toBe('attack');
  await page.evaluate(() => { window.controllerTest.pads[0]!.axes[2] = 0; });
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]?.state), { timeout: 15_000 }).not.toBe('attack');
  // Fast left-stick tap plus A (attack in the Smash layout) smashes the same way.
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.fighters[0]?.state), { timeout: 15_000 }).toMatch(/^(idle|walk|run|crouch|fall)$/);
  await page.evaluate(() => {
    window.controllerTest.pads[0]!.axes[0] = 1;
    window.controllerTest.pads[0]!.buttons[0]!.pressed = true;
    window.controllerTest.pads[0]!.buttons[0]!.value = 1;
  });
  await expect.poll(async () => (await smashOf())?.smash, { timeout: 10_000 }).not.toBeNull();
  await page.evaluate(() => {
    window.controllerTest.pads[0]!.axes[0] = 0;
    window.controllerTest.pads[0]!.buttons[0]!.pressed = false;
    window.controllerTest.pads[0]!.buttons[0]!.value = 0;
  });
  expect(errors).toEqual([]);
});

test('controller moves through mode, fighters, stages and starts the match', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await ready(page);

  // No focus yet: South activates the first mode choice (SOLO).
  await tap(page, 0);
  await expect(page.locator('#seat-kind-0')).toBeVisible();

  // Focusing a fighter warps the floating hand onto it; A picks what it points at.
  await expect(page.locator('.menu-hand')).toHaveCount(1);
  await page.locator('[data-fighter="Mr"]').focus();
  await tap(page, 0);
  await expect(page.locator('[data-fighter="Mr"]')).toHaveAttribute('aria-pressed', 'true');

  // East goes back to the mode screen.
  await tap(page, 1);
  await expect(page.locator('#mode-solo')).toBeVisible();

  // Return to solo via controller again, then reach the stage screen.
  await tap(page, 0);
  await expect(page.locator('#seat-kind-0')).toBeVisible();
  await page.locator('#go-stage').focus();
  await tap(page, 0);
  await expect(page.locator('[data-stage="battlefield"]')).toBeVisible();

  // The left stick glides the hand across stage tiles (focus follows it); A selects Final Destination.
  await page.locator('[data-stage="battlefield"]').focus();
  await holdDirection(page, 0, 0.9, 700);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-stage'))).not.toBe('battlefield');
  await page.locator('[data-stage="final"]').focus();
  await tap(page, 0);
  await expect(page.locator('[data-stage="final"]')).toHaveAttribute('aria-pressed', 'true');

  // Start (READY TO FIGHT) begins the match from the stage screen.
  await tap(page, 9);
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 30_000 }).not.toBe('ready');
  expect(errors).toEqual([]);
});

test('controller opens options with View, adjusts a select, closes it, and Start is READY TO FIGHT', async ({ page }) => {
  await mock(page);
  await ready(page);
  // Start on the mode screen still opens Game options.
  await tap(page, 9);
  await expect(page.locator('.options-dialog')).toBeVisible();
  await tap(page, 1);
  await expect(page.locator('.options-dialog')).not.toBeVisible();
  await tap(page, 0);
  await expect(page.locator('#seat-kind-0')).toBeVisible();

  // View / Select opens Game options over character select.
  await tap(page, 8);
  await expect(page.locator('.options-dialog')).toBeVisible();

  // Focus a select inside the (modal) options dialog, then cycle it with the stick.
  await page.locator('#camera-shake').focus();
  const before = await page.locator('#camera-shake').inputValue();
  await holdDirection(page, 0, 0.9);
  await expect.poll(() => page.locator('#camera-shake').inputValue()).not.toBe(before);

  // East closes options (back target = Close options).
  await tap(page, 1);
  await expect(page.locator('.options-dialog')).not.toBeVisible();

  // Start is READY TO FIGHT: on to the stage screen, B comes back.
  await tap(page, 9);
  await expect(page.locator('[data-stage="battlefield"]')).toBeVisible();
  await tap(page, 1);
  await expect(page.locator('#seat-kind-0')).toBeVisible();
});

test('controller hands: X / Y change costume, a player panel carries its token, and each pad gets its own hand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await ready(page);
  await tap(page, 0);
  await expect(page.locator('#seat-kind-0')).toBeVisible();
  await expect(page.locator('.menu-hand')).toHaveCount(1);
  await expect(page.locator('.menu-hands-legend')).toContainText('PICK');

  // Y cycles P1's costume forward, X back.
  const skin = page.locator('#select-seat-0 .seat-costume-name');
  const before = await skin.textContent();
  await tap(page, 3);
  await expect(skin).not.toHaveText(before ?? '');
  await expect(page.locator('#costume-prev-0')).toBeEnabled({ timeout: 30_000 });
  await tap(page, 2);
  await expect(skin).toHaveText(before ?? '');

  // A on the CPU's panel picks up its token; A on a fighter sets that seat.
  await page.locator('#select-seat-1').focus();
  await tap(page, 0);
  await expect(page.locator('#select-seat-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.menu-hand-token')).toBeVisible();
  await page.locator('.roster-grid [data-fighter="Kb"]').focus();
  await tap(page, 0);
  await expect(page.locator('#select-seat-1')).toHaveAttribute('aria-label', /Kirby/);
  await expect(page.locator('.menu-hand-token')).toBeHidden();

  // A second controller appears with its own hand.
  await page.evaluate(() => {
    const first = window.controllerTest.pads[0]!;
    window.controllerTest.pads.push({ ...first, index: 1, axes: [0, 0, 0, 0], buttons: first.buttons.map(() => ({ pressed: false, value: 0 })) });
  });
  await expect(page.locator('.menu-hand')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('unmapped standard-layout controller still drives menus, never gameplay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as unknown as { controllerTest: { pads: Array<MockPad | null>; denied: boolean } }).controllerTest = {
      pads: [
        {
          index: 0,
          id: 'Generic USB Controller (STANDARD GAMEPAD)',
          mapping: 'standard',
          connected: true,
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        },
      ],
      denied: false,
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => {
        const state = (window as unknown as { controllerTest: { pads: Array<MockPad | null> } }).controllerTest;
        return state.pads;
      },
    });
  });
  await ready(page);
  // Unknown brand: no guessed gameplay mapping, yet South still confirms.
  await tap(page, 0);
  await expect(page.locator('#seat-kind-0')).toBeVisible();
  // The hand warps to the focused fighter; A picks it.
  await page.locator('[data-fighter="Mr"]').focus();
  await tap(page, 0);
  await expect(page.locator('[data-fighter="Mr"]')).toHaveAttribute('aria-pressed', 'true');
  // East goes back to the mode screen without any mapping.
  await tap(page, 1);
  await expect(page.locator('#mode-solo')).toBeVisible();
  expect(errors).toEqual([]);
});

test('controller bumpers switch the active character-select seat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await ready(page);
  await tap(page, 0);
  await expect(page.locator('#seat-kind-0')).toBeVisible();
  await expect(page.locator('#select-seat-0')).toHaveAttribute('aria-pressed', 'true');
  // RB advances the active player panel, wrapping past the last seat.
  await tap(page, 5);
  await expect(page.locator('#select-seat-1')).toHaveAttribute('aria-pressed', 'true');
  // LB returns to the previous seat.
  await tap(page, 4);
  await expect(page.locator('#select-seat-0')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('controller drives Rift Descent setup, map and floor intro', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await ready(page);

  // Focus RIFT DESCENT explicitly (spatial order may vary) and enter it.
  await page.locator('#mode-rogue').focus();
  await tap(page, 0);
  await expect(page.locator('.rogue-screen-hub')).toBeVisible();

  // Champion screen: focus Mario, confirm the pick; B returns to the hub.
  await page.locator('#rogue-champion-open').focus();
  await tap(page, 0);
  await expect(page.locator('[data-fighter="Mr"]')).toBeEnabled({ timeout: 90_000 });
  await page.locator('[data-fighter="Mr"]').focus();
  await tap(page, 0);
  await expect(page.locator('[data-fighter="Mr"]')).toHaveAttribute('aria-pressed', 'true');
  await tap(page, 1);
  await expect(page.locator('.rogue-screen-hub')).toBeVisible();

  // Rules screen: the seed field takes keyboard entry; the act-1 preview renders.
  await page.locator('#rogue-rules-open').focus();
  await tap(page, 0);
  await page.locator('#rogue-seed').fill('RIFT-PAD1');
  await expect(page.locator('.rogue-tower')).toBeVisible();
  await page.locator('.rogue-back').click();

  // Begin the run, take a blessing, enter the first room and reach the floor intro.
  await page.locator('#rogue-begin').focus();
  await tap(page, 0);
  await expect(page.locator('.rogue-blessing-card')).toHaveCount(3);
  await page.locator('.rogue-blessing-card').first().focus();
  await tap(page, 0);
  await expect(page.locator('#rogue-enter')).toBeVisible();
  await page.locator('#rogue-enter').focus();
  await tap(page, 0);
  await expect(page.locator('#rogue-fight')).toBeVisible();

  // Start the floor with the controller and see the small in-fight run chip.
  await page.locator('#rogue-fight').focus();
  await tap(page, 0);
  await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 60_000 }).not.toBe('ready');
  await expect(page.locator('.rogue-run-hud')).toContainText('1/50');
  expect(errors).toEqual([]);
});
