import { describe, expect, it } from 'vitest';
import { HsdArchive, linkedList } from '../../lib/hsd/archive.ts';
import { loadGeometry } from '../../lib/hsd/geometry.ts';
import { decodeTexture, textureByteSize } from '../../lib/hsd/texture.ts';
import { decodeKeyframes, sampleTrack } from '../../lib/hsd/animation.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import type { DiscInfo } from '../../lib/disc.ts';

function archive(data = new Uint8Array(512), relocations: number[] = [], symbols: Array<[string, number]> = []): HsdArchive {
  const names = new TextEncoder().encode(symbols.map(([name]) => `${name}\0`).join(''));
  const bytes = new Uint8Array(32 + data.length + relocations.length * 4 + symbols.length * 8 + names.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length); view.setUint32(4, data.length); view.setUint32(8, relocations.length); view.setUint32(12, symbols.length);
  bytes.set(data, 32);
  let table = 32 + data.length;
  for (const location of relocations) { view.setUint32(table, location); table += 4; }
  let nameIndex = 0;
  for (const [name, offset] of symbols) { view.setUint32(table, offset); view.setUint32(table + 4, nameIndex); table += 8; nameIndex += new TextEncoder().encode(name).length + 1; }
  bytes.set(names, table);
  return new HsdArchive(bytes);
}

describe('bounded HSD archive reader', () => {
  it('handles a root at data offset zero', () => expect(archive(undefined, [], [['root_joint', 0]]).symbol('root_joint')).toBe(0));
  it('uses relocation targets as upper bounds, not file addresses', () => {
    const data = new Uint8Array(128); new DataView(data.buffer).setUint32(4, 32);
    const arc = archive(data, [4], [['root', 0]]);
    expect(arc.targets).toEqual([0, 32]); expect(arc.extent(0)).toBe(32); expect(arc.extent(32)).toBe(96);
  });
  it('rejects short headers', () => expect(() => new HsdArchive(new Uint8Array(16))).toThrow('archive size'));
  it('rejects size mismatches', () => {
    const bytes = archive().bytes.slice(); new DataView(bytes.buffer).setUint32(0, bytes.length + 1);
    expect(() => new HsdArchive(bytes)).toThrow('header');
  });
  it('rejects truncated relocation tables', () => {
    const bytes = archive().bytes.slice(); new DataView(bytes.buffer).setUint32(8, 1000);
    expect(() => new HsdArchive(bytes)).toThrow('table bounds');
  });
  it('rejects out-of-range relocation locations', () => expect(() => archive(undefined, [65535])).toThrow('out of bounds'));
  it('rejects duplicate public symbols', () => expect(() => archive(undefined, [], [['a', 0], ['a', 8]])).toThrow('Duplicate'));
  it('rejects non-finite floats', () => {
    const data = new Uint8Array(8); new DataView(data.buffer).setFloat32(0, NaN);
    expect(() => archive(data).f32(0)).toThrow('non-finite');
  });
  it.each([-1, 0.5, NaN, Infinity, 513])('rejects invalid offsets %s', (offset) => expect(() => archive().u32(offset)).toThrow('out of bounds'));
  it('rejects cyclic linked lists', () => {
    const data = new Uint8Array(64); const view = new DataView(data.buffer); view.setUint32(20, 32); view.setUint32(36, 16);
    expect(() => linkedList(archive(data), 16, 4)).toThrow('Cyclic');
  });
});

