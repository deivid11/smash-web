import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RoomFighter } from '../../lib/net/protocol.ts';
import { MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { openLan, chooseFighter, goToStage, backToCharacters } from './helpers/battle.ts';
import { confirmedConsensus } from './helpers/online.ts';

// Describe's default mode keeps these expensive tests sequential within this
// file. Also run this file and scenes.spec.ts with --workers=1 (CLI override).
test.describe.configure({ mode: 'default', timeout: 180_000 });

type NetworkSnapshot = ReturnType<NonNullable<Window['smashNetworkSnapshot']>>;
async function network(page: Page): Promise<NetworkSnapshot | null> {
  return page.evaluate(() => window.smashNetworkSnapshot?.() ?? null);
}

async function everyPeer(pages: Page[], assertion: (page: Page, index: number) => Promise<void>): Promise<void> {
  await Promise.all(pages.map(assertion));
}

async function capturePeers(pages: Page[], label: string, errors: string[] = []): Promise<void> {
  const directory = process.env.SMASH_BROWSER_ARTIFACT_DIR ?? test.info().outputPath('screenshots');
  await mkdir(directory, { recursive: true });
  for (const [slot, page] of pages.entries()) {
    if (page.isClosed()) continue;
    const prefix = `${pages.length}-players-${label}-p${slot + 1}`;
    const diagnostic = await page.evaluate(() => ({
      network: window.smashNetworkSnapshot?.(), match: window.smashMatchSnapshot?.(),
      status: document.querySelector('#load-progress')?.textContent,
      roomError: document.querySelector('.room-error')?.textContent,
      visibility: document.visibilityState,
    }));
    await writeFile(join(directory, `${prefix}.json`), JSON.stringify({ errors, ...diagnostic }, null, 2));
    await page.screenshot({ path: join(directory, `${prefix}.png`), fullPage: true, timeout: 15_000 });
  }
}

async function withPeers(browser: Browser, baseURL: string | undefined, count: number, run: (pages: Page[]) => Promise<void>): Promise<void> {
  if (!baseURL) throw new Error('The real-ISO server browser base URL must be configured.');
  const contexts: BrowserContext[] = [], pages: Page[] = [], errors: string[] = [];
  try {
    // Distinct contexts, not tabs: focus/visibility changes in a shared context
    // must not accidentally trigger the shared-match suspension policy.
    for (let slot = 0; slot < count; slot++) {
      const context = await browser.newContext({ baseURL, viewport: count > 4 ? { width: 640, height: 480 } : { width: 900, height: 700 } });
      contexts.push(context);
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => errors.push(`P${slot + 1}: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') errors.push(`P${slot + 1}: ${message.text()}`); });
      await page.goto('/play.html');
      await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
      await openLan(page);
      await page.locator('#player-name').fill(`Browser ${slot + 1}`);
      expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    }
    expect(new Set(pages.map(page => page.context())).size).toBe(count);
    await run(pages);
    expect(errors).toEqual([]);
  } catch (error) {
    await capturePeers(pages, 'failure', errors).catch(captureError => console.error('Could not capture all peer diagnostics:', captureError));
    throw error;
  } finally { await Promise.all(contexts.map(context => context.close())); }
}

/** Rooms are formed with each peer owning its own seat; `costumes` picks alternate skins
 * through the seat arrows (skins load on demand, like the fighters themselves). */
async function formRoom(pages: Page[], fighters: readonly RoomFighter[], costumes: readonly number[] = []): Promise<string> {
  const host = pages[0]!;
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect.poll(async () => (await network(host))?.room?.code).toMatch(/^[A-Z2-9]{6}$/u);
  const code = (await network(host))!.room!.code;
  await expect(host.locator('#active-room-code')).toHaveText(code);
  for (const guest of pages.slice(1)) {
    await guest.locator('#room-code').fill(code);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    // Joining is a websocket round trip on a client that is still loading in the background;
    // eight software-rendered browsers on one machine need more than the default poll window.
    await expect.poll(async () => (await network(guest))?.room?.code, { timeout: 30_000 }).toBe(code);
  }
  await everyPeer(pages, async (page, slot) => {
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    // Same budget as the join above: eight software-rendered browsers share one busy machine.
    await expect.poll(async () => (await network(page))?.room?.players.length, { timeout: 30_000 }).toBe(pages.length);
    expect((await network(page))?.slot).toBe(slot);
    expect((await network(page))?.room?.hostSlot).toBe(0);
    expect((await network(page))?.room?.players.map(player => player.name)).toEqual(pages.map((_, index) => `Browser ${index + 1}`));
    await expect(page.locator('.room-error')).toHaveText('');
    if (slot !== 0) {
      await expect(page.locator('#setup-stocks')).toBeDisabled();
      await expect(page.locator('#setup-seconds')).toBeDisabled();
      await expect(page.locator('#go-stage')).toBeEnabled();
      await expect(page.locator('#start-match')).toHaveCount(0);
      await goToStage(page);
      for (const stage of ['battlefield', 'final']) await expect(page.locator(`[data-stage="${stage}"]`)).toBeDisabled();
      await expect(page.locator('#start-match')).toBeDisabled();
      await backToCharacters(page);
    }
  });
  await host.locator('#setup-stocks').selectOption('4');
  for (const [slot, page] of pages.entries()) await chooseFighter(page, slot, fighters[slot]!);
  for (const [slot, page] of pages.entries()) {
    for (let press = 0; press < (costumes[slot] ?? 0); press++) {
      // Every room update re-renders the seat, so click the live node rather than a handle.
      await page.evaluate(id => document.getElementById(id)?.click(), `costume-next-${slot}`);
      await expect.poll(async () => (await network(page))?.room?.players.find(player => player.slot === slot)?.costume ?? 0).toBe(press + 1);
    }
  }
  await goToStage(host, 'final');
  await everyPeer(pages, async page => {
    await expect.poll(async () => (await network(page))?.room?.rules).toMatchObject({ stage: 'final', stocks: 4 });
    await expect.poll(async () => (await network(page))?.room?.players.map(player => player.fighter)).toEqual(fighters);
  });
  await expect(host.locator('#start-match')).toBeDisabled();
  await backToCharacters(host);
  for (const page of pages) await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await everyPeer(pages, async page => {
    // Ready is published only once that peer holds the room's fighters, skins and stage, so
    // anything outside the core set has to finish loading first.
    await expect.poll(async () => (await network(page))?.room?.players.every(player => player.ready), { timeout: 120_000 }).toBe(true);
  });
  return code;
}

async function startRoom(pages: Page[], fighters: readonly RoomFighter[]): Promise<void> {
  await goToStage(pages[0]!);
  await pages[0]!.locator('#start-match').click();
  await everyPeer(pages, async page => {
    await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: pages.length > 4 ? 90_000 : 45_000 }).toBe('playing');
    await expect.poll(async () => (await network(page))?.confirmedFrame ?? -1, { timeout: 30_000 }).toBeGreaterThan(120);
    expect((await network(page))?.room?.phase).toBe('playing');
    expect((await network(page))?.error).toBe('');
    const match = await page.evaluate(() => window.smashMatchSnapshot?.());
    expect(match?.paused).toBe(false);
    expect(match?.stage).toBe('final'); expect(match?.stageFloors).toBe(3);
    expect(match?.fighters.map(fighter => fighter.kind)).toEqual(fighters);
    expect(match?.fighters.map(fighter => fighter.stocks)).toEqual(fighters.map(() => 4));
    await expect(page.locator('#pause-match')).toBeDisabled();
    await expect(page.locator('#reset-match')).toBeDisabled();
    await expect(page.locator('#change-fighters')).toBeDisabled();
  });
}

async function exerciseIndependentInputs(pages: Page[]): Promise<void> {
  // Each context uses the SAME P1 binding, but it must affect its own room slot.
  await everyPeer(pages, async page => { await page.keyboard.down('KeyU'); });
  try {
    await everyPeer(pages, async page => {
      await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(fighter => fighter.state)), { timeout: 15_000 }).toEqual(pages.map(() => 'shield'));
    });
    for (const [slot, page] of pages.entries()) {
      await page.keyboard.up('KeyU');
      await everyPeer(pages, async observer => {
        await expect.poll(() => observer.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(fighter => fighter.state === 'shield')), { timeout: 10_000 }).toEqual(pages.map((_, index) => index > slot));
      });
    }
  } finally { await everyPeer(pages, async page => { await page.keyboard.up('KeyU'); }); }
  const before = await pages[0]!.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(fighter => fighter.x));
  expect(before).toHaveLength(pages.length);
  await everyPeer(pages, async page => { await page.keyboard.down('KeyD'); });
  try {
    await everyPeer(pages, async page => {
      await expect.poll(() => page.evaluate(before => window.smashMatchSnapshot?.()?.fighters.every((fighter, slot) => fighter.x > before[slot]! + 4), before!), { timeout: 15_000 }).toBe(true);
    });
  } finally { await everyPeer(pages, async page => { await page.keyboard.up('KeyD'); }); }
}

async function rejectNinthBrowser(browser: Browser, baseURL: string | undefined, code: string): Promise<void> {
  const context = await browser.newContext({ baseURL, viewport: { width: 640, height: 480 } });
  const errors: string[] = [], relayErrors: string[] = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('websocket', socket => socket.on('framereceived', frame => {
      const message = JSON.parse(String(frame.payload)) as { type: string; code?: string };
      if (message.type === 'error' && message.code) relayErrors.push(message.code);
    }));
    await page.goto('/play.html');
    await expect(page.locator('body')).toHaveAttribute('data-game-ready', 'true', { timeout: 60_000 });
    await openLan(page);
    await page.locator('#player-name').fill('Ninth browser');
    await page.locator('#room-code').fill(code);
    await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect.poll(() => relayErrors).toContain('ROOM_FULL');
    await expect(page.locator('.room-error')).toHaveText(`This room already has ${MAX_MATCH_PLAYERS} players.`);
    expect((await network(page))?.room).toBeNull(); expect((await network(page))?.slot).toBeNull();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

async function assertEightHud(page: Page): Promise<void> {
  await expect(page.locator('#arena .fighter-card')).toHaveCount(8);
  await expect(page.locator('#play-canvas')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const cards = [...document.querySelectorAll('.fighter-card')].map(card => ({
      card: rect(card), name: rect(card.querySelector('strong')!), percent: rect(card.querySelector('.percent')!),
      color: getComputedStyle(card).getPropertyValue('--player-color').trim(),
    }));
    const canvas = document.querySelector<HTMLCanvasElement>('#play-canvas')!;
    const style = getComputedStyle(canvas);
    return { cards, viewport: { width: innerWidth, height: innerHeight }, host: rect(document.querySelector('.canvas-host')!), hud: rect(document.querySelector('.fighters-hud')!), canvas: { ...rect(canvas), widthPixels: canvas.width, heightPixels: canvas.height, visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 } };
  });
  expect(geometry.canvas.visible).toBe(true); expect(geometry.canvas.widthPixels).toBeGreaterThan(0); expect(geometry.canvas.heightPixels).toBeGreaterThan(0);
  // The canvas fills the game view; portrait touch layouts shorten that view for the control panel.
  expect(geometry.canvas.width).toBe(geometry.host.width); expect(geometry.canvas.height).toBe(geometry.host.height); expect(geometry.host.width).toBe(geometry.viewport.width);
  expect(new Set(geometry.cards.map(card => card.color)).size).toBe(8);
  const rows = new Map<number, number>();
  for (const { card, name, percent } of geometry.cards) {
    expect(card.left).toBeGreaterThanOrEqual(0); expect(card.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(card.top).toBeGreaterThanOrEqual(0); expect(card.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(card.width).toBeGreaterThan(60); expect(card.height).toBeGreaterThanOrEqual(60);
    for (const label of [name, percent]) {
      expect(label.left).toBeGreaterThanOrEqual(card.left - 1); expect(label.right).toBeLessThanOrEqual(card.right + 1);
      expect(label.top).toBeGreaterThanOrEqual(card.top - 1); expect(label.bottom).toBeLessThanOrEqual(card.bottom + 1);
    }
    const top = Math.round(card.top); rows.set(top, (rows.get(top) ?? 0) + 1);
  }
  expect([...rows.values()]).toEqual([4, 4]);
  for (let a = 0; a < geometry.cards.length; a++) for (let b = a + 1; b < geometry.cards.length; b++) {
    const first = geometry.cards[a]!.card, second = geometry.cards[b]!.card;
    expect(first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top).toBe(false);
  }
  for (let slot = 0; slot < 8; slot++) {
    await expect(page.locator(`#fighter-name-${slot}`)).toBeVisible(); await expect(page.locator(`#percent-${slot}`)).toBeVisible();
  }
}

async function waitForEightFightersFramed(page: Page, beforeResizeFrame: number): Promise<void> {
  await expect.poll(() => page.evaluate(beforeFrame => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0;
    };
    const headerBottom = Math.max(0, ...[...document.querySelectorAll('.hud-top, .clock, .screen-tools, .match-actions, .network-telemetry')]
      .filter(visible).map(element => element.getBoundingClientRect().bottom));
    const hud = document.querySelector('.fighters-hud')!.getBoundingClientRect();
    // Leave room around the head labels, not merely their center projection.
    const safe = { left: 12, right: innerWidth - 12, top: Math.max(24, headerBottom + 8), bottom: hud.top - 8 };
    const tags = Array.from({ length: 8 }, (_, slot) => {
      const element = document.querySelector<HTMLElement>(`#fighter-tag-${slot}`);
      if (!element) return { slot, missing: true, framed: false };
      const box = element.getBoundingClientRect();
      const bounds = { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      const shown = !element.hidden && visible(element);
      return { slot, bounds, shown, framed: shown && box.left >= safe.left && box.right <= safe.right && box.top >= safe.top && box.bottom <= safe.bottom };
    });
    const canvas = document.querySelector<HTMLCanvasElement>('#play-canvas')!;
    const pixelRatio = Math.min(devicePixelRatio, 2);
    return {
      advanced: (window.smashMatchSnapshot?.()?.frame ?? -1) > beforeFrame,
      resized: (() => { const host = document.querySelector('.canvas-host')!.getBoundingClientRect(); return canvas.width === Math.floor(host.width * pixelRatio) && canvas.height === Math.floor(host.height * pixelRatio); })(),
      visibleTags: tags.filter(tag => tag.framed).length,
      outside: tags.filter(tag => !tag.framed), safe,
    };
  }, beforeResizeFrame), {
    timeout: 30_000,
    message: 'A post-resize rendered frame must place all eight fighter head labels inside the viewport, clear of top chrome and the HUD',
  }).toMatchObject({ advanced: true, resized: true, visibleTags: 8, outside: [] });
}

async function eightPlayerScreenshots(page: Page): Promise<void> {
  const directory = process.env.SMASH_BROWSER_ARTIFACT_DIR ?? test.info().outputPath('screenshots');
  await mkdir(directory, { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 960 }, { width: 900, height: 700 }, { width: 390, height: 844 }]) {
      const beforeResizeFrame = await page.evaluate(() => window.smashMatchSnapshot?.()?.frame ?? -1);
      await page.setViewportSize(viewport);
      await expect.poll(() => page.locator('#play-canvas').evaluate(canvas => Math.round(canvas.getBoundingClientRect().width))).toBe(viewport.width);
      await waitForEightFightersFramed(page, beforeResizeFrame);
      await assertEightHud(page);
      if (viewport.width === 390) {
        if (await page.locator('#touch-toggle').getAttribute('aria-pressed') !== 'true') await page.locator('#touch-toggle').click();
        const targets = await page.locator('#touch-controls button, #touch-stick').evaluateAll(buttons => buttons.map(button => {
          const rect = button.getBoundingClientRect(); const hud = document.querySelector('.fighters-hud')!.getBoundingClientRect();
          return { width: rect.width, height: rect.height, inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, clearHud: rect.bottom <= hud.top || rect.top >= hud.bottom || rect.right <= hud.left || rect.left >= hud.right };
        }));
        expect(targets).toHaveLength(8);
        for (const target of targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); expect(target.inside).toBe(true); expect(target.clearHud).toBe(true); }
      }
      await page.screenshot({ path: join(directory, `8-player-hud-${viewport.width}x${viewport.height}.png`), fullPage: false });
    }
  } finally { await page.setViewportSize({ width: 640, height: 480 }); }
}

