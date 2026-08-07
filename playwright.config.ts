import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: [
    {
      command: 'npm run dev:room',
      url: 'http://127.0.0.1:2567/health',
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev:web -- --hostname 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
    },
  ],
})
