import type { DiscReader } from '../../../lib/disc.ts';

/** Bounded local reads shared by the lab and viewer; never uploads disc bytes. */
export function localDiscReader(file: File, signal: AbortSignal): DiscReader {
  return {
    size: file.size,
    read(offset, length) {
      signal.throwIfAborted();
      return new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        const cleanup = () => signal.removeEventListener('abort', abort);
        const abort = () => { reader.abort(); cleanup(); reject(signal.reason); };
        reader.onload = () => { cleanup(); resolve(new Uint8Array(reader.result as ArrayBuffer)); };
        reader.onerror = () => { cleanup(); reject(reader.error ?? new Error('Cannot read the local disc.')); };
        signal.addEventListener('abort', abort, { once: true });
        reader.readAsArrayBuffer(file.slice(offset, offset + length));
      });
    },
  };
}

export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
