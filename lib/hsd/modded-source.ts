// One flat address space over the vanilla disc plus the registered ACE 2.0 extension
// disc. The vanilla disc stays authoritative for every original asset; the extension
// disc may only supply the ACE_ASSETS names (Zero). Offsets of extension entries are
// rebased past the vanilla disc size, so DiscReader-based consumers (HsdAssetSession,
// serverDiscReader) need no source awareness.
import type { DiscEntry, DiscInfo, DiscReader } from '../disc.ts';
import { ACE_ASSETS, aceDiscPath } from './source-protocol.ts';

export interface MergedModdedSource {
  reader: DiscReader;
  /** Vanilla entries as-is plus the rebased extension entries. */
  files: DiscEntry[];
  /** Only the rebased extension entries. */
  moddedFiles: DiscEntry[];
}

export function mergeModdedSource(vanilla: { reader: DiscReader; info: Pick<DiscInfo, 'files' | 'discSize'> }, ace: { reader: DiscReader; info: Pick<DiscInfo, 'files' | 'discSize'> }): MergedModdedSource {
  const base = vanilla.info.discSize;
  if (!Number.isSafeInteger(base) || base <= 0) throw new Error('Invalid vanilla disc size for the modded extension.');
  const moddedFiles = ACE_ASSETS.map((name): DiscEntry => {
    const entry = ace.info.files.find((file) => file.path === aceDiscPath(name));
    if (!entry) throw new Error(`The modded extension disc lacks required asset ${name}.`);
    return { path: name, offset: base + entry.offset, size: entry.size };
  });
  const files = [...vanilla.info.files.filter((file) => !ACE_ASSETS.some((name) => name === file.path)), ...moddedFiles];
  const reader: DiscReader = {
    size: base + ace.info.discSize,
    async read(offset, length) {
      // A single read never straddles both discs: every exposed entry lives fully on one side.
      if (offset >= base) return ace.reader.read(offset - base, length);
      if (offset + length > base) throw new Error('Merged disc read straddles the extension boundary.');
      return vanilla.reader.read(offset, length);
    },
  };
  return { reader, files, moddedFiles };
}
