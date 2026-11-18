import { expect, test } from '@playwright/test';

/**
 * Agent file-input F3 (design AGENT_FILE_INPUT_DESIGN_2026-11-18 §1.3,
 * §5 F3): the screen path attach → plan → approve → execute, driven
 * in a real browser with the v3 API mocked at the network layer. The
 * server side of the same path (real router, claim bridge, advancer,
 * tools) is covered by src/agent/agentAttachmentsF3Api.test.ts; here
 * the subject is the UI itself: the attachment chips, the plan's
 * attachment line, and the upload token riding along to run creation.
 */
test.describe('agent attachment flow (F3)', () => {
  test('attaches a file, plans with it, approves and completes at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fruits = 'id,item,amount\nA-1,りんご,120';
    const setDigest = 'd'.repeat(64);
    const seen: { planBody?: unknown; planTokenHeader?: string; createTokenHeader?: string } = {};

    await page.route('**/api/agent/v3/status', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        protocolVersion: 3,
        ready: true,
        approvalSigningConfigured: true,
        replayProtectionConfigured: true,
        browserApprovalEnabled: true,
        attachmentsEnabled: true,
        freeOnly: true,
        costUsd: 0,
        paidFallbackEnabled: false,
      }),
    }));
    await page.route('**/api/agent/v3/attachment-sets', route => route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        protocolVersion: 3,
        attachmentSetId: 'att-e2e-1',
        uploadToken: 'upload-token-e2e',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }));
    await page.route('**/api/agent/v3/attachment-sets/att-e2e-1/files', route => route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        protocolVersion: 3,
        attachmentSetId: 'att-e2e-1',
        file: { idx: 0, name: 'fruits.csv', mediaType: 'text/csv', kind: 'text', byteSize: 40, charCount: fruits.length, sha256: setDigest, extractionStatus: 'ok' },
        setDigest,
        fileCount: 1,
        totalChars: fruits.length,
      }),
    }));
    await page.route('**/api/agent/v3/plan', async route => {
      seen.planBody = route.request().postDataJSON();
      seen.planTokenHeader = route.request().headers()['x-agent-attachment-token'];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          protocolVersion: 3,
          runId: 'run-e2e-1',
          status: 'awaiting_approval',
          planToken: 'signed-plan-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          selectedTool: 'attachment_reader',
          params: { attachmentSetId: 'att-e2e-1', setDigest },
          steps: [
            { toolName: 'attachment_reader', params: { attachmentSetId: 'att-e2e-1', setDigest } },
            { toolName: 'attachment_analyzer', params: { attachmentSetId: 'att-e2e-1', setDigest, outputKind: 'rows', chunkOffset: 0, chunkCount: 1, instruction: '各行を分類してレポートを作成してください' } },
            { toolName: 'document_generator', params: { title: '分類レポート', dataGrounded: true, contentFromStep: 1 } },
          ],
          plan: [
            { id: 'task-1', title: 'Read the attached data' },
            { id: 'task-2', title: 'Analyze the attached data' },
            { id: 'task-3', title: 'Document' },
          ],
          attachments: {
            setId: 'att-e2e-1',
            setDigest,
            fileCount: 1,
            totalChars: fruits.length,
            files: [{ name: 'fruits.csv', charCount: fruits.length }],
          },
        }),
      });
    });
    await page.route('**/api/agent/v3/browser-approval', route => route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, protocolVersion: 3, runId: 'run-e2e-1', approvalToken: 'signed-approval-token', authMode: 'browser', scope: 'exact-operation' }),
    }));
    await page.route('**/api/agent/v3/runs**', async route => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/advance')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            protocolVersion: 3,
            runId: 'run-e2e-1',
            status: 'completed',
            artifact: '# 分類レポート',
            run: { runId: 'run-e2e-1', status: 'completed', goal: '各行を分類してレポートを作成してください', plan: [], stepsState: [] },
          }),
        });
        return;
      }
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, protocolVersion: 3, runs: [] }),
        });
        return;
      }
      seen.createTokenHeader = route.request().headers()['x-agent-attachment-token'];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          protocolVersion: 3,
          runId: 'run-e2e-1',
          status: 'queued',
          run: { runId: 'run-e2e-1', status: 'queued', goal: '各行を分類してレポートを作成してください', plan: [], stepsState: [] },
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-origin-storage-state', 'ready');
    await page.getByTestId('origin-add-menu-toggle').click();
    await page.getByRole('menuitem', { name: 'エージェントに任せる', exact: true }).click();
    await expect(page).toHaveURL(/workspace=agent/);
    await expect(page.getByRole('heading', { name: 'エージェントに任せる' })).toBeVisible();

    await page.getByLabel('任せたいこと', { exact: true }).fill('各行を分類してレポートを作成してください');
    await page.getByLabel('添付ファイルを選ぶ').setInputFiles({
      name: 'fruits.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(fruits, 'utf8'),
    });
    await expect(page.getByText(`fruits.csv（${fruits.length}文字）`)).toBeVisible();

    await page.getByRole('button', { name: '実行計画を作る' }).click();
    await expect(page.getByText('まだ実行していません · 承認待ち')).toBeVisible();
    await expect(page.getByText(`添付データ: 1件（fruits.csv、合計${fruits.length}文字）。このデータも承認の対象です。`)).toBeVisible();
    expect(seen.planBody).toEqual({ goal: '各行を分類してレポートを作成してください', attachmentSetId: 'att-e2e-1' });
    expect(seen.planTokenHeader).toBe('upload-token-e2e');

    await page.getByRole('button', { name: '承認して実行' }).click();
    await expect(page.getByRole('heading', { name: '分類レポート' })).toBeVisible();
    // Run creation carried the upload token — the claim bridge's proof.
    expect(seen.createTokenHeader).toBe('upload-token-e2e');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
