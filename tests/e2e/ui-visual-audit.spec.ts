import { expect, test } from '@playwright/test';

const representativeAnswer = [
  '## 結論',
  '',
  '段階公開を基本にし、品質・利用率・撤退条件を同時に観測できる構成にします。',
  '',
  '## 判断基準',
  '',
  '- **品質**: 重大エラー率と問い合わせ増加を公開前後で比較します。',
  '- **価値**: 対象ユーザーの利用率と主要タスク完了率を確認します。',
  '- **可逆性**: 問題時に即時停止できるフラグと復旧手順を用意します。',
  '',
  '## トレードオフ',
  '',
  '段階公開は学習速度と安全性を両立しやすい一方、全ユーザーへの到達は遅くなります。一斉公開は到達が速い反面、障害時の影響範囲が大きくなります。',
  '',
  '## 実行手順',
  '',
  '1. 対象を限定して公開します。',
  '2. KPIとエラー指標を確認します。',
  '3. 基準を満たした場合だけ対象を拡大します。',
  '4. 悪化時は停止し、原因確認後に再評価します。',
  '',
  '## 完了条件',
  '',
  '主要KPIが事前基準を満たし、重大障害がなく、撤退条件と復旧手順が実地確認できた状態を完了とします。',
].join('\n');

test.describe('ORIGIN visual QA evidence', () => {
  for (const viewport of [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1440', width: 1440, height: 1000 },
  ]) {
    test(`captures readable home and long-answer evidence on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route('**/api/chat', route => route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: representativeAnswer,
      }));

      await page.goto('/');
      await expect(page.getByTestId('origin-home-request')).toBeVisible();
      await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
      await expect(page.getByRole('region', { name: 'Project Workspace' })).toHaveCount(0);
      await expect(page.locator('header.origin-header')).toHaveCount(0);
      const workspaceBox = await page.getByRole('region', { name: 'ORIGIN workspace shell' }).boundingBox();
      expect(workspaceBox!.height).toBe(viewport.width < 640 ? 48 : 56);
      const primaryControls = page.locator('button:visible, select:visible, summary:visible');
      expect(await primaryControls.count()).toBeLessThanOrEqual(6);
      const composer = page.locator('.origin-composer');
      await expect(composer.getByLabel('Composer mode', { exact: true })).toBeVisible();
      for (const child of await composer.locator('textarea, button, select').all()) {
        const box = (await child.boundingBox())!;
        const parent = (await composer.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(parent.x);
        expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width);
      }
      const startBox = await page.getByTestId('start-request-button').boundingBox();
      expect(startBox).not.toBeNull();
      expect(startBox!.y).toBeGreaterThanOrEqual(0);
      expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(viewport.height);
      await testInfo.attach(`origin-home-${viewport.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });

      await page.getByTestId('origin-home-request').fill('新機能の公開方法を実務レベルで判断してください');
      await page.getByTestId('start-request-button').click();

      const answer = page.getByRole('article', { name: 'ORIGINの回答' });
      await expect(answer.getByRole('heading', { name: '結論', level: 2 })).toBeVisible();
      await expect(answer.getByRole('heading', { name: '完了条件', level: 2 })).toBeVisible();
      await expect(page.getByRole('group', { name: '回答を調整' })).toBeVisible();
      await expect(page.getByTestId('response-verification-details')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      const typography = await answer.locator('.markdown-body').evaluate(element => ({ size: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight) / parseFloat(getComputedStyle(element).fontSize) }));
      expect(typography.size).toBeGreaterThanOrEqual(15);
      expect(typography.size).toBeLessThanOrEqual(16);
      expect(typography.line).toBeGreaterThanOrEqual(1.6);
      expect(typography.line).toBeLessThanOrEqual(1.7);
      const sendBox = await page.getByTestId('send-request-button').boundingBox();
      expect(sendBox).not.toBeNull();
      expect(sendBox!.y).toBeGreaterThanOrEqual(0);
      expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);

      await testInfo.attach(`origin-answer-${viewport.name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }
});

test('workspace colors follow the resolved app theme rather than the OS theme', async ({ page }) => {
  await page.goto('/?workspace=research');
  const input = page.getByRole('textbox', { name: '調べたいこと' });
  await expect(input).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(resolved => {
      document.documentElement.dataset.theme = resolved;
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      document.documentElement.classList.toggle('light', resolved === 'light');
    }, theme);
    await page.emulateMedia({ colorScheme: 'light' });
    const colors = await input.evaluate(element => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }));
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => input.evaluate(element => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }))).toEqual(colors);
  }
});

test('empty creative preview has a plain background and mobile-neutral instructions', async ({ page }) => {
  await page.goto('/?workspace=creative');
  const stage = page.getByTestId('creative-preview-stage');
  await expect(stage.getByText('まだ生成されていません')).toBeVisible();
  expect(await stage.evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
  await expect(stage).toContainText('内容を入力して');
});

// Simulates reduced available height; a physical mobile keyboard remains a
// separate device check. No provider call is needed to test layout geometry.
test('conversation keeps its composer reachable after the viewport becomes short', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/chat', route => route.fulfill({
    status: 200, contentType: 'text/plain; charset=utf-8', body: representativeAnswer,
  }));
  await page.goto('/');
  await page.getByTestId('origin-home-request').fill('表示の確認');
  await page.getByTestId('start-request-button').click();
  await expect(page.getByTestId('send-request-button')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 380 });
  await page.getByTestId('origin-chat-request').focus();
  const sendBox = await page.getByTestId('send-request-button').boundingBox();
  expect(sendBox).not.toBeNull();
  expect(sendBox!.y).toBeGreaterThanOrEqual(0);
  expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(380);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: '＋ 新規対話', exact: true }).click();
  await expect(page.getByTestId('origin-home-request')).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`keeps one artifact pane and reachable conversation navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/chat', route => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '成果物を作成しました。\n```html:gate.html\n<main><h1>監査用の成果物</h1></main>\n```' }));
    await page.goto('/');
    await expect(page.getByRole('tab', { name: '成果物', exact: true })).toHaveCount(0);
    await page.getByTestId('origin-home-request').fill('成果物の表示を確認');
    await page.getByTestId('start-request-button').click();
    const artifact = page.getByTestId('artifact-workspace');
    await expect(artifact).toHaveCount(1);
    await expect(artifact).toBeVisible();
    const pane = (await artifact.boundingBox())!;
    if (width === 390) {
      const conversationTab = page.getByRole('tab', { name: '会話', exact: true });
      await expect(page.getByRole('tab', { name: '成果物', exact: true })).toHaveAttribute('aria-selected', 'true');
      const tab = (await conversationTab.boundingBox())!;
      expect(pane.y).toBeGreaterThanOrEqual(tab.y + tab.height);
      await testInfo.attach('artifact-mobile-390.png', { body: await page.screenshot(), contentType: 'image/png' });
      await conversationTab.click();
      await expect(artifact).toHaveCount(0);
      await expect(page.getByTestId('origin-chat-request')).toBeVisible();
      await page.getByRole('tab', { name: '成果物', exact: true }).click();
      await expect(artifact).toHaveCount(1);
    } else {
      const input = (await page.getByTestId('origin-chat-request').boundingBox())!;
      expect(input.x + input.width).toBeLessThanOrEqual(pane.x);
      expect(input.y + input.height).toBeLessThanOrEqual(900);
      await testInfo.attach('artifact-desktop-1440.png', { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByRole('button', { name: '成果物ワークスペースを閉じる' }).click();
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('region', { name: 'Artifact history' }).getByRole('button', { name: /gate.html/ }).click();
    await expect(artifact).toHaveCount(1);
    await expect(artifact).toContainText('gate.html');
  });
}


test('renders grounded Research runtime evidence in the Chat timeline', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/research/v1.1/query', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      version: '1.1',
      status: 'grounded',
      provider: 'DuckDuckGo',
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      sourceCount: 1,
      distinctDomainCount: 1,
      confidence: 'strong',
      confidenceScope: 'retrieval-evidence-only',
      semanticConflictDetection: 'conservative-structured-only',
      sources: [{
        id: 'S1',
        title: 'Verified source',
        url: 'https://example.com/source',
        domain: 'example.com',
        evidenceLevel: 'page-verified',
        freshness: 'recent',
        score: 95,
        scoreScope: 'retrieval-evidence-only',
        citation: '[S1]',
      }],
      conflicts: [],
      report: 'Verified grounded report [S1]',
    }),
  }));

  await page.goto('/');
  await page.getByLabel('Composer mode', { exact: true }).selectOption('research');
  await expect(page.getByRole('region', { name: 'Research Workspace' })).toBeVisible();
  await page.getByRole('textbox', { name: '調べたいこと' }).fill('公開情報を調査');
  await page.getByRole('button', { name: '調査する' }).click();
  await expect(page.getByRole('region', { name: 'Research summary' })).toBeVisible();
  await page.getByLabel('Workspace mode', { exact: true }).selectOption('chat');

  const timeline = page.getByTestId('origin-runtime-activity-timeline');
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText('Research');
  await expect(timeline).toContainText('公開情報を調査');
  await expect(timeline).toContainText('完了');
  await expect(timeline).toContainText('costUsd=0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await testInfo.attach('runtime-research-chat-mobile-390.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('renders verified Agentic Coding runtime evidence in the Chat timeline', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const jobId = 'coding-abcdefghijklmnopqrstuv';
  const now = new Date().toISOString();
  const capability = {
    ok: true,
    ready: true,
    controlPlaneReady: true,
    databaseReady: true,
    storeConfigured: true,
    resultStoreConfigured: true,
    storeReady: true,
    resultStoreReady: true,
    authorizationReady: true,
    ownerBindingReady: true,
    dataKeyReady: true,
    cryptoReady: true,
    dispatchReady: true,
    workerEnabled: true,
    resultDetailsReady: true,
    authorizationMode: 'coding-operator',
    authorizationScope: 'owner',
    freeOnly: true,
    costUsd: 0,
    gitPublished: false,
    deployed: false,
  };
  const result = {
    schemaVersion: 1,
    sessionStatus: 'verified',
    repairRounds: 0,
    diffs: [{
      path: 'src/example.ts',
      kind: 'modified',
      before: 'export const value = 1;',
      after: 'export const value = 2;',
      beforeTruncated: false,
      afterTruncated: false,
      previewAvailable: true,
    }],
    verificationChecks: [
      { kind: 'typecheck', ok: true, exitCode: 0, timedOut: false, attempt: 1 },
      { kind: 'lint', ok: true, exitCode: 0, timedOut: false, attempt: 1 },
      { kind: 'test', ok: true, exitCode: 0, timedOut: false, attempt: 1 },
      { kind: 'build', ok: true, exitCode: 0, timedOut: false, attempt: 1 },
    ],
    freeOnly: true,
    costUsd: 0,
    gitPublished: false,
    deployed: false,
  };
  const job = {
    jobId,
    targetKey: 'owner/repo',
    status: 'verified',
    attempt: 1,
    version: 1,
    cancelRequested: false,
    resultCode: null,
    changedPaths: ['src/example.ts'],
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
  };

  await page.route('**/api/coding/v1.4/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(capability),
  }));
  await page.route('**/api/coding/v1.4/jobs', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, job, result, resultDetailsState: 'available' }),
  }));

  await page.goto('/');
  await page.getByLabel('Composer mode', { exact: true }).selectOption('coding');
  await expect(page.getByRole('region', { name: 'Coding Job Workspace' })).toBeVisible();
  await expect(page.getByText('設定確認済み')).toBeVisible();
  await page.getByLabel('Coding認証キー').fill('test-only-credential');
  await page.getByLabel('変更したいこと').fill('検証済みの変更を実行');
  await page.getByRole('button', { name: '変更を依頼する' }).click();
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
  await page.getByLabel('Workspace mode', { exact: true }).selectOption('chat');

  const timeline = page.getByTestId('origin-runtime-activity-timeline');
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText('Agent');
  await expect(timeline).toContainText('Agentic Coding');
  await expect(timeline).toContainText('完了');
  await expect(timeline).toContainText(jobId);
  await expect(timeline).toContainText('checks=4/4');
  await testInfo.attach('runtime-agent-chat-desktop-1440.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
