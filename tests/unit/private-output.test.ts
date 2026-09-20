import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { privateOutputDirectory } from '../../scripts/private-output.ts';
import { root } from '../../scripts/shared.ts';

const directories: string[] = [];
function fixture() {
  mkdirSync(join(root, '.local'), { recursive: true });
  const base = mkdtempSync(join(root, '.local/private-output-test-')); directories.push(base);
  const repo = join(base, 'repo'), outside = join(base, 'exports');
  mkdirSync(repo); mkdirSync(outside);
  return { base, repo, outside };
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('private extracted-asset output boundary', () => {
  it('requires an explicit destination rather than a workstation default', () => {
    const { repo } = fixture();
    expect(() => privateOutputDirectory(repo, undefined)).toThrow(/explicit/u);
    expect(() => privateOutputDirectory(repo, '')).toThrow(/explicit/u);
  });
  it('rejects the repository and descendants, including trailing-root-slash input', () => {
    const { repo } = fixture();
    for (const requested of [repo, '.', 'dist/assets', 'private/export']) expect(() => privateOutputDirectory(repo + '/', requested)).toThrow(/inside/u);
  });
  it('allows a chosen external directory and new descendants', () => {
    const { repo, outside } = fixture();
    expect(privateOutputDirectory(repo, outside)).toBe(outside);
    expect(privateOutputDirectory(repo, '../exports/new/deep')).toBe(join(outside, 'new/deep'));
  });
  it('rejects an external symlink pointing into the repository', () => {
    const { base, repo } = fixture(), link = join(base, 'alias');
    symlinkSync(repo, link, 'dir');
    expect(() => privateOutputDirectory(repo, join(link, 'assets'))).toThrow(/inside/u);
  });
  it('refuses dangling symlinks instead of treating them as ordinary directories', () => {
    const { base, repo } = fixture(), link = join(base, 'broken');
    symlinkSync(join(repo, 'not-created'), link, 'dir');
    expect(() => privateOutputDirectory(repo, join(link, 'assets'))).toThrow();
  });
});
