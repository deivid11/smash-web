import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const localConfig = new URL('./.local/toolchain.json', import.meta.url);
const local = existsSync(localConfig)
  ? JSON.parse(readFileSync(localConfig, 'utf8')) as { playwrightExecutable?: string }
  : {};

export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:5272',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: local.playwrightExecutable,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    command: 'npm run dev -- --port 5272',
    url: 'http://127.0.0.1:5272',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
