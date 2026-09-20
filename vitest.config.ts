import { defineConfig } from 'vitest/config';
import { characterPacksPlugin } from './scripts/character-packs.ts';

export default defineConfig({
  plugins: [characterPacksPlugin()],
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
