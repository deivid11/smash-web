import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectDisc, verifyMeleeDisc, parseFileSystem, readExact, MELEE_102, type DiscReader } from '../../lib/disc.ts';

function fixture() {
  const bytes = new Uint8Array(8192);
  const fields = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('GALE01'));
  bytes[7] = 2;
  fields.setUint32(0x1c, 0xc2339f3d);
  bytes.set(new TextEncoder().encode('Synthetic test disc'), 0x20);
  fields.setUint32(0x420, 0x500);
  fields.setUint32(0x424, 0x1000);
  fields.setUint32(0x500, 0x100);
  fields.setUint32(0x590, 32);
  bytes.fill(0x42, 0x600, 0x620);
  const names = new TextEncoder().encode('\0assets\0model.dat\0readme.txt\0');
  const fst = new Uint8Array(48 + names.length);
  const entries = new DataView(fst.buffer);
  entries.setUint32(0, 0x01000000); entries.setUint32(8, 4);
  entries.setUint32(12, 0x01000001); entries.setUint32(20, 3);
  entries.setUint32(24, 8); entries.setUint32(28, 0x1500); entries.setUint32(32, 16);
  entries.setUint32(36, 18); entries.setUint32(40, 0x1600); entries.setUint32(44, 4);
  fst.set(names, 48);
  bytes.set(fst, 0x1000);
  fields.setUint32(0x428, fst.length);
  const reads: Array<{ offset: number; length: number }> = [];
  const reader: DiscReader = {
    size: bytes.length,
    async read(offset, length) { reads.push({ offset, length }); return bytes.slice(offset, offset + length); },
  };
  return { bytes, fields, fst, entries, reader, reads };
}

describe('bounded GameCube disc reader', () => {
  it('agrees with the upstream lock', () => {
    const lock = JSON.parse(readFileSync(new URL('../../third_party/melee.lock.json', import.meta.url), 'utf8'));
    expect(MELEE_102.gameId).toBe(lock.gameId);
    expect(MELEE_102.discRevision).toBe(lock.discRevision);
    expect(MELEE_102.mainDolSha1).toBe(lock.mainDolSha1);
  });
  it('reads big-endian metadata and nested filenames without reading the whole disc', async () => {
    const { reader, reads } = fixture();
    const info = await inspectDisc(reader);
    expect(info).toMatchObject({ gameId: 'GALE01', revision: 2, dolOffset: 0x500, dolSize: 0x120 });
    expect(info.files).toEqual([
      { path: 'assets/model.dat', offset: 0x1500, size: 16 },
      { path: 'readme.txt', offset: 0x1600, size: 4 },
    ]);
    expect(info.dolSha1).toMatch(/^[0-9a-f]{40}$/u);
    expect(reads.every((range) => range.length < reader.size)).toBe(true);
  });
  it('does not mistake a matching header for an authentic executable', async () => {
    await expect(verifyMeleeDisc(fixture().reader)).rejects.toThrow('SHA-1 mismatch');
  });
  it('rejects archives instead of pretending to load them', async () => {
    const { reader, bytes } = fixture(); bytes[0x1c] = 0;
    await expect(inspectDisc(reader)).rejects.toThrow('Extract archives first');
  });
  it.each([0, 1, 3])('rejects unsupported disc revision %s', async (revision) => {
    const { reader, bytes } = fixture(); bytes[7] = revision;
    await expect(inspectDisc(reader)).rejects.toThrow('Unsupported disc');
  });
  it('rejects the wrong region', async () => {
    const { reader, bytes } = fixture(); bytes[3] = 'P'.charCodeAt(0);
    await expect(inspectDisc(reader)).rejects.toThrow('Unsupported disc');
  });
  it('rejects an invalid disc number', async () => {
    const { reader, bytes } = fixture(); bytes[6] = 1;
    await expect(inspectDisc(reader)).rejects.toThrow('Unsupported disc');
  });
  it('caps filesystem allocation before reading it', async () => {
    const { reader, fields, reads } = fixture(); fields.setUint32(0x428, 0xffffffff);
    await expect(inspectDisc(reader)).rejects.toThrow('offsets are invalid');
    expect(reads).toHaveLength(1);
  });
  it('rejects sections overlapping the DOL header', async () => {
    const { reader, fields } = fixture(); fields.setUint32(0x500, 0x40);
    await expect(inspectDisc(reader)).rejects.toThrow('section bounds');
  });
  it('rejects excessively large DOL sections', async () => {
    const { reader, fields } = fixture(); fields.setUint32(0x590, 0xffffffff);
    await expect(inspectDisc(reader)).rejects.toThrow('section bounds');
  });
  it('rejects a DOL without sections', async () => {
    const { reader, fields } = fixture(); fields.setUint32(0x590, 0);
    await expect(inspectDisc(reader)).rejects.toThrow('no sections');
  });
  it('rejects a DOL outside the disc', async () => {
    const { reader, fields } = fixture(); fields.setUint32(0x420, 0xfffffff0);
    await expect(inspectDisc(reader)).rejects.toThrow('byte range');
  });
  it('rejects incomplete reads', async () => {
    const reader = { size: 4096, read: async () => new Uint8Array(1) };
    await expect(readExact(reader, 0, 512)).rejects.toThrow('read was truncated');
  });
  it.each([-1, NaN, 0.5, Infinity])('rejects invalid offsets: %s', async (offset) => {
    await expect(readExact(fixture().reader, offset, 1)).rejects.toThrow('byte range');
  });
});

