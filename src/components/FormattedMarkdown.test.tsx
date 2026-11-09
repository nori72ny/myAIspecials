// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FormattedMarkdown from './FormattedMarkdown';

afterEach(cleanup);

describe('FormattedMarkdown', () => {
  it('renders headings, bullets, numbered steps and bold instead of raw markdown', () => {
    const { container } = render(<FormattedMarkdown text={'# 調査サマリー\n\n## 要点\n- **重要**な結果です\n1. 最初の手順\n2. 次の手順\n\n通常の文です。'} />);

    expect(screen.getByRole('heading', { name: '調査サマリー' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '要点' })).toBeTruthy();
    expect(container.textContent).toContain('重要な結果です');
    expect(container.textContent).toContain('最初の手順');
    expect(container.textContent).toContain('通常の文です。');
    expect(container.textContent).not.toContain('# 調査サマリー');
    expect(container.textContent).not.toContain('**');
    expect(container.querySelector('pre')).toBeNull();
  });

  it('keeps model output inert (no HTML injection)', () => {
    const { container } = render(<FormattedMarkdown text={'<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
