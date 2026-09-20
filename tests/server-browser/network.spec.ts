import { test, expect, type Page } from '@playwright/test';
import { ROOM_PROTOCOL, type ServerMessage } from '../../lib/net/protocol.ts';

interface TransportProbe { messages: ServerMessage[]; token: string | null; send: (message: Record<string, unknown>, delay?: number) => void }
declare global { interface Window { roomTransportProbe: TransportProbe } }
const fingerprint = { game: 'browser-transport-fixture-only', wasm: 'a'.repeat(64), content: 'b'.repeat(64) };

/** This exercises native browser sockets, not gameplay asset attestation or rollback.
 * The normal server-browser gameplay tests exercise real loaded ISO content. */
async function connect(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/api/source`); // Same-origin inert JSON document; no rendering workload.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://${location.host}/api/rooms`);
    const probe: TransportProbe = window.roomTransportProbe = {
      messages: [], token: null,
      send: (message, delay = 0) => {
        const payload = JSON.stringify({ ...message, ...(probe.token && !['create', 'join', 'ping'].includes(message.type as string) ? { token: probe.token } : {}) });
        if (delay) setTimeout(() => socket.send(payload), delay); else socket.send(payload);
      },
    };
    socket.onerror = () => reject(new Error('Browser WebSocket failed.'));
    socket.onmessage = event => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      probe.messages.push(message);
      if (message.type === 'joined') probe.token = message.token;
      if (message.type === 'hello') resolve();
    };
  }));
}
async function send(page: Page, message: Record<string, unknown>, delay = 0): Promise<void> {
  await page.evaluate(({ message, delay }) => window.roomTransportProbe.send(message, delay), { message, delay });
}
async function waitMessage(page: Page, type: ServerMessage['type'], count = 1): Promise<void> {
  await page.waitForFunction(({ type, count }) => window.roomTransportProbe.messages.filter(message => message.type === type).length >= count, { type, count });
}

