# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acos.spec.ts >> ACOS 2.0 POM E2E Test Suite >> should execute a complete lifecycle of all core screens using Page Objects
- Location: tests/e2e/acos.spec.ts:12:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('home-screen')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByTestId('home-screen')

```

```yaml
- complementary:
  - text: ACOS Personal
  - button "New Chat"
  - navigation:
    - button "Dashboard"
    - button "Unified Chat"
    - button "Workspace"
    - button "Memory"
    - paragraph: Recent Projects
    - button "ACOS Development"
    - button "Sales Deck"
    - button "Marketing"
  - button "Switch to Enterprise"
  - button "US User Settings"
- main:
  - heading "dashboard" [level=1]
  - text: "AI Core: Optimal"
  - heading "What can I help you with today?" [level=2]
  - paragraph: ACOS Unified AI will automatically route your request to the best model.
  - textbox "Ask anything or run a quick action..."
  - button "Send"
  - button "提案資料作成"
  - button "営業資料作成"
  - button "競合分析"
  - button "SEO/AIO分析"
  - button "画像生成"
  - button "SNS投稿"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { HomePage } from './pages/HomePage';
  3  | import { MissionPage } from './pages/MissionPage';
  4  | import { BoardroomPage } from './pages/BoardroomPage';
  5  | import { WorkspacePage } from './pages/WorkspacePage';
  6  | import { MarketplacePage } from './pages/MarketplacePage';
  7  | import { ResultDashboardPage } from './pages/ResultDashboardPage';
  8  | import { SettingsPage } from './pages/SettingsPage';
  9  | import AxeBuilder from '@axe-core/playwright';
  10 | 
  11 | test.describe('ACOS 2.0 POM E2E Test Suite', () => {
  12 |   test('should execute a complete lifecycle of all core screens using Page Objects', async ({ page }) => {
  13 |     // Instantiate Page Objects
  14 |     const homePage = new HomePage(page);
  15 |     const missionPage = new MissionPage(page);
  16 |     const boardroomPage = new BoardroomPage(page);
  17 |     const workspacePage = new WorkspacePage(page);
  18 |     const marketplacePage = new MarketplacePage(page);
  19 |     const resultDashboardPage = new ResultDashboardPage(page);
  20 |     const settingsPage = new SettingsPage(page);
  21 | 
  22 |     // 1. Navigate to the application home
  23 |     await homePage.goto();
  24 | 
  25 |     // Verify Home Screen is visible
> 26 |     await expect(homePage.screen).toBeVisible({ timeout: 15000 });
     |                                   ^ Error: expect(locator).toBeVisible() failed
  27 | 
  28 |     // Run accessibility scan to automatically block structural accessibility failures
  29 |     const results = await new AxeBuilder({ page })
  30 |       .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
  31 |       .analyze();
  32 |     
  33 |     const criticalViolations = results.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''));
  34 |     if (criticalViolations.length > 0) {
  35 |       console.error('Accessibility violations found:', JSON.stringify(criticalViolations, null, 2));
  36 |     }
  37 |     expect(criticalViolations.length).toBe(0);
  38 | 
  39 |     // Close the AI Assistant sidebar if it's open, to prevent any overlay intercepts, using data-testid only
  40 |     const assistantSidebar = page.getByTestId('ai-assistant-sidebar');
  41 |     const assistantCloseButton = assistantSidebar.getByTestId('close-sidebar-button');
  42 |     if (await assistantCloseButton.isVisible()) {
  43 |       await assistantCloseButton.click({ force: true });
  44 |     }
  45 | 
  46 |     // 2. Open Settings Modal with force click to bypass any overlay intercepts
  47 |     await settingsPage.openModal();
  48 |     await expect(settingsPage.modal).toBeVisible({ timeout: 15000 });
  49 | 
  50 |     // Close Settings Modal
  51 |     await settingsPage.closeModal();
  52 |     await expect(settingsPage.modal).not.toBeVisible({ timeout: 15000 });
  53 | 
  54 |     // Navigate to Settings Screen (Organization Settings)
  55 |     await settingsPage.navigateToScreen();
  56 |     await expect(settingsPage.screen).toBeVisible({ timeout: 15000 });
  57 | 
  58 |     // 3. Navigate to Workspace App
  59 |     await workspacePage.navigateTo();
  60 |     await expect(workspacePage.screen).toBeVisible({ timeout: 15000 });
  61 | 
  62 |     // 4. Navigate to Marketplace App
  63 |     await marketplacePage.navigateTo();
  64 |     await expect(marketplacePage.screen).toBeVisible({ timeout: 15000 });
  65 | 
  66 |     // 5. Navigate back to Home
  67 |     await homePage.navigateTo();
  68 |     await expect(homePage.screen).toBeVisible({ timeout: 15000 });
  69 | 
  70 |     // 6. Execute a Mission via Mission Command Input
  71 |     await homePage.runMission('Calculate the sum of 1 to 10 and return the result. Format as simple text.');
  72 | 
  73 |     // Verify Boardroom (loading state / boardroom-screen) is rendered
  74 |     await expect(boardroomPage.screen).toBeVisible({ timeout: 15000 });
  75 | 
  76 |     // Verify Mission screen is active
  77 |     await expect(missionPage.screen).toBeVisible({ timeout: 15000 });
  78 | 
  79 |     // Verify Result Dashboard is rendered (waiting for multi-agent simulation completion)
  80 |     await expect(resultDashboardPage.screen).toBeVisible({ timeout: 60000 });
  81 |   });
  82 | });
  83 | 
```