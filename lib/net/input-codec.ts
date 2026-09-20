/** Binary controller frames for the room relay (introduced in protocol v8; the taunt bit
 * of byte 1 arrived with v11).
 *
 * A JSON input frame costs ~330 bytes sixty times a second per human; the same frame is
 * 13-15 bytes here, and a whole match log replays to a reconnecting browser in a few KiB.
 * The relay still never runs the simulation: it validates bounds and forwards bytes.
 *
 * Input payload (self-delimiting, canonical, identical for every peer):
 *   byte 0  buttons   bit0 jump · 1 attack · 2 strong · 3 down · 4 special · 5 shield · 6 grab · 7 walk
 *   byte 1  direction 0 none · 1 neutral · 2 side · 3 up · 4 down in bits 0-2, taunt in bit 7
 *             (bits 3-6 reserved, zero: any of them set is rejected with the direction)
 *   byte 2  axes      two bits each for x, y, cX, cY: 0 → 0 · 1 → +1 · 2 → -1 · 3 → float64 follows
 *   then one little-endian float64 per axis coded 3, in x, y, cX, cY order.
 * Exact doubles keep the simulation bit-identical with the JSON path; digital inputs
 * (keyboard, touch, d-pad) never carry a float at all.
 *
 * Messages (all integers little-endian):
 *   OP_INPUT   client → relay  [op][tag u32][frame u32][delay u8][adv i8][payload]
 *   OP_RELAY   relay → client  [op][tag u32][slot u8][frame u32][delay u8][adv i8][payload]
 *   OP_BACKLOG relay → client  [op][tag u32][slot u8][start u32][runs u16]{[count u16][payload]}…
 * `tag` is matchTag(matchId), `delay` the sender's local input delay and `adv` its perceived
 * frame advantage: presentation pacing hints only, never simulated and never logged. */
import type { NetInput } from './protocol.ts';

export const OP_INPUT = 1, OP_RELAY = 2, OP_BACKLOG = 3;
export const MAX_INPUT_DELAY = 7;
/** Largest binary message a browser accepts from the relay (backlog chunks stay below it). */
export const MAX_BINARY_MESSAGE = 64 * 1024;
const BACKLOG_CHUNK = 32 * 1024;
const DIRECTIONS = [undefined, 'neutral', 'side', 'up', 'down'] as const;
const AXES = ['x', 'y', 'cX', 'cY'] as const;

export interface InputMeta { delay: number; adv: number }
export interface DecodedInput { tag: number; frame: number; meta: InputMeta; payload: Uint8Array }
export interface DecodedRelay extends DecodedInput { slot: number }
export interface DecodedBacklog { tag: number; slot: number; start: number; inputs: NetInput[] }

/** FNV-1a of the match identity: four bytes instead of a 48-character id on every frame. */
export function matchTag(matchId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < matchId.length; index++) { hash ^= matchId.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

/** Canonical payload. Mirrors rollback normalizeInput: absent optionals are false/0 and -0 is 0. */
export function encodeInputPayload(input: NetInput): Uint8Array {
  const floats: number[] = [];
  let axes = 0;
  AXES.forEach((name, index) => {
    const value = input[name] || 0;
    const code = value === 0 ? 0 : value === 1 ? 1 : value === -1 ? 2 : 3;
    if (code === 3) floats.push(value);
    axes |= code << (index * 2);
  });
  const bytes = new Uint8Array(3 + floats.length * 8);
  bytes[0] = (input.jump ? 1 : 0) | (input.attack ? 2 : 0) | (input.strong ? 4 : 0) | (input.down ? 8 : 0) | (input.special ? 16 : 0) | (input.shield ? 32 : 0) | (input.grab ? 64 : 0) | (input.walk ? 128 : 0);
  bytes[1] = Math.max(0, DIRECTIONS.indexOf(input.specialDirection)) | (input.taunt ? 0x80 : 0);
  bytes[2] = axes;
  const view = new DataView(bytes.buffer);
  floats.forEach((value, index) => view.setFloat64(3 + index * 8, value, true));
  return bytes;
}

/** Byte length of the payload starting at `offset`, or -1 when truncated/invalid. */
export function inputPayloadLength(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length || (bytes[offset + 1]! & 0x7f) > 4) return -1;
  let floats = 0;
  for (let index = 0, axes = bytes[offset + 2]!; index < 4; index++, axes >>= 2) if ((axes & 3) === 3) floats++;
  const length = 3 + floats * 8;
  if (offset + length > bytes.length) return -1;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 3, floats * 8);
  for (let index = 0; index < floats; index++) { const value = view.getFloat64(index * 8, true); if (!Number.isFinite(value) || Math.abs(value) > 1) return -1; }
  return length;
}

