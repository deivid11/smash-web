import { defineConfig } from 'vitest/config';
import { characterPacksPlugin } from './scripts/character-packs.ts';
import { gameDefine } from './vite.config.ts';

export default defineConfig({
  plugins: [characterPacksPlugin()],
  define: gameDefine(),
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
