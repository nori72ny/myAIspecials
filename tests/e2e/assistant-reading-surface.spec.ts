import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;

async function waitForVisualSurface(page: Page) {
  await expect(page.getByRole('status', { name: 'ORIGIN を起動しています' })).toBeHidden({ timeout: 5_000 });
}

test.describe('ORIGIN continuous assistant reading surface', () => {
  for (const viewport of viewports) {
    test(`keeps assistant answers unboxed on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/chat', async (route) => route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: '結論です。通常回答は会話面に自然につながり、必要な情報だけを読みやすく表示します。\n\n## 確認項目\n\n- 背景を大きなカードで囲まない\n- ユーザー発言との区別は保つ\n- モバイルでも横にはみ出さない',
      }));

      await page.goto('/');
      await waitForVisualSurface(page);
      await page.getByTestId('origin-home-request').fill('通常回答の読みやすさを確認');
      await page.getByTestId('start-request-button').click();

      const assistant = page.locator('.origin-chat-assistant').last();
      const user = page.locator('.origin-chat-user').last();
      await expect(assistant).toBeVisible({ timeout: 15_000 });
      await expect(user).toBeVisible();
      await expect(assistant).toContainText('通常回答は会話面に自然につながり');

      const assistantStyle = await assistant.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          borderTopColor: style.borderTopColor,
          left: rect.left,
          right: rect.right,
        };
      });
      const userBackground = await user.evaluate((element) => getComputedStyle(element).backgroundColor);

      expect(assistantStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyle.boxShadow).toBe('none');
      expect(assistantStyle.borderTopColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyle.left).toBeGreaterThanOrEqual(-1);
      expect(assistantStyle.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(userBackground).not.toBe('rgba(0, 0, 0, 0)');
      // UI監査 #1：検証バッジは削除済み。回答が箱に囲まれていないことの
      // 検証（上の computed style 確認）がこのテストの本体。
      await expect(page.getByTestId('response-verification-details')).toHaveCount(0);

      await page.screenshot({ path: testInfo.outputPath(`assistant-reading-${viewport.name}.png`), fullPage: true });
    });
  }

  test('captures the quiet home, settings, and history surfaces on mobile-390', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByTestId('origin-home-request')).toBeVisible({ timeout: 15_000 });
    await waitForVisualSurface(page);

    // オリンはヘッダーに置かず、上部中央のプレゼンスに一本化した
    // （オーナー指示 2026-11-14 08:59）。2026-11-20 の窓方式を経て、
    // 同日 12:06 にオーナーが窓の枠を却下したため枠なしにし、
    // 同日 15:36 の実機判定で「頭が切れている」が不可とされた
    // ため、オリンの全体がヘッダーの下端より下に見える形にした。
    // 2026-11-21 の再デザインで素材を透過化し、円盤・落影・窪みは
    // 撤去した。残る質感は足元の接地影のみ（下の質感ブロック）。
    await expect(page.locator('.origin-header [data-testid="origin-cat-pedestal"]')).toHaveCount(0);
    const presence = page.getByTestId('origin-orin-presence');
    await expect(presence).toBeVisible();
    await expect(presence.locator('[data-testid="origin-cat-pedestal"]')).toHaveCount(0);
    const presenceCatImage = presence.locator('img[data-testid="origin-cat-state"]');
    await expect(presenceCatImage).toBeVisible();
    expect(await presenceCatImage.getAttribute('src')).toContain('origin-cat.webp');
    const presenceCatStyle = await presenceCatImage.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.width,
        height: style.height,
        borderRadius: style.borderRadius,
      };
    });
    // 円盤の中の猫は96pxの円形（待機時。2026-11-20
    // 18:17 の実機判定で顔が読める大きさへ拡大し、2026-11-28
    // の実機判定でさらに拡大）。作業中は
    // 64pxに自動で縮む（2026-11-20 10:10）。スクロール中の
    // 縮小は P4（2026-11-23）で廃止済み（K-01 では行が本文と
    // 一緒に流れるため、縮める理由自体がない）。
    expect(presenceCatStyle.width).toBe('96px');
    expect(presenceCatStyle.height).toBe('96px');
    expect(presenceCatStyle.borderRadius).toBe('999px');
    // 枠なし（2026-11-20 12:06）：タップ対象は窓パネルではなく、
    // 背景・枠・影を持たない。残るのは円盤とテキストだけ。
    const tapButton = presence.locator('button');
    const tapStyle = await tapButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(tapStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(tapStyle.borderTopStyle).toBe('none');
    expect(tapStyle.borderTopWidth).toBe('0px');
    expect(tapStyle.boxShadow).toBe('none');
    // 透過絵の質感（2026-11-21 再デザイン）：円盤の落影と
    // ::after の inset 窪みは撤去済みで、ラッパーにも ::after
    // にも box-shadow は無い。残る質感は足元の接地影だけで、
    // ::after の背景グラデーション（楕円、紺20%→0%）として
    // ライトテーマに付く。
    const discTexture = await presenceCatImage.evaluate((element) => {
      const wrapper = element.parentElement;
      if (!wrapper) return { drop: '', inset: '', ground: '' };
      const afterStyle = getComputedStyle(wrapper, '::after');
      return {
        drop: getComputedStyle(wrapper).boxShadow,
        inset: afterStyle.boxShadow,
        ground: afterStyle.backgroundImage,
      };
    });
    expect(discTexture.drop).toBe('none');
    expect(discTexture.inset).toBe('none');
    expect(discTexture.ground).toBe('radial-gradient(rgba(24, 35, 59, 0.2), rgba(24, 35, 59, 0) 68%)');
    // 全体表示の幾何（K-01 契約、2026-11-24）：プレゼンスは
    // 会話スクローラの最初の通常フローの行である（position
    // は static、配置は持たない）。円盤の上端はヘッダーの
    // 下端より下にあり、円盤がヘッダーに隠れる量は 0（猫の
    // 頭が切れない、2026-11-20 15:36 の実機判定は維持）。
    // ヘッダー下端から円盤上端までの距離は、スクローラの
    // padding-top（モバイル p-2 = 8px）とタップ対象の
    // padding-top（6px）の合計 14px が設計値（旧浮遊形の
    // 12px は top 配置由来で、行の積み重ねではこの 14px が
    // 正本）。行の高さは待機時 108px（円盤96px＋タップの
    // 上下パディング6px×2）で、行の下端はホームレイアウト
    // の上端に接する（本文は円盤の下ではなく行の下から
    // 始まるため、先頭行が隠れる余地自体がない）。
    // スクローラの padding-top は通常のパディング（モバイル
    // 8px）、scroll-padding-top は 16px（アンカー位置の
    // 小さな逃がしのみ。旧浮遊形の 88px/84px クリアランスは
    // 廃止済み）。
    await expect(presence).toHaveCSS('position', 'static');
    const headerBox = await page.locator('.origin-header').boundingBox();
    const discBox = await presenceCatImage.boundingBox();
    const scroller = page.locator('.origin-chat-scroll');
    const scrollerBox = await scroller.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(discBox).not.toBeNull();
    expect(scrollerBox).not.toBeNull();
    const headerBottom = headerBox!.y + headerBox!.height;
    const hiddenByHeader = headerBottom - discBox!.y;
    // 隠れる量は 0 が正本。 boundingBox の端数で 1px まで許容。
    expect(hiddenByHeader).toBeLessThanOrEqual(1);
    expect(discBox!.y - headerBottom).toBeLessThanOrEqual(14 + 1);
    // 行の位置と高さ：スクローラの最初の要素子で、高さは
    // 待機行の 108px。下端はホームレイアウトの上端に接する。
    const presenceBox = await presence.boundingBox();
    const homeBox = await page.locator('.origin-home-layout').boundingBox();
    expect(presenceBox).not.toBeNull();
    expect(homeBox).not.toBeNull();
    const presenceIsFirstRow = await presence.evaluate((element) => {
      const parent = element.closest('.origin-chat-scroll');
      return Boolean(parent && parent.firstElementChild === element);
    });
    expect(presenceIsFirstRow).toBe(true);
    expect(presenceBox!.height).toBeGreaterThanOrEqual(108 - 1);
    expect(presenceBox!.height).toBeLessThanOrEqual(108 + 1);
    expect(Math.abs(presenceBox!.y + presenceBox!.height - homeBox!.y)).toBeLessThanOrEqual(1);
    await expect(scroller).toHaveCSS('padding-top', '8px');
    await expect(scroller).toHaveCSS('scroll-padding-top', '16px');
    // タップの的（2026-11-20 15:36）：待機状態でも的は44px以上
    // （絵96px＋パディング6px×2＝108px）。
    const tapBox = await tapButton.boundingBox();
    expect(tapBox).not.toBeNull();
    expect(tapBox!.width).toBeGreaterThanOrEqual(44);
    expect(tapBox!.height).toBeGreaterThanOrEqual(44);
    console.log(`[orin-geometry] headerBottom=${headerBottom} discY=${discBox!.y} discH=${discBox!.height} hiddenByHeader=${hiddenByHeader} tap=${tapBox!.width}x${tapBox!.height}`);
    // ヘッダーの操作要素は円盤に隠れて押せなくならない
    // （当たり判定で確認する）。
    const settingsButton = page.getByTestId('history-drawer-toggle');
    const settingsHit = await settingsButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    });
    expect(settingsHit).toBe(true);

    await page.screenshot({ path: testInfo.outputPath('surface-home-mobile-390.png'), fullPage: true });

    await page.getByTestId('sidebar-toggle').click();
    await page.getByTestId('sidebar-settings').click();
    const settings = page.getByRole('dialog', { name: /設定|Settings/i });
    const settingsPanel = page.getByTestId('settings-modal');
    await expect(settings).toBeVisible();
    await expect(settingsPanel).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('surface-settings-mobile-390.png'), fullPage: true });
    await page.getByRole('button', { name: '設定を閉じる' }).click();
    await expect(settings).toBeHidden();

    await page.getByTestId('history-drawer-toggle').click();
    const history = page.getByTestId('history-drawer');
    await expect(history).toBeVisible();
    const historyBox = await history.boundingBox();
    expect(historyBox).not.toBeNull();
    expect(historyBox!.x).toBeGreaterThanOrEqual(0);
    expect(historyBox!.y).toBeGreaterThanOrEqual(0);
    expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(390);
    expect(historyBox!.y + Math.min(historyBox!.height, 1)).toBeLessThanOrEqual(844);
    const historyOnTop = await history.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height / 2, 120)));
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    });
    await page.screenshot({ path: testInfo.outputPath('surface-history-mobile-390.png'), fullPage: true });
    await history.screenshot({ path: testInfo.outputPath('surface-history-panel-mobile-390.png') });
    expect(historyOnTop).toBe(true);
  });

  test('captures the Orin presence shown while waiting, without changing the normal answer surface', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '処理が完了しました。' });
    });
    await page.goto('/');
    await waitForVisualSurface(page);
    await page.getByTestId('origin-home-request').fill('思考中の状態を確認');
    await page.getByTestId('start-request-button').click();
    // 作業中表示（2026-11-14、枠なし方式 2026-11-20 12:06）：
    // 待ちの主表示は上部中央のオリン＋状態テキスト（reduced-motion では
    // フェードなしで出る）。全体画面ステージは出ない。名前は
    // 2026-11-24 のオーナー指示で吹き出し型タグ「Orin」として
    // 円盤の横に常時出す（2026-11-15 の削除指示は撤回された。
    // カード内表示も残る）。
    const presence = page.getByTestId('origin-orin-presence');
    await expect(presence).toBeVisible();
    await expect(presence).toContainText('回答を準備しています');
    // 作業中コメントは入力文の丸写しではなく作業の要約だけを
    // 出し（2026-11-20 18:17）、末尾には稼働ドットが付く。
    await expect(presence).not.toContainText('思考中の状態を確認');
    await expect(presence.getByTestId('origin-orin-presence-dots')).toBeVisible();
    // 作業中は自動縮小で猫が64pxになる（状態テキストは見えたまま）。
    const catDuring = presence.locator('img[data-testid="origin-cat-state"]');
    await expect(catDuring).toBeVisible();
    await expect.poll(async () => catDuring.evaluate((el) => getComputedStyle(el).width)).toBe('64px');
    // 縮小状態でもタップの的は44px以上（64px＋パディング6px×2
    // ＝76px、2026-11-20 15:36）。
    const tapDuringBox = await presence.locator('button').boundingBox();
    expect(tapDuringBox).not.toBeNull();
    expect(tapDuringBox!.height).toBeGreaterThanOrEqual(44);
    console.log(`[orin-geometry] working tap height=${tapDuringBox!.height}`);
    // 名前タグは作業中（64px の縮小状態）でも常時出る
    // （2026-11-24 オーナー指示）。
    await expect(page.getByTestId('origin-orin-presence-name')).toBeVisible();
    await expect(page.getByTestId('origin-orin-presence-name')).toHaveText('Orin');
    await expect(page.getByTestId('origin-stage')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('surface-thinking-mobile-390.png'), fullPage: true });
    // 回答が終わるとピルだけが消え、姿は通常の96pxに戻って残る。
    await expect(page.getByTestId('origin-orin-presence-status')).toHaveCount(0, { timeout: 15_000 });
    await expect(presence).toBeVisible();
    const catAfter = presence.locator('img[data-testid="origin-cat-state"]');
    await expect(catAfter).toBeVisible();
    await expect.poll(async () => catAfter.evaluate((el) => getComputedStyle(el).width)).toBe('96px');
    await expect(page.locator('.origin-chat-assistant').last()).toContainText('処理が完了しました。');
  });

  test('Orin scrolls away with the content and never covers the conversation text (K-01 revision 2026-11-24)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const longBody = Array.from({ length: 24 }, (_, i) => `第${i + 1}段落です。スクロールしてもオリンが文字の上に残らないことを確認するための長い回答です。`).join('\n\n');
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: longBody,
    }));
    await page.goto('/');
    await waitForVisualSurface(page);
    await page.getByTestId('origin-home-request').fill('長い回答でスクロールを確認');
    await page.getByTestId('start-request-button').click();
    const assistant = page.locator('.origin-chat-assistant').last();
    await expect(assistant).toContainText('第24段落です', { timeout: 15_000 });

    const presence = page.getByTestId('origin-orin-presence');
    const disc = presence.locator('.origin-orin-presence__disc');
    const scroller = page.locator('.origin-chat-scroll');
    const firstArticle = page.locator('.origin-conversation-log article').first();
    // 旧契約（浮遊＋スクロール中フェード 0.35、2026-11-20
    // 15:36）は K-01 で廃止した：プレゼンスはスクローラ内の
    // 通常フローの行であり、本文の下を何かが通る構造自体が
    // ないため、薄くする必要がない。不透明度は常時 1。
    await expect.poll(async () => disc.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    // どのスクロール位置でも、行は会話ログの前に積まれた
    // ままで本文と重ならない（プレゼンスの下端 ≤ 最初の
    // メッセージの上端）。矩形はスクロールと一緒に平行移動
    // するため、この積み重なりは位置によらず保たれる。
    const expectNoOverlap = async () => {
      const presenceBox = await presence.boundingBox();
      const articleBox = await firstArticle.boundingBox();
      expect(presenceBox).not.toBeNull();
      expect(articleBox).not.toBeNull();
      expect(presenceBox!.y + presenceBox!.height).toBeLessThanOrEqual(articleBox!.y + 1);
    };
    // 最下部までスクロールすると、行はスクローラの可視領域
    // から完全に流れ去っている（本文の上に残らない）。
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const scrollerBox = await scroller.boundingBox();
    const presenceAtBottom = await presence.boundingBox();
    expect(scrollerBox).not.toBeNull();
    expect(presenceAtBottom).not.toBeNull();
    expect(presenceAtBottom!.y + presenceAtBottom!.height).toBeLessThanOrEqual(scrollerBox!.y + 1);
    await expectNoOverlap();
    // 先頭へ戻すと行が会話の入口に現れる。タップの的は
    // 44px以上（待機行は絵96px＋パディング6px×2＝108px）。
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await expect(disc).toBeVisible();
    const tapBox = await presence.locator('button').boundingBox();
    expect(tapBox).not.toBeNull();
    expect(tapBox!.width).toBeGreaterThanOrEqual(44);
    expect(tapBox!.height).toBeGreaterThanOrEqual(44);
    console.log(`[orin-geometry] top tap=${tapBox!.width}x${tapBox!.height}`);
    // 途中までスクロールすると、行はスクロール量と同じだけ
    // 上へ流れる（固定表示ではないことの確認）。
    const beforeScroll = await presence.boundingBox();
    await scroller.evaluate((el) => { el.scrollTop = 120; });
    const afterScroll = await presence.boundingBox();
    expect(beforeScroll).not.toBeNull();
    expect(afterScroll).not.toBeNull();
    expect(beforeScroll!.y - afterScroll!.y).toBeGreaterThanOrEqual(120 - 1);
    expect(beforeScroll!.y - afterScroll!.y).toBeLessThanOrEqual(120 + 1);
    await expectNoOverlap();
  });

  // K-16（2026-11-24）：長い回答の完了直後、追加スクロール
  // なしで調整ピル群が全見えし押せること。完了後に操作行が
  // 出現して本文が伸び、最終スクロール位置が古い高さに止まる
  // とピルが入力欄の裏に半分隠れた（欠陥#5 の残件）。会話ログ
  // の末尾余白（入力欄＋操作行分）を決定的に確保して吸収する。
  // 表あり／なしの両形で確認する。
  for (const variant of [
    { name: 'without table', table: '' },
    { name: 'with table', table: '\n\n| 項目 | 内容 |\n| --- | --- |\n| 確認 | 済みです |\n| 未確認点 | 理由A<br>理由B |' },
  ]) {
    test(`keeps the refinement pills fully visible after a long answer completes (${variant.name}) (K-16)`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const longBody = Array.from({ length: 24 }, (_, i) => `第${i + 1}段落です。完了直後にピルが隠れないことを確認するための長い回答です。`).join('\n\n') + variant.table;
      await page.route('**/api/chat', async (route) => route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: longBody,
      }));
      await page.goto('/');
      await waitForVisualSurface(page);
      await page.getByTestId('origin-home-request').fill('長い回答でピルの見え方を確認');
      await page.getByTestId('start-request-button').click();
      const pills = page.locator('.origin-answer-refinements');
      await expect(pills).toBeVisible({ timeout: 15_000 });
      const scroller = page.locator('.origin-chat-scroll');
      const scrollerBox = await scroller.boundingBox();
      expect(scrollerBox).not.toBeNull();
      // 追随そのものもここで固定する（K-16 残件、2026-11-24）：
      // 負荷の高い全体実行では、短い内容の最下部にいた時点で
      // 発生したスクロールイベントが本文の伸びた後に遅れて
      // 配送され、追随判定が「読み手が上へ動いた」と誤認して
      // 追随が先頭のまま止まる事象があった（scrollTop=1 のまま
      // ピルが文書末尾に残る）。App 側は、追随処理が自分で
      // 置いた位置から動いていないイベントでは追随を落とさ
      // ないようになり、競合の再現条件は App.test.tsx の
      // 単体テストで決定的に固定した。ここでは完了直後に
      // 追加スクロールなしで最下部へ到達していることと、
      // その位置でピル行まで含めて収まり末尾余白が確保され
      // ていること（CSS 側の保証）を合わせて確認する。
      await expect.poll(async () => scroller.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)), { timeout: 15_000 }).toBeLessThanOrEqual(2);
      const pillBox = await pills.boundingBox();
      expect(pillBox).not.toBeNull();
      expect(pillBox!.y).toBeGreaterThanOrEqual(scrollerBox!.y - 1);
      expect(pillBox!.y + pillBox!.height).toBeLessThanOrEqual(scrollerBox!.y + scrollerBox!.height + 1);
      // 末尾余白：ピル行の下端からスクローラの下端までの距離が、
      // 確保した余白（モバイル 224px）から会話ログ末尾までの
      // 既存の積み重ねを差し引いても十分に残っていること。
      const tailGap = scrollerBox!.y + scrollerBox!.height - (pillBox!.y + pillBox!.height);
      console.log(`[k16-geometry] tailGap=${tailGap}`);
      expect(tailGap).toBeGreaterThanOrEqual(120);
      // 表ありの形では、セル内の <br> が文字列として見えず、
      // 実際の改行になっている（K-15 の実画面確認を兼ねる）。
      if (variant.table) {
        const cell = page.locator('.origin-chat-assistant td', { hasText: '理由A' });
        await expect(cell.locator('br')).toHaveCount(1);
        await expect(page.locator('.origin-chat-assistant')).not.toContainText('<br>');
      }
      // ピルが実際に押せる（当たり判定で他の要素に覆われて
      // いない）ことを、最初のピルの中心で確認する。
      const firstPill = pills.locator('button').first();
      const hit = await firstPill.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(target && (target === element || element.contains(target)));
      });
      expect(hit).toBe(true);
    });
  }

  test('captures the fail-closed unverified-cost waiting state without leaking paid content', async ({ page }, testInfo) => {
    const model = 'google/gemma-4-31b-it:free';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/chat', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: 'NEVER DISPLAY THIS PAID RESPONSE',
        model,
        usage: { costUsd: 1 },
        routing: {
          model: model,
          modelId: model,
          freeOnly: true,
          cost: 0,
          actualCostUsd: 1,
          estimatedCostUsd: 0,
          billingTier: 'free',
          usage: { costUsd: 1 },
          providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false },
        },
      }),
    }));
    await page.goto('/');
    await waitForVisualSurface(page);
    await page.getByTestId('origin-home-request').fill('無料条件の安全待機表示を確認');
    await page.getByTestId('start-request-button').click();
    const safeWaiting = page.getByTestId('origin-safe-waiting-state');
    await expect(safeWaiting).toContainText('無料で使えることを確認できなかったため、回答を表示できませんでした');
    await expect(safeWaiting).not.toContainText('$0.00');
    await expect(page.getByText('NEVER DISPLAY THIS PAID RESPONSE')).toHaveCount(0);
    await expect(page.getByTestId('origin-thinking')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('surface-safe-waiting-mobile-390.png'), fullPage: true });
  });
});