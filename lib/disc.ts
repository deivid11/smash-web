/** Read-only, bounded GameCube ISO/GCM inspection. No uploads or asset extraction. */
import { discSha1 } from './checksum.ts';

export interface DiscReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const MELEE_102 = {
  gameId: 'GALE01',
  discRevision: 2,
  mainDolSha1: '08e0bf20134dfcb260699671004527b2d6bb1a45',
} as const;

/** ACE 2.0 (Akaneia-based m-ex build): the only supported modded disc. It is never a
 * substitute for the vanilla disc — it may only supply the explicitly listed extra
 * fighter assets (Zero), while all vanilla content keeps coming from the verified
 * unmodified v1.02 disc. */
export const ACE_20 = {
  gameId: 'GALE01',
  discRevision: 2,
  mainDolSha1: '4963ea2dd7528851f2f8340f253052c9e38ce05a',
  id: 'ace-2.0',
} as const;

export interface DiscEntry {
  path: string;
  offset: number;
  size: number;
}

export interface DiscInfo {
  gameId: string;
  revision: number;
  title: string;
  discSize: number;
  dolOffset: number;
  dolSize: number;
  dolSha1: string;
  files: DiscEntry[];
}

const MAX_DOL_SIZE = 32 * 1024 * 1024;
const MAX_FST_SIZE = 16 * 1024 * 1024;

function assertRange(offset: number, length: number, total: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length < 0 || offset > total || length > total - offset) {
    throw new Error('Disc contains an invalid or truncated byte range.');
  }
}

export async function readExact(reader: DiscReader, offset: number, length: number): Promise<Uint8Array> {
  assertRange(offset, length, reader.size);
  const data = await reader.read(offset, length);
  if (data.byteLength !== length) throw new Error('Disc read was truncated.');
  return data;
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function text(data: Uint8Array, start: number, end: number): string {
  const zero = data.indexOf(0, start);
  return new TextDecoder().decode(data.subarray(start, zero >= start && zero < end ? zero : end));
}

/** Validate the FST tree before trusting its file offsets or names. */
export function parseFileSystem(data: Uint8Array, discSize: number): DiscEntry[] {
  if (data.length < 12) throw new Error('Disc filesystem header is truncated.');
  const table = view(data);
  const count = table.getUint32(8, false);
  if (data[0] !== 1 || table.getUint32(4, false) !== 0 || count < 1 ||
      count > 100_000 || count * 12 > data.length) {
    throw new Error('Disc filesystem root is invalid.');
  }
  const strings = count * 12;
  const folders = [{ index: 0, end: count, path: '' }];
  const paths = new Set<string>();
  const files: DiscEntry[] = [];
  for (let index = 1; index < count; index++) {
    while (folders.length > 1 && index >= folders.at(-1)!.end) folders.pop();
    const parent = folders.at(-1)!;
    const entry = index * 12;
    const descriptor = table.getUint32(entry, false);
    const kind = descriptor >>> 24;
    const nameOffset = strings + (descriptor & 0x00ff_ffff);
    const nameEnd = data.indexOf(0, nameOffset);
    if (kind > 1 || nameOffset >= data.length || nameEnd < nameOffset) {
      throw new Error('Disc filesystem entry is invalid.');
    }
    const name = text(data, nameOffset, nameEnd);
    if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/u.test(name)) {
      throw new Error('Disc filesystem contains an unsafe name.');
    }
    const path = parent.path ? `${parent.path}/${name}` : name;
    if (paths.has(path)) throw new Error('Disc filesystem contains duplicate paths.');
    paths.add(path);
    const offset = table.getUint32(entry + 4, false);
    const size = table.getUint32(entry + 8, false);
    if (kind === 1) {
      if (offset !== parent.index || size <= index || size > parent.end) {
        throw new Error('Disc filesystem directory bounds are invalid.');
      }
      folders.push({ index, end: size, path });
    } else {
      assertRange(offset, size, discSize);
      files.push({ path, offset, size });
    }
  }
  return files;
}

export async function inspectDisc(reader: DiscReader): Promise<DiscInfo> {
  const header = await readExact(reader, 0, 0x440);
  const fields = view(header);
  if (fields.getUint32(0x1c, false) !== 0xc2339f3d) {
    throw new Error('Not a GameCube ISO/GCM. Extract archives first; RVZ is not supported yet.');
  }
  const gameId = text(header, 0, 6);
  const revision = header[7]!;
  if (gameId !== MELEE_102.gameId || revision !== MELEE_102.discRevision || header[6] !== 0) {
    throw new Error(`Unsupported disc: ${gameId}, revision ${revision}. Melee USA v1.02 (GALE01, revision 2) is required.`);
  }
  const dolOffset = fields.getUint32(0x420, false);
  const fstOffset = fields.getUint32(0x424, false);
  const fstSize = fields.getUint32(0x428, false);
  if (dolOffset < 0x440 || fstOffset < 0x440 || fstSize < 12 || fstSize > MAX_FST_SIZE) {
    throw new Error('Disc executable or filesystem offsets are invalid.');
  }
  const dolHeader = view(await readExact(reader, dolOffset, 0x100));
  let dolSize = 0x100;
  let sections = 0;
  for (let index = 0; index < 18; index++) {
    const offset = dolHeader.getUint32(index * 4, false);
    const size = dolHeader.getUint32(0x90 + index * 4, false);
    if (size === 0) continue;
    if (offset < 0x100 || offset + size > MAX_DOL_SIZE) {
      throw new Error('Disc executable section bounds are invalid.');
    }
    sections++;
    dolSize = Math.max(dolSize, offset + size);
  }
  if (sections === 0) throw new Error('Disc executable contains no sections.');
  const dol = await readExact(reader, dolOffset, dolSize);
  const dolSha1 = await discSha1(dol);
  const files = parseFileSystem(await readExact(reader, fstOffset, fstSize), reader.size);
  return {
    gameId, revision, title: text(header, 0x20, 0x400), discSize: reader.size,
    dolOffset, dolSize, dolSha1, files,
  };
}

export async function verifyAceDisc(reader: DiscReader): Promise<DiscInfo> {
  const info = await inspectDisc(reader);
  if (info.dolSha1 !== ACE_20.mainDolSha1) {
    throw new Error(`Modded disc executable SHA-1 mismatch: ${info.dolSha1}. Only the ACE 2.0 build is supported as an extension disc.`);
  }
  return info;
}

export async function verifyMeleeDisc(reader: DiscReader): Promise<DiscInfo> {
  const info = await inspectDisc(reader);
  if (info.dolSha1 !== MELEE_102.mainDolSha1) {
    throw new Error(`Executable SHA-1 mismatch: ${info.dolSha1}. Use an unmodified USA v1.02 disc.`);
  }
  return info;
}

export function browserDiscReader(file: File): DiscReader {
  return {
    size: file.size,
    read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  };
}
