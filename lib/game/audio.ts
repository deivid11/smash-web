// HAL SSM/DSP layout: original HSD synth + vgmstream's ngc_ssm reader.
// See third_party/NOTICE.md. PCM decoding is local; this is not the complete AX mixer.
export interface PcmSound { rate: number; channels: Int16Array[]; loop: boolean; loopStart: number }
interface DspChannel { start: number; samples: number; coefs: number[]; h1: number; h2: number }
export interface SoundDescriptor { id: number; rate: number; channels: DspChannel[]; loop: boolean; loopStart: number }
/** `auxA`: the voice's aux-A (reverb) send fraction x26·x24[0]/65535 when the cue starts
 * (see lib/game/ax-aux.ts); scripts always set it, direct samples have none. */
export interface SoundCue { sample: number; delay: number; gain: number; pitch: number; auxA?: number }
const nibbleSamples = (n: number) => Math.floor(n / 16) * 14 + (n % 16 > 0 ? n % 16 - 2 : 0);
function range(offset: number, length: number, total: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > total || length > total - offset) throw new Error('Audio data range is invalid.');
}
export function decodeDsp(bytes: Uint8Array, count: number, coefficients: readonly number[], initial1 = 0, initial2 = 0): Int16Array {
  if (!Number.isInteger(count) || count < 0 || count > 2_000_000 || coefficients.length !== 16) throw new Error('Invalid DSP sample parameters.');
  range(0, Math.ceil(count / 14) * 8, bytes.length);
  const pcm = new Int16Array(count); let h1 = initial1, h2 = initial2;
  for (let i = 0; i < count; i++) {
    const frame = Math.floor(i / 14) * 8, within = i % 14, header = bytes[frame]!;
    const predictor = header >>> 4, scale = 1 << (header & 15);
    if (predictor > 7) throw new Error('Invalid DSP predictor index.');
    const packed = bytes[frame + 1 + (within >>> 1)]!;
    const nibble = within & 1 ? packed & 15 : packed >>> 4;
    const signed = nibble >= 8 ? nibble - 16 : nibble;
    const value = Math.max(-32768, Math.min(32767, Math.floor((signed * scale * 2048 + 1024 + coefficients[predictor * 2]! * h1 + coefficients[predictor * 2 + 1]! * h2) / 2048)));
    pcm[i] = value; h2 = h1; h1 = value;
  }
  return pcm;
}
export class SsmBank {
  readonly sounds: SoundDescriptor[] = [];
  readonly base: number;
  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length < 16 || bytes.length > 16 * 1024 * 1024) throw new Error('Invalid SSM bank size.');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), headSize = v.getUint32(0), dataSize = v.getUint32(4), count = v.getUint32(8);
    this.base = v.getUint32(12);
    if (count < 1 || count > 4096 || this.base + count > 65536 || headSize < count * 0x48 || 16 + headSize + dataSize > bytes.length) throw new Error('Invalid SSM bank header.');
    const dataOffset = bytes.length - dataSize; let offset = 16;
    for (let index = 0; index < count; index++) {
      range(offset, 8, 16 + headSize);
      const channels = v.getUint32(offset), rate = v.getUint32(offset + 4);
      if (channels < 1 || channels > 2 || rate < 8000 || rate > 48000) throw new Error('Unsupported SSM channel/rate configuration.');
      range(offset, 8 + channels * 0x40, 16 + headSize);
      const desc: SoundDescriptor = { id: this.base + index, rate, loop: v.getUint16(offset + 8) !== 0, loopStart: 0, channels: [] };
      for (let channel = 0; channel < channels; channel++) {
        const d = offset + 8 + channel * 0x40, startNibble = v.getUint32(d + 12), endNibble = v.getUint32(d + 8), loopNibble = v.getUint32(d + 4);
        if (v.getUint16(d + 2) !== 0 || endNibble < startNibble) throw new Error('Unsupported SSM encoding or invalid sample bounds.');
        const samples = nibbleSamples(endNibble - startNibble), start = dataOffset + Math.floor(startNibble / 16) * 8;
        if (samples < 0 || samples > 2_000_000) throw new Error('SSM sample exceeds the decoding budget.');
        range(start, Math.ceil(samples / 14) * 8, bytes.length);
        desc.loopStart = Math.max(0, Math.min(samples, nibbleSamples(Math.max(0, loopNibble - startNibble))));
        desc.channels.push({ start, samples, coefs: Array.from({ length: 16 }, (_, n) => v.getInt16(d + 16 + n * 2)), h1: v.getInt16(d + 52), h2: v.getInt16(d + 54) });
      }
      if (desc.channels.some((channel) => channel.samples !== desc.channels[0]!.samples)) throw new Error('Mismatched SSM channel lengths.');
      this.sounds.push(desc); offset += 8 + channels * 0x40;
    }
  }
  decode(id: number): PcmSound {
    const sound = this.sounds[id - this.base]; if (!sound) throw new Error('Sound is not in this SSM bank.');
    return { rate: sound.rate, loop: sound.loop, loopStart: sound.loopStart, channels: sound.channels.map((channel) => decodeDsp(this.bytes.subarray(channel.start, channel.start + Math.ceil(channel.samples / 14) * 8), channel.samples, channel.coefs, channel.h1, channel.h2)) };
  }
}

