import { defineConfig, devices } from '@playwright/test';

import { E2E_RELEASE_SHA } from './tests/e2e/release-fixture';

const E2E_PORT = Number.parseInt(process.env.TEST_PORT || '3000', 10);
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000, // 2 minutes for E2E
  expect: {
    timeout: 15000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Sequential for complex state
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'results/playwright-results.xml' }],
    ['list']
  ],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start',
    env: {
      ORIGIN_RELEASE_SHA: E2E_RELEASE_SHA,
      TEST_PORT: String(E2E_PORT),
    },
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
});
