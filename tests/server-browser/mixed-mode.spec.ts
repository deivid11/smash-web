import { expect, test, type Page } from '@playwright/test';
import { openControllerSettings, openPauseMenu, openSolo, openLan, setSeat, chooseFighter, goToStage, backToCharacters, startBattle, type SeatControl } from './helpers/battle.ts';
import { confirmedConsensus, createAndJoin, network, withLanPeers } from './helpers/online.ts';
import type { RoomFighter } from '../../lib/net/protocol.ts';
import { captureBattle } from './helpers/artifacts.ts';

interface MixedPad { buttons: { pressed: boolean; value: number }[] }
declare global { interface Window { mixedPad: MixedPad } }

test.describe.configure({ mode: 'default', timeout: 180_000 });
const roster = ['Fx', 'Mr', 'Ss', 'Kb', 'Fx', 'Mr', 'Ss', 'Kb'] as const;
const match = (page: Page) => page.evaluate(() => window.smashMatchSnapshot?.());
const frames = (page: Page, count: number) => page.clock.runFor(count * 17);

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) await captureBattle(page, 'failure').catch(error => console.error('Failure capture:', error));
});

async function solo(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto('/play.html');
  await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('#mode-solo')).toBeVisible();
  await expect(page.locator('#mode-lan')).toBeVisible();
  await expect(page.locator('#start-match')).toHaveCount(0);
  await captureBattle(page, 'home');
  await openSolo(page);
  await expect(page.locator('.player-seat')).toHaveCount(8);
  await expect(page.locator('#seat-kind-0')).toHaveValue('human');
  await expect(page.locator('#select-seat-0')).toContainText(/Fox/i);
  await expect(page.locator('#seat-kind-1')).toHaveValue('cpu');
  await expect(page.locator('#select-seat-1')).toContainText(/Mario/i);
  for (let seat = 2; seat < 8; seat++) await expect(page.locator(`#seat-kind-${seat}`)).toHaveValue('off');
  await expect(page.locator('#start-match')).toHaveCount(0);
}

