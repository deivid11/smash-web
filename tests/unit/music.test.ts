import { describe, expect, it } from 'vitest';
import { decodeHps, MAX_HPS_BYTES, MAX_MUSIC_SAMPLES } from '../../lib/game/music.ts';

/** Synthetic non-asset DSP fixture with two independent stereo blocks. */
export function hpsFixture(): Uint8Array {
  const bytes = new Uint8Array(0xf0), v = new DataView(bytes.buffer);
  v.setUint32(0, 0x2048414c); v.setUint32(4, 0x50535400); v.setUint32(8, 32000); v.setUint32(12, 2);
  for (let c = 0; c < 2; c++) {
    const d = 0x10 + c * 0x38;
    v.setUint32(d, 0x10000); v.setUint32(d + 4, 2); v.setUint32(d + 8, 31); v.setUint32(d + 12, 2);
    v.setInt16(d + 16, 2048);
  }
  for (const offset of [0x80, 0xc0]) {
    v.setUint32(offset, 16); v.setUint32(offset + 4, 15); v.setUint32(offset + 8, 0xc0);
    for (let c = 0; c < 2; c++) {
      v.setInt16(offset + 14 + c * 8, (offset === 0x80 ? 10 : 100) * (c + 1));
      bytes.fill(c ? 0x22 : 0x11, offset + 0x21 + c * 8, offset + 0x28 + c * 8);
    }
  }
  return bytes;
}
describe('bounded original HALPST decoding', () => {
  it('decodes stereo DSP with each block history and exact loop point', () => {
    const pcm = decodeHps(hpsFixture());
    expect(pcm.rate).toBe(32000); expect(pcm.loop).toBe(true); expect(pcm.loopStart).toBe(14);
    expect([...pcm.channels[0]!]).toEqual([...Array.from({ length: 14 }, (_, i) => 11 + i), ...Array.from({ length: 14 }, (_, i) => 101 + i)]);
    expect(pcm.channels[1]![0]).toBe(22); expect(pcm.channels[1]![14]).toBe(202);
  });
  it('supports a terminating non-looped chain', () => {
    const bytes = hpsFixture(); new DataView(bytes.buffer).setUint32(0xc8, 0xffffffff);
    expect(decodeHps(bytes).loop).toBe(false);
  });
  it.each([
    [0, 0, 'signature'], [8, 1, 'rate'], [12, 3, 'channels'], [0x14, 1, 'encoding'],
    [0x50, 32, 'mismatched'], [0x18, MAX_MUSIC_SAMPLES * 2, 'budget'],
    [0x80, 3, 'block size'], [0x88, 0xa0, 'Overlapping'], [0xc8, 0x90, 'boundary'],
    [0xc4, 31, 'sample count'], [0x18, 47, 'mismatched'], [0xc8, 0x1000, 'range'],
  ] as const)('rejects malformed header/block field %i', (offset, value, error) => {
    const bytes = hpsFixture(); new DataView(bytes.buffer).setUint32(offset, value);
    expect(() => decodeHps(bytes)).toThrow(error);
  });
  it('rejects oversized, truncated and corrupt DSP data', () => {
    expect(() => decodeHps(new Uint8Array(MAX_HPS_BYTES + 1))).toThrow('budget');
    expect(() => decodeHps(hpsFixture().subarray(0, 0xe0))).toThrow('range');
    const bytes = hpsFixture(); bytes[0xa0] = 0x80; expect(() => decodeHps(bytes)).toThrow('predictor');
  });
  it('honors pre-cancelled work', () => {
    const abort = new AbortController(); abort.abort();
    expect(() => decodeHps(hpsFixture(), abort.signal)).toThrow();
  });
});
