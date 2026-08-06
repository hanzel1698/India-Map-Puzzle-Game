import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/* Use a Chromium that is already on the machine when there is one.
 *
 * Sandboxed CI images often ship a pinned Chromium under PLAYWRIGHT_BROWSERS_PATH
 * whose build number does not match whatever @playwright/test resolved to, and
 * Playwright then demands `playwright install` even though a perfectly good
 * browser is sitting right there. Pointing executablePath at it sidesteps the
 * version handshake entirely. Falls back to Playwright's own download when the
 * path is absent, so this stays portable to an ordinary laptop. */
const LOCAL_CHROMIUM =
  process.env.CHROMIUM_PATH ||
  ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find((p) => existsSync(p));

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 45000,

  use: {
    // Most tests run against file://, which is the "double-click index.html"
    // path. This baseURL covers the GitHub Pages path.
    baseURL: 'http://127.0.0.1:8123',
    trace: 'off',
    launchOptions: LOCAL_CHROMIUM ? { executablePath: LOCAL_CHROMIUM } : {},
  },

  webServer: {
    command: 'python3 -m http.server 8123',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
