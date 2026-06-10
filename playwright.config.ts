import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3101';

export default defineConfig({
	testDir: './tests',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: 'npm run dev -- --hostname 127.0.0.1 --port 3101',
		url: baseURL,
		timeout: 180 * 1000,
		reuseExistingServer: !process.env.CI,
	},
});
