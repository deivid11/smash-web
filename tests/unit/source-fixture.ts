import { MELEE_102 } from '../../lib/disc.ts';
import { VIEWER_ASSETS, type SourceManifest } from '../../lib/hsd/source-protocol.ts';

export function sourceFixture(): SourceManifest {
  return {
    version: 1, mode: 'server', gameId: MELEE_102.gameId, revision: MELEE_102.discRevision,
    title: 'Synthetic transport fixture', discSize: 1_000_000, executableSha1: MELEE_102.mainDolSha1,
    files: VIEWER_ASSETS.map((path, index) => ({ path, offset: 0x4000 + index * 0x1000, size: 256 })),
  };
}
