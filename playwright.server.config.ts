import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

export default defineConfig({
  ...base,
  testDir: './tests/server-browser',
  workers: 1, // A multiplayer case already owns four independent SwiftShader clients.
  use: { ...base.use, baseURL: 'http://127.0.0.1:5274' },
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:5274/viewer.html',
    env: {
      SMASH_HOST: '127.0.0.1', SMASH_PORT: '5274',
      ...(process.env.MELEE_DISC_PATH ? { MELEE_ISO: process.env.MELEE_DISC_PATH } : {}),
      ...(process.env.MELEE_ACE_ISO ? { MELEE_ACE_ISO: process.env.MELEE_ACE_ISO } : {}),
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
