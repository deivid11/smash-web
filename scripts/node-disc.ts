import { open } from 'node:fs/promises';
import type { DiscReader } from '../lib/disc.ts';

export async function openDisc(path: string): Promise<DiscReader & { close(): Promise<void> }> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Disc input must be a regular file.');
    return {
      size: stat.size,
      close: () => file.close(),
      async read(offset, length) {
        const buffer = new Uint8Array(length);
        let position = 0;
        while (position < length) {
          const { bytesRead } = await file.read(buffer, position, length - position, offset + position);
          if (bytesRead === 0) throw new Error('Disc file ended unexpectedly.');
          position += bytesRead;
        }
        return buffer;
      },
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}
