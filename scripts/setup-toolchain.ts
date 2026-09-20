/** Installs the pinned Emscripten SDK so a fresh clone can build the WASM modules
 * without hunting for a compiler. The compiled modules are deliberately not
 * committed (they are upstream-derived; see third_party/NOTICE.md), so everyone
 * builds them locally from the pinned decompilation with this exact version.
 *
 *   npm run toolchain:setup            # into .local/emsdk
 *   EMSDK_DIR=/opt/emsdk npm run toolchain:setup
 *
 * Machine-local paths are written to the ignored .local/toolchain.json, which
 * scripts/build-wasm.ts reads after $EMCC and before `emcc` on PATH.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { root, run, capture } from './shared.ts';

const lock = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8')) as { emscripten: string; emsdkRepository: string; emsdkCommit: string };
const configPath = join(root, '.local/toolchain.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown> : {};
const force = process.argv.includes('--force');

/** First line of `emcc --version` carries the version number, or null when it cannot run. */
function versionOf(emcc: string): string | null {
  try { return capture(emcc, ['--version']).split('\n')[0]!.match(/\b\d+\.\d+\.\d+\b/u)?.[0] ?? null; }
  catch { return null; }
}

const existing = [process.env.EMCC, typeof config.emcc === 'string' ? config.emcc : undefined, 'emcc'].filter((entry): entry is string => !!entry);
for (const emcc of existing) {
  if (versionOf(emcc) === lock.emscripten) {
    if (!force) { console.log(`Emscripten ${lock.emscripten} already available: ${emcc}\nRun with --force to install a fresh SDK anyway.`); process.exit(0); }
    break;
  }
}

const directory = resolve(root, process.env.EMSDK_DIR ?? '.local/emsdk');
if (existsSync(join(directory, '.git'))) {
  if (capture('git', ['rev-parse', 'HEAD'], directory) !== lock.emsdkCommit) throw new Error(`${directory} is a different emsdk revision. Remove it or set EMSDK_DIR elsewhere.`);
  console.log(`emsdk already pinned: ${lock.emsdkCommit}`);
} else {
  if (existsSync(directory)) throw new Error(`${directory} already exists without Git metadata. Remove it or set EMSDK_DIR elsewhere.`);
  mkdirSync(directory, { recursive: true });
  run('git', ['init'], directory);
  run('git', ['remote', 'add', 'origin', lock.emsdkRepository], directory);
  run('git', ['fetch', '--depth', '1', 'origin', lock.emsdkCommit], directory);
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], directory);
  console.log(`Pinned emsdk: ${lock.emsdkCommit}`);
}

// Downloads a few hundred MB of clang/node the first time.
const emsdk = join(directory, process.platform === 'win32' ? 'emsdk.bat' : 'emsdk');
run(emsdk, ['install', lock.emscripten], directory);
run(emsdk, ['activate', lock.emscripten], directory);

const emcc = join(directory, 'upstream/emscripten', process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const installed = versionOf(emcc);
if (installed !== lock.emscripten) throw new Error(`Installed compiler reports ${installed ?? 'no version'}, expected ${lock.emscripten}.`);

mkdirSync(join(root, '.local'), { recursive: true });
writeFileSync(configPath, `${JSON.stringify({ ...config, emcc }, null, 2)}\n`);
console.log(`Emscripten ${lock.emscripten} ready: ${emcc}\nRecorded in .local/toolchain.json. Next: npm run wasm:build`);
