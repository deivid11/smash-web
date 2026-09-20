import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, upstream, run, capture } from './shared.ts';

const lock = JSON.parse(readFileSync(join(root, 'third_party/melee.lock.json'), 'utf8')) as { repository: string; commit: string };
if (existsSync(join(upstream, '.git'))) {
  if (capture('git', ['rev-parse', 'HEAD'], upstream) !== lock.commit) {
    throw new Error('Upstream revision differs from the lock. Refusing to overwrite your checkout.');
  }
  if (capture('git', ['status', '--porcelain'], upstream)) {
    throw new Error('Upstream checkout contains changes. Refusing to overwrite them.');
  }
  console.log(`Upstream already pinned: ${lock.commit}`);
} else {
  if (existsSync(upstream)) throw new Error('Upstream destination already exists without Git metadata.');
  mkdirSync(upstream, { recursive: true });
  run('git', ['init'], upstream);
  run('git', ['remote', 'add', 'origin', lock.repository], upstream);
  run('git', ['fetch', '--depth', '1', 'origin', lock.commit], upstream);
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], upstream);
  console.log(`Pinned upstream: ${lock.commit}`);
}
