import { expect, test } from '@playwright/test';

test('prevents duplicate browser submissions during an in-flight chat request', async ({ page }) => {
  let requestCount = 0;
  let releaseSecondRequest!: () => void;
  const secondRequestGate = new Promise<void>((resolve) => {
    releaseSecondRequest = resolve;
  });

  await page.route('**/api/chat', async (route) => {
    requestCount += 1;

    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '最初の回答です。',
      });
      return;
    }

    await secondRequestGate;
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '二重送信せず処理しました。',
    });
  });

  await page.goto('/');
  await page.getByTestId('origin-home-request').fill('最初の依頼');
  await page.getByTestId('start-request-button').click();
  await expect(page.getByText('最初の回答です。')).toBeVisible();

  await page.getByTestId('origin-chat-request').fill('一度だけ送ってください');
  await page.getByTestId('send-request-button').dblclick({ delay: 0 });

  await expect.poll(() => requestCount).toBe(2);
  await page.waitForTimeout(150);
  expect(requestCount).toBe(2);

  await expect(page.getByText('一度だけ送ってください', { exact: true })).toHaveCount(1);

  releaseSecondRequest();
  await page.waitForTimeout(150);
  expect(requestCount).toBe(2);
});
