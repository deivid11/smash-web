import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root, upstream, capture, run } from './shared.ts';
import { buildGameplay } from './build-gameplay.ts';

const lock = JSON.parse(readFileSync(join(root, 'third_party/melee.lock.json'), 'utf8')) as { commit: string };
const tools = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8')) as { emscripten: string };
const localPath = join(root, '.local/toolchain.json');
const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) as { emcc?: string } : {};
const emcc = process.env.EMCC ?? local.emcc ?? 'emcc';
if (!existsSync(join(upstream, '.git'))) throw new Error('Run npm run upstream:setup first.');
if (capture('git', ['rev-parse', 'HEAD'], upstream) !== lock.commit || capture('git', ['status', '--porcelain'], upstream)) {
  throw new Error('Upstream must be clean and at the locked revision.');
}
const compilerVersion = capture(emcc, ['--version']).split('\n')[0]!;
if (compilerVersion.match(/\b\d+\.\d+\.\d+\b/u)?.[0] !== tools.emscripten) {
  throw new Error(`Expected Emscripten ${tools.emscripten}, got: ${compilerVersion}`);
}
const output = join(root, 'web/public/wasm');
mkdirSync(output, { recursive: true });
const source = join(upstream, 'src/sysdolphin/baselib/random.c');
const binary = join(output, 'melee-probe.wasm');
run(emcc, [
  source, join(root, 'engine/probe.c'),
  '-I', join(root, 'engine/compat'), '-I', join(upstream, 'src'),
  '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
  '-fno-fast-math', '-ffp-contract=off', '--no-entry',
  '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0', '-sINITIAL_MEMORY=131072',
  '-sSTACK_SIZE=16384',
  '-sEXPORTED_FUNCTIONS=["_probe_set_seed","_probe_get_seed","_HSD_Rand","_HSD_Randf"]',
  '-o', binary,
]);
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(join(output, 'probe.build.json'), `${JSON.stringify({
  scope: 'Original HSD RNG only; not a gameplay engine or a full rollback implementation.',
  upstreamCommit: lock.commit,
  upstreamSource: 'src/sysdolphin/baselib/random.c',
  upstreamSourceSha256: sha256(source),
  compiler: compilerVersion,
  wasmSha256: sha256(binary),
  wasmBytes: readFileSync(binary).length,
}, null, 2)}\n`);
console.log(`Built original Melee RNG probe: ${readFileSync(binary).length} bytes.`);
buildGameplay(emcc, compilerVersion, lock.commit);
