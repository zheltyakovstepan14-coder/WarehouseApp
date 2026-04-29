// @ts-check
const { defineConfig } = require('@playwright/test');

const baseURL = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3002}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: process.env.PW_HEADED !== '1'
  }
});
