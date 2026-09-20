import { decodeDsp, type PcmSound } from './audio.ts';

export const MUSIC_TRACKS = {
  menu: 'audio/menu01.hps',
  battlefield: 'audio/sp_zako.hps',
  final: 'audio/sp_end.hps',
  corneria: 'audio/corneria.hps',
  temple: 'audio/shrine.hps',
  stadium: 'audio/pokesta.hps',
  'yoshi-story': 'audio/ystory.hps',
  'dream-land': 'audio/old_kb.hps',
  'peach-castle': 'audio/castle.hps',
  onett: 'audio/onetto.hps',
  'mute-city': 'audio/mutecity.hps',
  'yoshi-island': 'audio/yorster.hps',
  'green-greens': 'audio/greens.hps',
  venom: 'audio/venom.hps',
  'jungle-japes': 'audio/garden.hps',
  fourside: 'audio/fourside.hps',
  brinstar: 'audio/zebes.hps',
  'kongo-jungle': 'audio/kongo.hps',
  'fountain-of-dreams': 'audio/izumi.hps',
  'mushroom-kingdom': 'audio/inis1_01.hps',
} as const;
export type MusicId = keyof typeof MUSIC_TRACKS;
export const MAX_MUSIC_SAMPLES = 8_000_000; // per channel; at most 64 MB per WebAudio buffer (Jungle Japes needs ~7M)
export const MAX_HPS_BYTES = 8 * 1024 * 1024;
const samplesFromNibbles = (n: number) => Math.floor(n / 16) * 14 + Math.max(0, n % 16 - 2);
interface Block { offset: number; size: number; samples: number; start: number }

/** HALPST block-linked Nintendo DSP ADPCM. No music assets are bundled.
 * Format research: vgmstream meta/halpst.c, layout/blocked_halpst.c at the
 * revision credited in third_party/NOTICE.md. Initial histories are the block
 * contexts, not zeros at every block. A backwards link defines the loop.
 */
export function decodeHps(bytes: Uint8Array, signal?: AbortSignal): PcmSound {
  const check = (offset: number, length: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset > bytes.length || length > bytes.length - offset) throw new Error('Invalid HPS data range.');
  };
  if (bytes.length < 0xa0 || bytes.length > MAX_HPS_BYTES) throw new Error('HPS size exceeds the music budget.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) !== 0x2048414c || v.getUint32(4) !== 0x50535400) throw new Error('Invalid HALPST signature.');
  const rate = v.getUint32(8), channelCount = v.getUint32(12);
  if (rate < 8000 || rate > 48000 || channelCount < 1 || channelCount > 2) throw new Error('Unsupported HPS sample rate or channels.');
  const sampleCount = samplesFromNibbles(v.getUint32(0x18)) + 1;
  if (sampleCount < 1 || sampleCount > MAX_MUSIC_SAMPLES) throw new Error('HPS sample count exceeds the music budget.');
  const coefficients: number[][] = [];
  for (let c = 0; c < channelCount; c++) {
    const base = 0x10 + c * 0x38;
    if (v.getUint32(base + 4) !== 2 || v.getUint32(base + 12) !== 2 || v.getUint32(base + 8) !== v.getUint32(0x18)) throw new Error('Unsupported HPS channel encoding or mismatched lengths.');
    coefficients.push(Array.from({ length: 16 }, (_, i) => v.getInt16(base + 16 + i * 2)));
  }
  const blocks: Block[] = [], starts = new Map<number, number>();
  let offset = 0x80, total = 0, loop = false, loopStart = 0;
  while (true) {
    signal?.throwIfAborted();
    check(offset, 0x20);
    if (blocks.length >= 1024 || offset % 0x20 !== 0) throw new Error('Invalid HPS block chain.');
    const dataSize = v.getUint32(offset), nibbles = v.getUint32(offset + 4) + 1, next = v.getUint32(offset + 8);
    const size = dataSize / channelCount, samples = samplesFromNibbles(nibbles);
    if (!Number.isInteger(size) || size < 8 || size > 0x10000 || size % 8 || samples < 1 || Math.ceil(samples / 14) * 8 > size || total + samples > sampleCount) throw new Error('Invalid HPS block size or sample count.');
    check(offset + 0x20, dataSize);
    starts.set(offset, total); blocks.push({ offset, size, samples, start: total }); total += samples;
    if (next === 0xffffffff) break;
    if (next <= offset) {
      const start = starts.get(next);
      if (start === undefined) throw new Error('HPS loop does not target a block boundary.');
      loop = true; loopStart = start; break;
    }
    if (next < offset + 0x20 + dataSize) throw new Error('Overlapping HPS blocks.');
    offset = next;
  }
  if (total !== sampleCount) throw new Error('HPS chain does not match the declared sample count.');
  const channels = Array.from({ length: channelCount }, () => new Int16Array(sampleCount));
  for (const block of blocks) {
    signal?.throwIfAborted();
    for (let c = 0; c < channelCount; c++) {
      const start = block.offset + 0x20 + c * block.size, context = block.offset + 12 + c * 8;
      const pcm = decodeDsp(bytes.subarray(start, start + block.size), block.samples, coefficients[c]!, v.getInt16(context + 2), v.getInt16(context + 4));
      channels[c]!.set(pcm, block.start);
    }
  }
  return { rate, channels, loop, loopStart };
}