test('native mixed-seat relay rejects forged ownership and confirms/finishes with human sockets only', async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 2 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [host, guest] = pages as [Page, Page];
  try {
    await Promise.all(pages.map(page => connect(page, baseURL!)));
    await send(host, { type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint }); await waitMessage(host, 'joined');
    const code = await host.evaluate(() => window.roomTransportProbe.messages.find(message => message.type === 'joined')!.room.code);
    await send(guest, { type: 'join', protocol: ROOM_PROTOCOL, code, name: 'Guest', fingerprint }); await waitMessage(guest, 'joined');
    await send(host, { type: 'cpu', slot: 3, fighter: 'Kb' });
    await send(host, { type: 'cpu', slot: 7, fighter: 'Kb' });
    const expected = [[0, 'human', 'Fx'], [1, 'human', 'Mr'], [3, 'cpu', 'Kb'], [7, 'cpu', 'Kb']];
    const seats = (page: Page) => page.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'room').at(-1)?.room.players.map(player => [player.slot, player.control, player.fighter]));
    for (const page of pages) await expect.poll(() => seats(page)).toEqual(expected);
    for (const fighter of ['Fx', null]) {
      await send(guest, { type: 'cpu', slot: 3, fighter });
      await send(host, { type: 'cpu', slot: 1, fighter });
    }
    await waitMessage(guest, 'error', 2); await waitMessage(host, 'error', 2);
    expect(await guest.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'error').map(message => message.code))).toEqual(['HOST_ONLY', 'HOST_ONLY']);
    expect(await host.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'error').map(message => message.code))).toEqual(['SEAT_OCCUPIED', 'SEAT_OCCUPIED']);
    // Portrait choose is intrinsically socket-owned; a guest choice updates its
    // human slot, never the selected host CPU or somebody else's human.
    await send(guest, { type: 'choose', fighter: 'Kb' }); expected[1] = [1, 'human', 'Kb'];
    for (const page of pages) await expect.poll(() => seats(page)).toEqual(expected);
    for (const page of pages) await send(page, { type: 'ready', assetsLoaded: true });
    await host.waitForFunction(() => window.roomTransportProbe.messages.filter(message => message.type === 'room').at(-1)?.room.players.every(player => player.ready));
    await send(host, { type: 'start' }); await Promise.all(pages.map(page => waitMessage(page, 'start')));
    const starts = await Promise.all(pages.map(page => page.evaluate(() => window.roomTransportProbe.messages.find(message => message.type === 'start')!)));
    expect(starts[0]).toEqual(starts[1]);
    expect(starts[0]!.players.map(player => [player.slot, player.control, player.fighter])).toEqual(expected);
    const matchId = starts[0]!.matchId;
    for (const [slot, page] of pages.entries()) await send(page, { type: 'input', matchId, frame: 0, input: { x: slot ? -0.5 : 0.5, jump: false, attack: false, strong: false, down: false } });
    await Promise.all(pages.map(page => waitMessage(page, 'input', 2)));
    for (const page of pages) {
      expect(await page.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'input').map(message => message.slot).sort())).toEqual([0, 1]);
      await send(page, { type: 'hash', matchId, frame: 0, hash: 'c'.repeat(64) });
    }
    await Promise.all(pages.map(page => waitMessage(page, 'hash')));
    for (const page of pages) expect(await page.evaluate(() => window.roomTransportProbe.messages.find(message => message.type === 'hash'))).toMatchObject({ frame: 0, hash: 'c'.repeat(64) });
    for (const page of pages) await send(page, { type: 'finish', matchId, frame: 0, hash: 'c'.repeat(64) });
    await Promise.all(pages.map(page => waitMessage(page, 'end')));
    for (const page of pages) expect(await page.evaluate(() => window.roomTransportProbe.messages.find(message => message.type === 'end')?.code)).toBe('MATCH_COMPLETE');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('native four-browser LAN relay: delayed inputs, useful canonical desync, fresh rematch, held background seat and shared leave closure', async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  try {
    await Promise.all(pages.map(page => connect(page, baseURL!)));
    await send(pages[0]!, { type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint }); await waitMessage(pages[0]!, 'joined');
    const code = await pages[0]!.evaluate(() => window.roomTransportProbe.messages.find(message => message.type === 'joined')!.room.code);
    for (let slot = 1; slot < 4; slot++) {
      await send(pages[slot]!, { type: 'join', protocol: ROOM_PROTOCOL, code, name: `Peer ${slot}`, fingerprint }); await waitMessage(pages[slot]!, 'joined');
    }
    async function startRound(number: number): Promise<string> {
      for (const page of pages) await send(page, { type: 'ready', assetsLoaded: true });
      await pages[0]!.waitForFunction(() => {
        const room = window.roomTransportProbe.messages.filter(message => message.type === 'room').at(-1)?.room;
        return room?.phase === 'lobby' && room.players.length === 4 && room.players.every(player => player.ready);
      });
      await send(pages[0]!, { type: 'start' }); await Promise.all(pages.map(page => waitMessage(page, 'start', number)));
      const starts = await Promise.all(pages.map(page => page.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'start').at(-1)!)));
      starts.forEach(start => expect(start).toEqual(starts[0]));
      expect(starts[0]!.players.map(player => player.slot)).toEqual([0, 1, 2, 3]);
      return starts[0]!.matchId;
    }
    const first = await startRound(1);
    for (let slot = 0; slot < 4; slot++) await send(pages[slot]!, { type: 'input', matchId: first, frame: 0, input: { x: slot / 4, jump: false, attack: false, strong: false, down: false } }, [0, 15, 35, 70][slot]);
    await Promise.all(pages.map(page => waitMessage(page, 'input', 4)));
    for (const page of pages) {
      const inputs = await page.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'input').sort((a, b) => a.slot - b.slot));
      expect(inputs.map(message => [message.slot, message.frame, message.input.x])).toEqual([[0, 0, 0], [1, 0, 0.25], [2, 0, 0.5], [3, 0, 0.75]]);
    }
    await send(pages[0]!, { type: 'hash', matchId: first, frame: 0, hash: 'a'.repeat(64) });
    await send(pages[1]!, { type: 'hash', matchId: first, frame: 0, hash: 'b'.repeat(64) });
    await Promise.all(pages.map(page => waitMessage(page, 'end')));
    for (const page of pages) expect(await page.evaluate(() => window.roomTransportProbe.messages.find(message => message.type === 'end'))).toMatchObject({ code: 'DESYNC', frame: 0, hashes: { 0: 'a'.repeat(64), 1: 'b'.repeat(64) } });
    await send(pages[0]!, { type: 'lobby' }); const second = await startRound(2); expect(second).not.toBe(first);
    // Protocol v8: a hidden tab holds its seat (the match stays open); an explicit leave still closes it for everyone.
    await send(pages[2]!, { type: 'background' });
    for (const page of pages) await page.waitForFunction(() => window.roomTransportProbe.messages.filter(message => message.type === 'room').at(-1)?.room.players.find(player => player.slot === 2)?.connected === false);
    for (const page of pages) expect(await page.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'end').length)).toBe(1);
    await send(pages[2]!, { type: 'leave' }); await Promise.all(pages.filter((_, slot) => slot !== 2).map(page => waitMessage(page, 'end', 2)));
    for (const page of pages.filter((_, slot) => slot !== 2)) expect(await page.evaluate(() => window.roomTransportProbe.messages.filter(message => message.type === 'end').at(-1)?.code)).toBe('PEER_LEFT');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
