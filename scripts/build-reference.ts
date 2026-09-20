import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root, upstream, run, capture } from './shared.ts';

const lock = JSON.parse(readFileSync(join(root, 'third_party/melee.lock.json'), 'utf8')) as { commit: string; mainDolSha1: string };
const jobs = Number(process.env.BUILD_JOBS ?? 6);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 64) throw new Error('BUILD_JOBS must be an integer between 1 and 64.');
if (capture('git', ['rev-parse', 'HEAD'], upstream) !== lock.commit || capture('git', ['status', '--porcelain'], upstream)) {
  throw new Error('Upstream must be clean and at the locked revision.');
}
const sha1 = (path: string) => createHash('sha1').update(readFileSync(path)).digest('hex');
const original = sha1(join(upstream, 'orig/GALE01/sys/main.dol'));
if (original !== lock.mainDolSha1) throw new Error('Reference executable is not the expected USA v1.02 version. Run disc:import with an unmodified disc.');
run(process.env.PYTHON ?? 'python3', ['configure.py'], upstream);
run('ninja', ['-j', String(jobs)], upstream);
const rebuilt = sha1(join(upstream, 'build/GALE01/main.dol'));
if (rebuilt !== original) throw new Error('Rebuilt executable does not match the original.');
mkdirSync(join(root, 'private'), { recursive: true, mode: 0o700 });
writeFileSync(join(root, 'private/reference-build.json'), `${JSON.stringify({
  upstreamCommit: lock.commit, originalSha1: original, rebuiltSha1: rebuilt, matching: true,
}, null, 2)}\n`, { mode: 0o600 });
console.log(`Reference build verified: ${rebuilt}`);
console.log('This is a matching GameCube executable, not a browser build of the full game.');
