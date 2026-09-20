import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent } from '../../lib/game/load.ts';
import { LoadingOverlay } from '../../web/src/play/play-app.tsx';

describe('boot loading overlay', () => {
  it('shows a clamped tabular percentage, a matching bar width and the phase message', () => {
    const html = renderToStaticMarkup(createElement(LoadingOverlay, { progress: 'Loading Link: Wait1…', fraction: 0.4237 }));
    expect(html).toContain('role="progressbar"'); expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('width:42%'); expect(html).toContain('>42%</p>');
    expect(html).toContain('Loading Link: Wait1…');
    for (const [fraction, percent] of [[-0.5, 0], [1.4, 100], [Number.NaN, 0]] as const) {
      expect(renderToStaticMarkup(createElement(LoadingOverlay, { progress: '', fraction }))).toContain(`aria-valuenow="${percent}"`);
    }
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('loadGameContent progress fractions', () => {
  const reports: Array<{ message: string; fraction: number | undefined }> = [];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      const wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
      await loadGameContent(session, wasm, (message, fraction) => reports.push({ message, fraction }));
    } finally { await disc.close(); }
  }, 30000);
  it('emits many bounded, monotonically non-decreasing fractions ending near completion', () => {
    expect(reports.length).toBeGreaterThan(100);
    let last = 0;
    for (const { message, fraction } of reports) {
      expect(message.length).toBeGreaterThan(0);
      expect(fraction).toBeDefined();
      expect(fraction!).toBeGreaterThanOrEqual(0); expect(fraction!).toBeLessThanOrEqual(1);
      expect(fraction!).toBeGreaterThanOrEqual(last - 1e-9);
      last = fraction!;
    }
    expect(last).toBeGreaterThanOrEqual(0.9);
    expect(reports.at(-1)!.message).toContain('sound banks');
  });
});
