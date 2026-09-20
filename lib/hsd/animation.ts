// FObj/figatree format interpretation: noclip.website and the original HSD sources.
// See third_party/NOTICE.md. This is animation playback, not game simulation.
import { HsdArchive, linkedList } from './archive.ts';

export interface Keyframe { time: number; duration: number; mode: number; p0: number; p1: number; d0: number; d1: number }
export interface Track { type: number; keys: Keyframe[] }
export interface JointAnimation { endFrame: number; tracks: Track[] }
export interface AnimationClip { name: string; endFrame: number; joints: JointAnimation[] }
export interface FighterAction { name: string; symbol: string; offset: number; size: number; scriptOffset: number }

export function decodeKeyframes(bytes: Uint8Array, fracValue: number, fracSlope: number): Keyframe[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  const take = (size: number) => {
    if (cursor + size > bytes.length) throw new Error('Truncated HSD animation stream.');
    const result = cursor; cursor += size; return result;
  };
  const vlq = () => {
    let result = 0;
    for (let i = 0; i < 5; i++) {
      const byte = view.getUint8(take(1));
      result += (byte & 127) * 2 ** (i * 7);
      if (result > 0xffffffff) throw new Error('Oversized HSD animation integer.');
      if (!(byte & 128)) return result;
    }
    throw new Error('Unterminated HSD animation integer.');
  };
  const number = (frac: number) => {
    const format = frac >>> 5, shift = frac & 31;
    let result: number;
    if (format === 0) {
      if (shift !== 0) throw new Error('Invalid float animation format.');
      result = view.getFloat32(take(4), true);
    } else if (format === 1) result = view.getInt16(take(2), true) / 2 ** shift;
    else if (format === 2) result = view.getUint16(take(2), true) / 2 ** shift;
    else if (format === 3) result = view.getInt8(take(1)) / 2 ** shift;
    else if (format === 4) result = view.getUint8(take(1)) / 2 ** shift;
    else throw new Error('Unsupported HSD animation number format.');
    if (!Number.isFinite(result)) throw new Error('Non-finite HSD animation value.');
    return result;
  };
  const keys: Keyframe[] = [];
  let p0 = 0, p1 = 0, d0 = 0, d1 = 0, time = 0, duration = 0, previous = 0, hasSlope = false, valuesRead = 0;
  while (cursor < bytes.length) {
    const header = vlq(), opcode = header & 15, count = (header >>> 4) + 1;
    if (opcode < 1 || opcode > 6 || count > 100_000) throw new Error('Invalid HSD animation opcode or run length.');
    for (let i = 0; i < count; i++) {
      if (++valuesRead > 1_000_000) throw new Error('HSD animation key budget exceeded.');
      if (opcode === 5) { d0 = d1; d1 = number(fracSlope); hasSlope = true; continue; }
      p0 = p1;
      p1 = number(fracValue);
      if (opcode === 1 || opcode === 2) { if (!hasSlope) { d0 = d1; d1 = 0; } }
      else if (opcode === 3) { d0 = d1; d1 = 0; }
      else if (opcode === 4) { d0 = d1; d1 = number(fracSlope); }
      else if (opcode === 6) p0 = p1;
      hasSlope = false;
      if (previous) keys.push({ time, duration, mode: previous, p0, p1, d0, d1 });
      time += duration;
      if (time > 10_000_000) throw new Error('HSD animation duration budget exceeded.');
      // HSDRaw-authored streams (modded fighters) omit the trailing duration after the
      // final key; original streams always carry it. Both shapes end the track here.
      duration = cursor < bytes.length ? vlq() : 0; previous = opcode;
    }
  }
  if (previous) keys.push({ time, duration: 0, mode: 1, p0: p1, p1, d0: 0, d1: 0 });
  return keys;
}

export function sampleTrack(keys: Keyframe[], frame: number): number | undefined {
  if (!keys.length) return undefined;
  let low = 0, high = keys.length;
  while (low < high) { const mid = (low + high) >>> 1; if (keys[mid]!.time <= frame) low = mid + 1; else high = mid; }
  const key = keys[Math.max(0, low - 1)]!;
  if (key.mode === 1 || key.mode === 6) return key.p0;
  const t = key.duration > 0 ? Math.min(1, Math.max(0, (frame - key.time) / key.duration)) : 1;
  if (key.mode === 2) return key.p0 + (key.p1 - key.p0) * t;
  // HSD's stored slopes are derivatives per frame, not normalized tangents.
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * key.p0 + (-2 * t3 + 3 * t2) * key.p1
    + (t3 - 2 * t2 + t) * key.d0 * key.duration + (t3 - t2) * key.d1 * key.duration;
}

export function fighterActions(arc: HsdArchive): FighterAction[] {
  const root = arc.symbols.values().next().value as number | undefined;
  if (root === undefined) throw new Error('Missing fighter data root.');
  const table = arc.pointer(root + 12);
  const count = Math.floor(arc.extent(table) / 24);
  if (count > 4096) throw new Error('Oversized fighter action table.');
  const actions: FighterAction[] = [];
  for (let i = 0; i < count; i++) {
    const entry = table + i * 24;
    const str = arc.pointer(entry);
    if (!str) continue;
    const symbol = arc.string(str), offset = arc.u32(entry + 4), size = arc.u32(entry + 8);
    if (!size) continue;
    const name = symbol.match(/_ACTION_(.+)_figatree$/u)?.[1] ?? symbol;
    actions.push({ name, symbol, offset, size, scriptOffset: arc.pointer(entry + 12) });
  }
  return actions;
}

