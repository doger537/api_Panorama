import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.ts', workers: 1, timeout: 180000,
  use: { baseURL: process.env.E2E_BASE_URL, actionTimeout: 15000, viewport: { width: 1200, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
});
