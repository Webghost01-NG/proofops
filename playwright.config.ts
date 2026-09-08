import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const systemChrome = '/opt/google/chrome/chrome';
export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4319',
    launchOptions: existsSync(systemChrome) ? { executablePath: systemChrome } : {},
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1080 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: 'node dist/cli.js dashboard --port 4319',
    url: 'http://127.0.0.1:4319',
    reuseExistingServer: false,
    env: { SOURCE_CHAIN_RPC_URL: '', PROOFOPS_DATA_DIR: resolve(`.test-build/browser-${Date.now()}`) }
  }
});
