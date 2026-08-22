import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('ORIGIN Personal 2.0 critical journey', () => {
  test('renders a focused core identity and a spacious command bar without starter-card noise', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('origin-core-logo')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('header').getByText('ORIGIN', { exact: true })).toBeVisible();
    await expect(page.getByText('Personal 2.0', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '何を実現したいですか？' })).toBeVisible();
    const commandBar = page.getByTestId('origin-home-request');
    await expect(commandBar).toBeVisible();
    expect(await commandBar.evaluate((element) => getComputedStyle(element).minHeight)).toBe('60px');
    const initialComposerHeight = await commandBar.evaluate((element) => element.closest('.origin-composer')!.getBoundingClientRect().height);
    expect(initialComposerHeight).toBeGreaterThanOrEqual(76);
    expect(initialComposerHeight).toBeLessThanOrEqual(80);
    await expect(page.locator('[data-testid^="starter-"]')).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });

  test('shows pulsing ORIGIN thinking feedback immediately after sending', async ({ page }) => {
    await page.route('**/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '完了しました。' });
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('考えてください');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByTestId('origin-thinking')).toContainText('ORIGIN が思考・生成中…');
    await expect(page.getByTestId('origin-thinking')).toBeHidden({ timeout: 15_000 });
  });

  test('protects Japanese IME composition, then discloses exactly three verification stages', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/chat', async (route) => {
      requests += 1;
      await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '変換確定後に回答しました。' });
    });
    await page.goto('/');
    const composer = page.getByTestId('origin-home-request');
    await composer.fill('日本語を変換中です');
    await composer.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true })));
    await composer.evaluate((element) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true });
      Object.defineProperty(event, 'keyCode', { value: 229 });
      element.dispatchEvent(event);
    });
    expect(requests).toBe(0);
    await composer.press('Control+Enter');
    await expect(page.getByText('変換確定後に回答しました。')).toBeVisible();
    expect(requests).toBe(1);
    const verification = page.getByTestId('response-verification-details');
    await expect(verification).not.toHaveAttribute('open');
    await verification.getByText('検証済み').click();
    for (const label of ['意図分析', '制作仕様', '構文検証']) await expect(page.getByTestId('response-verification-log')).toContainText(label);
    await expect(page.locator('.safe-area-bottom .origin-composer')).toBeVisible();
  });

  test('interrupts an unfinished artifact and steers its continuation through the same free model', async ({ page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const state = window as Window & { originSteeringRequests?: Array<{ model: string; messages: Array<{ content: string }> }>; originSteeringAborted?: boolean };
      state.originSteeringRequests = [];
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith('/api/chat')) return originalFetch(input, init);
        state.originSteeringRequests?.push(JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> });
        if (state.originSteeringRequests?.length === 1) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('成果物を生成しています。\n```html:steered.html\n<main id="partial">Original draft</main>'));
              init?.signal?.addEventListener('abort', () => { state.originSteeringAborted = true; controller.error(new DOMException('Interrupted', 'AbortError')); }, { once: true });
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        return new Response('方向修正を反映しました。\n```html:steered.html\n<main id="steered">Navy final</main>\n```', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }) as typeof fetch;
    });
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('成果物を作成してください');
    await page.getByTestId('start-request-button').click();
    const steering = page.getByTestId('artifact-live-steering');
    await expect(steering).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('artifact-live-steering-input').fill('落ち着いたネイビーに変更');
    await page.getByTestId('artifact-live-steering-submit').click();
    await expect(page.getByTestId('artifact-workspace')).toContainText('Navy final');
    await expect(steering).toBeHidden();
    const state = await page.evaluate(() => {
      const current = window as Window & { originSteeringRequests?: Array<{ model: string; messages: Array<{ content: string }> }>; originSteeringAborted?: boolean };
      return { requests: current.originSteeringRequests, aborted: current.originSteeringAborted };
    });
    expect(state.aborted).toBe(true);
    expect(state.requests).toHaveLength(2);
    expect(state.requests?.map((request) => request.model)).toEqual(['google/gemma-4-26b-a4b-it:free', 'google/gemma-4-26b-a4b-it:free']);
    expect(state.requests?.[1]?.messages.at(-1)?.content).toContain('落ち着いたネイビーに変更');
    expect(state.requests?.[1]?.messages.at(-1)?.content).toContain('Original draft');
  });

  test('synchronizes semantic OKLCH design themes into an existing opaque-origin preview', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '```html:semantic-theme.html\n<main id="theme-target" style="color:var(--accent-primary)">Semantic preview</main>\n```' }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('テーマ同期を確認');
    await page.getByTestId('start-request-button').click();
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    const preview = page.getByTestId('artifact-workspace').getByTitle('プレビュー');
    const sandbox = preview.contentFrame();
    await expect(sandbox.locator('html')).toHaveAttribute('data-origin-design-theme', 'minimal');
    await preview.evaluate((element) => { (window as Window & { originThemeFrame?: Window | null }).originThemeFrame = (element as HTMLIFrameElement).contentWindow; });
    const originalAccent = await sandbox.locator('html').evaluate((element) => getComputedStyle(element).getPropertyValue('--accent-primary').trim());
    await page.getByTestId('artifact-action-details').click();
    await page.getByTestId('artifact-open-design-settings').click();
    await page.getByTestId('design-theme-luxury').click();
    await expect(page.locator('html')).toHaveAttribute('data-design-theme', 'luxury');
    await expect(sandbox.locator('html')).toHaveAttribute('data-origin-design-theme', 'luxury');
    const luxuryAccent = await sandbox.locator('html').evaluate((element) => getComputedStyle(element).getPropertyValue('--accent-primary').trim());
    expect(luxuryAccent).not.toBe(originalAccent);
    expect(await preview.evaluate((element) => (window as Window & { originThemeFrame?: Window | null }).originThemeFrame === (element as HTMLIFrameElement).contentWindow)).toBe(true);
    await page.getByTestId('design-theme-glass').click();
    await expect(sandbox.locator('html')).toHaveAttribute('data-origin-design-theme', 'glass');
    expect(await preview.evaluate((element) => (window as Window & { originThemeFrame?: Window | null }).originThemeFrame === (element as HTMLIFrameElement).contentWindow)).toBe(true);
    await expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /connect-src 'none'/);
  });

  test('auto-corrects low contrast and unnamed buttons inside the isolated artifact sandbox', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '```html:a11y-auto-lint.html\n<main style="background:#777"><p id="low-contrast" style="color:#777">Important result</p><button id="unnamed-button"><svg aria-hidden="true" viewBox="0 0 10 10"><path d="M1 5h8"/></svg></button></main>\n```',
    }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('アクセシビリティ補正を確認');
    await page.getByTestId('start-request-button').click();
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    const preview = page.getByTestId('artifact-workspace').getByTitle('プレビュー');
    const sandbox = preview.contentFrame();
    await expect(sandbox.locator('html')).toHaveAttribute('data-origin-a11y-checked', 'true');
    await expect(sandbox.locator('html')).toHaveAttribute('data-origin-a11y-contrast-fixes', '1');
    await expect(sandbox.locator('html')).toHaveAttribute('data-origin-a11y-name-fixes', '1');
    await expect(sandbox.locator('#low-contrast')).toHaveAttribute('data-origin-contrast-fixed', 'true');
    await expect(sandbox.locator('#unnamed-button')).toHaveAttribute('aria-label', '操作ボタン 1');
    expect(await sandbox.locator('#low-contrast').evaluate((element) => getComputedStyle(element).color)).not.toBe('rgb(119, 119, 119)');
    await expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /connect-src 'none'/);
  });

  test('uses translated artifact controls, HTML MIME download, and a locked-down preview sandbox', async ({ page }) => {
    await page.addInitScript(() => {
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      (window as Window & { originBlobTypes?: string[] }).originBlobTypes = [];
      URL.createObjectURL = ((blob: Blob) => {
        (window as Window & { originBlobTypes?: string[] }).originBlobTypes?.push(blob.type);
        return originalCreateObjectURL(blob);
      }) as typeof URL.createObjectURL;
    });
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '成果物を作成しました。\n```html:preview.html\n<a href="https://example.invalid">ORIGIN Personal 2.0 preview</a>\n```' }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('成果物を作成したい');
    await page.getByTestId('start-request-button').click();
    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    const preview = workspace.getByTitle('プレビュー');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(preview).toHaveAttribute('src', '/origin-artifact-sandbox.html');
    await expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /default-src 'none';/);
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /window\.open=function/);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '成果物をダウンロード' }).click();
    await expect((await download).suggestedFilename()).toBe('preview.html');
    await expect.poll(() => page.evaluate(() => (window as Window & { originBlobTypes?: string[] }).originBlobTypes ?? [])).toContain('text/html;charset=utf-8');
    await page.getByRole('button', { name: '成果物ワークスペースを閉じる' }).click();
    await expect(workspace).toBeHidden();
  });

  test('polyfills opaque-origin Storage without exposing parent data or permitting outbound requests', async ({ page }) => {
    const outbound: string[] = [];
    page.on('request', (request) => { if (request.url().includes('origin-egress.invalid')) outbound.push(request.url()); });
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '```html:isolated-storage.html\n<main id="storage-result">Waiting</main><script>localStorage.setItem("habit","done");sessionStorage.setItem("session","isolated");document.getElementById("storage-result").textContent=localStorage.getItem("habit");fetch("https://origin-egress.invalid/blocked").catch(function(){});</script>\n```',
    }));
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('origin-parent-secret', 'parent-only'));
    await page.getByTestId('origin-home-request').fill('保存できる習慣トラッカーを作成');
    await page.getByTestId('start-request-button').click();
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    const preview = page.getByTestId('artifact-workspace').getByTitle('プレビュー');
    await expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    const sandbox = preview.contentFrame();
    await expect(sandbox.locator('#storage-result')).toHaveText('done');
    expect(await sandbox.locator('body').evaluate(() => ({
      habit: localStorage.getItem('habit'),
      session: sessionStorage.getItem('session'),
      parentSecret: localStorage.getItem('origin-parent-secret'),
      key: localStorage.key(0),
      length: localStorage.length,
    }))).toEqual({ habit: 'done', session: 'isolated', parentSecret: null, key: 'habit', length: 1 });
    expect(await page.evaluate(() => localStorage.getItem('origin-parent-secret'))).toBe('parent-only');
    expect(outbound).toEqual([]);
  });

  test('packages all generated artifacts into one offline ZIP download', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '成果物を作成しました。\n```html:bundle.html\n<main>Bundle preview</main>\n```\n```css:bundle.css\nmain { color: cyan; }\n```' }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('複数成果物を作成');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByTestId('artifact-workspace')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('artifact-action-details').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('artifact-action-bundle').click();
    await expect((await download).suggestedFilename()).toMatch(/^origin-artifact-package-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  test('exports an artifact locally as HTML, SVG, PNG, Markdown, and JSON', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '```html:multi-format.html\n<main><h1>Multi format export</h1></main>\n```' }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('多形式エクスポートを作成');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByTestId('artifact-workspace')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('artifact-action-details').click();
    for (const [format, extension] of [['html', 'html'], ['svg', 'svg'], ['png', 'png'], ['markdown', 'md'], ['json', 'json']] as const) {
      await page.getByTestId('artifact-action-export-menu').click();
      await expect(page.getByTestId('artifact-export-menu')).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await page.getByTestId(`artifact-export-${format}`).click();
      await expect((await downloadPromise).suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    }
  });

  test('restores a local archived conversation from the requestAnimationFrame knowledge map', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'セッションを整理しました。' }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('復元対象のローカルセッション');
    await page.getByTestId('start-request-button').click();
    await expect(page.getByText('セッションを整理しました。')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '新規対話を開始' }).click();
    await page.getByTestId('knowledge-map-toggle').click();
    await expect(page.getByTestId('knowledge-map-node-count')).toHaveText('1');
    await page.getByTestId('knowledge-map-session-0').click();
    await expect(page.getByText('復元対象のローカルセッション')).toBeVisible();
  });

  test('migrates legacy localStorage to IndexedDB and persists generated artifact revisions locally', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('origin_personal_history', JSON.stringify({ version: 1, messages: [{ id: 'legacy-1', role: 'user', content: 'IndexedDBへ移行する履歴' }] }));
      localStorage.setItem('origin_personal_sessions', JSON.stringify([{ id: 'legacy-session', title: '旧セッション', createdAt: 1, messages: [{ id: 'legacy-1', role: 'user', content: 'IndexedDBへ移行する履歴' }] }]));
    });
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '成果物を保存します。\n```html:persisted.html\n<main>Persisted artifact</main>\n```' }));
    await page.goto('/');
    await expect(page.getByText('IndexedDBへ移行する履歴')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => new Promise<{ legacy: string | null; snapshot: unknown }>((resolve) => {
      const request = indexedDB.open('origin-personal-local', 1);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction('snapshots', 'readonly').objectStore('snapshots').get('primary');
        read.onsuccess = () => { resolve({ legacy: localStorage.getItem('origin_personal_history'), snapshot: read.result }); database.close(); };
      };
    }))).toMatchObject({ legacy: null, snapshot: { messages: [{ content: 'IndexedDBへ移行する履歴' }] } });
    await page.getByTestId('origin-chat-request').fill('成果物を生成');
    await page.getByTestId('origin-chat-request').press('Control+Enter');
    await expect(page.getByTestId('artifact-workspace')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(async () => new Promise<unknown>((resolve) => {
      const request = indexedDB.open('origin-personal-local', 1);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction('snapshots', 'readonly').objectStore('snapshots').get('primary');
        read.onsuccess = () => { resolve(read.result); database.close(); };
      };
    }))).toMatchObject({ artifacts: [expect.objectContaining({ title: 'persisted.html', content: expect.stringContaining('<main>Persisted artifact</main>') })] });
  });

  test('searches IndexedDB-backed sessions and artifact code locally from the history drawer', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('origin_personal_history', JSON.stringify({ version: 1, messages: [{ id: 'legacy-search', role: 'user', content: '検索可能なIndexedDB会話' }] }));
      localStorage.setItem('origin_personal_sessions', JSON.stringify([{ id: 'search-session', title: '検索用セッション', createdAt: 1, messages: [{ id: 'legacy-search', role: 'user', content: '検索可能なIndexedDB会話' }] }]));
    });
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '```html:searchable.html\n<main>Artifact Search Needle</main>\n```' }));
    await page.goto('/');
    await page.getByTestId('origin-chat-request').fill('成果物を追加');
    await page.getByTestId('origin-chat-request').press('Control+Enter');
    await expect(page.getByTestId('artifact-workspace')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '成果物ワークスペースを閉じる' }).click();
    await page.waitForTimeout(250);
    await page.getByTestId('history-drawer-toggle').click();
    const search = page.getByTestId('history-search-input');
    await search.fill('IndexedDB');
    await expect(page.getByTestId('history-search-results')).toContainText('検索用セッション');
    await search.fill('Artifact Search Needle');
    await expect(page.getByTestId('history-search-results')).toContainText('searchable.html');
  });

  test('prioritizes three artifact actions, reveals details on demand, and recovers a sandbox runtime error', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '成果物を作成しました。\n```html:unstable.html\n<main>Last known good UI</main>\n```',
    }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('不安定な成果物を作成');
    await page.getByTestId('start-request-button').click();
    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('artifact-action-save')).toBeVisible();
    await expect(page.getByTestId('artifact-action-share')).toBeVisible();
    await expect(page.getByTestId('artifact-action-edit')).toBeVisible();
    await expect(page.getByTestId('artifact-action-details')).toBeVisible();
    await expect(page.getByTestId('artifact-action-edit')).toHaveText('✏️ 編集');
    await expect(page.getByTestId('artifact-action-share')).toHaveText('📲 共有');
    await expect(page.getByTestId('artifact-action-save')).toHaveText('📥 保存');
    for (const control of ['artifact-action-save', 'artifact-action-share', 'artifact-action-edit', 'artifact-action-details']) {
      await expect(page.getByTestId(control)).toHaveClass(/min-h-11/);
    }
    await page.getByTestId('artifact-action-details').click();
    await expect(page.getByTestId('artifact-action-copy')).toBeVisible();
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    const preview = workspace.getByTitle('プレビュー');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('data-origin-loaded', 'true');
    const sandbox = preview.contentFrame();
    await expect(sandbox.locator('body')).toBeVisible();
    await page.waitForTimeout(180);
    await sandbox.locator('body').evaluate(() => parent.postMessage({ source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'ready', timestamp: Date.now() }, '*'));
    await sandbox.locator('body').evaluate(() => parent.postMessage({ source: 'ORIGIN_SANDBOX_BOUNDARY', type: 'runtime-error', message: 'unstable preview', timestamp: Date.now() }, '*'));
    const boundary = page.getByTestId('sandbox-runtime-boundary');
    await expect(boundary).toBeVisible({ timeout: 15_000 });
    await expect(boundary).toContainText('Sandbox内で実行時エラーを検知しました。');
    const restore = page.getByTestId('restore-last-known-good');
    await expect(restore).toBeEnabled();
    await restore.click();
    await expect(boundary).toBeHidden();
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /Last known good UI/);
    await expect(preview).not.toHaveAttribute('data-origin-srcdoc', /unstable preview/);
  });

  test('switches preview viewports and presents multi-slide artifacts with keyboard navigation', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '成果物を作成しました。\n```html:deck.html\n<section class="slide">Slide one</section><section class="slide">Slide two</section>\n```',
    }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('プレゼン資料を作成');
    await page.getByTestId('start-request-button').click();
    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    const preview = workspace.getByTitle('プレビュー');
    const sandbox = preview.contentFrame();
    await expect(sandbox.locator('body')).toBeVisible();
    await page.getByTestId('preview-viewport-375').click();
    await expect(preview).toHaveAttribute('style', /width: 375px/);
    await expect(page.getByTestId('preview-viewport-375')).toContainText('375px');
    await page.getByTestId('preview-viewport-768').click();
    await expect(preview).toHaveAttribute('style', /width: 768px/);
    await page.getByTestId('preview-viewport-fluid').click();
    await expect(preview).toHaveAttribute('style', /width: 100%/);
    await page.getByTestId('artifact-action-details').click();
    await page.getByTestId('presentation-mode-toggle').click();
    await expect(page.getByTestId('presentation-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(sandbox.getByText('Slide one')).toBeVisible();
    await expect(sandbox.getByText('Slide two')).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(sandbox.getByText('Slide one')).toBeHidden();
    await expect(sandbox.getByText('Slide two')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(sandbox.getByText('Slide one')).toBeVisible();
    await expect(sandbox.getByText('Slide two')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('presentation-mode-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('edits preview text through Direct Touch and records an immutable new revision', async ({ page }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '成果物を作成しました。\n```html:direct-touch.html\n<main><p>Original editable text</p></main>\n```',
    }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('直接編集できる成果物を作成');
    await page.getByTestId('start-request-button').click();
    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    await page.getByTestId('artifact-action-edit').click();
    await expect(page.getByTestId('artifact-action-edit')).toHaveAttribute('aria-pressed', 'true');
    const preview = workspace.getByTitle('プレビュー');
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /data-origin-direct-touch-root/);
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /ORIGIN_DIRECT_TOUCH/);
    const sandbox = preview.contentFrame();
    await expect(sandbox.locator('[data-origin-direct-touch-root]')).toBeVisible();
    const target = sandbox.getByText('Original editable text');
    await target.click();
    await expect(target).toHaveAttribute('contenteditable', 'plaintext-only');
    await expect(preview).toHaveAttribute('data-origin-srcdoc', /oninput=/);
    await sandbox.locator('body').evaluate(() => parent.postMessage({ source: 'ORIGIN_DIRECT_TOUCH', type: 'commit', edits: [{ index: 0, text: 'Edited locally' }], timestamp: Date.now() }, '*'));
    await expect(page.getByTestId('artifact-revision-indicator')).toHaveText('最新');
    await expect(page.getByText('1つ前の版あり')).toBeVisible();
    await expect(workspace.getByTitle('プレビュー')).toHaveAttribute('data-origin-srcdoc', /Edited locally/);
    await expect(workspace.getByTitle('プレビュー')).toHaveAttribute('sandbox', 'allow-scripts');
  });

  test('visualizes changes using natural-language controls and keeps local artifact export available offline', async ({ page, context }) => {
    await page.route('**/api/chat', async (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '```html:visual-diff.html\n<main><p>Original visual text</p></main>\n```' }));
    await page.goto('/');
    await page.getByTestId('origin-home-request').fill('差分対象を作成');
    await page.getByTestId('start-request-button').click();
    const workspace = page.getByTestId('artifact-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'プレビューを表示' }).click();
    const preview = workspace.getByTitle('プレビュー');
    const sandbox = preview.contentFrame();
    await sandbox.locator('body').evaluate(() => parent.postMessage({ source: 'ORIGIN_DIRECT_TOUCH', type: 'commit', edits: [{ index: 0, text: 'Updated visual text' }], timestamp: Date.now() }, '*'));
    await expect(page.getByTestId('artifact-revision-indicator')).toHaveText('最新');
    await page.getByTestId('artifact-action-details').click();
    await page.getByTestId('artifact-visual-diff-toggle').click();
    await expect(page.getByTestId('artifact-visual-diff')).toContainText('Updated visual text');
    await context.setOffline(true);
    await expect(page.getByTestId('artifact-offline-status')).toBeVisible();
    await page.getByTestId('artifact-action-details').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('artifact-action-bundle').click();
    await expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    await context.setOffline(false);
  });

  test('accepts multiple text drag-and-drop attachments and rejects files over 5MB or totals over 10MB', async ({ page }) => {
    await page.goto('/');
    const homeRequest = page.getByTestId('origin-home-request');
    await homeRequest.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['hello origin'], 'note.txt', { type: 'text/plain' }));
      transfer.items.add(new File(['more context'], 'context.md', { type: 'text/markdown' }));
      element.parentElement?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    await expect(page.getByText(/添付: note.txt/)).toBeVisible();
    await expect(page.getByText(/添付: context.md/)).toBeVisible();
    await homeRequest.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.txt', { type: 'text/plain' }));
      element.parentElement?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    await expect(page.getByRole('alert')).toContainText('5MB以下');
    await homeRequest.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(5 * 1024 * 1024)], 'first.txt', { type: 'text/plain' }));
      transfer.items.add(new File([new Uint8Array(5 * 1024 * 1024)], 'second.txt', { type: 'text/plain' }));
      element.parentElement?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    await expect(page.getByRole('alert')).toContainText('合計は10MB以下');
  });

  test('keeps settings, language, system theme, and history controls available', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '設定を開く' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /設定|Settings/i });
    await expect(settingsDialog).toBeVisible();
    await page.getByRole('button', { name: 'システム設定' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'What would you like to accomplish?' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Export' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Import' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Clear' })).toBeVisible();
    await page.getByTestId('close-settings-button').click();
    await expect(settingsDialog).toBeHidden();
  });

  test('reflows the Personal 2.0 workspace at mobile width without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('origin-core-logo')).toBeVisible();
    await expect(page.getByTestId('origin-home-request')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
