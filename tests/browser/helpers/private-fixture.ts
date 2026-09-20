import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Harmless owned data: privacy checks must work on clean clones without real disc reports. */
export async function privateFixture(root: string, folder: 'private' | '.local') {
  const parent = join(root, folder);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, 'browser-deny-'));
  const path = join(directory, 'fixture.json');
  try { await writeFile(path, '{"privateFixture":true}\n', { mode: 0o600 }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  return { path, dispose: () => rm(directory, { recursive: true, force: true }) };
}
