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
    render(<OriginAnswerMarkdown language="ja" content="生成中の回答です。" showActions={false} />);
    expect(screen.getByText('生成中の回答です。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '回答をコピー' })).toBeNull();
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
    expect(screen.getByText('『全国平均小売価格は1リットルあたり170円程度でした。』')).toBeTruthy();
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

  // K-15（2026-11-24）：モデル出力の生 <br> が文字列として見えた
  // 実働欠陥（LIVE-3、企画回答の表セル内）。許可するのは br のみ：
  // 本文では hard break に、表セルでは実際の改行要素に変える。
  // コードの中の <br> は文字列として残す。
  it('renders <br> in table cells as real line breaks, not literal text (K-15)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" showActions={false} content={'| 項目 | 内容 |\n| --- | --- |\n| 未確認点 | 理由A<br>理由B |'} />);
    const cell = container.querySelectorAll('td')[1];
    expect(cell.querySelector('br')).toBeTruthy();
    expect(cell.textContent).toBe('理由A理由B');
    expect(container.textContent).not.toContain('<br>');
  });

  it('renders escaped and variant break tags in table cells as breaks (K-15)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" showActions={false} content={'| 項目 | 内容 |\n| --- | --- |\n| x | A&lt;br&gt;B<br/>C<br />D<BR>E |'} />);
    const cell = container.querySelectorAll('td')[1];
    expect(cell.querySelectorAll('br')).toHaveLength(4);
    expect(container.textContent).not.toContain('<br');
  });

  it('keeps emphasis and breaks together in table cells (K-15)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" showActions={false} content={'| 項目 | 内容 |\n| --- | --- |\n| x | **太字**の前<br>後 |'} />);
    const cell = container.querySelectorAll('td')[1];
    expect(cell.querySelector('strong')?.textContent).toBe('太字');
    expect(cell.querySelector('br')).toBeTruthy();
  });

  it('keeps <br> literal inside code in table cells and paragraphs (K-15)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" showActions={false} content={'| 項目 | 内容 |\n| --- | --- |\n| x | `<br>` タグ |'} />);
    expect(container.querySelector('td code')?.textContent).toBe('<br>');

    const { container: para } = render(<OriginAnswerMarkdown language="ja" showActions={false} content={'タグは `<br>` です<br>次の行'} />);
    expect(para.querySelector('p code')?.textContent).toBe('<br>');
    expect(para.querySelector('p > br')).toBeTruthy();
  });

  it('renders <br> in paragraphs and list items as hard breaks (K-15)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" showActions={false} content={'1行目<br>2行目\n\n- 項目A<br>続き'} />);
    expect(container.querySelector('p > br')).toBeTruthy();
    expect(container.querySelector('li br')).toBeTruthy();
    expect(container.textContent).not.toContain('<br>');
  });

  it('keeps <br> literal inside fenced code blocks (K-15)', () => {
    const { container } = render(<OriginAnswerMarkdown language="ja" showActions={false} content={'```html\n<p>a<br>b</p>\n```'} />);
    expect(container.querySelector('code')?.textContent).toContain('<br>');
  });
});
