import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { discSha1 } from '../../lib/checksum.ts';

describe('local disc checksum on secure and LAN HTTP origins', () => {
  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['The quick brown fox jumps over the lazy dog', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'],
  ])('matches known SHA-1 vectors without Web Crypto: %j', async (text, expected) => {
    expect(await discSha1(new TextEncoder().encode(text), null)).toBe(expected);
  });
  it.each([55, 56, 63, 64, 65, 4 * 1024 * 1024])('matches native SHA-1 across block boundaries (%s bytes)', async (length) => {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 251);
    const expected = createHash('sha1').update(bytes).digest('hex');
    expect(await discSha1(bytes, null)).toBe(expected);
    expect(await discSha1(bytes)).toBe(expected);
  });
  it('hashes the selected byte view, not the entire backing buffer', async () => {
    const bytes = new TextEncoder().encode('prefixabcsuffix').subarray(6, 9);
    expect(await discSha1(bytes, null)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});
