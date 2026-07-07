import { test, expect } from '@playwright/test';
import { HomePage } from './pages/HomePage';
import { MissionPage } from './pages/MissionPage';
import { BoardroomPage } from './pages/BoardroomPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { MarketplacePage } from './pages/MarketplacePage';
import { ResultDashboardPage } from './pages/ResultDashboardPage';
import { SettingsPage } from './pages/SettingsPage';
import AxeBuilder from '@axe-core/playwright';

test.describe('ACOS 2.0 POM E2E Test Suite', () => {
  test('should execute a complete lifecycle of all core screens using Page Objects', async ({ page }) => {
    // Instantiate Page Objects
    const homePage = new HomePage(page);
    const missionPage = new MissionPage(page);
    const boardroomPage = new BoardroomPage(page);
    const workspacePage = new WorkspacePage(page);
    const marketplacePage = new MarketplacePage(page);
    const resultDashboardPage = new ResultDashboardPage(page);
    const settingsPage = new SettingsPage(page);

    // 1. Navigate to the application home
    await homePage.goto();

    // Verify Home Screen is visible
    await expect(homePage.screen).toBeVisible({ timeout: 15000 });

    // Run accessibility scan to automatically block structural accessibility failures
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze();
    
    const criticalViolations = results.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''));
    if (criticalViolations.length > 0) {
      console.error('Accessibility violations found:', JSON.stringify(criticalViolations, null, 2));
    }
    expect(criticalViolations.length).toBe(0);

    // Close the AI Assistant sidebar if it's open, to prevent any overlay intercepts, using data-testid only
    const assistantSidebar = page.getByTestId('ai-assistant-sidebar');
    const assistantCloseButton = assistantSidebar.getByTestId('close-sidebar-button');
    if (await assistantCloseButton.isVisible()) {
      await assistantCloseButton.click({ force: true });
    }

    // 2. Open Settings Modal with force click to bypass any overlay intercepts
    await settingsPage.openModal();
    await expect(settingsPage.modal).toBeVisible({ timeout: 15000 });

    // Close Settings Modal
    await settingsPage.closeModal();
    await expect(settingsPage.modal).not.toBeVisible({ timeout: 15000 });

    // Navigate to Settings Screen (Organization Settings)
    await settingsPage.navigateToScreen();
    await expect(settingsPage.screen).toBeVisible({ timeout: 15000 });

    // 3. Navigate to Workspace App
    await workspacePage.navigateTo();
    await expect(workspacePage.screen).toBeVisible({ timeout: 15000 });

    // 4. Navigate to Marketplace App
    await marketplacePage.navigateTo();
    await expect(marketplacePage.screen).toBeVisible({ timeout: 15000 });

    // 5. Navigate back to Home
    await homePage.navigateTo();
    await expect(homePage.screen).toBeVisible({ timeout: 15000 });

    // 6. Execute a Mission via Mission Command Input
    await homePage.runMission('Calculate the sum of 1 to 10 and return the result. Format as simple text.');

    // Verify Boardroom (loading state / boardroom-screen) is rendered
    await expect(boardroomPage.screen).toBeVisible({ timeout: 15000 });

    // Verify Mission screen is active
    await expect(missionPage.screen).toBeVisible({ timeout: 15000 });

    // Verify Result Dashboard is rendered (waiting for multi-agent simulation completion)
    await expect(resultDashboardPage.screen).toBeVisible({ timeout: 60000 });
  });
});
