import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { configuredPacks } from '../../scripts/character-packs.ts';
import { root } from '../../scripts/shared.ts';
import { privateFixture } from './helpers/private-fixture.ts';

const packs = configuredPacks();
test('loads the exact opted-in registry without requiring a private pack in public mode', async ({ page }) => {
  await page.goto('/index.html');
  const identities = await page.evaluate(async (url) => {
    const registry = await import(url);
    return registry.CUSTOM_PACK_IDENTITIES;
  }, `/@fs${root}lib/custom/registry.ts`);
  expect(identities).toEqual(packs.map(pack => pack.identity));
});

test('serves only declared, hashed custom assets while keeping local pack storage private', async ({ request }) => {
  for (const pack of packs) {
    for (const asset of pack.assets.values()) {
      const response = await request.get(asset.url);
      expect(response.status()).toBe(200);
      expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(createHash('sha256').update(asset.bytes).digest('hex'));
    }
    const denied = await request.get(`/@fs${root}private/characters/${pack.manifest.id}/pack.json`);
    expect([403, 404]).toContain(denied.status());
  }
  const fixture = await privateFixture(root, '.local');
  try {
    const config = await request.get(`/@fs${fixture.path}`);
    expect([403, 404]).toContain(config.status());
  } finally { await fixture.dispose(); }
});
