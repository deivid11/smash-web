import { HsdArchive } from './archive.ts';

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Map<number, Float32Array>;
  matrices: Float32Array;
  indices: Uint32Array;
  hasNormals: boolean;
  hasColors: boolean;
}
interface Attribute { attr: number; kind: number; count: number; type: number; shift: number; stride: number; offset: number }

function componentSize(type: number): number {
  if (type < 0 || type > 4) throw new Error(`Unsupported GX numeric component type ${type}.`);
  return [1, 1, 2, 2, 4][type]!;
}
function scalar(archive: HsdArchive, offset: number, type: number, shift: number): number {
  const size = componentSize(type);
  archive.range(offset, size);
  let value: number;
  switch (type) {
    case 0: value = archive.data.getUint8(offset); break;
    case 1: value = archive.data.getInt8(offset); break;
    case 2: value = archive.data.getUint16(offset); break;
    case 3: value = archive.data.getInt16(offset); break;
    default: value = archive.data.getFloat32(offset); break;
  }
  value /= type === 4 ? 1 : 2 ** shift;
  if (!Number.isFinite(value)) throw new Error('Non-finite GX vertex component.');
  return value;
}
function color(arc: HsdArchive, offset: number, format: number): { value: number[]; bytes: number } {
  const expand = (n: number, bits: number) => n / ((1 << bits) - 1);
  if (format === 0) {
    const word = arc.u16(offset);
    return { value: [expand(word >>> 11, 5), expand((word >>> 5) & 63, 6), expand(word & 31, 5), 1], bytes: 2 };
  }
  if (format === 1 || format === 2 || format === 5) return {
    value: [arc.u8(offset) / 255, arc.u8(offset + 1) / 255, arc.u8(offset + 2) / 255, format === 5 ? arc.u8(offset + 3) / 255 : 1],
    bytes: format === 1 ? 3 : 4,
  };
  if (format === 3) {
    const word = arc.u16(offset);
    return { value: [expand(word >>> 12, 4), expand((word >>> 8) & 15, 4), expand((word >>> 4) & 15, 4), expand(word & 15, 4)], bytes: 2 };
  }
  if (format === 4) {
    const word = arc.u8(offset) * 65536 + arc.u8(offset + 1) * 256 + arc.u8(offset + 2);
    return { value: [expand(word >>> 18, 6), expand((word >>> 12) & 63, 6), expand((word >>> 6) & 63, 6), expand(word & 63, 6)], bytes: 3 };
  }
  throw new Error(`Unsupported GX vertex color format ${format}.`);
}

