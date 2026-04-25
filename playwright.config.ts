import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  // Retries: más en CI, menos en local para ciclos rápidos de feedback
  retries: process.env.CI ? 2 : 1,

  // Workers: paralelismo controlado para evitar flakiness por recursos
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,

  // Timeout global por test (30s)
  timeout: 30_000,

  // Timeout para aserciones expect() - permite que la UI se estabilice
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: 'https://demo.playwright.dev',

    // Timeouts diferenciados por tipo de acción
    actionTimeout: 15_000,
    navigationTimeout: 20_000,

    ignoreHTTPSErrors: true,

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    viewport: { width: 1280, height: 720 },
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // El JSON es el insumo principal del analizador de flakiness
    ['json', { outputFile: 'flakiness-metrics/results-latest.json' }],
  ],

  projects: [
    {
      name: 'chromium-ui',
      use: { ...devices['Desktop Chrome'], headless: false },
    },
    {
      name: 'chromium-headless',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
});