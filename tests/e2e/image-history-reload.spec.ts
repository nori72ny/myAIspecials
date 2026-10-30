import { expect, test, type Page } from '@playwright/test';

async function seedGeneratedImageHistory(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');

  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas-context-unavailable');
    const gradient = context.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, '#0f766e');
    gradient.addColorStop(1, '#f59e0b');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('png-encode-failed')), 'image/png');
    });
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const generationId = `raster-${'b'.repeat(24)}`;
    const image = {
      assetId: sha256,
      mimeType: 'image/png',
      downloadName: 'origin-reloaded-image.png',
      sha256,
      providerId: 'origin-local-canvas',
      model: 'origin-canvas-procedural-v1',
      generationId,
      visualBrainVersion: 'visual-brain-v1',
      planVersion: 'raster-visual-plan-v1',
      planSha256: 'c'.repeat(64),
      purpose: 'photograph',
      typographyOverlay: false,
      sourceCriticVersion: 'raster-structural-critic-v1',
      sourceQualityScore: 100,
      technicalCriticVersion: 'raster-technical-critic-v1',
      technicalQualityScore: 88,
      prompt: 'Reload persistence regression image',
      width: 256,
      height: 256,
      relation: 'generated',
    };
    const asset = {
      ...image,
      version: 1,
      id: sha256,
      createdAt: Date.now(),
      blob,
    };

    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('origin-raster-visual-local-v1', 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('images')) open.result.createObjectStore('images', { keyPath: 'id' });
      };
      open.onerror = () => reject(open.error ?? new Error('raster-db-open-failed'));
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('images', 'readwrite');
        transaction.objectStore('images').put(asset);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('raster-asset-seed-failed')); };
        transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('raster-asset-seed-aborted')); };
      };
    });

    const snapshot = {
      version: 1,
      messages: [{
        id: 'persisted-image-message',
        role: 'assistant',
        content: '保存済み画像の復元テストです。',
        deliveryState: 'verified',
        image,
      }],
      sessions: [],
      artifacts: [],
      updatedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('origin-personal-local', 1);
      open.onerror = () => reject(open.error ?? new Error('origin-db-open-failed'));
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('snapshots')) {
          db.close();
          reject(new Error('origin-snapshot-store-missing'));
          return;
        }
        const transaction = db.transaction('snapshots', 'readwrite');
        transaction.objectStore('snapshots').put(snapshot, 'primary');
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('origin-snapshot-seed-failed')); };
        transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('origin-snapshot-seed-aborted')); };
      };
    });
  });
}

test('restores locally generated image bytes and save link after a full page reload', async ({ page }) => {
  await seedGeneratedImageHistory(page);
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');
  const image = page.getByAltText('ORIGINが生成した画像');
  await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 256)).toBe(true);
  const saveLink = page.getByRole('link', { name: '画像を保存' });
  await expect(saveLink).toHaveAttribute('download', 'origin-reloaded-image.png');
  await expect(saveLink).toHaveAttribute('href', /^blob:/);
});