describe('GX tiled textures', () => {
  it('respects block padding for non-block-aligned dimensions', () => expect(textureByteSize(0, 9, 1)).toBe(64));
  it('decodes I4 high/low nibbles and clips padded pixels', () => {
    const data = new Uint8Array(32); data[0] = 0xf3;
    expect([...decodeTexture(data, 0, 2, 1).pixels]).toEqual([255, 255, 255, 255, 51, 51, 51, 51]);
  });
  it('decodes IA4 with alpha in the high nibble', () => {
    const data = new Uint8Array(32); data[0] = 0x84;
    expect([...decodeTexture(data, 2, 1, 1).pixels]).toEqual([68, 68, 68, 136]);
  });
  it('decodes big-endian IA8', () => {
    const data = new Uint8Array(32); data.set([128, 64]);
    expect([...decodeTexture(data, 3, 1, 1).pixels]).toEqual([64, 64, 64, 128]);
  });
  it('decodes RGB565', () => {
    const data = new Uint8Array(32); data.set([0xf8, 0]);
    expect([...decodeTexture(data, 4, 1, 1).pixels]).toEqual([255, 0, 0, 255]);
  });
  it('decodes opaque and translucent RGB5A3', () => {
    const data = new Uint8Array(32); data.set([0xfc, 0, 0x3f, 0]);
    expect([...decodeTexture(data, 5, 2, 1).pixels]).toEqual([255, 0, 0, 255, 255, 0, 0, 109]);
  });
  it('decodes RGBA8 AR/GB planes', () => {
    const data = new Uint8Array(64); data.set([44, 11]); data.set([22, 33], 32);
    expect([...decodeTexture(data, 6, 1, 1).pixels]).toEqual([11, 22, 33, 44]);
  });
  it('decodes C4 using a big-endian palette', () => {
    const data = new Uint8Array(32); data[0] = 0x10;
    const palette = { format: 1, bytes: new Uint8Array([0, 0x1f, 0xf8, 0]) };
    expect([...decodeTexture(data, 8, 2, 1, palette).pixels]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });
  it('decodes all four CMPR selector values in the correct bit order', () => {
    const data = new Uint8Array(32); data.set([0xf8, 0, 0x07, 0xe0, 0x1b, 0, 0, 0]);
    expect([...decodeTexture(data, 14, 4, 1).pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 170, 85, 0, 255, 85, 170, 0, 255]);
  });
  it('decodes CMPR transparent selectors', () => {
    const data = new Uint8Array(32); data.set([0, 0, 0xff, 0xff, 0xc0]);
    expect([...decodeTexture(data, 14, 1, 1).pixels]).toEqual([0, 0, 0, 0]);
  });
  it('rejects truncated texture data', () => expect(() => decodeTexture(new Uint8Array(31), 0, 8, 8)).toThrow('Truncated'));
  it('rejects missing palette data', () => expect(() => decodeTexture(new Uint8Array(32), 8, 1, 1)).toThrow('palette'));
  it('rejects oversized dimensions', () => expect(() => textureByteSize(6, 8192, 8192)).toThrow('dimensions'));
  it('rejects unknown formats', () => expect(() => textureByteSize(15, 32, 32)).toThrow('format'));
});

function geometryFixture(primitive: number, count: number, indexed = false): HsdArchive {
  const data = new Uint8Array(1024); const view = new DataView(data.buffer);
  view.setUint32(0, 9); view.setUint32(4, indexed ? 3 : 1); view.setUint32(8, 1); view.setUint32(12, 4);
  view.setUint16(18, 12); view.setUint32(20, 512); view.setUint32(24, 255);
  data[128] = primitive; view.setUint16(129, count);
  for (let i = 0; i < count; i++) {
    const offset = indexed ? 512 + i * 12 : 131 + i * 12;
    view.setFloat32(offset, i); view.setFloat32(offset + 4, i & 1); view.setFloat32(offset + 8, 0);
    if (indexed) view.setUint16(131 + i * 2, i);
  }
  return archive(data);
}
describe('GX primitive decoding', () => {
  it('decodes direct triangles', () => {
    const result = loadGeometry(geometryFixture(0x90, 3), 0, 128, 64);
    expect([...result.indices]).toEqual([0, 1, 2]); expect([...result.positions]).toEqual([0, 0, 0, 1, 1, 0, 2, 0, 0]);
  });
  it('decodes indexed 16-bit attribute arrays', () => {
    const result = loadGeometry(geometryFixture(0x90, 3, true), 0, 128, 64);
    expect([...result.positions]).toEqual([0, 0, 0, 1, 1, 0, 2, 0, 0]);
  });
  it.each([0x80, 0x88])('triangulates both GX quad commands (%s)', (command) => expect([...loadGeometry(geometryFixture(command, 4), 0, 128, 64).indices]).toEqual([0, 1, 2, 0, 2, 3]));
  it('alternates strip winding consistently', () => expect([...loadGeometry(geometryFixture(0x98, 4), 0, 128, 64).indices]).toEqual([0, 1, 2, 2, 1, 3]));
  it('triangulates a fan', () => expect([...loadGeometry(geometryFixture(0xa0, 4), 0, 128, 64).indices]).toEqual([0, 1, 2, 0, 2, 3]));
  it('rejects truncated vertex packets', () => expect(() => loadGeometry(geometryFixture(0x90, 3), 0, 128, 20)).toThrow('Truncated'));
  it('rejects unknown display-list commands', () => expect(() => loadGeometry(geometryFixture(0x61, 3), 0, 128, 64)).toThrow('Unsupported'));
  it('rejects invalid triangle counts', () => expect(() => loadGeometry(geometryFixture(0x90, 4), 0, 128, 64)).toThrow('vertex count'));
});

describe('HSD animation streams', () => {
  it('decodes little-endian float keys within a big-endian archive format', () => {
    const bytes = new Uint8Array(16); const view = new DataView(bytes.buffer); bytes[0] = 0x22;
    for (let i = 0; i < 3; i++) { view.setFloat32(1 + i * 5, i * 10, true); bytes[5 + i * 5] = i === 2 ? 0 : 10; }
    const keys = decodeKeyframes(bytes, 0, 0);
    expect(sampleTrack(keys, 0)).toBe(0); expect(sampleTrack(keys, 5)).toBe(5); expect(sampleTrack(keys, 15)).toBe(15); expect(sampleTrack(keys, 50)).toBe(20);
  });
  it('retains a single KEY opcode instead of losing a static track', () => {
    const bytes = new Uint8Array(6); bytes[0] = 6; new DataView(bytes.buffer).setFloat32(1, 2.5, true);
    expect(sampleTrack(decodeKeyframes(bytes, 0, 0), 0)).toBe(2.5);
  });
  it('applies signed integer fractional formats', () => {
    const bytes = new Uint8Array([6, 0xf8, 0xff, 0]);
    expect(sampleTrack(decodeKeyframes(bytes, 0x22, 0), 0)).toBe(-2);
  });
  it('scales Hermite slopes by segment duration as the HSD spline function does', () => {
    expect(sampleTrack([{ time: 0, duration: 10, mode: 4, p0: 0, p1: 0, d0: 2, d1: 0 }], 5)).toBe(2.5);
  });
  it('rejects truncated float streams', () => expect(() => decodeKeyframes(new Uint8Array([6, 0, 0]), 0, 0)).toThrow('Truncated'));
  it('rejects unterminated VLQs', () => expect(() => decodeKeyframes(new Uint8Array([128, 128, 128, 128, 128]), 0, 0)).toThrow('Unterminated'));
  it('rejects invalid opcodes', () => expect(() => decodeKeyframes(new Uint8Array([15]), 0, 0)).toThrow('opcode'));
});

describe('local asset session boundary', () => {
  it('rejects oversized entries before making a read', async () => {
    let reads = 0;
    const info = { files: [{ path: 'model.dat', offset: 0, size: 65 * 1024 * 1024 }] } as DiscInfo;
    const session = new HsdAssetSession({ size: 100 * 1024 * 1024, read: async () => { reads++; return new Uint8Array(); } }, info);
    await expect(session.model('model.dat')).rejects.toThrow('memory budget'); expect(reads).toBe(0);
  });
  it('rejects names absent from the verified filesystem', async () => {
    const session = new HsdAssetSession({ size: 0, read: async () => new Uint8Array() }, { files: [] } as unknown as DiscInfo);
    await expect(session.model('missing.dat')).rejects.toThrow('does not contain');
  });
});
