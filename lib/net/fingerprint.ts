import { sha256 } from '@noble/hashes/sha2.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
/** Works on ordinary LAN HTTP without Web Crypto; bytes never leave the browser. */
export function sha256Hex(bytes: Uint8Array): string { return hex(sha256(bytes)); }
/** Hash actual loaded bytes with unambiguous sorted name/length framing.
 * Include gameplay DATs, stage data, custom content, and scripts/config that affect
 * simulation; hash the WASM separately. This compares identity, not authenticity.
 */
export function contentFingerprint(files: Iterable<readonly [string, Uint8Array]>): string {
  const entries = Array.from(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const hash = sha256.create(), encoder = new TextEncoder();
  let previous: string | undefined;
  hash.update(encoder.encode('smash-prototype-content-v1\n'));
  for (const [name, bytes] of entries) {
    if (!name || name === previous) throw new Error('Content fingerprint needs unique nonempty names.');
    previous = name;
    const encoded = encoder.encode(name);
    hash.update(encoder.encode(`${encoded.length}:${bytes.byteLength}:`)); hash.update(encoded); hash.update(bytes);
  }
  if (!entries.length) throw new Error('Cannot fingerprint empty gameplay content.');
  return hex(hash.digest());
}
