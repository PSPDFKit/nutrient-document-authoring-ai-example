import { expect, test, type Page } from '@playwright/test';

const waitForReady = async (page: Page) => {
	// The Document Authoring SDK populates the host element once the editor has
	// booted; the use-case tabs stay disabled until the document is loaded.
	await expect(page.locator('[data-testid="document-editor-host"] > *').first()).toBeAttached({ timeout: 60_000 });
	await expect(page.getByRole('tab', { name: 'AI Editor' })).toBeEnabled({ timeout: 60_000 });
};

const openTab = async (page: Page, name: string) => {
	const tab = page.getByRole('tab', { name, exact: true });
	await tab.click();
	await expect(tab).toHaveAttribute('aria-selected', 'true');
	await expect(tab).toBeEnabled({ timeout: 60_000 });
};

test('shows the right side panel per use case', async ({ page }) => {
	await page.goto('/');
	await waitForReady(page);

	await expect(page.getByRole('region', { name: 'AI Assistant' }).getByRole('heading', { name: 'Assistant' })).toBeVisible();

	await openTab(page, 'Proofreading');
	await expect(page.getByRole('button', { name: 'Review Document' })).toBeEnabled({ timeout: 60_000 });

	await openTab(page, 'Translation');
	await expect(page.getByLabel('Target language')).toHaveValue('spanish');
	await expect(page.getByRole('button', { name: 'Translate Document' })).toBeEnabled({ timeout: 60_000 });

	await openTab(page, 'Template Builder');
	await expect(page.getByRole('region', { name: 'Placeholder catalog' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Build Template' })).toBeEnabled({ timeout: 60_000 });
});

test('assistant prompt posts a chat request and renders the conversation', async ({ page }) => {
	let requestBody: Record<string, unknown> | undefined;
	await page.route('**/api/chat', async (route) => {
		requestBody = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Mock chat failure.' }) });
	});
	await page.goto('/');
	await waitForReady(page);

	await page.getByRole('textbox', { name: 'Ask assistant' }).fill('Make the title bold.');
	await page.getByRole('button', { name: 'Submit' }).click();

	const userBubble = page.locator('.bubble-user');
	await expect(userBubble.locator('p')).toHaveText('Make the title bold.');
	await expect(page.locator('.bubble-assistant')).toHaveCount(1, { timeout: 15_000 });
	expect(requestBody?.useCase).toBe('ai-editor');
	expect(requestBody?.reviewComments).toBe('disabled');
	expect(Array.isArray(requestBody?.messages)).toBe(true);
});

test('proofreading workflow posts workflow input and confirms the applied output', async ({ page }) => {
	let requestBody: Record<string, unknown> | undefined;
	await page.route('**/api/chat', async (route) => {
		requestBody = route.request().postDataJSON() as Record<string, unknown>;
		const workflowInput = requestBody?.workflowInput as { inputFragment: unknown };
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ output: { replacementFragment: workflowInput.inputFragment } }),
		});
	});
	await page.goto('/');
	await waitForReady(page);
	await openTab(page, 'Proofreading');

	const runButton = page.getByRole('button', { name: 'Review Document' });
	await expect(runButton).toBeEnabled({ timeout: 60_000 });
	await runButton.click();

	await expect(page.locator('.workflow-completion-toast')).toContainText('Review complete', { timeout: 30_000 });
	expect(requestBody?.useCase).toBe('proofreading');
	expect((requestBody?.workflowInput as { scope: string }).scope).toBe('document');
});
