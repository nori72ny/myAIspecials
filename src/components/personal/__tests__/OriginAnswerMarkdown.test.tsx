import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OriginAnswerMarkdown from '../OriginAnswerMarkdown';

afterEach(cleanup);

describe('OriginAnswerMarkdown', () => {
  it('renders a structured answer with readable semantic elements', () => {
    render(<OriginAnswerMarkdown language="ja" content={'## 結論\n\n重要な回答です。\n\n- 根拠A\n- 根拠B'} />);

    expect(screen.getByRole('heading', { name: '結論', level: 2 })).toBeTruthy();
    expect(screen.getByRole('list').children).toHaveLength(2);
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
});
