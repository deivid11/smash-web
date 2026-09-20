import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateFixture } from './helpers/private-fixture.ts';

const localDisc = process.env.MELEE_DISC_PATH;
const root = fileURLToPath(new URL('../../', import.meta.url));

test('runs real WASM, restores the RNG seed, and shows the current scope', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#wasm-status')).toHaveText('WASM READY');
  await expect(page.locator('#probe-result')).toContainText('All 12 outputs match');
  await expect(page.getByText('This is a port lab, not a playable game.')).toBeVisible();
  const first = await page.locator('#rng-values').textContent();
  await page.getByLabel('INITIAL SEED').fill('4294967295');
  await page.getByRole('button', { name: 'Run replay check' }).click();
  await expect(page.locator('#rng-values')).not.toHaveText(first!);
  await page.getByLabel('INITIAL SEED').fill('1');
  await page.getByRole('button', { name: 'Run replay check' }).click();
  await expect(page.locator('#rng-values')).toHaveText(first!);
  expect(errors).toEqual([]);
  const artifacts = process.env.SMASH_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: artifacts ? join(artifacts, 'port-lab.png') : testInfo.outputPath('port-lab.png'), fullPage: true });
});

test('rejects truncated input without uploading it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#wasm-status')).toHaveText('WASM READY');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.getByLabel('Choose local disc').setInputFiles({ name: 'broken.iso', mimeType: 'application/octet-stream', buffer: Buffer.alloc(16) });
  await expect(page.locator('#disc-status')).toHaveText('NOT SUPPORTED');
  await expect(page.locator('#disc-result')).toContainText('invalid or truncated');
  expect(requests).toEqual([]);
});

test('does not expose private or third-party files through Vite', async ({ request }) => {
  const hidden = await privateFixture(root, 'private'), config = await privateFixture(root, '.local');
  try {
    // The pinned RNG source exists after upstream setup; a private reference executable
    // need not exist in a clean clone. Never create fixtures inside the upstream checkout.
    for (const path of [hidden.path, config.path, join(root, 'third_party/melee/src/sysdolphin/baselib/random.c')]) {
      const response = await request.get(`/@fs${path}`);
      expect(response.status()).toBe(403);
    }
  } finally { await hidden.dispose(); await config.dispose(); }
});

test('reports a missing WASM build honestly', async ({ page }) => {
  await page.route('**/wasm/melee-probe.wasm', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.locator('#wasm-status')).toHaveText('UNAVAILABLE');
  await expect(page.getByRole('button', { name: 'Run replay check' })).toBeDisabled();
  await expect(page.locator('#probe-result')).toContainText('Build the probe first');
});

test('fits a mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#wasm-status')).toHaveText('WASM READY');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('verifies the real local disc entirely inside the browser', async ({ page }) => {
  test.skip(!localDisc, 'Set MELEE_DISC_PATH to your own extracted USA v1.02 ISO for this integration test.');
  await page.goto('/');
  await expect(page.locator('#wasm-status')).toHaveText('WASM READY');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.getByLabel('Choose local disc').setInputFiles(localDisc!);
  await expect(page.locator('#disc-status')).toHaveText('DISC VERIFIED', { timeout: 20_000 });
  await expect(page.locator('#disc-hash')).toHaveText('08e0bf20134dfcb260699671004527b2d6bb1a45');
  await expect(page.locator('#disc-id')).toHaveText('GALE01 / revision 2');
  expect(requests).toEqual([]);
});
