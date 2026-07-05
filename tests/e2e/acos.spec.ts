import { test, expect } from '@playwright/test';

test.describe('ACOS 2.0 Full Lifecycle E2E Test', () => {
  test('should execute a complete lifecycle of all core screens using getByTestId', async ({ page }) => {
    // 1. Navigate to the application home
    await page.goto('/');

    // Verify Home Screen is visible
    await expect(page.getByTestId('home-screen').first()).toBeVisible({ timeout: 15000 });

    // Close the AI Assistant sidebar if it's open, to prevent any overlay intercepts on settings-button
    const assistantCloseButton = page.locator('button:has-text("✕")');
    if (await assistantCloseButton.isVisible()) {
      await assistantCloseButton.click();
    }

    // 2. Open Settings Modal with force click to bypass any overlay intercepts
    await page.getByTestId('settings-button').click({ force: true });
    await expect(page.getByTestId('settings-modal')).toBeVisible({ timeout: 15000 });

    // Close Settings Modal
    await page.getByTestId('close-settings-button').click({ force: true });
    await expect(page.getByTestId('settings-modal')).not.toBeVisible({ timeout: 15000 });

    // 3. Navigate to Workspace App
    await page.getByTestId('sidebar-workspace').click({ force: true });
    await expect(page.getByTestId('workspace-screen').first()).toBeVisible({ timeout: 15000 });

    // 4. Navigate to Marketplace App
    await page.getByTestId('sidebar-marketplace').click({ force: true });
    await expect(page.getByTestId('marketplace-screen').first()).toBeVisible({ timeout: 15000 });

    // 5. Navigate back to Home
    await page.getByTestId('sidebar-dashboard').click({ force: true });
    await expect(page.getByTestId('home-screen').first()).toBeVisible({ timeout: 15000 });

    // 6. Execute a Mission via Mission Command Input
    const missionInput = page.getByTestId('mission-input-field');
    await missionInput.click({ force: true });
    await page.waitForTimeout(500); // Wait for transition animation to stabilize
    await missionInput.fill('Calculate the sum of 1 to 10 and return the result. Format as simple text.');
    await page.waitForTimeout(200); // Allow React state to register the change
    await page.getByTestId('mission-execute-button').click({ force: true });

    // Verify Boardroom (loading state) is rendered
    await expect(page.getByTestId('boardroom-screen')).toBeVisible({ timeout: 15000 });

    // Verify Result Dashboard is rendered (waiting for multi-agent simulation completion)
    await expect(page.getByTestId('result-dashboard')).toBeVisible({ timeout: 60000 });
  });
});
