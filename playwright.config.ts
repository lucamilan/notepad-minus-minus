import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// I test e2e girano sulla build di produzione (npm run build), l'unica con la CSP attiva.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Service worker bloccati di default: ogni contesto nuovo installerebbe la cache dell'app e in
  // Firefox chiudere un contesto a installazione in corso può rallentare l'archivio del test
  // dopo. Li riattivano (serviceWorkers: 'allow') le spec in cui contano: offline, csp, acceptance.
  use: { baseURL: `http://localhost:${PORT}`, serviceWorkers: 'block' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
