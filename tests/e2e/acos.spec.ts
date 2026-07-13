import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('ACOS 2.0 Personal Edition critical journey', () => {
  test('opens the personal dashboard and navigates to Unified Chat', async ({ page }) => {
    await page.goto('/');

    // The current product entry point is Personal Edition, not the legacy
    // enterprise dashboard previously referenced by the Page Objects.
    await expect(
      page.getByRole('heading', { name: 'What can I help you with today?' })
    ).toBeVisible({ timeout: 15_000 });

    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const blockingViolations = accessibility.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? '')
    );
    expect(blockingViolations).toEqual([]);

    const unifiedChatNavigation = page.getByRole('button', {
      name: /統合チャット|Unified Chat/i,
    });
    await expect(unifiedChatNavigation).toBeVisible();
    await unifiedChatNavigation.click();

    await expect(
      page.getByText(/こんにちは！ACOS統合AIです|Hello! I am ACOS Unified AI/i)
    ).toBeVisible({ timeout: 15_000 });

    const chatInput = page.getByPlaceholder(/ACOSにメッセージを入力|Message ACOS/i);
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEditable();
  });
});
