import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { characterPacksPlugin } from './scripts/character-packs.ts';
import { ANDROID_SHELL_API } from './web/src/android-bridge.ts';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** The game version shown in the corner of the main menu comes from package.json, so a
 * release bumps one number. `vitest.config.ts` defines the same pair for unit tests. */
export const gameDefine = (): Record<string, string> => ({
  __GAME_VERSION__: JSON.stringify((JSON.parse(readFileSync(path('./package.json'), 'utf8')) as { version: string }).version),
  __GAME_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
});

export default defineConfig({
  root: path('./web'),
  plugins: [characterPacksPlugin(), react(), {
    // The native-bridge API this game code needs; the server's derived Android game-code
    // channel (server/web-bundle.ts) reads it so older app shells skip incompatible builds.
    name: 'smash-shell-api-meta',
    transformIndexHtml: (html) => html.replace('</head>', `<meta name="smash-shell-api" content="${ANDROID_SHELL_API}">\n</head>`),
  }],
  server: {
    port: 5270,
    strictPort: true,
    fs: {
      strict: true,
      allow: [path('./web'), path('./lib'), path('./node_modules')],
      deny: ['**/private/**', '**/third_party/**', '**/.local/**', '**/.git/**', '**/.env*', '**/*.{pem,crt,iso,gcm,rvz,dol,7z}'],
    },
  },
  preview: { port: 5271, strictPort: true },
  define: gameDefine(),
  build: {
    // Emit .map files so production stack traces resolve to real file:line
    // instead of minified names like `Ym (play-*.js:2:513645)`.
    outDir: path('./dist'), emptyOutDir: true, target: 'es2022', sourcemap: true,
    rolldownOptions: { input: { lab: path('./web/index.html'), viewer: path('./web/viewer.html'), play: path('./web/play.html') } },
  },
});