async function startFrozen(page: Page, duringCountdown?: () => Promise<void>): Promise<void> {
  await startBattle(page);
  if (duringCountdown) await duringCountdown();
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  // Keep the original mechanics suite's post-countdown startup convention.
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function assertRoster(page: Page, seats: number[], controls: Exclude<SeatControl, 'off'>[], fighters: readonly RoomFighter[]): Promise<void> {
  const snapshot = await match(page);
  expect(snapshot?.fighters.map(fighter => fighter.seatId)).toEqual(seats);
  expect(snapshot?.fighters.map(fighter => fighter.controllerKind)).toEqual(controls);
  expect(snapshot?.fighters.map(fighter => fighter.kind)).toEqual(fighters);
  await expect(page.locator('#arena .fighter-card')).toHaveCount(seats.length);
}

test('Solo three sparse seats preserve stage/back choices and route P1/P2 by HUMAN ordinal, not seat number', async ({ page }) => {
  const errors = watchErrors(page); await solo(page);
  await setSeat(page, 1, 'off');
  await setSeat(page, 3, 'human', 'Mr');
  await setSeat(page, 7, 'cpu', 'Kb');
  await chooseFighter(page, 0, 'Ss');
  await page.locator('#setup-stocks').selectOption('4');
  await page.locator('#setup-seconds').selectOption('120');
  await goToStage(page, 'final');
  await captureBattle(page, 'stage');
  await backToCharacters(page);
  await expect(page.locator('#setup-stocks')).toHaveValue('4');
  await expect(page.locator('#setup-seconds')).toHaveValue('120');
  for (const [seat, control] of [[0, 'human'], [1, 'off'], [3, 'human'], [7, 'cpu']] as const) await expect(page.locator(`#seat-kind-${seat}`)).toHaveValue(control);
  await expect(page.locator('[data-fighter="Ss"]')).toHaveAttribute('aria-pressed', 'true');
  await goToStage(page);
  await expect(page.locator('[data-stage="final"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#start-match').click();
  await page.waitForFunction(() => window.smashMatchSnapshot?.()?.phase === 'playing');
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await assertRoster(page, [0, 3, 7], ['human', 'human', 'cpu'], ['Ss', 'Mr', 'Kb']);
  expect((await match(page))?.stage).toBe('final');
  expect((await match(page))?.stageFloors).toBe(3);
  expect((await match(page))!.remainingFrames).toBeLessThanOrEqual(120 * 60);
  expect((await match(page))!.remainingFrames).toBeGreaterThan(115 * 60);
  expect((await match(page))?.fighters.map(fighter => fighter.stocks)).toEqual([4, 4, 4]);
  const cpuBefore = (await match(page))!.fighters[2]!;
  await page.keyboard.down('KeyU'); await frames(page, 3);
  expect((await match(page))?.fighters[0].state).toBe('shield');
  expect((await match(page))?.fighters[1].state).not.toBe('shield');
  await page.keyboard.down('ShiftRight'); await frames(page, 3);
  expect((await match(page))?.fighters.slice(0, 2).map(fighter => fighter.state)).toEqual(['shield', 'shield']);
  await page.keyboard.up('KeyU'); await frames(page, 20);
  expect((await match(page))?.fighters[0].state).not.toBe('shield');
  expect((await match(page))?.fighters[1].state).toBe('shield');
  await page.keyboard.up('ShiftRight'); await frames(page, 30);
  const cpuAfter = (await match(page))!.fighters[2]!;
  expect([cpuAfter.x, cpuAfter.y, cpuAfter.animationFrame]).not.toEqual([cpuBefore.x, cpuBefore.y, cpuBefore.animationFrame]);
  await openPauseMenu(page);await page.locator('#change-fighters').click();
  for (const [seat, control] of [[0, 'human'], [1, 'off'], [3, 'human'], [7, 'cpu']] as const) await expect(page.locator(`#seat-kind-${seat}`)).toHaveValue(control);
  await page.locator('#back-to-mode').click();
  await expect(page.locator('#mode-solo')).toBeVisible();
  await openSolo(page);
  for (const [seat, control] of [[0, 'human'], [1, 'off'], [3, 'human'], [7, 'cpu']] as const) await expect(page.locator(`#seat-kind-${seat}`)).toHaveValue(control);
  await expect(page.locator('#setup-stocks')).toHaveValue('4');
  await expect(page.locator('#setup-seconds')).toHaveValue('120');
  await goToStage(page);
  await expect(page.locator('[data-stage="final"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('Solo eight mixed seats use two keyboard humans plus a third assigned controller, with internal CPU opponents', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const pad = { index: 0, id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    window.mixedPad = pad;
  });
  await solo(page);
  const controls = ['human', 'cpu', 'cpu', 'human', 'cpu', 'cpu', 'cpu', 'human'] as const;
  for (let seat = 0; seat < 8; seat++) await setSeat(page, seat, controls[seat]!, roster[seat]);
  const setupBounds = await page.locator('.player-seat').evaluateAll(seats => seats.map(seat => {
    const bounds = seat.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, inside: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight };
  }));
  expect(setupBounds).toHaveLength(8);
  for (const seat of setupBounds) { expect(seat.inside).toBe(true); expect(seat.width).toBeGreaterThan(60); expect(seat.height).toBeGreaterThan(60); }
  await captureBattle(page, 'solo-eight-mixed-setup');
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await captureBattle(page, 'solo-eight-mobile-390');
  await page.setViewportSize(viewport);
  await openControllerSettings(page);
  const assignment = page.locator('[data-controller-index="0"] .controller-panel__assignment select');
  await expect(assignment.locator('option')).toHaveCount(4); // Unassigned + three human source ordinals, never CPU seats.
  await assignment.selectOption('2');
  await page.getByRole('button', { name: 'Close options', exact: true }).click();
  await startFrozen(page, async () => {
    // The eight-seat layout puts a CPU within dash-attack reach of human P4.
    // Observe neutral countdown frames so the re-armed controller is usable,
    // then hold all three real input sources BEFORE CPUs can attack at GO.
    // Never require a fighter already in hitstun to shield-cancel that hitstun.
    await page.waitForFunction(() => { const state = window.smashMatchSnapshot?.(); return state?.phase === 'countdown' && state.frame >= 2; });
    await page.keyboard.down('KeyU'); await page.keyboard.down('ShiftRight');
    await page.evaluate(() => { window.mixedPad.buttons[6] = { pressed: true, value: 1 }; });
  });
  await assertRoster(page, [0, 1, 2, 3, 4, 5, 6, 7], [...controls], roster);
  await captureBattle(page, 'solo-eight-mixed-arena');
  await frames(page, 4);
  const shielding = (await match(page))!.fighters;
  for (const seat of [0, 3, 7]) expect(shielding[seat]!.state).toBe('shield');
  await page.keyboard.up('KeyU'); await page.keyboard.up('ShiftRight');
  await page.evaluate(() => { window.mixedPad.buttons[6] = { pressed: false, value: 0 }; });
  const before = (await match(page))!.fighters.map(fighter => [fighter.x, fighter.y]);
  await frames(page, 75);
  const after = (await match(page))!.fighters;
  expect(after.some((fighter, seat) => controls[seat] === 'cpu' && (fighter.x !== before[seat]![0] || fighter.y !== before[seat]![1]))).toBe(true);
  expect(errors).toEqual([]);
});

test('Solo all-CPU exhibition actually advances without reserving a human keyboard or controller slot', async ({ page }) => {
  const errors = watchErrors(page); await solo(page);
  await setSeat(page, 0, 'cpu', 'Fx');
  await setSeat(page, 1, 'cpu', 'Mr');
  await setSeat(page, 4, 'cpu', 'Kb');
  await openControllerSettings(page);
  await expect(page.locator('.controller-panel')).toContainText(/CPU exhibition/i);
  await page.getByRole('button', { name: 'Close options', exact: true }).click();
  await startFrozen(page);
  await assertRoster(page, [0, 1, 4], ['cpu', 'cpu', 'cpu'], ['Fx', 'Mr', 'Kb']);
  const before = (await match(page))!;
  await page.keyboard.down('KeyU'); await page.keyboard.down('ShiftRight');
  await frames(page, 90);
  const after = (await match(page))!;
  expect(after.frame).toBeGreaterThan(before.frame + 80);
  expect(after.fighters.some((fighter, index) => fighter.x !== before.fighters[index]!.x || fighter.y !== before.fighters[index]!.y)).toBe(true);
  // Normal CPU AI does not hold the humans' shield binding.
  expect(after.fighters.every(fighter => fighter.state !== 'shield')).toBe(true);
  await page.keyboard.up('KeyU'); await page.keyboard.up('ShiftRight');
  await page.locator('#pause-match').click();
  const paused = await match(page); await frames(page, 30);
  expect(await match(page)).toEqual(paused);
  expect(errors).toEqual([]);
});

test('LAN one human can ready and start against one CPU without a phantom second browser', async ({ browser, baseURL }) => {
  await withLanPeers(browser, baseURL, 1, async pages => {
    const host = pages[0]!;
    await createAndJoin(pages);
    await expect(host.locator('#go-stage')).toBeDisabled();
    await setSeat(host, 7, 'cpu', 'Mr');
    await expect.poll(async () => (await network(host))?.room?.players.map(player => [player.slot, player.control])).toEqual([[0, 'human'], [7, 'cpu']]);
    await goToStage(host, 'final');
    await expect(host.locator('#start-match')).toBeDisabled();
    await host.getByRole('button', { name: 'Ready', exact: true }).click();
    await expect(host.locator('#start-match')).toBeEnabled();
    await host.locator('#start-match').click();
    await expect.poll(async () => (await match(host))?.phase, { timeout: 60_000 }).toBe('playing');
    await assertRoster(host, [0, 7], ['human', 'cpu'], ['Fx', 'Mr']);
    // This checks progress and retained hash bounds for a sole human socket;
    // actual multi-peer agreement is checked by the following two-browser tests.
    const checkpoint = await confirmedConsensus(pages);
    await host.keyboard.down('KeyU');
    await expect.poll(async () => (await match(host))?.fighters[0].state).toBe('shield');
    await host.keyboard.up('KeyU');
    await confirmedConsensus(pages, checkpoint + 30);
    await host.getByRole('button', { name: 'Return to lobby', exact: true }).click();
    await expect.poll(async () => (await network(host))?.lastEnd?.code).toBe('RETURNED_TO_LOBBY');
    await expect(host.locator('#seat-kind-7')).toHaveValue('cpu');
  });
});

for (const cpuSeats of [[3, 7], [2, 3, 4, 5, 6, 7]]) test(`LAN two humans plus ${cpuSeats.length} CPUs preserve ownership and converge at confirmed frames`, async ({ browser, baseURL }) => {
  await withLanPeers(browser, baseURL, 2, async pages => {
    const [host, guest] = pages as [Page, Page];
    const code = await createAndJoin(pages);
    await chooseFighter(host, 0, 'Fx'); await chooseFighter(guest, 1, 'Mr');
    for (const seat of cpuSeats) await setSeat(host, seat, 'cpu', roster[seat]);
    const seats = [0, 1, ...cpuSeats], controls = ['human', 'human', ...cpuSeats.map(() => 'cpu')] as const;
    await captureBattle(host, 'lan-mixed-setup');
    for (const page of pages) {
      await expect.poll(async () => (await network(page))?.room?.players.map(player => [player.slot, player.control, player.fighter])).toEqual(seats.map((seat, index) => [seat, controls[index], roster[seat]]));
    }
    // Neither host nor guest may replace another connected human; guests cannot
    // edit host rules/CPU choices or select somebody else's portrait target.
    for (const page of pages) for (const seat of [0, 1]) await expect(page.locator(`#seat-kind-${seat}`)).toBeDisabled();
    await expect(host.locator('#select-seat-1')).toBeDisabled();
    await expect(guest.locator('#select-seat-0')).toBeDisabled();
    await expect(guest.locator('#setup-stocks')).toBeDisabled();
    await expect(guest.locator('#setup-seconds')).toBeDisabled();
    await expect(guest.locator('#go-stage')).toBeEnabled();
    await goToStage(guest);
    for (const stage of ['battlefield', 'final']) await expect(guest.locator(`[data-stage="${stage}"]`)).toBeDisabled();
    await expect(guest.locator('#start-match')).toBeDisabled();
    await backToCharacters(guest);
    for (const seat of cpuSeats) {
      await expect(guest.locator(`#seat-kind-${seat}`)).toBeDisabled();
      await expect(guest.locator(`#select-seat-${seat}`)).toBeDisabled();
    }
    await host.locator('#setup-stocks').selectOption('4');
    await goToStage(host, 'final');
    await captureBattle(host, 'lan-stage');
    await expect(host.locator('#start-match')).toBeDisabled();
    await backToCharacters(host);
    for (const page of pages) await page.getByRole('button', { name: 'Ready', exact: true }).click();
    for (const page of pages) await expect.poll(async () => (await network(page))?.room?.players.every(player => player.ready)).toBe(true);
    if (seats.length === 8) {
      // Capacity is occupied seats, not socket count: two humans + six CPUs
      // reject a ninth occupant without replacing a bot or assigning a token.
      const context = await browser.newContext({ baseURL });
      try {
        const ninth = await context.newPage(), relayErrors: string[] = [];
        ninth.on('websocket', socket => socket.on('framereceived', frame => {
          const message = JSON.parse(String(frame.payload)) as { type: string; code?: string };
          if (message.type === 'error' && message.code) relayErrors.push(message.code);
        }));
        await ninth.goto('/play.html');
        await expect(ninth.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
        await openLan(ninth); await ninth.locator('#room-code').fill(code);
        await ninth.getByRole('button', { name: 'Join room', exact: true }).click();
        await expect.poll(() => relayErrors).toContain('ROOM_FULL');
        await expect(ninth.locator('.room-error')).toHaveText('This room already has 8 players.');
        expect((await network(ninth))?.room).toBeNull(); expect((await network(ninth))?.slot).toBeNull();
        expect((await network(host))?.room?.players.map(player => player.slot)).toEqual(seats);
        expect((await network(host))?.room?.players.every(player => player.ready)).toBe(true);
      } finally { await context.close(); }
    }
    await goToStage(host);
    await expect(host.locator('[data-stage="final"]')).toHaveAttribute('aria-pressed', 'true');
    await host.locator('#start-match').click();
    for (const page of pages) {
      await expect.poll(async () => (await match(page))?.phase, { timeout: 60_000 }).toBe('playing');
      await assertRoster(page, seats, [...controls] as ('human' | 'cpu')[], seats.map(seat => roster[seat]!));
      expect((await match(page))?.stage).toBe('final');
      await expect(page.locator('#pause-match')).toBeDisabled();
      await expect(page.locator('#reset-match')).toBeDisabled();
      await expect(page.locator('#change-fighters')).toBeDisabled();
    }
    const initial = await confirmedConsensus(pages);
    // Ownership, one human at a time: a held full shield breaks after ~3.6 real
    // seconds at 60 Hz and six CPUs knock the edge seats around, so each check
    // only requires the pressing human's fighter to shield while the other does not.
    const shielding = (page: Page) => async () => (await match(page))?.fighters.slice(0, 2).map(fighter => fighter.state === 'shield');
    await host.keyboard.down('KeyU');
    for (const page of pages) await expect.poll(shielding(page), { timeout: 15_000 }).toEqual([true, false]);
    await host.keyboard.up('KeyU');
    await guest.keyboard.down('KeyU');
    for (const page of pages) await expect.poll(shielding(page), { timeout: 15_000 }).toEqual([false, true]);
    await guest.keyboard.up('KeyU');
    for (const page of pages) await expect.poll(shielding(page), { timeout: 15_000 }).toEqual([false, false]);
    await confirmedConsensus(pages, initial + 30);
    // Online Escape still cannot unilaterally freeze the mixed shared match.
    await guest.keyboard.press('Escape');
    expect((await match(guest))?.paused).toBe(false);
    await confirmedConsensus(pages, initial + 60);
    await guest.getByRole('button', { name: 'Return to lobby', exact: true }).click();
    for (const page of pages) {
      await expect.poll(async () => (await network(page))?.lastEnd?.code).toBe('RETURNED_TO_LOBBY');
      await expect.poll(async () => (await network(page))?.room?.phase).toBe('lobby');
      expect((await match(page))?.paused).toBe(true);
      expect((await network(page))?.room?.players.filter(player => player.control === 'human').every(player => !player.ready)).toBe(true);
      expect((await network(page))?.room?.players.filter(player => player.control === 'cpu').every(player => player.ready)).toBe(true);
      for (const seat of cpuSeats) await expect(page.locator(`#seat-kind-${seat}`)).toHaveValue('cpu');
    }
  });
});
