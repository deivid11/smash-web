import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyMeleeDisc, readExact } from '../lib/disc.ts';
import { root, upstream } from './shared.ts';
import { openDisc } from './node-disc.ts';

const args = process.argv.slice(2);
if (args.length !== 1) throw new Error('Usage: npm run disc:import -- "/path/to/your/game.iso"');
const input = resolve(args[0]!);
const reader = await openDisc(input);
try {
  console.log('Inspecting disc and hashing its executable (the ISO stays local)...');
  const info = await verifyMeleeDisc(reader);
  await access(join(upstream, 'configure.py'));
  const dol = await readExact(reader, info.dolOffset, info.dolSize);
  const destination = join(upstream, 'orig/GALE01/sys/main.dol');
  await mkdir(join(root, 'private'), { recursive: true, mode: 0o700 });
  await mkdir(join(upstream, 'orig/GALE01/sys'), { recursive: true });
  try {
    await writeFile(destination, dol, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(destination);
    if (!existing.equals(Buffer.from(dol))) {
      throw new Error('A different reference executable already exists. It was not overwritten.');
    }
  }
  await writeFile(join(root, 'private/disc-report.json'), `${JSON.stringify({ input, ...info }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Verified ${info.gameId}, revision ${info.revision}: ${info.title}`);
  console.log(`Executable SHA-1: ${info.dolSha1}`);
  console.log(`Indexed ${info.files.length} files. Reference executable is ready for the upstream build.`);
  console.log('No models, textures, audio, or disc images were copied into the web/public directory.');
} finally {
  await reader.close();
}
