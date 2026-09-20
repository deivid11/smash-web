/** Bounded HSD archive reader. Pointer offsets are relative to the data section. */
export class HsdArchive {
  readonly data: DataView;
  readonly symbols = new Map<string, number>();
  readonly targets: number[];
  readonly relocations = new Set<number>();
  readonly externCount: number;

  constructor(readonly bytes: Uint8Array) {
    if (bytes.byteLength < 0x20 || bytes.byteLength > 64 * 1024 * 1024) throw new Error('Invalid HSD archive size.');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = header.getUint32(0);
    const dataSize = header.getUint32(4);
    const relocCount = header.getUint32(8);
    const publicCount = header.getUint32(12);
    this.externCount = header.getUint32(16);
    const tables = 0x20 + dataSize;
    const names = tables + relocCount * 4 + (publicCount + this.externCount) * 8;
    if (size !== bytes.byteLength || dataSize === 0 || names > size || relocCount > 1_000_000 || publicCount + this.externCount > 100_000) {
      throw new Error('Invalid HSD archive header or table bounds.');
    }
    this.data = new DataView(bytes.buffer, bytes.byteOffset + 0x20, dataSize);
    const targets = new Set<number>();
    for (let index = 0; index < relocCount; index++) {
      const location = header.getUint32(tables + index * 4);
      const target = this.u32(location);
      this.range(target, 0);
      this.relocations.add(location);
      targets.add(target);
    }
    for (let index = 0; index < publicCount + this.externCount; index++) {
      const record = tables + relocCount * 4 + index * 8;
      const offset = header.getUint32(record);
      const nameOffset = names + header.getUint32(record + 4);
      const end = bytes.indexOf(0, nameOffset);
      if (nameOffset >= size || end < nameOffset || end - nameOffset > 1024) throw new Error('Invalid HSD symbol name.');
      const name = new TextDecoder().decode(bytes.subarray(nameOffset, end));
      if (index < publicCount) {
        this.range(offset, 1);
        if (this.symbols.has(name)) throw new Error('Duplicate HSD public symbol.');
        this.symbols.set(name, offset);
        targets.add(offset);
      }
    }
    this.targets = [...targets].sort((a, b) => a - b);
  }

  range(offset: number, size: number): number {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > this.data.byteLength || size > this.data.byteLength - offset) {
      throw new Error(`HSD data out of bounds at 0x${offset.toString(16)} (${size} bytes).`);
    }
    return offset;
  }
  u8(offset: number): number { return this.data.getUint8(this.range(offset, 1)); }
  u16(offset: number): number { return this.data.getUint16(this.range(offset, 2)); }
  u32(offset: number): number { return this.data.getUint32(this.range(offset, 4)); }
  f32(offset: number): number {
    const value = this.data.getFloat32(this.range(offset, 4));
    if (!Number.isFinite(value)) throw new Error('HSD contains a non-finite floating-point value.');
    return value;
  }
  slice(offset: number, size: number): Uint8Array {
    this.range(offset, size);
    return new Uint8Array(this.data.buffer, this.data.byteOffset + offset, size);
  }
  pointer(location: number): number {
    const offset = this.u32(location);
    if (offset !== 0 && offset !== 0xffffffff) this.range(offset, 1);
    return offset;
  }
  string(offset: number): string {
    this.range(offset, 1);
    const bytes = this.slice(offset, Math.min(1025, this.data.byteLength - offset));
    const end = bytes.indexOf(0);
    if (end < 0) throw new Error('Unterminated HSD string.');
    return new TextDecoder().decode(bytes.subarray(0, end));
  }
  /** A relocation-derived upper bound, not a guarantee of a structure's exact size. */
  extent(offset: number): number {
    this.range(offset, 1);
    let low = 0, high = this.targets.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.targets[mid]! <= offset) low = mid + 1; else high = mid;
    }
    return (this.targets[low] ?? this.data.byteLength) - offset;
  }
  symbol(name: string): number {
    const result = this.symbols.get(name);
    if (result === undefined) throw new Error(`HSD symbol not found: ${name}`);
    return result;
  }
}

export function linkedList(archive: HsdArchive, start: number, nextOffset: number, limit = 4096): number[] {
  const result: number[] = [];
  const visited = new Set<number>();
  for (let current = start; current !== 0 && current !== 0xffffffff; current = archive.pointer(current + nextOffset)) {
    if (visited.has(current) || result.length >= limit) throw new Error('Cyclic or oversized HSD linked list.');
    visited.add(current);
    result.push(current);
  }
  return result;
}
