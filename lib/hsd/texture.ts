/** GameCube tiled texture decoding. Values remain in the original byte color space. */
export interface DecodedTexture { width: number; height: number; pixels: Uint8Array;
  /** True once `pixels` has been decoded and cached (deferred textures only). */
  readonly decoded?: boolean;
  /** Drops the cached RGBA so the source bytes alone stay resident. The next `pixels`
   * read decodes again; call it when no GPU texture references this image any more. */
  release?(): void;
  /** Undecoded source bytes (deferred textures only), for the memory census. */
  readonly source?: Uint8Array }
export interface Palette { format: number; bytes: Uint8Array }
const blocks: Record<number, [number, number, number]> = {
  0: [8, 8, 32], 1: [8, 4, 32], 2: [8, 4, 32], 3: [4, 4, 32],
  4: [4, 4, 32], 5: [4, 4, 32], 6: [4, 4, 64],
  8: [8, 8, 32], 9: [8, 4, 32], 10: [4, 4, 32], 14: [8, 8, 32],
};
const expandTable = (bits: number) => Uint8Array.from({ length: 1 << bits }, (_, value) => Math.round(value * 255 / ((1 << bits) - 1)));
const E3 = expandTable(3), E4 = expandTable(4), E5 = expandTable(5), E6 = expandTable(6);
/** Writes an RGB565 word as RGBA at `at`. */
function put565(out: Uint8Array, at: number, word: number): void {
  out[at] = E5[word >>> 11]!; out[at + 1] = E6[(word >>> 5) & 63]!; out[at + 2] = E5[word & 31]!; out[at + 3] = 255;
}
function put5a3(out: Uint8Array, at: number, word: number): void {
  if (word & 0x8000) { out[at] = E5[(word >>> 10) & 31]!; out[at + 1] = E5[(word >>> 5) & 31]!; out[at + 2] = E5[word & 31]!; out[at + 3] = 255; }
  else { out[at] = E4[(word >>> 8) & 15]!; out[at + 1] = E4[(word >>> 4) & 15]!; out[at + 2] = E4[word & 15]!; out[at + 3] = E3[(word >>> 12) & 7]!; }
}
export function textureByteSize(format: number, width: number, height: number): number {
  const block = blocks[format];
  if (!block) throw new Error(`Unsupported GameCube texture format ${format}.`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4_194_304) {
    throw new Error('Invalid or oversized GameCube texture dimensions.');
  }
  return Math.ceil(width / block[0]) * Math.ceil(height / block[1]) * block[2];
}
/** A texture whose RGBA decode runs on the first `pixels` read and is then kept. The roster
 * loads every fighter's model but only draws the ones on screen, so eager decoding held tens of
 * MB of RGBA for models never rendered. Format, size, data length and palette presence/format
 * are still checked here, so broken data keeps failing at load time. */
export function deferredTexture(bytes: Uint8Array, format: number, width: number, height: number, palette?: Palette): DecodedTexture {
  if (bytes.byteLength < textureByteSize(format, width, height)) throw new Error('Truncated GameCube texture data.');
  if (format === 8 || format === 9 || format === 10) {
    if (!palette || palette.bytes.length < 2) throw new Error('Missing or out-of-range GameCube texture palette.');
    if (palette.format !== 0 && palette.format !== 1 && palette.format !== 2) throw new Error(`Unsupported palette format ${palette.format}.`);
  }
  let pixels: Uint8Array | null = null;
  return {
    width, height,
    get pixels() { return pixels ??= decodeTexture(bytes, format, width, height, palette).pixels; },
    get decoded() { return pixels !== null; },
    source: bytes,
    // The RGBA expansion is 4-8x the source bytes; released images decode again on demand.
    release() { pixels = null; },
  };
}
/** Decodes into RGBA without per-pixel allocations: each block's texels go straight into
 * `pixels` (palette colors and CMPR sub-block palettes are expanded once). Texels of edge
 * blocks outside the image are still visited so palette range errors match the texel walk. */
