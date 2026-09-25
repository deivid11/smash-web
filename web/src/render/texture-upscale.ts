/** Optional CPU upscale of the original fighter and stage textures (Options → Visual effects).
 *
 * Cosmetic only: simulation, snapshots and hashes never read it. It is a classic filter, a
 * separable Catmull-Rom (bicubic) resample, not a learned or hand-painted HD pack: it adds no
 * detail that the disc does not hold. What it buys is the magnified look — the GPU's bilinear
 * filter then interpolates between four/sixteen times as many, already smoothly curved
 * samples, so the diamond-shaped blur and stair-steps of a 64-pixel texture stretched over
 * a close-up model turn into clean curves. Each resampled value is clamped to the range of
 * the texels it lies between, and a range-clamped sharpen then steepens the edges, so flat art
 * and alpha cut-outs never grow ringing halos. */
export type TextureUpscale = 1 | 2 | 4;
export const TEXTURE_UPSCALES = [1, 2, 4] as const satisfies readonly TextureUpscale[];
export const TEXTURE_UPSCALE_KEY = 'smash-web.texture-upscale';
/** Largest side an upscaled texture may reach; a bigger factor falls back to a smaller one. */
export const TEXTURE_UPSCALE_MAX_SIDE = 2048;
/** Ramps, single-colour fills and other tiny lookups gain nothing from resampling. */
export const TEXTURE_UPSCALE_MIN_SIDE = 4;

export function isTextureUpscale(value: unknown): value is TextureUpscale { return value === 1 || value === 2 || value === 4; }
function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export function loadTextureUpscale(): TextureUpscale {
  try { const value = Number(storage()?.getItem(TEXTURE_UPSCALE_KEY)); return isTextureUpscale(value) ? value : 1; } catch { return 1; }
}
export function saveTextureUpscale(value: TextureUpscale): void {
  try { const store = storage(); if (!store) return; if (value === 1) store.removeItem(TEXTURE_UPSCALE_KEY); else store.setItem(TEXTURE_UPSCALE_KEY, String(value)); } catch { /* private mode: the session value still applies */ }
}
let current: TextureUpscale | null = null;
/** Factor newly created model textures use; existing GPU textures keep theirs until reloaded. */
export function textureUpscale(): TextureUpscale { return current ??= loadTextureUpscale(); }
export function setTextureUpscale(value: TextureUpscale): void { current = value; }

/** The factor actually applied to one image: 1 when it is too small to gain anything, and
 * stepped down while the result would exceed {@link TEXTURE_UPSCALE_MAX_SIDE}. */
export function effectiveTextureUpscale(width: number, height: number, wanted: TextureUpscale): TextureUpscale {
  if (Math.min(width, height) < TEXTURE_UPSCALE_MIN_SIDE) return 1;
  let factor: number = wanted;
  while (factor > 1 && Math.max(width, height) * factor > TEXTURE_UPSCALE_MAX_SIDE) factor /= 2;
  return factor as TextureUpscale;
}

/** GX wrap modes: 0 clamp, 1 repeat, 2 mirror. Taps past an edge follow the same rule the
 * GPU sampler will, so tiling textures keep seamless borders after the resample. */
function wrapIndex(index: number, size: number, mode: number): number {
  if (mode === 1) return ((index % size) + size) % size;
  if (mode === 2) { const period = size * 2, at = ((index % period) + period) % period; return at < size ? at : period - 1 - at; }
  return index < 0 ? 0 : index >= size ? size - 1 : index;
}
/** Catmull-Rom weights of the four taps around a sample `t` (0..1) past the second tap. */
function weights(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}
/** One axis of the resample over interleaved 4-channel float rows/columns. */
function resampleAxis(source: Float32Array, count: number, lines: number, factor: number, mode: number, stride: number, lineStride: number, outStride: number, outLineStride: number, out: Float32Array): void {
  const phases = Array.from({ length: factor }, (_, phase) => { const at = (phase + 0.5) / factor - 0.5, base = Math.floor(at); return { base, w: weights(at - base) }; });
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < count; i++) {
      for (let phase = 0; phase < factor; phase++) {
        const { base, w } = phases[phase]!;
        const i0 = wrapIndex(i + base - 1, count, mode), i1 = wrapIndex(i + base, count, mode), i2 = wrapIndex(i + base + 1, count, mode), i3 = wrapIndex(i + base + 2, count, mode);
        const a0 = line * lineStride + i0 * stride, a1 = line * lineStride + i1 * stride, a2 = line * lineStride + i2 * stride, a3 = line * lineStride + i3 * stride;
        const to = line * outLineStride + (i * factor + phase) * outStride;
        for (let channel = 0; channel < 4; channel++) {
          const near = source[a1 + channel]!, far = source[a2 + channel]!;
          const value = source[a0 + channel]! * w[0] + near * w[1] + far * w[2] + source[a3 + channel]! * w[3];
          // Anti-ringing: stay between the two texels this sample lies between.
          out[to + channel] = value < Math.min(near, far) ? Math.min(near, far) : value > Math.max(near, far) ? Math.max(near, far) : value;
        }
      }
    }
  }
}

