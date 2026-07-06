const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  // Playwright owns the browser *.spec.js files; the pure-Node simulation test
  // (tests/sim.test.mjs, run with `node`) must NOT be collected here — it runs
  // on import and would exit the runner. Run it with `npm run test:sim`.
  testMatch: '**/*.spec.js',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'python -m http.server 8000',
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: !process.env.CI,
    timeout: 20 * 1000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
  ],
});
