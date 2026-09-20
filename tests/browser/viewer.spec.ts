import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const localDisc = process.env.MELEE_DISC_PATH;
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = []; errors.set(page, list);
  page.on('pageerror', (error) => list.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') list.push(message.text()); });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function ready(page: Page, mode: string): Promise<void> {
  await expect(page.locator('#viewer-status')).toHaveText('ORIGINAL ASSETS RENDERING', { timeout: 30_000 });
  await expect(page.locator('body')).toHaveAttribute('data-scene-ready', mode);
}
async function load(page: Page): Promise<void> {
  test.skip(!localDisc, 'Set MELEE_DISC_PATH to exercise original model rendering with your own disc.');
  await page.goto('/viewer.html');
  await page.getByLabel('Select local ISO').setInputFiles(localDisc!);
  await ready(page, 'battlefield');
}
async function seek(page: Page, frame: number): Promise<void> {
  await page.locator('#frame-slider').evaluate((input, frame) => {
    (input as HTMLInputElement).value = String(frame); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, frame);
}
async function canvasImage(page: Page): Promise<string> {
  return page.locator('#scene-canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
}

test('does not fake a scene before the user supplies a disc', async ({ page }) => {
  await page.goto('/viewer.html');
  await expect(page.locator('#viewer-status')).toHaveText('SELECT YOUR DISC');
  await expect(page.locator('#scene-canvas')).toHaveCount(0);
  await expect(page.locator('#scene-select')).toBeDisabled();
  await expect(page.getByText('ORIGINAL-ASSET VIEWER — NOT GAMEPLAY')).toBeVisible();
});

test('rejects a malformed disc without upload requests', async ({ page }) => {
  await page.goto('/viewer.html');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.getByLabel('Select local ISO').setInputFiles({ name: 'invalid.iso', mimeType: 'application/octet-stream', buffer: Buffer.alloc(16) });
  await expect(page.locator('#viewer-status')).toHaveText('RENDER ERROR');
  await expect(page.locator('#load-message')).toContainText('invalid or truncated');
  expect(requests).toEqual([]);
});

test('renders textured original Battlefield and fighter meshes entirely locally', async ({ page }, testInfo) => {
  test.skip(!localDisc, 'Requires the user-owned local ISO.');
  await page.goto('/viewer.html');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.getByLabel('Select local ISO').setInputFiles(localDisc!);
  await ready(page, 'battlefield'); await seek(page, 12);
  await expect(page.locator('#asset-stats')).toContainText('26,269');
  await expect(page.locator('#load-message')).toContainText('PlFxAJ.dat');
  const uniqueColors = await page.locator('#scene-canvas').evaluate((canvas) => {
    const sample = document.createElement('canvas'); sample.width = 128; sample.height = 128;
    const ctx = sample.getContext('2d')!; ctx.drawImage(canvas as HTMLCanvasElement, 0, 0, 128, 128);
    const pixels = ctx.getImageData(0, 0, 128, 128).data;
    const colors = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) colors.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
    return colors.size;
  });
  expect(uniqueColors).toBeGreaterThan(500);
  expect(requests).toEqual([]);
  const artifacts = process.env.SMASH_RENDER_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: artifacts ? join(artifacts, 'tested-battlefield.png') : testInfo.outputPath('battlefield.png'), fullPage: true });
});

test('plays original animation keys and reproduces a pose when seeking back', async ({ page }) => {
  await load(page);
  await page.locator('#scene-select').selectOption('fox'); await ready(page, 'fox');
  await expect(page.locator('#fighter-count')).toBeDisabled();
  await seek(page, 0); const first = await canvasImage(page);
  await seek(page, 25); expect(await canvasImage(page)).not.toBe(first);
  await seek(page, 0); expect(await canvasImage(page)).toBe(first);
  await page.locator('#action-select').selectOption('Attack11'); await ready(page, 'fox');
  await seek(page, 8); expect(await canvasImage(page)).not.toBe(first);
  await expect(page.locator('#load-message')).toContainText('No gameplay simulation');
});

test('renders additional original stages and a static trophy', async ({ page }) => {
  await load(page);
  for (const mode of ['final', 'yoshi', 'mario', 'trophy']) {
    await page.locator('#scene-select').selectOption(mode); await ready(page, mode);
    await expect(page.locator('#asset-stats')).toBeVisible();
  }
  await expect(page.locator('#action-select')).toBeDisabled();
  await expect(page.locator('#asset-stats')).toContainText('6,016');
});

test('renders four models and downloads a labeled local screenshot', async ({ page }) => {
  await load(page);
  await page.locator('#fighter-count').selectOption('4'); await ready(page, 'battlefield');
  await expect(page.locator('#asset-stats')).toContainText('39,255');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save rendered image' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('smash-web-original-assets.png');
  expect(await download.failure()).toBeNull();
});

test('verifies and renders the real disc without secure-context Web Crypto', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }));
  await load(page);
  expect(await page.evaluate(() => globalThis.crypto.subtle)).toBeUndefined();
  await expect(page.locator('#asset-stats')).toContainText('26,269');
});

test('keeps the viewer usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/viewer.html');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel('Select local ISO')).toBeEnabled();
});
