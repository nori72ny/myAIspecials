import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginAnswerMarkdown from '../OriginAnswerMarkdown';

afterEach(cleanup);

describe('OriginAnswerMarkdown', () => {
  it('renders a structured answer with readable semantic elements', () => {
    render(<OriginAnswerMarkdown language="ja" content={'## 結論\n\n重要な回答です。\n\n- 根拠A\n- 根拠B\n\n| 項目 | 判断 |\n| --- | --- |\n| 費用 | 0円 |'} />);

    expect(screen.getByRole('heading', { name: '結論', level: 2 })).toBeTruthy();
    expect(screen.getByRole('list').children).toHaveLength(2);
    expect(screen.getByRole('table').textContent).toContain('0円');
    expect(screen.getByRole('region', { name: '横にスクロールできる回答表' })).toBeTruthy();
    expect(screen.getByText('重要な回答です。')).toBeTruthy();
  });

  it('does not execute raw HTML or automatically load external images', () => {
    const { container } = render(
      <OriginAnswerMarkdown language="ja" content={'<script>window.pwned=true</script>\n\n![機密図](https://example.com/private.png)'} />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('外部画像は自動では表示しません');
  });

  it('does not auto-load Pollinations image URLs from Markdown', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" content="![external](https://image.pollinations.ai/prompt/test)" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('外部画像は自動では表示しません');
  });

  it('opens answer links without giving the destination opener access', () => {
    render(<OriginAnswerMarkdown language="en" content={'[Primary source](https://example.com/source)'} />);
    const link = screen.getByRole('link', { name: 'Primary source' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('offers task-adaptive professional refinements without inventing completed work', () => {
    const onRefine = vi.fn();
    render(<OriginAnswerMarkdown language="ja" content="回答本文" onRefine={onRefine} />);

    for (const label of ['実務向けに詳しく', '具体例を足す', '実行プランにする', '要点だけ']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    // 第1引数はモデルへ送る内部指示文、第2引数は吹き出し表示用の短い
    // ラベル（ピルの表示文そのもの）。内部指示文が表示側へ漏れないよう、
    // ラベルは指示文と別々に渡ることを固定する。
    fireEvent.click(screen.getByRole('button', { name: '実務向けに詳しく' }));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('判断基準'), '実務向けに詳しく');
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('検証方法'), '実務向けに詳しく');
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('開発なら'), '実務向けに詳しく');

    fireEvent.click(screen.getByRole('button', { name: '具体例を足す' }));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('仮定や例示は明示'), '具体例を足す');
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('架空の事例を実績として扱わない'), '具体例を足す');

    fireEvent.click(screen.getByRole('button', { name: '実行プランにする' }));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('明確な完了条件'), '実行プランにする');
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('未実施の作業を完了済みとは書かない'), '実行プランにする');

    fireEvent.click(screen.getByRole('button', { name: '要点だけ' }));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('意思決定に必要な結論と次の行動'), '要点だけ');
  });

  it('keeps the English deepening prompt specific to research, coding, planning, and unknowns', () => {
    const onRefine = vi.fn();
    render(<OriginAnswerMarkdown language="en" content="Answer" onRefine={onRefine} />);
    fireEvent.click(screen.getByRole('button', { name: 'More depth for practical work' }));
    const prompt = String(onRefine.mock.calls[0]?.[0] ?? '');
    for (const phrase of ['decision criteria', 'verification', 'research', 'coding', 'planning', 'Do not add filler']) {
      expect(prompt).toContain(phrase);
    }
    expect(onRefine.mock.calls[0]?.[1]).toBe('More depth for practical work');
  });
});