export function loadGeometry(arc: HsdArchive, descriptor: number, displayOffset: number, displaySize: number): GeometryData {
  arc.range(displayOffset, displaySize);
  const attributes: Attribute[] = [];
  for (let index = 0; ; index++) {
    if (index >= 32) throw new Error('Unterminated GX vertex descriptor list.');
    const offset = descriptor + index * 0x18;
    let attr = arc.u32(offset);
    if (attr === 255) break;
    if (attr === 25) attr = 10;
    const kind = arc.u32(offset + 4);
    if (attr > 20 || kind > 3 || attributes.some((a) => a.attr === attr)) throw new Error('Invalid GX vertex descriptor.');
    if (kind === 0) continue;
    attributes.push({ attr, kind, count: arc.u32(offset + 8), type: arc.u32(offset + 12), shift: arc.u8(offset + 16), stride: arc.u16(offset + 18), offset: arc.pointer(offset + 20) });
  }
  attributes.sort((a, b) => a.attr - b.attr);
  if (!attributes.some((attr) => attr.attr === 9)) throw new Error('GX polygon has no position attribute.');
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], matrices: number[] = [], indices: number[] = [];
  const uvs = new Map<number, number[]>();
  for (const attr of attributes) if (attr.attr >= 13) uvs.set(attr.attr - 13, []);
  let cursor = displayOffset;
  const end = displayOffset + displaySize;
  const consume = (bytes: number): number => {
    if (cursor + bytes > end) throw new Error('Truncated GX display list.');
    const offset = cursor; cursor += bytes; return offset;
  };
  while (cursor < end) {
    const command = arc.u8(consume(1));
    if (command === 0) continue;
    const primitive = command & 0xf8;
    if (primitive < 0x80 || primitive > 0xb8) throw new Error(`Unsupported GX display-list command 0x${command.toString(16)}.`);
    const count = arc.u16(consume(2));
    const base = matrices.length;
    if (base + count > 1_000_000) throw new Error('GX vertex budget exceeded.');
    for (let index = 0; index < count; index++) {
      let pos = [0, 0, 0], normal = [0, 0, 1], rgba = [1, 1, 1, 1], matrix = 0;
      for (const attr of attributes) {
        if (attr.attr <= 8) {
          if (attr.kind !== 1) throw new Error('GX matrix attributes must be direct bytes.');
          const value = arc.u8(consume(1));
          if (attr.attr === 0) {
            if (value % 3 !== 0 || value > 27) throw new Error('Invalid GX position-matrix index.');
            matrix = value / 3;
          }
          continue;
        }
        const nbt3 = attr.attr === 10 && attr.count === 2;
        let source: number;
        if (attr.kind === 1) source = cursor;
        else {
          const offset = consume(attr.kind === 2 ? 1 : 2);
          const arrayIndex = attr.kind === 2 ? arc.u8(offset) : arc.u16(offset);
          if (attr.stride === 0) throw new Error('GX indexed attribute has zero stride.');
          source = attr.offset + arrayIndex * attr.stride;
          if (nbt3) consume((attr.kind === 2 ? 1 : 2) * 2);
        }
        if (attr.attr === 11 || attr.attr === 12) {
          const decoded = color(arc, source, attr.type);
          if (attr.kind === 1) consume(decoded.bytes);
          if (attr.attr === 11) rgba = decoded.value;
          continue;
        }
        const components = attr.attr === 9 ? (attr.count === 0 ? 2 : 3)
          : attr.attr === 10 ? (attr.count === 1 ? 9 : 3) : (attr.count === 0 ? 1 : 2);
        const stride = componentSize(attr.type);
        const shift = attr.attr === 10 ? (attr.type === 1 ? 6 : attr.type === 3 ? 14 : 0) : attr.shift;
        const values = Array.from({ length: components }, (_, component) => scalar(arc, source + component * stride, attr.type, shift));
        if (attr.kind === 1) consume(components * stride);
        if (attr.attr === 9) pos = [values[0]!, values[1]!, values[2] ?? 0];
        else if (attr.attr === 10) normal = values.slice(0, 3);
        else uvs.get(attr.attr - 13)!.push(values[0]!, values[1] ?? 0);
      }
      positions.push(...pos); normals.push(...normal); colors.push(...rgba); matrices.push(matrix);
    }
    const triangle = (a: number, b: number, c: number) => indices.push(base + a, base + b, base + c);
    if (primitive === 0x80 || primitive === 0x88) {
      if (count % 4) throw new Error('GX quad packet has an invalid vertex count.');
      for (let i = 0; i < count; i += 4) { triangle(i, i + 1, i + 2); triangle(i, i + 2, i + 3); }
    } else if (primitive === 0x90) {
      if (count % 3) throw new Error('GX triangle packet has an invalid vertex count.');
      for (let i = 0; i < count; i += 3) triangle(i, i + 1, i + 2);
    } else if (primitive === 0x98) {
      for (let i = 2; i < count; i++) i & 1 ? triangle(i - 1, i - 2, i) : triangle(i - 2, i - 1, i);
    } else if (primitive === 0xa0) {
      for (let i = 2; i < count; i++) triangle(0, i - 1, i);
    } else throw new Error('GX line/point primitives are not supported by the model viewer yet.');
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors),
    matrices: new Float32Array(matrices), indices: new Uint32Array(indices),
    uvs: new Map([...uvs].map(([index, values]) => [index, new Float32Array(values)])),
    hasNormals: attributes.some((attr) => attr.attr === 10), hasColors: attributes.some((attr) => attr.attr === 11),
  };
}
