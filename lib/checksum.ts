import { sha1 } from '@noble/hashes/legacy.js';

/** Upstream's legacy file checksum, not a cryptographic authentication scheme.
 * Web Crypto is absent on ordinary LAN HTTP origins; never upload bytes to hash them.
 */
export async function discSha1(bytes: Uint8Array, subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null): Promise<string> {
  const digest = subtle
    ? new Uint8Array(await subtle.digest('SHA-1', new Uint8Array(bytes).buffer))
    : sha1(bytes);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