async function eightPlayerInputs(pages: Page[]): Promise<number> {
  const started = Date.now();
  await everyPeer(pages, async page => { await page.keyboard.down('KeyU'); });
  try {
    await everyPeer(pages, async page => {
      await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.map(fighter => fighter.state)), { timeout: 25_000 }).toEqual(pages.map(() => 'shield'));
    });
    return Date.now() - started;
  } finally { await everyPeer(pages, async page => { await page.keyboard.up('KeyU'); }); }
}

test('two independent browsers share selected rules, P1 inputs, confirmed state and lobby termination', async ({ browser, baseURL }) => {
  await withPeers(browser, baseURL, 2, async pages => {
    const fighters = ['Fx', 'Mr'] as const;
    await formRoom(pages, fighters); await startRoom(pages, fighters);
    const initial = await confirmedConsensus(pages);
    await exerciseIndependentInputs(pages);
    await confirmedConsensus(pages, initial + 20);
    await capturePeers(pages, 'arena');
    // A local Escape must not unilaterally pause an online match.
    await pages[1]!.keyboard.press('Escape');
    await confirmedConsensus(pages, initial + 30);
    expect(await pages[1]!.evaluate(() => window.smashMatchSnapshot?.()?.paused)).toBe(false);
    await pages[1]!.getByRole('button', { name: 'Return to lobby', exact: true }).click();
    await everyPeer(pages, async page => {
      await expect.poll(async () => (await network(page))?.lastEnd?.code).toBe('RETURNED_TO_LOBBY');
      await expect.poll(async () => (await network(page))?.room?.phase).toBe('lobby');
      await expect(page.locator('#select-seat-0')).toBeVisible();
      expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.paused)).toBe(true);
      expect((await network(page))?.room?.players.every(player => !player.ready)).toBe(true);
      await expect(page.locator('.room-error')).toHaveText('');
    });
    const stopped = await Promise.all(pages.map(page => page.evaluate(() => window.smashMatchSnapshot?.()?.frame)));
    await pages[1]!.getByRole('button', { name: 'Leave room', exact: true }).click();
    await expect.poll(async () => (await network(pages[1]!))?.room).toBeNull();
    await expect.poll(async () => (await network(pages[0]!))?.room?.players.length).toBe(1);
    expect(await Promise.all(pages.map(page => page.evaluate(() => window.smashMatchSnapshot?.()?.frame)))).toEqual(stopped);
  });
});

