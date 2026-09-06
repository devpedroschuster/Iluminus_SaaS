// gestao_web/playwright.config.js
import { defineConfig, devices } from '@playwright/test';
import { PORT, BASE_URL } from './e2e/constants.js';

// Pré-requisitos para rodar localmente (npm run e2e):
// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (projeto de staging) e
// E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD como env vars ANTES de `npm run build`
// — como reuseExistingServer é true fora do CI, um build antigo feito sem
// essas vars seria reutilizado silenciosamente em vez de dar erro.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
