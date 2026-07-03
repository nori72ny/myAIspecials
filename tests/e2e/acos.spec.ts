import { test, expect } from '@playwright/test';

test.describe('ACOS 2.0 Full Lifecycle E2E Test', () => {
  test('should execute a complete mission lifecycle from UI', async ({ page }) => {
    // Navigate to the dashboard
    await page.goto('/');

    // Click the "Mission Generator" sidebar button to navigate to the cockpit
    const missionGeneratorTab = page.locator('button:has-text("Mission Generator")').first();
    await expect(missionGeneratorTab).toBeVisible({ timeout: 15000 });
    await missionGeneratorTab.click();

    // Wait for the main input to be visible (using its placeholder to avoid matching the Copilot input in the sidebar)
    const input = page.getByPlaceholder('例: 交通事故に強い弁護士を比較し、勝率が高く、口コミも優れた候補を提案する');
    await expect(input).toBeVisible({ timeout: 15000 });
    
    // Type a simple, deterministic mission for the AI to process quickly
    const objective = 'Calculate the sum of 1 to 10 and return the result. Format as simple text.';
    await input.fill(objective);

    // Submit the form using Enter key for 100% click/overlay resilience
    await input.press('Enter');

    // The UI should show the ResultDashboard which contains sections for Strategic, Execution, etc.
    // Wait for the Master Intelligence Engine header to appear indicating successful run
    const resultElement = page.locator('text=Master Intelligence Engine').or(page.locator('text=Success Score')).first();
    await expect(resultElement).toBeVisible({ timeout: 60000 });
    
    // Validate we reached the results screen
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Intelligence OS');

  });
});
