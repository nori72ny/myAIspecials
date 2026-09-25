import { expect, test } from '@playwright/test';

test.describe('ORIGIN Personal 2.0 production surface', () => {
  for (const width of [390, 834, 1440]) {
    test(`refines the latest answer with conversation context at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const requests: { messages: { role: string; content: string }[] }[] = [];
      await page.route('**/api/chat', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8',
          body: requests.length === 1 ? '## 進め方\n\n要件を確認してから実装し、動作を確認します。' : '具体的な手順を補足しました。' });
      });
      await page.goto('/');
      await page.getByTestId('origin-home-request').fill('開発の進め方を説明してください');
      await page.getByTestId('start-request-button').click();
      const detail = page.getByRole('button', { name: '実務レベルに深掘り', exact: true });
      await expect(detail).toBeVisible();
      await page.getByTestId('origin-chat-request').fill('まだ送信しないメモ');
      await expect(detail).toHaveCount(0);
      expect(requests).toHaveLength(1);
      await page.getByTestId('origin-chat-request').fill('');
      await detail.click();
      await expect(page.getByText('具体的な手順を補足しました。')).toBeVisible();
      expect(requests).toHaveLength(2);
      expect(requests[1].messages.some(message => message.role === 'assistant' && message.content.includes('要件を確認'))).toBe(true);
      expect(requests[1].messages.at(-1)?.content).toContain('判断基準');
      expect(requests[1].messages.at(-1)?.content).toContain('開発なら使える変更内容・組込み方・テスト・制約');
      await expect(page.getByRole('group', { name: '回答を調整', exact: true })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  test('opens Code by touch and direct URL on a narrow screen without losing the chat draft', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/coding/v1.4/status', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, ready: false, controlPlaneReady: false,
        authorizationMode: 'unconfigured', freeOnly: true, paidFallbackEnabled: false,
      }),
    }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('保存前の相談メモ');
    await page.getByTestId('origin-add-menu-toggle').click();
    await page.getByRole('menuitem', { name: 'コード', exact: true }).click();
    await expect(page).toHaveURL(/workspace=coding/);
    await page.getByText('実行に必要な認証', { exact: true }).click();
    await expect(page.getByLabel('Coding認証キー')).toBeVisible();
    await expect(page.getByLabel('変更したいこと', { exact: true })).toBeEditable();
    await expect(page.getByText('Grounded execution evidence', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Coding workspace views' })).toHaveCount(0);
    await expect(page.getByText('Plan', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '会話に戻る', exact: true }).click();
    await expect(page.getByTestId('origin-home-request')).toHaveValue('保存前の相談メモ');
    await page.goBack();
    await page.getByText('実行に必要な認証', { exact: true }).click();
    await expect(page.getByLabel('Coding認証キー')).toBeVisible();
    await page.reload();
    await page.getByText('実行に必要な認証', { exact: true }).click();
    await expect(page.getByLabel('Coding認証キー')).toBeVisible();
    await expect(page.getByRole('button', { name: '変更を依頼する', exact: true })).toBeDisabled();
  });

  test('shows the truthful first-release workspace without legacy navigation or sample data', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('ORIGIN Personal');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Personal 2.0', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('origin-home-request')).toBeEditable();
    await expect(page.getByRole('navigation', { name: 'Mode' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'ORIGIN workspace shell' })).toHaveCount(0);
    await expect(page.getByTestId('origin-add-menu-toggle')).toBeVisible();
    await expect(page.getByRole('menu', { name: '追加機能' })).toBeHidden();
    await page.getByTestId('origin-add-menu-toggle').click();
    for (const label of ['ファイルを添付', '詳しく調べる', 'コード', '成果物を作る']) {
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('menuitem', { name: '詳細', exact: true })).toHaveCount(0);
    await page.getByTestId('origin-add-menu-toggle').click();
    await expect(page.getByRole('region', { name: 'Project Workspace' })).toHaveCount(0);
    await expect(page.getByLabel('Model ORIGIN Auto')).toHaveCount(0);
    await expect(page.getByLabel('Tools 自動管理')).toHaveCount(0);
    await expect(page.getByTestId(/^starter-/)).toHaveCount(0);
    await expect(page.getByText(/最近のプロジェクト|Recent projects|ACOS Development|Sales Deck|Marketing|Memory Fragments/)).toHaveCount(0);
    await expect(page.getByTestId('nav-dashboard')).toHaveCount(0);
    await expect(page.getByTestId('nav-chat')).toHaveCount(0);
    await expect(page.getByTestId('nav-workspace')).toHaveCount(0);
    await expect(page.getByText(/追加料金が発生するAIへ自動で切り替わりません|No automatic switch to paid AI/i)).toBeVisible();
  });

  for (const width of [320, 390, 1440]) {
    test(`audits every progressive workspace link and maximizes composer space at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width <= 390 ? (width === 320 ? 568 : 844) : 900 });
      await page.route('**/api/coding/v1.4/status', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          ready: false,
          controlPlaneReady: false,
          authorizationMode: 'unconfigured',
          freeOnly: true,
          paidFallbackEnabled: false,
        }),
      }));
      await page.route('**/api/creative/v1.5/status', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ready: true,
          releaseStage: 'verified-vector-foundation',
          externalNetworkRequests: 0,
          providerExecutions: 0,
          costUsd: 0,
          freeOnly: true,
        }),
      }));

      await page.goto('/');
      const composer = page.locator('.origin-composer');
      const input = page.getByTestId('origin-home-request');
      const add = page.getByTestId('origin-add-menu-toggle');
      const send = page.getByTestId('start-request-button');

      await expect(input).toHaveAttribute('placeholder', 'やりたいことを、そのまま入力してください');
      await expect(add).toHaveText('＋');
      await expect(send).toHaveText('↑');
      const composerBox = await composer.boundingBox();
      const addBox = await add.boundingBox();
      const sendBox = await send.boundingBox();
      expect(addBox?.width).toBeGreaterThanOrEqual(44);
      expect(sendBox?.width).toBeGreaterThanOrEqual(44);
      if (width === 320) expect(composerBox?.width).toBeGreaterThanOrEqual(290);
      if (width === 390) expect(composerBox?.width).toBeGreaterThanOrEqual(360);
      if (width === 1440) expect(composerBox?.width).toBeGreaterThanOrEqual(850);

      const noOverflow = async () => expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBe(true);

      await add.click();
      const addMenu = page.getByRole('menu', { name: '追加機能' });
      await expect(addMenu).toBeVisible();
      const addMenuBox = await addMenu.boundingBox();
      expect(addMenuBox).not.toBeNull();
      expect(addMenuBox!.x).toBeGreaterThanOrEqual(0);
      expect(addMenuBox!.x + addMenuBox!.width).toBeLessThanOrEqual(width);
      expect(addMenuBox!.y).toBeGreaterThanOrEqual(0);
      expect(addMenuBox!.y + addMenuBox!.height).toBeLessThanOrEqual(width <= 390 ? (width === 320 ? 568 : 844) : 900);
      await page.getByRole('menuitem', { name: '詳しく調べる', exact: true }).click();
      await expect(page).toHaveURL(/workspace=research/);
      await expect(page.getByRole('heading', { name: '詳しく調べる' })).toBeVisible();
      await expect(page.getByLabel('調べたいこと', { exact: true })).toBeEditable();
      await noOverflow();
      await page.getByRole('button', { name: '会話に戻る', exact: true }).click();

      await page.getByTestId('origin-add-menu-toggle').click();
      await page.getByRole('menuitem', { name: 'コード', exact: true }).click();
      await expect(page).toHaveURL(/workspace=coding/);
      await expect(page.getByRole('heading', { name: 'コードの変更を依頼' })).toBeVisible();
      await expect(page.getByLabel('変更したいこと', { exact: true })).toBeEditable();
      await noOverflow();
      await page.getByRole('button', { name: '会話に戻る', exact: true }).click();

      await page.getByTestId('origin-add-menu-toggle').click();
      await page.getByRole('menuitem', { name: '成果物を作る', exact: true }).click();
      await expect(page).toHaveURL(/workspace=creative/);
      await expect(page.getByRole('heading', { name: '作りたいものを入力' })).toBeVisible();
      await expect(page.getByLabel('タイトル', { exact: true })).toBeEditable();
      await noOverflow();
      await page.getByRole('button', { name: '会話に戻る', exact: true }).click();

      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId('origin-home-request')).toBeVisible();
      await noOverflow();
    });
  }

  test('opens HTML artifacts as finished previews instead of source code', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/chat', route => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '完成しました。\n\n```html:完成プレビュー\n<main><h1>完成画面</h1><input aria-label="成果物入力" placeholder="入力してください"><button>実行</button></main>\n```',
    }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('HTML成果物を作成');
    await page.getByTestId('start-request-button').click();

    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible();
    const preview = workspace.getByTitle('プレビュー');
    await expect(preview).toBeVisible();
    const sandbox = preview.contentFrame();
    const artifactInput = sandbox.getByLabel('成果物入力');
    await expect(artifactInput).toBeVisible();
    const artifactInputMetrics = await artifactInput.evaluate((element) => {
      const style = getComputedStyle(element);
      return { height: element.getBoundingClientRect().height, fontSize: Number.parseFloat(style.fontSize) };
    });
    expect(artifactInputMetrics.height).toBeGreaterThanOrEqual(44);
    expect(artifactInputMetrics.fontSize).toBeGreaterThanOrEqual(16);
    const workspaceBox = await workspace.boundingBox();
    expect(workspaceBox?.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole('button', { name: 'プレビューを表示' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'コードを表示' })).toHaveAttribute('aria-pressed', 'false');
    await expect(workspace.getByText('<main><h1>完成画面</h1><input aria-label="成果物入力" placeholder="入力してください"><button>実行</button></main>', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'コードを表示' }).click();
    await expect(workspace.getByText('<main><h1>完成画面</h1><input aria-label="成果物入力" placeholder="入力してください"><button>実行</button></main>', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('submits a command-bar request within a compact viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '最初の計画を整理しました。' });
    });
    await page.goto('/');

    await page.getByTestId('origin-home-request').fill('最初の計画を整理してください');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByText('最初の計画を整理しました。')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('origin-chat-request')).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  });

  test('renders structured answers safely and readably on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '## 結論\n\n優先順位を決めて進めます。\n\n- 根拠A\n- 根拠B\n\n| 項目 | 判断 |\n| --- | --- |\n| 費用 | 0円 |\n\n![外部図](https://example.invalid/image.png)',
      });
    });
    await page.goto('/');

    await page.getByTestId('origin-home-request').fill('構造化した回答を表示してください');
    await page.getByTestId('start-request-button').click();

    const answer = page.getByRole('article', { name: 'ORIGINの回答' });
    await expect(answer.getByRole('heading', { name: '結論', level: 2 })).toBeVisible();
    await expect(answer.getByRole('list')).toContainText('根拠A');
    await expect(answer.getByRole('table')).toBeVisible();
    await expect(answer.getByRole('img')).toHaveCount(0);
    await expect(answer.getByRole('note')).toContainText('外部画像は自動表示しません');
    await expect(page.getByTestId('response-verification-details')).toContainText('詳細');
    const typography = await answer.evaluate((element) => {
      const heading = element.querySelector('h2');
      const paragraph = element.querySelector('p');
      if (!heading || !paragraph) return null;
      const headingStyle = getComputedStyle(heading);
      const paragraphStyle = getComputedStyle(paragraph);
      return {
        headingPx: Number.parseFloat(headingStyle.fontSize),
        paragraphPx: Number.parseFloat(paragraphStyle.fontSize),
        paragraphLineHeightPx: Number.parseFloat(paragraphStyle.lineHeight),
      };
    });
    expect(typography).not.toBeNull();
    expect(typography!.headingPx).toBeGreaterThan(typography!.paragraphPx * 1.2);
    expect(typography!.paragraphLineHeightPx).toBeGreaterThan(typography!.paragraphPx * 1.7);
    const answerSurface = page.locator('.origin-chat-assistant');
    const verification = page.getByTestId('response-verification-details');
    const answerBox = await answerSurface.boundingBox();
    const verificationBox = await verification.boundingBox();
    expect(answerBox?.width).toBeLessThanOrEqual(832);
    expect(verificationBox?.width).toBeLessThanOrEqual(832);
    expect(Math.abs((answerBox?.width ?? 0) - (verificationBox?.width ?? 0))).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('does not automatically retry a transient transport failure', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/chat', async (route) => {
      attempts += 1;
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary upstream failure' });
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('一時的な通信障害では自動再試行しない');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('現在、無料AIの利用が集中しています。費用0円ポリシーを維持するため自動再試行せず、今回は安全に回答を返せませんでした。少し時間をおいて、もう一度お試しください。')).toBeVisible();
    await expect(page.getByTestId('response-verification-details')).toHaveCount(0);
    expect(attempts).toBe(1);
  });

  test('batches fragmented streamed output without losing Japanese characters or verification', async ({ page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (!url.endsWith('/api/chat')) return originalFetch(input, init);

        const bytes = new TextEncoder().encode('結論：描画バッチで滑らかに表示します。');
        return new Response(new ReadableStream({
          start(controller) {
            for (let index = 0; index < bytes.length; index += 1) {
              controller.enqueue(bytes.slice(index, index + 1));
            }
            controller.close();
          },
        }), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      };
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('日本語の分割ストリームを検証');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('結論：描画バッチで滑らかに表示します。')).toBeVisible();
    await expect(page.getByTestId('response-verification-details')).toBeVisible();
  });

  test('shows the zero-cost congestion notice without a verified trace or client retry', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/chat', async (route) => {
      attempts += 1;
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PROVIDER_RATE_LIMITED', retryable: true, retryAttempted: true }),
      });
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('混雑時の安全案内を確認');
    await page.getByTestId('start-request-button').click();

    await expect(page.getByText('現在、無料AIの利用が集中しています。費用0円ポリシーを維持するため自動再試行せず、今回は安全に回答を返せませんでした。少し時間をおいて、もう一度お試しください。')).toBeVisible();
    await expect(page.getByTestId('response-verification-details')).toHaveCount(0);
    expect(attempts).toBe(1);
  });

  test('keeps the pristine mobile header minimal and reveals New conversation only after use', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/chat', route => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '確認しました。' }));
    await page.goto('/');

    const header = page.locator('header.origin-header');
    const history = page.getByTestId('history-drawer-toggle');
    const settings = page.getByRole('button', { name: '設定を開く' });

    await expect(header).toContainText('ORIGIN');
    await expect(header.getByRole('button')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '新規対話を開始' })).toHaveCount(0);
    await expect(page.getByTestId('knowledge-map-toggle')).toHaveCount(0);
    for (const button of [history, settings]) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
      expect(await button.evaluate((element) => getComputedStyle(element).flexShrink)).toBe('0');
    }

    await page.getByTestId('origin-home-request').fill('会話を開始');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByRole('article', { name: 'ORIGINの回答' }).getByText('確認しました。', { exact: true })).toBeVisible();
    const newConversation = page.getByRole('button', { name: '新規対話を開始' });
    await expect(newConversation).toBeVisible();
    await expect(header.getByRole('button')).toHaveCount(3);
    const newBox = await newConversation.boundingBox();
    expect(newBox?.height).toBeGreaterThanOrEqual(44);
    expect(newBox?.width).toBeGreaterThanOrEqual(44);

    const headerWidth = await header.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(headerWidth.scroll).toBeLessThanOrEqual(headerWidth.client);

    await history.click();
    await expect(page.getByTestId('knowledge-map-toggle')).toBeVisible();
  });
});

for (const width of [390, 834, 1440]) {
  test(`code answer controls stay usable at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const code = 'const message = "' + 'long-code-value-'.repeat(35) + '";';
    const content = '## 実装\n\n以下を利用できます。\n\n```ts\n' + code + '\n```';
    await page.route('**/api/chat', route => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: content }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('コードを表示してください');
    await page.getByTestId('start-request-button').click();
    await page.getByRole('button', { name: 'コードをコピー', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(code + '\n');
    const wrap = page.getByRole('button', { name: '折り返し', exact: true });
    await wrap.click();
    await expect(wrap).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '回答をコピー', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(content);
  });
}
