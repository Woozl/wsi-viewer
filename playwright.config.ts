import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke test drives the built site, because the WASM core and its worker
 * are only wired together by a real build.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 2,
  workers: 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173/wsi-viewer/',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173',
    url: 'http://localhost:4173/wsi-viewer/',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 300_000,
  },
});
