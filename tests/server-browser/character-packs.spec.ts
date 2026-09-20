import { expect, test } from '@playwright/test';
import { configuredPacks } from '../../scripts/character-packs.ts';
import { ROOM_PROTOCOL } from '../../lib/net/protocol.ts';
import { withLanPeers, createAndJoin, network, confirmedConsensus } from './helpers/online.ts';
import { chooseFighter, goToStage, backToCharacters } from './helpers/battle.ts';

const packs = configuredPacks();
test('staged server exposes declared pack assets but never private storage/config', async ({ request }) => {
  for (const path of ['/private/characters/example.training-dummy/pack.json', '/.local/character-packs.json']) expect((await request.get(path)).status()).toBe(404);
  for (const pack of packs) for (const asset of pack.assets.values()) {
    const response = await request.get(asset.url); expect(response.status()).toBe(200); expect(await response.body()).toEqual(asset.bytes);
  }
});

test('matching installed custom fighters play across two independent browsers; missing packs fail before joining', async ({ browser, baseURL }) => {
  test.skip(!packs.length, 'This staged build has no opted-in custom packs.');
  test.setTimeout(180_000);
  const kind = packs[0]!.identity.id;
  await withLanPeers(browser, baseURL, 2, async pages => {
    const code = await createAndJoin(pages), host = pages[0]!;
    expect((await network(host))?.room?.fingerprint.packs).toEqual(packs.map(pack => pack.identity));
    const mismatch = await host.evaluate(async ({ code, protocol }) => {
      const fingerprint = { ...window.smashNetworkSnapshot!().room!.fingerprint, packs: [] };
      return new Promise<{ code: string; message: string }>((resolve, reject) => {
        const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms`);
        const timer = setTimeout(() => { socket.close(); reject(new Error('Pack mismatch response timed out.')); }, 10_000);
        socket.onmessage = event => {
          const message = JSON.parse(String(event.data));
          if (message.type === 'hello') socket.send(JSON.stringify({ type: 'join', protocol, code, name: 'Missing-pack probe', fingerprint }));
          if (message.type === 'error') { clearTimeout(timer); socket.close(); resolve({ code: message.code, message: message.message }); }
        };
      });
    }, { code, protocol: ROOM_PROTOCOL });
    expect(mismatch.code).toBe('FINGERPRINT_MISMATCH'); expect(mismatch.message).toContain('Custom character packs');
    for (const [slot, page] of pages.entries()) await chooseFighter(page, slot, kind);
    await goToStage(host, 'final'); await backToCharacters(host);
    for (const page of pages) await page.getByRole('button', { name: 'Ready', exact: true }).click();
    for (const page of pages) await expect.poll(async () => (await network(page))?.room?.players.every(player => player.ready), { timeout: 60_000 }).toBe(true);
    await goToStage(host); await host.locator('#start-match').click();
    for (const page of pages) {
      await expect.poll(() => page.evaluate(() => window.smashMatchSnapshot?.()?.phase), { timeout: 45_000 }).toBe('playing');
      expect(await page.evaluate(() => window.smashMatchSnapshot!()?.fighters.map(fighter => fighter.kind))).toEqual([kind, kind]);
    }
    await host.keyboard.press('l');
    await confirmedConsensus(pages, 90);
  });
});
