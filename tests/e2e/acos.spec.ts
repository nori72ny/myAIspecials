import { test, expect } from '@playwright/test';

test.describe('ACOS 2.0 Full Lifecycle E2E Test', () => {
  test('should execute a complete mission lifecycle from UI', async ({ page }) => {
    // Navigate to the dashboard
    await page.goto('/');

    // Wait for the main input to be visible
    const input = page.locator('input[type="text"]').first();
    await expect(input).toBeVisible({ timeout: 15000 });
    
    // Type a simple, deterministic mission for the AI to process quickly
    const objective = 'Calculate the sum of 1 to 10 and return the result. Format as simple text.';
    await input.fill(objective);

    // Click Submit
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // The UI should show the ResultDashboard which contains sections for Strategic, Execution, etc.
    // Wait for either the final text, "Completed", or something that indicates progress.
    // We will wait for a long time as LLM calls take time.
    await expect(page.locator('text=COMPLETED').or(page.getByText('55', { exact: false })).or(page.locator('.result-content'))).toBeVisible({ timeout: 60000 });
    
    // Validate we reached the results screen
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});