/** How far the resampled picture is pushed away from its own 4-neighbour blur. */
export const TEXTURE_UPSCALE_SHARPEN = 0.6;
/** Contrast-adaptive style sharpen of the resampled (premultiplied) picture: each texel moves
 * away from the mean of its four neighbours, then is clamped to the range those neighbours and
 * itself span. The clamp is what keeps it halo-free: edges get steeper, never brighter or
 * darker than what is already around them, and flat areas do not move at all. */
function sharpen(image: Float32Array, width: number, height: number, wrapS: number, wrapT: number): void {
  const source = image.slice();
  for (let y = 0; y < height; y++) {
    const up = wrapIndex(y - 1, height, wrapT) * width, down = wrapIndex(y + 1, height, wrapT) * width, row = y * width;
    for (let x = 0; x < width; x++) {
      const left = wrapIndex(x - 1, width, wrapS), right = wrapIndex(x + 1, width, wrapS);
      for (let channel = 0; channel < 4; channel++) {
        const c = source[(row + x) * 4 + channel]!, n = source[(up + x) * 4 + channel]!, s = source[(down + x) * 4 + channel]!, w = source[(row + left) * 4 + channel]!, e = source[(row + right) * 4 + channel]!;
        const low = Math.min(c, n, s, w, e), high = Math.max(c, n, s, w, e), value = c + (c - (n + s + w + e) / 4) * TEXTURE_UPSCALE_SHARPEN;
        image[(row + x) * 4 + channel] = value < low ? low : value > high ? high : value;
      }
    }
  }
}

/** Upscales straight-alpha RGBA8 by an integer factor. Colour is filtered premultiplied, so
 * the (often black) RGB under transparent texels never darkens a cut-out's edge; fully
 * transparent results keep the nearest source colour for the GPU filter to bleed from. */
export function upscaleRgba(pixels: Uint8Array, width: number, height: number, factor: TextureUpscale, wrapS = 0, wrapT = 0): { pixels: Uint8Array; width: number; height: number } {
  if (factor === 1 || pixels.length < width * height * 4) return { pixels, width, height };
  const outWidth = width * factor, outHeight = height * factor;
  const source = new Float32Array(width * height * 4);
  for (let at = 0; at < source.length; at += 4) {
    const alpha = pixels[at + 3]! / 255;
    source[at] = pixels[at]! * alpha; source[at + 1] = pixels[at + 1]! * alpha; source[at + 2] = pixels[at + 2]! * alpha; source[at + 3] = pixels[at + 3]!;
  }
  // Horizontal: rows are lines, columns are samples. Vertical: columns are lines, rows are samples.
  const wide = new Float32Array(outWidth * height * 4);
  resampleAxis(source, width, height, factor, wrapS, 4, width * 4, 4, outWidth * 4, wide);
  const full = new Float32Array(outWidth * outHeight * 4);
  resampleAxis(wide, height, outWidth, factor, wrapT, outWidth * 4, 4, outWidth * 4, 4, full);
  sharpen(full, outWidth, outHeight, wrapS, wrapT);
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const sourceRow = Math.min(height - 1, Math.floor(y / factor)) * width;
    for (let x = 0; x < outWidth; x++) {
      const at = (y * outWidth + x) * 4, alpha = full[at + 3]!;
      if (alpha >= 0.5) {
        const scale = 255 / alpha;
        out[at] = Math.min(255, Math.round(full[at]! * scale)); out[at + 1] = Math.min(255, Math.round(full[at + 1]! * scale)); out[at + 2] = Math.min(255, Math.round(full[at + 2]! * scale));
        out[at + 3] = Math.min(255, Math.round(alpha));
      } else {
        const from = (sourceRow + Math.min(width - 1, Math.floor(x / factor))) * 4;
        out[at] = pixels[from]!; out[at + 1] = pixels[from + 1]!; out[at + 2] = pixels[from + 2]!; out[at + 3] = 0;
      }
    }
  }
  return { pixels: out, width: outWidth, height: outHeight };
}