export class SemTable {
  private view: DataView;
  private banks: number[];
  private scripts: number[];
  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const read = (offset: number) => { range(offset, 4, bytes.length); return this.view.getUint32(offset); };
    let offset = 0;
    for (let i = 0; i < 2; i++) { const count = read(offset); if (count > 10000) throw new Error('Oversized SEM header table.'); offset += 4 + count * 4; range(0, offset, bytes.length); }
    const bankCount = read(offset); offset += 4;
    if (bankCount < 1 || bankCount > 256) throw new Error('Invalid SEM bank table.');
    this.banks = Array.from({ length: bankCount }, (_, i) => read(offset + i * 4)); offset += bankCount * 4;
    const scriptCount = read(offset); offset += 4;
    if (scriptCount > 20000) throw new Error('Oversized SEM script table.');
    this.scripts = Array.from({ length: scriptCount }, (_, i) => read(offset + i * 4));
    for (const pointer of this.scripts) range(pointer, 4, bytes.length);
  }
  /** Banks in this table; ids are `bank * 10000 + script`. */
  get bankCount(): number { return this.banks.length; }
  /** The bank whose scripts start playing at SSM sample `base` (an extension fighter's
   * bank index, read from the table instead of hardcoded). */
  bankForSample(base: number): number | undefined {
    for (let bank = 0; bank < this.banks.length; bank++) {
      const count = (this.banks[bank + 1] ?? this.scripts.length) - this.banks[bank]!;
      let low = Infinity;
      for (let script = 0; script < count; script++) for (const cue of this.cues(bank * 10000 + script)) low = Math.min(low, cue.sample);
      if (low === base) return bank;
    }
    return undefined;
  }
  cues(id: number): SoundCue[] {
    if (!Number.isInteger(id) || id < 0 || id >= this.banks.length * 10000) return [];
    const bank = Math.floor(id / 10000), local = id % 10000, base = this.banks[bank];
    if (base === undefined) return [];
    const index = base + local;
    if (index >= (this.banks[bank + 1] ?? this.scripts.length)) return [];
    let cursor = this.scripts[index]; if (cursor === undefined) return [];
    // Aux sends start from the channel defaults (AXDriver_804C5A20: zero for aux A) with a
    // full x26 scale. Ops 18/19/21 (aux B) are ignored: AXDriver_804D603C = 2 locks aux B
    // to the program's per-channel levels (lib/game/ax-aux.ts auxBSend).
    let time = 0, gain = 1, pitch = 1, pending: number | null = null, loopCount = 0, auxA = 0, auxAScale = 255;
    const result: SoundCue[] = [];
    const flush = () => { if (pending !== null) { result.push({ sample: pending, delay: time * 0.003, gain, pitch, auxA: auxAScale * auxA / 65535 }); pending = null; } };
    for (let count = 0; count < 256; count++) {
      range(cursor, 4, this.view.byteLength); const word = this.view.getUint32(cursor), op = word >>> 24;
      const delay = op === 0 ? word & 0xffffff : [6,7,8,9,10,11,16,17,18,19].includes(op) ? (word >>> 8) & 0xffff : op === 12 || op === 13 ? (word >>> 16) & 255 : 0;
      if (delay) { flush(); time += delay; if (time > 10000) break; }
      if (op === 1) pending = word & 0xffff;
      else if (op === 6) gain = (word & 255) / 255;
      else if (op === 7) gain = Math.max(0, Math.min(1, gain + ((word << 24) >> 24) / 255));
      else if (op === 12) pitch = 2 ** (((word << 16) >> 16) / 1200);
      else if (op === 13) pitch *= 2 ** (((word << 16) >> 16) / 1200);
      else if (op === 16) auxA = word & 255;
      else if (op === 17) auxA = Math.max(0, Math.min(255, auxA + ((word << 24) >> 24)));
      else if (op === 20) auxAScale = word & 255;
      else if (op === 2) loopCount = word & 0xffff;
      else if (op === 3) { if (loopCount === 0) break; if (--loopCount > 0) { cursor -= (word & 0xffffff) * 4; continue; } }
      else if (op === 14 || op === 15) { flush(); break; }
      if (result.length > 16) break;
      cursor += 4;
    }
    flush(); return result;
  }
}
// Original lbColl_803B9880 mapping (sound kind × severity), not guessed cues.
const HIT_SOUNDS = [540000,540000,540000,91,90,89,88,87,86,111,112,113,84,84,84,90,89,223,225,225,225,98,99,100,101,102,103,280091,280091,280091,241,241,241,94,93,92,220079,220082,220085,540000,540000,525];
export function hitSound(kind = 0, severity = 0): number { return HIT_SOUNDS[kind * 3 + Math.min(2, severity)] ?? 540000; }