export function decodeTexture(bytes: Uint8Array, format: number, width: number, height: number, palette?: Palette): DecodedTexture {
  const required = textureByteSize(format, width, height);
  if (bytes.byteLength < required) throw new Error('Truncated GameCube texture data.');
  const [bw, bh, blockSize] = blocks[format]!;
  const pixels = new Uint8Array(width * height * 4);
  // Palette colors expand lazily on first use, so an unused bad palette never throws.
  let colors: Uint8Array | null = null;
  const paletteColor = (index: number): number => {
    if (!palette || index * 2 + 2 > palette.bytes.length) throw new Error('Missing or out-of-range GameCube texture palette.');
    if (!colors) {
      if (palette.format !== 0 && palette.format !== 1 && palette.format !== 2) throw new Error(`Unsupported palette format ${palette.format}.`);
      const count = palette.bytes.length >>> 1, source = palette.bytes;
      colors = new Uint8Array(count * 4);
      for (let entry = 0; entry < count; entry++) {
        const word = (source[entry * 2]! << 8) | source[entry * 2 + 1]!, at = entry * 4;
        if (palette.format === 0) { colors[at] = colors[at + 1] = colors[at + 2] = word & 255; colors[at + 3] = word >>> 8; }
        else if (palette.format === 1) put565(colors, at, word);
        else put5a3(colors, at, word);
      }
    }
    return index * 4;
  };
  const putPalette = (from: number, at: number) => { const c = colors!; pixels[at] = c[from]!; pixels[at + 1] = c[from + 1]!; pixels[at + 2] = c[from + 2]!; pixels[at + 3] = c[from + 3]!; };
  const cmpr = new Uint8Array(16);
  let blockOffset = 0;
  for (let by = 0; by < height; by += bh) for (let bx = 0; bx < width; bx += bw) {
    if (format === 14) {
      // Four 4×4 sub-blocks of two RGB565 endpoints plus 2-bit codes; the endpoint palette is built once per sub-block.
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const sub = blockOffset + (sy * 2 + sx) * 8;
        const w0 = (bytes[sub]! << 8) | bytes[sub + 1]!, w1 = (bytes[sub + 2]! << 8) | bytes[sub + 3]!;
        put565(cmpr, 0, w0); put565(cmpr, 4, w1);
        for (let channel = 0; channel < 3; channel++) {
          const a = cmpr[channel]!, b = cmpr[4 + channel]!;
          if (w0 > w1) { cmpr[8 + channel] = Math.floor((a * 2 + b) / 3); cmpr[12 + channel] = Math.floor((a + b * 2) / 3); }
          else { cmpr[8 + channel] = Math.floor((a + b) / 2); cmpr[12 + channel] = 0; }
        }
        cmpr[11] = 255; cmpr[15] = w0 > w1 ? 255 : 0;
        for (let py = 0; py < 4; py++) {
          const row = by + sy * 4 + py;
          if (row >= height) continue;
          const codes = bytes[sub + 4 + py]!;
          for (let px = 0; px < 4; px++) {
            const column = bx + sx * 4 + px;
            if (column >= width) continue;
            const from = ((codes >>> (6 - px * 2)) & 3) * 4, at = (row * width + column) * 4;
            pixels[at] = cmpr[from]!; pixels[at + 1] = cmpr[from + 1]!; pixels[at + 2] = cmpr[from + 2]!; pixels[at + 3] = cmpr[from + 3]!;
          }
        }
      }
      blockOffset += blockSize;
      continue;
    }
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x, inside = bx + x < width && by + y < height, at = ((by + y) * width + bx + x) * 4;
      switch (format) {
        case 0: case 8: {
          const packed = bytes[blockOffset + (i >>> 1)]!, value = i & 1 ? packed & 15 : packed >>> 4;
          if (format === 8) { const from = paletteColor(value); if (inside) putPalette(from, at); }
          else if (inside) pixels[at] = pixels[at + 1] = pixels[at + 2] = pixels[at + 3] = value * 17;
          break;
        }
        case 1: case 2: case 9: {
          const value = bytes[blockOffset + i]!;
          if (format === 9) { const from = paletteColor(value); if (inside) putPalette(from, at); }
          else if (!inside) break;
          else if (format === 2) { pixels[at] = pixels[at + 1] = pixels[at + 2] = (value & 15) * 17; pixels[at + 3] = (value >>> 4) * 17; }
          else pixels[at] = pixels[at + 1] = pixels[at + 2] = pixels[at + 3] = value;
          break;
        }
        case 3: case 4: case 5: case 10: {
          const word = (bytes[blockOffset + i * 2]! << 8) | bytes[blockOffset + i * 2 + 1]!;
          if (format === 10) { const from = paletteColor(word & 0x3fff); if (inside) putPalette(from, at); }
          else if (!inside) break;
          else if (format === 3) { pixels[at] = pixels[at + 1] = pixels[at + 2] = word & 255; pixels[at + 3] = word >>> 8; }
          else if (format === 4) put565(pixels, at, word);
          else put5a3(pixels, at, word);
          break;
        }
        default: // 6: RGBA8 in the original channel layout.
          if (inside) { pixels[at] = bytes[blockOffset + i * 2 + 1]!; pixels[at + 1] = bytes[blockOffset + 32 + i * 2]!; pixels[at + 2] = bytes[blockOffset + 33 + i * 2]!; pixels[at + 3] = bytes[blockOffset + i * 2]!; }
      }
    }
    blockOffset += blockSize;
  }
  return { width, height, pixels };
}