describe('disc filesystem validation', () => {
  it('rejects a truncated root', () => expect(() => parseFileSystem(new Uint8Array(8), 8192)).toThrow('truncated'));
  it('rejects enormous entry counts', () => {
    const { fst, entries } = fixture(); entries.setUint32(8, 0xffffffff);
    expect(() => parseFileSystem(fst, 8192)).toThrow('root is invalid');
  });
  it('rejects directories extending past their parent', () => {
    const { fst, entries } = fixture(); entries.setUint32(20, 5);
    expect(() => parseFileSystem(fst, 8192)).toThrow('directory bounds');
  });
  it('rejects invalid directory parent indexes', () => {
    const { fst, entries } = fixture(); entries.setUint32(16, 1);
    expect(() => parseFileSystem(fst, 8192)).toThrow('directory bounds');
  });
  it('rejects out-of-range file data', () => {
    const { fst, entries } = fixture(); entries.setUint32(32, 8192);
    expect(() => parseFileSystem(fst, 8192)).toThrow('byte range');
  });
  it('rejects out-of-range names', () => {
    const { fst, entries } = fixture(); entries.setUint32(24, 0xffffff);
    expect(() => parseFileSystem(fst, 8192)).toThrow('entry is invalid');
  });
  it('rejects unknown entry types', () => {
    const { fst, entries } = fixture(); entries.setUint32(24, 0x02000008);
    expect(() => parseFileSystem(fst, 8192)).toThrow('entry is invalid');
  });
  it('rejects unterminated names', () => {
    const { fst } = fixture(); fst[fst.length - 1] = 65;
    expect(() => parseFileSystem(fst, 8192)).toThrow('entry is invalid');
  });
  it.each(['../bad', 'a/bad!', 'a\\bad!', 'bad\u0001xx'])('rejects unsafe path component %j', (name) => {
    const { fst } = fixture(); fst.set(new TextEncoder().encode(name), 49);
    expect(() => parseFileSystem(fst, 8192)).toThrow('unsafe name');
  });
  it('rejects duplicate paths', () => {
    const { fst, entries } = fixture();
    entries.setUint32(20, 4); entries.setUint32(36, 8);
    expect(() => parseFileSystem(fst, 8192)).toThrow('duplicate paths');
  });
});
