import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { VIEWER_ASSETS, SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

async function ready(page: Page, mode = 'battlefield'): Promise<void> {
  await expect(page.locator('#viewer-status')).toHaveText('ORIGINAL ASSETS RENDERING', { timeout: 30_000 });
  await expect(page.locator('body')).toHaveAttribute('data-scene-ready', mode);
}

test('loads the server ISO automatically and renders in the browser without a file picker', async ({ page }, testInfo) => {
  const errors: string[] = [], requests: Array<{ path: string; range: string | undefined; method: string }> = [];
  let assetBytes = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.url().includes('/api/assets/')) requests.push({ path: new URL(request.url()).pathname, range: request.headers().range, method: request.method() }); });
  page.on('response', (response) => { if (response.url().includes('/api/assets/')) assetBytes += Number(response.headers()['content-length'] ?? 0); });
  await page.goto('/viewer.html'); await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-source-mode', 'server');
  await expect(page.locator('#source-status')).toContainText('SERVER ISO');
  await expect(page.locator('#asset-stats')).toContainText('26,269');
  expect(await page.locator('#viewer-disc').evaluate((input) => (input as HTMLInputElement).files?.length ?? 0)).toBe(0);
  expect(requests).toHaveLength(7);
  for (const request of requests) {
    expect(request.method).toBe('GET'); expect(request.range).toMatch(/^bytes=\d+-\d+$/u);
    expect(VIEWER_ASSETS).toContain(request.path.replace('/api/assets/', ''));
  }
  expect(assetBytes).toBeGreaterThan(1_000_000); expect(assetBytes).toBeLessThan(3_000_000);
  const colors = await page.locator('#scene-canvas').evaluate((canvas) => {
    const sample = document.createElement('canvas'); sample.width = sample.height = 64;
    const ctx = sample.getContext('2d')!; ctx.drawImage(canvas as HTMLCanvasElement, 0, 0, 64, 64);
    const bytes = ctx.getImageData(0, 0, 64, 64).data, values = new Set<number>();
    for (let i = 0; i < bytes.length; i += 4) values.add((bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!);
    return values.size;
  });
  expect(colors).toBeGreaterThan(300); expect(errors).toEqual([]);
  const artifacts = process.env.SMASH_SERVER_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: artifacts ? join(artifacts, 'tested-server-render.png') : testInfo.outputPath('server-render.png'), fullPage: true });
});

test('streams selected animation ranges but does not request data for each rendered frame', async ({ page }) => {
  await page.goto('/viewer.html'); await ready(page);
  await page.locator('#scene-select').selectOption('fox'); await ready(page, 'fox');
  const clips: number[] = [];
  page.on('response', (response) => { if (response.url().endsWith('/api/assets/PlFxAJ.dat')) clips.push(Number(response.headers()['content-length'])); });
  await page.locator('#action-select').selectOption('Run'); await ready(page, 'fox');
  expect(clips.length).toBeGreaterThan(0); expect(Math.max(...clips)).toBeLessThan(256 * 1024);
  let requests = 0; page.on('request', (request) => { if (request.url().includes('/api/')) requests++; });
  const image = () => page.locator('#scene-canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  const seek = async (frame: number) => page.locator('#frame-slider').evaluate((input, frame) => { (input as HTMLInputElement).value = String(frame); input.dispatchEvent(new Event('input', { bubbles: true })); }, frame);
  await seek(0); const first = await image(); await seek(8); expect(await image()).not.toBe(first);
  await seek(0); expect(await image()).toBe(first); expect(requests).toBe(0);
  await page.locator('#scene-select').selectOption('final'); await ready(page, 'final');
});

test('does not expose the ISO, executable, unrelated assets, or private files', async ({ request }) => {
  const response = await request.get('/api/source'); expect(response.status()).toBe(200);
  const text = await response.text(); expect(text).not.toContain('/home/'); expect(text).not.toContain('.iso'); expect(JSON.parse(text).files).toHaveLength(SERVER_ASSETS.length);
  for (const path of ['/api/disc', '/api/assets/main.dol', '/api/assets/opening.bnr', '/private/disc-report.json', '/.local/toolchain.json']) {
    expect((await request.get(path)).status()).toBe(404);
  }
  expect((await request.get('/api/assets/GrNBa.dat', { headers: { Range: 'bytes=999999999-' } })).status()).toBe(416);
  expect((await request.get('/api/source', { headers: { Origin: 'https://other.example' } })).status()).toBe(403);
});

test('reports asset transport failures instead of pretending to render', async ({ page }) => {
  await page.route('**/api/assets/GrNBa.dat', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Busy"}' }));
  await page.goto('/viewer.html');
  // The bounded 503 retry schedule itself takes five seconds before surfacing failure.
  await expect(page.locator('#viewer-status')).toHaveText('RENDER ERROR', { timeout: 15_000 });
  await expect(page.locator('#load-message')).toContainText('Server asset read failed (503)');
  await expect(page.locator('#scene-canvas')).toHaveCount(0);
  await expect(page.locator('#use-local-disc')).toBeEnabled();
});

test('keeps optional local-disc rendering available without uploading the local disc', async ({ page }) => {
  test.skip(!process.env.MELEE_DISC_PATH, 'Set MELEE_DISC_PATH to exercise the optional local-disc fallback.');
  await page.goto('/viewer.html'); await ready(page);
  let networkRequests = 0; page.on('request', (request) => { if (request.url().includes('/api/')) networkRequests++; });
  await page.locator('#viewer-disc').setInputFiles(process.env.MELEE_DISC_PATH!);
  await expect(page.locator('body')).toHaveAttribute('data-source-mode', 'local'); await ready(page);
  await expect(page.locator('#source-status')).toHaveText('SOURCE · LOCAL ISO'); expect(networkRequests).toBe(0);
});