/** A fighter clip track whose keyframes decode on first read. Every fighter loads ~120 clips, but
 * a match samples only the fighters in it: decoding them all eagerly kept millions of Keyframe
 * objects alive. The same decoder validates the stream on that first read. */
class DeferredTrack implements Track {
  private decoded: Keyframe[] | null = null;
  constructor(readonly type: number, private stream: Uint8Array | null, private readonly fracValue: number, private readonly fracSlope: number, private readonly budget: { keys: number }) {}
  get keys(): Keyframe[] {
    if (!this.decoded) {
      const keys = decodeKeyframes(this.stream!, this.fracValue, this.fracSlope);
      this.budget.keys += keys.length;
      if (this.budget.keys > 200_000) throw new Error('Fighter animation total key budget exceeded.');
      this.decoded = keys; this.stream = null;
    }
    return this.decoded;
  }
}
export function loadFigatree(bytes: Uint8Array): AnimationClip {
  if (bytes.length < 32) throw new Error('Truncated fighter animation archive.');
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size > bytes.length || size < 32) throw new Error('Invalid fighter animation archive length.');
  const arc = new HsdArchive(bytes.subarray(0, size));
  const symbol = arc.symbols.entries().next().value as [string, number] | undefined;
  // Figatree root tag is 1 on every shipped fighter but 0 on some Yoshi clips
  // (verified: his LandingAirN decodes to exactly his 70-joint bone count with
  // a sane duration). Model-bound animations never check the tag; the duration,
  // key-budget and bone-count guards below still reject corrupt data.
  if (!symbol || arc.symbols.size !== 1 || (arc.u32(symbol[1]) !== 1 && arc.u32(symbol[1]) !== 0)) throw new Error('Unsupported fighter animation root.');
  const pointer = symbol[1], endFrame = arc.f32(pointer + 8);
  if (endFrame < 0 || endFrame > 1_000_000) throw new Error('Invalid fighter animation duration.');
  const counts = arc.pointer(pointer + 12), trackTable = arc.pointer(pointer + 16);
  const joints: JointAnimation[] = [];
  // Every keyframe takes at least one stream byte, so this bounds the deferred key budget up front.
  const budget = { keys: 0 };
  let trackOffset = trackTable, streamBytes = 0;
  for (let joint = 0; ; joint++) {
    const count = arc.u8(counts + joint);
    if (count === 255) break;
    if (joint >= 4096 || count > 64) throw new Error('Invalid fighter animation track table.');
    const tracks: Track[] = [];
    for (let i = 0; i < count; i++, trackOffset += 12) {
      const length = arc.u16(trackOffset), type = arc.u8(trackOffset + 4);
      const stream = arc.slice(arc.pointer(trackOffset + 8), length);
      streamBytes += length;
      if (streamBytes > 1_600_000) throw new Error('Fighter animation total key budget exceeded.');
      tracks.push(new DeferredTrack(type, stream, arc.u8(trackOffset + 5), arc.u8(trackOffset + 6), budget));
    }
    joints.push({ endFrame, tracks });
  }
  return { name: symbol[0], endFrame, joints };
}

export function loadJointAnimation(arc: HsdArchive, pointer: number): AnimationClip | null {
  if (!pointer || pointer === 0xffffffff) return null;
  const joints: JointAnimation[] = [], visited = new Set<number>();
  let totalKeys = 0;
  function visit(offset: number, depth: number): void {
    if (visited.has(offset) || depth > 128 || visited.size >= 20_000) throw new Error('Cyclic or oversized joint animation tree.');
    visited.add(offset);
    const aobj = arc.pointer(offset + 8);
    let endFrame = 0;
    const tracks: Track[] = [];
    if (aobj) {
      endFrame = arc.f32(aobj + 4);
      for (const fobj of linkedList(arc, arc.pointer(aobj + 8), 0, 64)) {
        const type = arc.u8(fobj + 12), stream = arc.slice(arc.pointer(fobj + 16), arc.u32(fobj + 4));
        let keys: Keyframe[];
        try { keys = decodeKeyframes(stream, arc.u8(fobj + 13), arc.u8(fobj + 14)); }
        catch (error) {
          // Types 40+ never pose a joint (40 HSD_A_J_PTCL particle cues, 41 joint sound, then the
          // SETBYTE/SETFLOAT callback values). An m-ex stream the decoder cannot read there (EfWfData
          // model 4, Wolf's Fire Wolf flame, opens with op 0) drops only that track instead of
          // rejecting the whole clip; pose tracks still fail closed.
          if (type < 40) throw error;
          continue;
        }
        totalKeys += keys.length;
        if (totalKeys > 200_000) throw new Error('Joint animation total key budget exceeded.');
        const start = arc.f32(fobj + 8);
        for (const key of keys) key.time += start;
        tracks.push({ type, keys });
      }
    }
    joints.push({ endFrame, tracks });
    for (const child of linkedList(arc, arc.pointer(offset), 4)) visit(child, depth + 1);
  }
  visit(pointer, 0);
  return { name: 'Stage joint animation', endFrame: Math.max(0, ...joints.map((joint) => joint.endFrame)), joints };
}
