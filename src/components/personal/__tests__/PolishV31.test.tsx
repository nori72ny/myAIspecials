// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OriginAnswerMarkdown from '../OriginAnswerMarkdown';

afterEach(cleanup);

describe('Phase 10 answer presentation', () => {
  it('keeps long answers inside the dedicated readable markdown surface', () => {
    render(<OriginAnswerMarkdown content={'# 見出し\n\n長い回答本文です。'} language="ja" />);
    const heading = screen.getByRole('heading', { name: '見出し' });
    expect(heading.closest('.origin-answer-markdown')).toBeTruthy();
  });

  it('keeps answer tables keyboard reachable through the scrollable region', () => {
    render(<OriginAnswerMarkdown content={'|A|B|\n|-|-|\n|1|2|'} language="ja" />);
    const region = screen.getByRole('region', { name: '横にスクロールできる回答表' });
    expect(region.getAttribute('tabindex')).toBe('0');
  });
});
