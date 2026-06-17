import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,                    // Gesamt-Timeout pro Test
  retries: process.env.CI ? 2 : 1,   // In CI zweimal wiederholen
  workers: 1,                        // Weniger Parallelität = stabiler in CI

  use: {
    actionTimeout: 30000,
    navigationTimeout: 45000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  reporter: [['list'], ['html']],
});
