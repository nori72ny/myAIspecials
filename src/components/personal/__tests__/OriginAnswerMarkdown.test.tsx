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
    expect(screen.getByRole('note').textContent).toContain('外部画像は自動表示しません');
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

    for (const label of ['実務レベルに深掘り', '具体例を追加', '実行プランにする', '要点だけ']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: '実務レベルに深掘り' }));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('判断基準'));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('検証方法'));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('開発なら'));

    fireEvent.click(screen.getByRole('button', { name: '具体例を追加' }));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('仮定や例示は明示'));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('架空の事例を実績として扱わない'));

    fireEvent.click(screen.getByRole('button', { name: '実行プランにする' }));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('明確な完了条件'));
    expect(onRefine).toHaveBeenLastCalledWith(expect.stringContaining('未実施の作業を完了済みとは書かない'));
  });

  it('keeps the English deepening prompt specific to research, coding, planning, and unknowns', () => {
    const onRefine = vi.fn();
    render(<OriginAnswerMarkdown language="en" content="Answer" onRefine={onRefine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Professional depth' }));
    const prompt = String(onRefine.mock.calls[0]?.[0] ?? '');
    for (const phrase of ['decision criteria', 'verification', 'research', 'coding', 'planning', 'Do not add filler']) {
      expect(prompt).toContain(phrase);
    }
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
  it('reports clipboard rejection without claiming success', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<OriginAnswerMarkdown language="en" content="Useful answer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Select and copy'));
    expect(screen.queryByText('Copied')).toBeNull();
  });
});