export class GameSoundLibrary {
  /** Decoded PCM, bounded to 96 sounds; exposed read-only for the memory census. */
  readonly cache = new Map<number, PcmSound>();
  /** `extension` is the ACE disc's own SEM: it answers only the banks past the vanilla
   * table (m-ex fighter banks); every vanilla id keeps resolving through `sem`. */
  constructor(readonly sem: SemTable, readonly banks: SsmBank[], readonly extension?: SemTable) {}
  cues(id: number): SoundCue[] {
    const table = this.extension && Math.floor(id / 10000) >= this.sem.bankCount ? this.extension : this.sem;
    return table.cues(id).filter((cue) => this.banks.some((bank) => cue.sample >= bank.base && cue.sample < bank.base + bank.sounds.length));
  }
  /** How many 60 Hz frames a SEM-scripted sound plays (its longest cue: delay plus the sample
   * at the cue pitch), from the SSM headers alone. Deterministic, so simulation code can
   * stand in for lbAudioAx_80023710 ("still playing?"); 0 when nothing resolves. */
  durationFrames(id: number): number {
    let seconds = 0;
    for (const cue of this.cues(id)) {
      const bank = this.banks.find((entry) => cue.sample >= entry.base && cue.sample < entry.base + entry.sounds.length);
      const sound = bank?.sounds[cue.sample - bank.base];
      if (!sound) continue;
      seconds = Math.max(seconds, cue.delay + (sound.channels[0]?.samples ?? 0) / sound.rate / Math.max(0.125, Math.min(8, cue.pitch)));
    }
    // The epsilon keeps a last-ulp pow/division difference between engines from moving a frame.
    return Math.max(0, Math.ceil(seconds * 60 - 1e-6));
  }
  sample(id: number): PcmSound | null {
    const cached = this.cache.get(id); if (cached) return cached;
    const bank = this.banks.find((bank) => id >= bank.base && id < bank.base + bank.sounds.length); if (!bank) return null;
    const pcm = bank.decode(id); if (this.cache.size >= 96) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(id, pcm); return pcm;
  }
}
