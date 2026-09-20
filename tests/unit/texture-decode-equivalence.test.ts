import { describe, expect, it } from 'vitest';
import { decodeTexture, type DecodedTexture, type Palette } from '../../lib/hsd/texture.ts';

// Verbatim copy of the original per-pixel decoder (allocating tuples per pixel), kept as the
// reference: the optimized decoder must produce identical bytes and identical errors.
const blocks: Record<number, [number, number, number]> = {
  0: [8, 8, 32], 1: [8, 4, 32], 2: [8, 4, 32], 3: [4, 4, 32],
  4: [4, 4, 32], 5: [4, 4, 32], 6: [4, 4, 64],
  8: [8, 8, 32], 9: [8, 4, 32], 10: [4, 4, 32], 14: [8, 8, 32],
};
const expand = (value: number, bits: number) => Math.round(value * 255 / ((1 << bits) - 1));
type Color = [number, number, number, number];
function rgb565(word: number): Color { return [expand(word >>> 11, 5), expand((word >>> 5) & 63, 6), expand(word & 31, 5), 255]; }
function rgb5a3(word: number): Color {
  return word & 0x8000
    ? [expand((word >>> 10) & 31, 5), expand((word >>> 5) & 31, 5), expand(word & 31, 5), 255]
    : [expand((word >>> 8) & 15, 4), expand((word >>> 4) & 15, 4), expand(word & 15, 4), expand((word >>> 12) & 7, 3)];
}
function legacyTextureByteSize(format: number, width: number, height: number): number {
  const block = blocks[format];
  if (!block) throw new Error(`Unsupported GameCube texture format ${format}.`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4_194_304) {
    throw new Error('Invalid or oversized GameCube texture dimensions.');
  }
  return Math.ceil(width / block[0]) * Math.ceil(height / block[1]) * block[2];
}
function legacyDecodeTexture(bytes: Uint8Array, format: number, width: number, height: number, palette?: Palette): DecodedTexture {
  const required = legacyTextureByteSize(format, width, height);
  if (bytes.byteLength < required) throw new Error('Truncated GameCube texture data.');
  const [bw, bh, blockSize] = blocks[format]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixels = new Uint8Array(width * height * 4);
  const lookup = (index: number): Color => {
    if (!palette || index * 2 + 2 > palette.bytes.length) throw new Error('Missing or out-of-range GameCube texture palette.');
    const word = (palette.bytes[index * 2]! << 8) | palette.bytes[index * 2 + 1]!;
    if (palette.format === 0) return [word & 255, word & 255, word & 255, word >>> 8];
    if (palette.format === 1) return rgb565(word);
    if (palette.format === 2) return rgb5a3(word);
    throw new Error(`Unsupported palette format ${palette.format}.`);
  };
  let blockOffset = 0;
  for (let by = 0; by < height; by += bh) for (let bx = 0; bx < width; bx += bw) {
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      let color: Color;
      if (format === 0 || format === 8) {
        const packed = bytes[blockOffset + (i >>> 1)]!;
        const value = i & 1 ? packed & 15 : packed >>> 4;
        color = format === 8 ? lookup(value) : [value * 17, value * 17, value * 17, value * 17];
      } else if (format === 1 || format === 2 || format === 9) {
        const value = bytes[blockOffset + i]!;
        color = format === 9 ? lookup(value) : format === 2
          ? [(value & 15) * 17, (value & 15) * 17, (value & 15) * 17, (value >>> 4) * 17]
          : [value, value, value, value];
      } else if (format === 3 || format === 4 || format === 5 || format === 10) {
        const word = view.getUint16(blockOffset + i * 2);
        color = format === 3 ? [word & 255, word & 255, word & 255, word >>> 8]
          : format === 4 ? rgb565(word) : format === 5 ? rgb5a3(word) : lookup(word & 0x3fff);
      } else if (format === 6) {
        color = [bytes[blockOffset + i * 2 + 1]!, bytes[blockOffset + 32 + i * 2]!, bytes[blockOffset + 33 + i * 2]!, bytes[blockOffset + i * 2]!];
      } else {
        const sub = blockOffset + ((y >>> 2) * 2 + (x >>> 2)) * 8;
        const w0 = view.getUint16(sub), w1 = view.getUint16(sub + 2);
        const c0 = rgb565(w0), c1 = rgb565(w1);
        const mix = (a: Color, b: Color, wa: number, wb: number): Color => [
          Math.floor((a[0] * wa + b[0] * wb) / (wa + wb)),
          Math.floor((a[1] * wa + b[1] * wb) / (wa + wb)),
          Math.floor((a[2] * wa + b[2] * wb) / (wa + wb)), 255,
        ];
        const code = (bytes[sub + 4 + (y & 3)]! >>> (6 - (x & 3) * 2)) & 3;
        color = code === 0 ? c0 : code === 1 ? c1 : w0 > w1
          ? (code === 2 ? mix(c0, c1, 2, 1) : mix(c0, c1, 1, 2))
          : (code === 2 ? mix(c0, c1, 1, 1) : [0, 0, 0, 0]);
      }
      if (bx + x < width && by + y < height) pixels.set(color, ((by + y) * width + bx + x) * 4);
    }
    blockOffset += blockSize;
  }
  return { width, height, pixels };
}

