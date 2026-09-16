import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

const statusBody = JSON.stringify({
  ok: true,
  ready: true,
  version: '1.5',
  releaseStage: 'verified-vector-foundation',
  externalNetworkRequests: 0,
  providerExecutions: 0,
  costUsd: 0,
  freeOnly: true,
});

const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#F7F7F4"/><text x="80" y="180">Creative E2E</text></svg>';

test.describe('V1.5 Creative workspace production surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/creative/v1.5/status', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: statusBody,
    }));
    await page.route('**/api/creative/v1.5/generate', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      headers: {
        'Content-Disposition': "attachment; filename=\"origin-social-card-portrait.svg\"; filename*=UTF-8''creative-e2e-portrait.svg",
        'X-Origin-Visual-Verified': 'true',
        'X-Origin-Visual-Sha256': 'b'.repeat(64),
        'X-Origin-Free-Only': 'true',
        'X-Origin-Cost-Usd': '0',
        'X-Origin-External-Network': 'false',
      },
      body: svg,
    }));
  });

  test('opens Creative on mobile, generates a verified preview, and exports a real PNG locally', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const navigation = page.getByRole('navigation', { name: 'ワークスペース' });
    await navigation.getByRole('button', { name: /Creative/ }).click();
    await expect(page).toHaveURL(/workspace=creative/);
    await expect(page.getByText('検証済みローカル生成 · 外部通信 0 · Provider 0 · $0')).toBeVisible();

    await page.getByRole('textbox', { name: 'タイトル', exact: true }).fill('モバイルCreative');
    await page.getByRole('button', { name: 'Visualを生成' }).click();

    await expect(page.getByRole('img', { name: '生成済みVisual: モバイルCreative' })).toBeVisible();
    const svgDownload = page.getByRole('link', { name: 'SVG保存' });
    await expect(svgDownload).toHaveAttribute('download', 'creative-e2e-portrait.svg');
    await expect(page.getByText(/SHA-256 bbbbbbbbbbbb…/)).toBeVisible();

    const requestsBeforePng = requests.length;
    await page.getByRole('button', { name: 'PNGを作成' }).click();
    const pngDownload = page.getByRole('link', { name: 'PNG保存' });
    await expect(pngDownload).toHaveAttribute('download', 'creative-e2e-portrait.png');
    expect(requests.length).toBe(requestsBeforePng);

    const downloadPromise = page.waitForEvent('download');
    await pngDownload.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('creative-e2e-portrait.png');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('supports a direct Creative URL and browser history without losing the chat mount', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?workspace=creative');
    await expect(page.getByRole('main', { name: 'Creative workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Creative/ })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'チャット', exact: true }).click();
    await expect(page).not.toHaveURL(/workspace=creative/);
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('main', { name: 'Creative workspace' })).toBeVisible();
  });
});