describe('answer copy and code controls', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('copies exact code and the full Markdown answer separately', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const content = '説明です。\n\n```ts\nconst value = 0;\n```';
    render(<OriginAnswerMarkdown language="ja" content={content} />);
    fireEvent.click(screen.getByRole('button', { name: 'コードをコピー' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const value = 0;\n'));
    fireEvent.click(screen.getByRole('button', { name: '回答をコピー' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(content));
    const wrap = screen.getByRole('button', { name: '折り返し' });
    fireEvent.click(wrap);
    expect(wrap.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: 'コードブロック' }).querySelector('pre')?.className).toBe('origin-code-wrap');
  });
  it('renders the answer text without actions while generation is in progress', () => {
    render(<OriginAnswerMarkdown language="ja" content="生成中の回答です。" actionsSuspended />);
    expect(screen.getByText('生成中の回答です。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '回答をコピー' })).toBeNull();
  });
  it('attaches text-answer actions only to plain answers, never to image results or failure cards (proposal 7)', () => {
    const onRefine = vi.fn();
    const image = render(<OriginAnswerMarkdown language="ja" content="画像の説明です。" resultKind="image" onRefine={onRefine} />);
    expect(screen.queryByRole('button', { name: '回答をコピー' })).toBeNull();
    expect(screen.queryByRole('group', { name: '回答を調整' })).toBeNull();
    image.unmount();
    const failure = render(<OriginAnswerMarkdown language="ja" content="確認できませんでした。" resultKind="failure" onRefine={onRefine} />);
    expect(screen.queryByRole('button', { name: '回答をコピー' })).toBeNull();
    expect(screen.queryByRole('group', { name: '回答を調整' })).toBeNull();
    failure.unmount();
    render(<OriginAnswerMarkdown language="ja" content="通常の回答です。" resultKind="answer" onRefine={onRefine} />);
    expect(screen.getByRole('button', { name: '回答をコピー' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '回答を調整' })).toBeTruthy();
  });
  it('reports clipboard rejection without claiming success', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<OriginAnswerMarkdown language="en" content="Useful answer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Select and copy'));
    expect(screen.queryByText('Copied')).toBeNull();
  });
});

describe('partial-answer source cards', () => {
  const partialAnswer = [
    '公開情報を2件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。内容の詳細は各出典でご確認ください。',
    '',
    '## 確認できた範囲',
    '',
    '取得日：2026年11月21日',
    '',
    '### S1 · enecho.meti.go.jp',
    '',
    '[日本のガソリン価格について](https://www.enecho.meti.go.jp/example)',
    '',
    '『全国平均小売価格は1リットルあたり170円程度でした。』',
    '',
    '### S2 · example.org',
    '',
    '[Second source](https://example.org/b)',
  ].join('\n');

  it('renders the fallback sources as cards, not a markdown text list', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" content={partialAnswer} />);
    const articles = container.querySelectorAll('article');
    expect(articles).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '確認できた範囲', level: 2 })).toBeTruthy();
    expect(screen.getByText('S1 · enecho.meti.go.jp')).toBeTruthy();
    expect(screen.getByText('日本のガソリン価格について')).toBeTruthy();
    // 4-A 以降、引用は「分かったこと」の要約と出典カードの両方に出る。
    expect(screen.getAllByText('『全国平均小売価格は1リットルあたり170円程度でした。』')).toHaveLength(2);
    expect(screen.getByText('取得日：2026年11月21日')).toBeTruthy();
    const openLinks = screen.getAllByRole('link', { name: '原文を開く' });
    expect(openLinks.map((link) => link.getAttribute('href'))).toEqual([
      'https://www.enecho.meti.go.jp/example',
      'https://example.org/b',
    ]);
    // カード見出しが Markdown の h3 としては描かれていない（テキスト羅列の形に戻っていない）。
    expect(screen.queryByRole('heading', { name: 'S1 · enecho.meti.go.jp' })).toBeNull();
    // 回答全体へのコピーは従来どおり使える。
    expect(screen.getByRole('button', { name: '回答をコピー' })).toBeTruthy();
  });

  it('leaves answers without the fallback sources section as plain markdown', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" content={'回答です。\n\n## 出典\n\n- S1: example.com'} />);
    expect(container.querySelectorAll('article')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: '出典', level: 2 })).toBeTruthy();
  });

  it('shows the domain instead of a raw URL when the link text is the URL itself (K-27)', () => {
    // リンク文が URL そのものの場合（自動リンク化された素の URL を
    // 含む）、長いエンコード URL がそのまま表示されて折り返しが
    // 乱れた（実働検査 LIVE-4）。表示はドメインに留め、URL は
    // リンク先にだけ残す。タイトル付きリンクは従来どおり。
    const url = 'https://ja.wikipedia.org/wiki/%E5%86%85%E9%96%A3%E7%B7%8F%E7%90%86%E5%A4%A7%E8%87%A3';
    render(<OriginAnswerMarkdown language="ja" content={`参考リンク\n\n- [${url}](${url})\n- ${url}\n- [内閣総理大臣の一覧](${url})`} />);
    const domainLinks = screen.getAllByRole('link', { name: 'ja.wikipedia.org' });
    expect(domainLinks).toHaveLength(2);
    for (const link of domainLinks) expect(link.getAttribute('href')).toBe(url);
    expect(screen.getByRole('link', { name: '内閣総理大臣の一覧' }).getAttribute('href')).toBe(url);
  });

  it('wraps answer tables in a frame that can show the right-edge scroll cue (K-26)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" content={'| 項目 | 判断 |\n| --- | --- |\n| 費用 | 0円 |'} />);
    const frame = container.querySelector('.origin-answer-table-frame');
    expect(frame).toBeTruthy();
    expect(frame?.querySelector('.origin-answer-table-scroll')).toBeTruthy();
    // jsdom では実寸が取れないためフェードは出ない（実ブラウザで確認）。
    expect(frame?.querySelector('.origin-answer-table-fade')).toBeNull();
  });
});