/** Caller validated the payload with inputPayloadLength. Always the full canonical record. */
export function decodeInputPayload(bytes: Uint8Array, offset = 0): NetInput {
  const buttons = bytes[offset]!, flags = bytes[offset + 1]!, direction = DIRECTIONS[flags & 0x7f];
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
  const values = [0, 0, 0, 0];
  for (let index = 0, axes = bytes[offset + 2]!, cursor = 3; index < 4; index++, axes >>= 2) {
    const code = axes & 3;
    if (code === 3) { values[index] = view.getFloat64(cursor, true) || 0; cursor += 8; } else values[index] = code === 1 ? 1 : code === 2 ? -1 : 0;
  }
  return { x: values[0]!, y: values[1]!, jump: !!(buttons & 1), attack: !!(buttons & 2), strong: !!(buttons & 4), down: !!(buttons & 8),
    special: !!(buttons & 16), shield: !!(buttons & 32), grab: !!(buttons & 64), walk: !!(buttons & 128), taunt: !!(flags & 0x80), cX: values[2]!, cY: values[3]!,
    ...(direction === undefined ? {} : { specialDirection: direction }) };
}

const clampMeta = (meta?: Partial<InputMeta>): InputMeta => ({
  delay: Math.min(MAX_INPUT_DELAY, Math.max(0, Math.trunc(meta?.delay ?? 0) || 0)),
  adv: Math.min(127, Math.max(-128, Math.round(meta?.adv ?? 0) || 0)),
});

export function encodeInputMessage(tag: number, frame: number, input: NetInput, meta?: Partial<InputMeta>): Uint8Array {
  const payload = encodeInputPayload(input), bytes = new Uint8Array(11 + payload.length), view = new DataView(bytes.buffer), hints = clampMeta(meta);
  bytes[0] = OP_INPUT; view.setUint32(1, tag, true); view.setUint32(5, frame, true); bytes[9] = hints.delay; view.setInt8(10, hints.adv);
  bytes.set(payload, 11); return bytes;
}
export function decodeInputMessage(bytes: Uint8Array): DecodedInput | null {
  if (bytes.length < 14 || bytes[0] !== OP_INPUT || bytes[9]! > MAX_INPUT_DELAY || inputPayloadLength(bytes, 11) !== bytes.length - 11) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return { tag: view.getUint32(1, true), frame: view.getUint32(5, true), meta: { delay: bytes[9]!, adv: view.getInt8(10) }, payload: bytes.slice(11) };
}

export function encodeRelayMessage(tag: number, slot: number, frame: number, payload: Uint8Array, meta?: Partial<InputMeta>): Uint8Array {
  const bytes = new Uint8Array(12 + payload.length), view = new DataView(bytes.buffer), hints = clampMeta(meta);
  bytes[0] = OP_RELAY; view.setUint32(1, tag, true); bytes[5] = slot; view.setUint32(6, frame, true); bytes[10] = hints.delay; view.setInt8(11, hints.adv);
  bytes.set(payload, 12); return bytes;
}
export function decodeRelayMessage(bytes: Uint8Array): DecodedRelay | null {
  if (bytes.length < 15 || bytes[0] !== OP_RELAY || bytes[10]! > MAX_INPUT_DELAY || inputPayloadLength(bytes, 12) !== bytes.length - 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  return { tag: view.getUint32(1, true), slot: bytes[5]!, frame: view.getUint32(6, true), meta: { delay: bytes[10]!, adv: view.getInt8(11) }, payload: bytes.slice(12) };
}

const samePayload = (a: Uint8Array, b: Uint8Array): boolean => { if (a.length !== b.length) return false; for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false; return true; };

/** One slot's consecutive payloads from `start`, run-length encoded (held inputs repeat for
 * many frames) and split into bounded messages. */
export function encodeBacklog(tag: number, slot: number, start: number, payloads: readonly Uint8Array[]): Uint8Array[] {
  const messages: Uint8Array[] = [];
  let index = 0;
  while (index < payloads.length) {
    const first = start + index, runs: Array<{ count: number; payload: Uint8Array }> = [];
    let size = 12;
    while (index < payloads.length && size < BACKLOG_CHUNK && runs.length < 0xffff) {
      const payload = payloads[index]!;
      let count = 1;
      while (index + count < payloads.length && count < 0xffff && samePayload(payload, payloads[index + count]!)) count++;
      runs.push({ count, payload }); size += 2 + payload.length; index += count;
    }
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    bytes[0] = OP_BACKLOG; view.setUint32(1, tag, true); bytes[5] = slot; view.setUint32(6, first, true); view.setUint16(10, runs.length, true);
    let cursor = 12;
    for (const run of runs) { view.setUint16(cursor, run.count, true); bytes.set(run.payload, cursor + 2); cursor += 2 + run.payload.length; }
    messages.push(bytes);
  }
  return messages;
}
export function decodeBacklog(bytes: Uint8Array): DecodedBacklog | null {
  if (bytes.length < 12 || bytes[0] !== OP_BACKLOG) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), runs = view.getUint16(10, true), inputs: NetInput[] = [];
  let cursor = 12;
  for (let run = 0; run < runs; run++) {
    if (cursor + 2 > bytes.length) return null;
    const count = view.getUint16(cursor, true), length = inputPayloadLength(bytes, cursor + 2);
    if (count < 1 || length < 0) return null;
    const input = decodeInputPayload(bytes, cursor + 2);
    for (let repeat = 0; repeat < count; repeat++) inputs.push(repeat ? { ...input } : input);
    cursor += 2 + length;
  }
  return cursor === bytes.length ? { tag: view.getUint32(1, true), slot: bytes[5]!, start: view.getUint32(6, true), inputs } : null;
}
