import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';

/** Resolve an explicitly chosen export directory without allowing repository or symlink aliases. */
export function privateOutputDirectory(repository: string, requested: string | undefined): string {
  if (!requested?.trim()) throw new Error('Choose an explicit --out directory in private storage outside the repository.');
  const root = resolve(repository), candidate = resolve(root, requested);
  const inside = (path: string, base: string) => path === base || path.startsWith(base + sep);
  if (inside(candidate, root)) throw new Error('Refusing to write extracted assets inside the repository.');
  const tail: string[] = [];
  let ancestor = candidate;
  for (;;) {
    try { lstatSync(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      tail.unshift(basename(ancestor)); ancestor = parent;
    }
  }
  // realpath also refuses dangling symlinks rather than guessing their destination.
  const canonical = resolve(realpathSync(ancestor), ...tail);
  if (inside(canonical, realpathSync(root))) throw new Error('Refusing an export path that resolves inside the repository.');
  return canonical;
}
