import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Same command as local development; migrations run first inside `pnpm dev`.
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5199/',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PORT: '5199', HOST: '127.0.0.1' },
  },
});
