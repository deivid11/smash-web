import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { SemTable } from '../../lib/game/audio.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original SEM aux-A (reverb) sends', () => {
  let disc: Awaited<ReturnType<typeof openDisc>>, sem: SemTable;
  beforeAll(async () => {
    disc = await openDisc(iso!);
    const session = new HsdAssetSession({ size: disc.size, read: (offset, length) => disc.read(offset, length) }, await verifyMeleeDisc(disc));
    sem = new SemTable(await session.bytes('audio/us/smash2.sem'));
  });
  afterAll(async () => { await disc?.close(); });
  it('carries each script op-16 send level into its cues', () => {
    const level = (id: number) => Math.round(sem.cues(id)[0]!.auxA! * 65535 / 255);
    expect(level(110103)).toBe(20); expect(level(110094)).toBe(30); // Fox move sounds
    expect(level(180007)).toBe(1); expect(level(91)).toBe(4); expect(level(111)).toBe(10); // Mario, hit sounds
  });
  it('sends almost every non-system script to the reverb', () => {
    let total = 0, sent = 0;
    for (let bank = 1; bank < sem.bankCount; bank++) for (let i = 0; i < 400; i++) {
      const cues = sem.cues(bank * 10000 + i); if (!cues.length) continue;
      total++; if (cues.some((cue) => (cue.auxA ?? 0) > 0)) sent++;
    }
    expect(total).toBe(3507); expect(sent).toBe(3131);
  });
});
