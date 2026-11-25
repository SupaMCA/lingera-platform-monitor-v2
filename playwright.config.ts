import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,                    // Gesamt-Timeout pro Test
  retries: 0,
  workers: 1,                        // Weniger Parallelität = stabiler in CI

  use: {
    actionTimeout: 30000,
    navigationTimeout: 45000,
    trace: 'off',
    screenshot: 'off',
  },

  reporter: [['list'], ['html']],
});