describe('Japanese line-breaking rules (P6) and the chat scroller anchor (P5)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

  it('does not break answer text at arbitrary characters', () => {
    // 以前の overflow-wrap: anywhere は行末の文字が何でも割れ、
    // 「12:00〜1 3:30」の数字途中・「シーパ／ラダイス」の単語途中
    // の改行を起こした（週次品質検査の欠陥#6）。
    const baseRule = css.match(/\.origin-answer-markdown \{[^}]*\}/)?.[0] ?? '';
    expect(baseRule).not.toContain('overflow-wrap: anywhere');
    expect(css).toContain('.origin-answer-markdown { line-break: strict; word-break: keep-all; overflow-wrap: break-word; }');
  });

  it('keeps table cell tokens whole and lets the wrapper scroll horizontally', () => {
    // 表は枠内で横スクロールする現行仕様を維持する。
    expect(css).toContain('.origin-answer-table-scroll { max-width: 100%; overflow-x: auto;');
    // セル内では一切折り返さない（nowrap）。keep-all だけでは
    // 列幅の配分でセルが狭くなったときに語が割れる実測があった。
    const cellRules = css.match(/\.origin-answer-table-scroll td \{[^}]*\}/g) ?? [];
    expect(cellRules.some((rule) => rule.includes('white-space: nowrap'))).toBe(true);
  });

  it('disables browser scroll anchoring on the chat scroller (P5)', () => {
    expect(css).toContain('.origin-chat-scroll { overflow-anchor: none; }');
  });
});

describe('answer display adjustments (2026-11-26 batch 1)', () => {
  it('renders LaTeX math as plain readable notation, not raw source (3-A)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" content={'40人のうち75%は $40 \\times \\frac{3}{4} = 30$ なので30人です。'} />);
    expect(container.textContent).toContain('40 × 3/4 = 30');
    expect(container.textContent).not.toContain('\\times');
    expect(container.textContent).not.toContain('\\frac');
    expect(container.textContent).not.toContain('$');
  });

  it('reshapes a partial (sources-only) landing into status, found quotes, then cards (4-A)', () => {
    const partialAnswer = [
      '公開情報を2件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。内容の詳細は各出典でご確認ください。',
      '',
      '## 確認できた範囲',
      '',
      '### S1 · mhlw.go.jp',
      '',
      '[一般職業紹介状況](https://www.mhlw.go.jp/example)',
      '',
      '『有効求人倍率は1.19倍でした。』',
      '',
      '### S2 · example.org',
      '',
      '[Second source](https://example.org/b)',
    ].join('\n');
    const { container } = render(<OriginAnswerMarkdown language="ja" content={partialAnswer} />);
    // 状態の1行が先頭に出て、長い定型の導入文は出ない。
    const status = container.querySelector('.origin-answer-status-lead');
    expect(status?.textContent).toBe('要約した答えは作れませんでした。出典の記述で分かったことをお伝えします。');
    expect(container.textContent).not.toContain('確認できた範囲と出典の一覧をお伝えします');
    // 「分かったこと」に引用が先に並び、出典カードも従来どおり出る。
    expect(screen.getByRole('heading', { name: '分かったこと（出典の記述）', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '確認できた範囲', level: 2 })).toBeTruthy();
    expect(container.querySelectorAll('article')).toHaveLength(2);
  });

  it('reshapes a reconstruction (verbatim quotes) landing with a status line and heading (4-A)', () => {
    const reconstruction = [
      '取得した出典の記述から、ご質問に関係する内容をそのままお伝えします。',
      '',
      '「8月の有効求人倍率は1.18倍でした。」 [S1](https://www.nikkei.com/example)',
      '',
      '## 出典',
      '- S1: 有効求人倍率（www.nikkei.com）',
      '  https://www.nikkei.com/example',
    ].join('\n');
    const { container } = render(<OriginAnswerMarkdown language="ja" content={reconstruction} />);
    expect(container.textContent).toContain('要約した答えは作れませんでした。出典の記述で分かったことをお伝えします。');
    expect(screen.getByRole('heading', { name: '分かったこと（出典の記述）', level: 2 })).toBeTruthy();
    expect(container.textContent).toContain('8月の有効求人倍率は1.18倍でした。');
    expect(screen.getByRole('heading', { name: '出典', level: 2 })).toBeTruthy();
    // 元の導入文そのものは状態行に置き換わる。
    expect(container.textContent).not.toContain('ご質問に関係する内容をそのままお伝えします');
  });

  it('shows a publication-date line on a source card only when the card carries one (5-A)', () => {
    const withDate = [
      '公開情報を2件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。内容の詳細は各出典でご確認ください。',
      '',
      '## 確認できた範囲',
      '',
      '### S1 · mhlw.go.jp',
      '',
      '[一般職業紹介状況](https://www.mhlw.go.jp/example)',
      '',
      '公表日：2026年10月31日',
      '',
      '『有効求人倍率は1.19倍でした。』',
      '',
      '### S2 · example.org',
      '',
      '[Second source](https://example.org/b)',
    ].join('\n');
    render(<OriginAnswerMarkdown language="ja" content={withDate} />);
    expect(screen.getByText('公表日：2026年10月31日')).toBeTruthy();
    // 日付は1件だけ（S2 には付けない）。
    expect(screen.getAllByText(/^公表日：/)).toHaveLength(1);
  });
});