function random(seed: number) { let state = seed >>> 0; return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296; }
const outcome = (run: () => DecodedTexture) => { try { return { pixels: [...run().pixels] }; } catch (error) { return { error: (error as Error).message }; } };

describe('optimized GameCube texture decoder', () => {
  it('matches the reference decoder byte for byte on every format, odd sizes and palettes', () => {
    const next = random(0x5eed);
    for (const format of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 14]) {
      for (let trial = 0; trial < 60; trial++) {
        const width = 1 + Math.floor(next() * 37), height = 1 + Math.floor(next() * 29);
        const bytes = Uint8Array.from({ length: 4096 }, () => Math.floor(next() * 256));
        let palette: Palette | undefined;
        if (format === 8 || format === 9 || format === 10) {
          const roll = next();
          // Mostly valid palettes, sometimes short ones (out-of-range errors) or bad formats.
          const entries = roll < 0.15 ? 3 : format === 8 ? 16 : format === 9 ? 256 : 1 << 14;
          palette = roll < 0.05 ? undefined : { format: roll < 0.1 ? 7 : Math.floor(next() * 3), bytes: Uint8Array.from({ length: entries * 2 + (next() < 0.2 ? 1 : 0) }, () => Math.floor(next() * 256)) };
          if (format === 10 && palette && roll >= 0.15) for (let i = 0; i < bytes.length; i += 2) bytes[i]! &= 0x3f;
        }
        expect(outcome(() => decodeTexture(bytes, format, width, height, palette)), `format ${format} ${width}x${height}`)
          .toEqual(outcome(() => legacyDecodeTexture(bytes, format, width, height, palette)));
      }
    }
  });
  it('keeps the original validation errors', () => {
    expect(() => decodeTexture(new Uint8Array(4), 14, 8, 8)).toThrow('Truncated GameCube texture data.');
    expect(() => decodeTexture(new Uint8Array(64), 7, 8, 8)).toThrow('Unsupported GameCube texture format 7.');
    expect(() => decodeTexture(new Uint8Array(64), 8, 8, 8)).toThrow('Missing or out-of-range GameCube texture palette.');
  });
});

describe('deferred textures', () => {
  it('decode on first pixels read, once, with the same bytes', async () => {
    const { deferredTexture } = await import('../../lib/hsd/texture.ts');
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 255);
    const lazy = deferredTexture(bytes, 14, 8, 8);
    expect([lazy.width, lazy.height]).toEqual([8, 8]);
    const first = lazy.pixels;
    expect(lazy.pixels).toBe(first);
    expect([...first]).toEqual([...decodeTexture(bytes, 14, 8, 8).pixels]);
  });
  it('still rejects broken data at creation', async () => {
    const { deferredTexture } = await import('../../lib/hsd/texture.ts');
    expect(() => deferredTexture(new Uint8Array(4), 14, 8, 8)).toThrow('Truncated GameCube texture data.');
    expect(() => deferredTexture(new Uint8Array(64), 7, 8, 8)).toThrow('Unsupported GameCube texture format 7.');
    expect(() => deferredTexture(new Uint8Array(64), 8, 8, 8)).toThrow('Missing or out-of-range GameCube texture palette.');
    expect(() => deferredTexture(new Uint8Array(64), 9, 8, 4, { format: 5, bytes: new Uint8Array(512) })).toThrow('Unsupported palette format 5.');
  });
});
