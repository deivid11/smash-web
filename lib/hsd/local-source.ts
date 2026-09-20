// Client-disc mode: the player's own verified ISO (plus, optionally, their ACE 2.0 extension
// disc) read in the browser. The manifest is built exactly like the server's (same exposed
// names, order and rebased extension offsets), so the content fingerprint of a local disc
// equals the one a server streaming the same discs would produce. Disc bytes never leave
// the browser.
import { ACE_20, verifyAceDisc, verifyMeleeDisc, type DiscReader } from '../disc.ts';
import { HsdAssetSession } from './session.ts';
import { ACE_ASSETS, SERVER_ASSETS, aceDiscPath, type SourceFile, type SourceManifest } from './source-protocol.ts';

export async function openLocalSource(vanilla: DiscReader, ace?: DiscReader): Promise<{ session: HsdAssetSession; manifest: SourceManifest }> {
  const info = await verifyMeleeDisc(vanilla);
  const files: SourceFile[] = SERVER_ASSETS.map((name) => {
    const file = info.files.find((file) => file.path === name);
    if (!file) throw new Error(`The verified disc lacks required asset ${name}.`);
    return { path: name, offset: file.offset, size: file.size };
  });
  let modded: SourceManifest['modded'];
  if (ace) {
    const aceInfo = await verifyAceDisc(ace);
    for (const name of ACE_ASSETS) {
      const file = aceInfo.files.find((file) => file.path === aceDiscPath(name));
      if (!file) throw new Error(`The ACE extension disc lacks required asset ${name}.`);
      files.push({ path: name, offset: info.discSize + file.offset, size: file.size });
    }
    modded = { id: ACE_20.id, executableSha1: aceInfo.dolSha1, discSize: aceInfo.discSize };
  }
  const base = info.discSize;
  const reader: DiscReader = {
    size: base + (modded?.discSize ?? 0),
    async read(offset, length) {
      // A single read never straddles both discs: every exposed entry lives fully on one side.
      if (offset >= base) { if (!ace) throw new Error('Disc read is outside the selected disc.'); return ace.read(offset - base, length); }
      if (offset + length > base) throw new Error('Merged disc read straddles the extension boundary.');
      return vanilla.read(offset, length);
    },
  };
  const manifest: SourceManifest = {
    version: 1, mode: 'server', gameId: info.gameId, revision: info.revision, title: info.title,
    discSize: reader.size, executableSha1: info.dolSha1, files, ...(modded ? { modded } : {}),
  };
  return { session: new HsdAssetSession(reader, manifest), manifest };
}
