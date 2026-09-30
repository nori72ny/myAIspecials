import { expect, test } from '@playwright/test';

const GENERATED_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPklEQVR4nO3PQQ0AIAzAwJKMzAAiEDZZSEMMKvainz6b3Fj7JieppgbzQEFXg9l4R4ECBQoUKFCgQIGCjwQPDA0CxBEY0isAAAAASUVORK5CYII=';
const GENERATED_SHA = 'e73d048c64c76842e242327f2a000f6cfbe0f2772fd1526e31899dd41f3d37a2';
const EDITED_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAX0lEQVR4nGM8IafBwMIAQU4wBgMLwz4kNiXiLAwMbAy0BMPAAickC/YhSTghsSkRHwZBRHML9iFZQK1wRxYfBkE0mg8IgWFgwWg+GHgLRvPBwFswmg8G3oLRfDDgFgAA62ciBKZOIRkAAAAASUVORK5CYII=';
const EDITED_SHA = 'd25d5e0373267af5ddc25e9c6e417c58091bc1c01a4a3d456722d2f6cb02d5be';

async function waitForBoot(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
}

function imageHeaders(sha: string, task: 'generate' | 'edit', referenceCount: number) {
  return {
    'Content-Type': 'image/png',
    'Content-Disposition': 'attachment; filename="origin-image.png"',
    'X-Origin-Visual-Verified': 'true',
    'X-Origin-Visual-Sha256': sha,
    'X-Origin-Visual-Provider': 'cloudflare-workers-ai-free',
    'X-Origin-Visual-Model': '@cf/black-forest-labs/flux-2-klein-4b',
    'X-Origin-Visual-Generation-Id': `raster-${sha.slice(0, 24)}`,
    'X-Origin-Visual-Brain': 'visual-brain-v1',
    'X-Origin-Visual-Plan': 'raster-visual-plan-v1',
    'X-Origin-Visual-Purpose': 'photograph',
    'X-Origin-Visual-Template': 'general-square',
    'X-Origin-Visual-Safe-Margin-Pct': '7',
    'X-Origin-Visual-Typography-Zone': 'bottom',
    'X-Origin-Visual-Critic': 'raster-structural-critic-v1',
    'X-Origin-Visual-Quality-Score': '100',
    'X-Origin-Visual-Actual-Width': '1024',
    'X-Origin-Visual-Actual-Height': '1024',
    'X-Origin-Visual-Typography-Overlay': 'not-required',
    'X-Origin-Visual-Plan-Sha256': 'a'.repeat(64),
    'X-Origin-Visual-Width': '1024',
    'X-Origin-Visual-Height': '1024',
    'X-Origin-Visual-Task': task,
    'X-Origin-Visual-Reference-Count': String(referenceCount),
    'X-Origin-Free-Only': 'true',
    'X-Origin-Cost-Usd': '0',
    'X-Origin-Paid-Fallback': 'false',
    'X-Origin-Secret-Delivery': 'server-only',
  };
}

for (const width of [390, 1440] as const) {
  test(`generated-image variation uses bounded reference edit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });

    let generateRequests = 0;
    let editRequests = 0;
    let editBody: Record<string, unknown> | null = null;

    await page.route('**/api/generate-image', async route => {
      generateRequests += 1;
      await route.fulfill({
        status: 200,
        headers: imageHeaders(GENERATED_SHA, 'generate', 0),
        body: Buffer.from(GENERATED_BASE64, 'base64'),
      });
    });

    await page.route('**/api/creative/v1.5/raster/edit', async route => {
      editRequests += 1;
      editBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: imageHeaders(EDITED_SHA, 'edit', 1),
        body: Buffer.from(EDITED_BASE64, 'base64'),
      });
    });

    await page.goto('/');
    await waitForBoot(page);

    await page.getByTestId('origin-home-request').fill('夕焼けの海の写真風画像を文字なし・正方形で作ってください');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByAltText('ORIGINが生成した画像')).toHaveCount(1);
    await page.getByRole('button', { name: '別案を作る' }).click();

    await expect(page.getByAltText('ORIGINが生成した画像')).toHaveCount(2);
    expect(generateRequests).toBe(1);
    expect(editRequests).toBe(1);
    expect(editBody).not.toBeNull();

    const body = editBody as {
      prompt?: unknown;
      width?: unknown;
      height?: unknown;
      referenceImages?: unknown;
    };
    expect(body.width).toBe(1024);
    expect(body.height).toBe(1024);
    expect(String(body.prompt)).toContain('Create a clearly distinct alternative variation');
    expect(Array.isArray(body.referenceImages)).toBe(true);
    expect(body.referenceImages).toHaveLength(1);
    const reference = String((body.referenceImages as unknown[])[0]);
    expect(reference).toMatch(/^data:image\/(?:webp|jpeg);base64,/);
    expect(Buffer.from(reference.split(',')[1] ?? '', 'base64').byteLength).toBeLessThanOrEqual(768 * 1024);

    await expect(page.getByText(/Technical \d+\/100/)).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
