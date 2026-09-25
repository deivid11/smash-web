import { describe, expect, it } from 'vitest';
import { effectiveTextureUpscale, isTextureUpscale, upscaleRgba } from '../../web/src/render/texture-upscale.ts';

const rgba = (width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) => {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(fill(x, y), (y * width + x) * 4);
  return pixels;
};
const at = (image: { pixels: Uint8Array; width: number }, x: number, y: number) => [...image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

describe('cosmetic texture upscale', () => {
  it('is the identity at 1x and multiplies the size otherwise', () => {
    const pixels = rgba(8, 4, (x, y) => [x * 30, y * 60, 9, 255]);
    expect(upscaleRgba(pixels, 8, 4, 1).pixels).toBe(pixels);
    const doubled = upscaleRgba(pixels, 8, 4, 2);
    expect([doubled.width, doubled.height, doubled.pixels.length]).toEqual([16, 8, 16 * 8 * 4]);
    expect(upscaleRgba(pixels, 8, 4, 4)).toMatchObject({ width: 32, height: 16 });
  });
  it('keeps flat colour exactly flat and a hard edge free of ringing', () => {
    const flat = upscaleRgba(rgba(8, 8, () => [200, 100, 50, 255]), 8, 8, 4);
    for (let i = 0; i < flat.pixels.length; i += 4) expect([...flat.pixels.slice(i, i + 4)]).toEqual([200, 100, 50, 255]);
    const edge = upscaleRgba(rgba(8, 8, x => x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]), 8, 8, 4);
    // Far from the edge both sides stay pure; nothing overshoots 0..255 into a halo.
    expect(at(edge, 2, 10)).toEqual([0, 0, 0, 255]); expect(at(edge, 29, 10)).toEqual([255, 255, 255, 255]);
    const row = Array.from({ length: 32 }, (_, x) => at(edge, x, 10)[0]!);
    for (let x = 1; x < 32; x++) expect(row[x]!).toBeGreaterThanOrEqual(row[x - 1]!); // monotonic: no ringing
  });
  it('filters colour premultiplied so a cut-out edge never darkens, and keeps colour under full transparency', () => {
    // Opaque red next to transparent BLACK: a straight-alpha filter would pull the edge toward black.
    const cut = upscaleRgba(rgba(8, 8, x => x < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]), 8, 8, 2);
    for (let x = 0; x < 16; x++) { const [r, g, b, a] = at(cut, x, 6); if (a! > 0) expect([r, g, b]).toEqual([255, 0, 0]); }
    expect(at(cut, 15, 6)).toEqual([0, 0, 0, 0]);
  });
  it('follows the sampler wrap mode at the borders so tiling textures stay seamless', () => {
    const stripes = rgba(4, 4, x => x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
    const clamp = upscaleRgba(stripes, 4, 4, 2, 0, 0), repeat = upscaleRgba(stripes, 4, 4, 2, 1, 1);
    // Clamp: the left border only sees white beyond it. Repeat: it sees the black column from the far side.
    expect(at(clamp, 0, 2)[0]).toBe(255); expect(at(repeat, 0, 2)[0]!).toBeLessThan(255);
  });
  it('skips tiny lookups and steps the factor down instead of exceeding the size cap', () => {
    expect(effectiveTextureUpscale(2, 64, 4)).toBe(1); expect(effectiveTextureUpscale(64, 64, 4)).toBe(4);
    expect(effectiveTextureUpscale(1024, 512, 4)).toBe(2); expect(effectiveTextureUpscale(2048, 2048, 4)).toBe(1);
    expect([1, 2, 4].every(isTextureUpscale)).toBe(true); expect(isTextureUpscale(3)).toBe(false);
  });
});