/** Assets load on demand: a room's fighters, skins and stage are only resident on a peer that
 * asked for them. Ready therefore waits for this client's own assets and the warm set pins the
 * room's picks, or the host's Start bounces the whole room back to character select. */
test('two browsers start a LAN match with fighters and skins that load on demand', async ({ browser, baseURL }) => {
  await withPeers(browser, baseURL, 2, async pages => {
    // Neither kind is in the core set the game boots with, and both wear an alternate skin.
    const fighters = ['Ms', 'Pk'] as const;
    await formRoom(pages, fighters, [2, 1]);
    await everyPeer(pages, async page => {
      await expect.poll(async () => (await network(page))?.room?.players.map(player => player.costume ?? 0)).toEqual([2, 1]);
      // Ready is only published once the peer could start this selection.
      expect((await network(page))?.preparing).toBe(false);
    });
    await startRoom(pages, fighters);
    await confirmedConsensus(pages);
    await everyPeer(pages, async page => {
      const match = await page.evaluate(() => window.smashMatchSnapshot?.());
      expect(match?.fighters.map(fighter => fighter.kind)).toEqual(fighters);
      expect((await network(page))?.error).toBe('');
      expect((await network(page))?.room?.phase).toBe('playing');
    });
  });
});

test('four independent browsers converge after per-slot inputs, hold for one hidden tab and resume when it returns', async ({ browser, baseURL }) => {
  await withPeers(browser, baseURL, 4, async pages => {
    const fighters = ['Fx', 'Mr', 'Kb', 'Fx'] as const;
    await formRoom(pages, fighters); await startRoom(pages, fighters);
    const initial = await confirmedConsensus(pages);
    await exerciseIndependentInputs(pages);
    const settled = await confirmedConsensus(pages, initial + 20);
    await capturePeers(pages, 'arena');
    // Explicitly exercise the visibility handler in one context. Do not depend
    // on headless focus/tab switching to emulate actual OS process suspension.
    const backgrounded = pages[3]!;
    await backgrounded.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    let held: number[] = [];
    try {
      // Protocol v8: a hidden tab holds its seat instead of closing the match. Nobody invents its
      // inputs, so every peer stalls at the prediction cap behind the hold notice.
      await everyPeer(pages, async page => {
        await expect.poll(async () => (await network(page))?.room?.players.find(player => player.slot === 3)?.connected).toBe(false);
        expect((await network(page))?.room?.phase).toBe('playing'); expect((await network(page))?.lastEnd).toBeNull();
      });
      await expect(pages[0]!.locator('#network-notice')).toContainText('Waiting for Browser 4');
      await pages[0]!.waitForTimeout(600);
      held = await Promise.all(pages.map(async page => (await network(page))!.confirmedFrame));
      await pages[0]!.waitForTimeout(600);
      expect(await Promise.all(pages.map(async page => (await network(page))!.confirmedFrame))).toEqual(held);
    } finally {
      await backgrounded.evaluate(() => {
        Reflect.deleteProperty(document, 'hidden'); Reflect.deleteProperty(document, 'visibilityState');
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    await everyPeer(pages, async page => { await expect.poll(async () => (await network(page))?.room?.players.some(player => player.connected === false)).toBe(false); });
    await confirmedConsensus(pages, Math.max(settled, ...held) + 60);
    await expect(pages[0]!.locator('#network-notice')).toHaveCount(0);
    await pages[0]!.getByRole('button', { name: 'Return to lobby', exact: true }).first().click();
    await everyPeer(pages, async page => { await expect.poll(async () => (await network(page))?.room?.phase).toBe('lobby'); });
    const stopped = await Promise.all(pages.map(page => page.evaluate(() => window.smashMatchSnapshot?.()?.frame)));
    await pages[0]!.waitForTimeout(400);
    expect(await Promise.all(pages.map(page => page.evaluate(() => window.smashMatchSnapshot?.()?.frame)))).toEqual(stopped);
  });
});

test('eight independent browsers render eight fighters, reject a ninth, converge and terminate together', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  expect(MAX_MATCH_PLAYERS).toBe(8);
  await withPeers(browser, baseURL, 8, async pages => {
    const fighters = ['Fx', 'Mr', 'Ss', 'Kb', 'Fx', 'Mr', 'Ss', 'Kb'] as const;
    const code = await formRoom(pages, fighters);
    await expect(pages[0]!.locator('.player-seat')).toHaveCount(8);
    for (let slot = 0; slot < 8; slot++) await expect(pages[0]!.locator(`#seat-kind-${slot}`)).toHaveValue('human');
    // The ninth browser also loads real assets, but never receives a room slot.
    await rejectNinthBrowser(browser, baseURL, code);
    await everyPeer(pages, async page => {
      expect((await network(page))?.room?.players.length).toBe(8);
      expect((await network(page))?.room?.players.every(player => player.ready)).toBe(true);
    });
    await startRoom(pages, fighters);
    await confirmedConsensus(pages);
    await everyPeer(pages, async page => {
      await assertEightHud(page);
      for (let slot = 0; slot < 8; slot++) await expect(page.locator(`#fighter-tag-${slot}`)).toBeVisible();
      const colors = await page.locator('#play-canvas').evaluate(canvas => {
        const sample = document.createElement('canvas'); sample.width = sample.height = 64;
        const context = sample.getContext('2d')!; context.drawImage(canvas as HTMLCanvasElement, 0, 0, 64, 64);
        const pixels = context.getImageData(0, 0, 64, 64).data, values = new Set<number>();
        for (let index = 0; index < pixels.length; index += 4) values.add((pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!);
        return values.size;
      });
      expect(colors).toBeGreaterThan(100);
    });
    const inputPropagationObservedMs = await eightPlayerInputs(pages);
    await everyPeer(pages, async page => {
      await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.fighters.every(fighter => fighter.state !== 'shield')), { timeout: 20_000 }).toBe(true);
    });
    const afterInput = Math.max(...(await Promise.all(pages.map(page => network(page)))).map(snapshot => snapshot!.frame));
    const checkpoint = await confirmedConsensus(pages, afterInput + 30);
    const observations = (await Promise.all(pages.map(page => network(page)))).map(snapshot => ({
      slot: snapshot!.slot, estimatedRttMs: snapshot!.latencyMs === null ? null : snapshot!.latencyMs * 2,
      rollbacks: snapshot!.rollbacks, resimulatedFrames: snapshot!.resimulatedFrames, predictionFrames: snapshot!.predictionFrames,
    }));
    await test.info().attach('eight-browser-observations', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      note: 'Actual browser/relay observations under software rendering; wall time includes Playwright polling and rendering. Not a hardware-input latency or competitive-network guarantee.',
      inputPropagationObservedMs, confirmedCheckpoint: checkpoint, peers: observations,
    }, null, 2)) });
    await eightPlayerScreenshots(pages[0]!);
    await confirmedConsensus(pages, checkpoint + 30);
    await capturePeers(pages, 'arena');
    // A non-host slot terminates the shared match; nobody keeps simulating alone.
    await pages[7]!.getByRole('button', { name: 'Return to lobby', exact: true }).click();
    await everyPeer(pages, async page => {
      await expect.poll(async () => (await network(page))?.lastEnd?.code).toBe('RETURNED_TO_LOBBY');
      await expect.poll(async () => (await network(page))?.room?.phase).toBe('lobby');
      expect(await page.evaluate(() => window.smashMatchSnapshot?.()?.paused)).toBe(true);
      await expect(page.locator('.room-error')).toHaveText('');
    });
    const stopped = await Promise.all(pages.map(page => page.evaluate(() => window.smashMatchSnapshot?.()?.frame)));
    await pages[7]!.getByRole('button', { name: 'Leave room', exact: true }).click();
    await expect.poll(async () => (await network(pages[7]!))?.room).toBeNull();
    await everyPeer(pages.slice(0, 7), async page => { await expect.poll(async () => (await network(page))?.room?.players.length).toBe(7); });
    expect(await Promise.all(pages.map(page => page.evaluate(() => window.smashMatchSnapshot?.()?.frame)))).toEqual(stopped);
  });
});
