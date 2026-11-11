// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchMessageView, ResearchReaderOverlay } from '../ResearchReportView';
import type { ResearchReportResult } from '../../../research/researchReport';

const result: ResearchReportResult = {
  ok: true,
  version: '1.1',
  status: 'grounded',
  provider: 'DuckDuckGo',
  freeOnly: true,
  costUsd: 0,
  paidFallbackUsed: false,
  sourceCount: 2,
  distinctDomainCount: 2,
  confidence: 'moderate',
  confidenceScope: 'retrieval-evidence-only',
  semanticConflictDetection: 'conservative-structured-only',
  sources: [
    { id: 'S1', title: 'Primary source', url: 'https://example.com/a', domain: 'example.com', evidenceLevel: 'page-verified', freshness: 'recent', score: 85, scoreScope: 'retrieval-evidence-only', citation: '[S1](https://example.com/a)' },
    { id: 'S2', title: 'Second source', url: 'https://example.org/b', domain: 'example.org', evidenceLevel: 'snippet', freshness: 'unknown', score: 45, scoreScope: 'retrieval-evidence-only', citation: '[S2](https://example.org/b)' },
  ],
  conflicts: [],
  report: '## 確認できた内容\n- 営業時間を編集できます [S1](https://example.com/a)',
};

afterEach(() => { cleanup(); });

describe('ResearchReportView (chat-integrated research result)', () => {
  it('renders the report with validated citation links and the source section in the conversation', () => {
    render(<ResearchMessageView result={result} language="ja" onOpenReader={() => undefined} />);

    expect(screen.getByRole('heading', { name: '確認できた内容' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'S1' }).getAttribute('href')).toBe('https://example.com/a');
    expect(screen.getByText('Primary source')).toBeTruthy();
    expect(screen.getByText('Second source')).toBeTruthy();
    expect(screen.getByText('出典の確かさ: 中')).toBeTruthy();
    expect(screen.getByText(/example\.com · 最近の情報 · 本文確認済み/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '原文を開く' })).toHaveLength(2);
    // 食い違いがない場合は「出典同士の違い」のボックス自体を出さない。
    expect(screen.queryByText('出典同士の違い')).toBeNull();
    // 旧専用画面にあった内部方針の説明文は持ち込まない。
    expect(screen.queryByText(/調査の安全条件/)).toBeNull();
    expect(screen.queryByText(/有料AIへの自動切り替え/)).toBeNull();
    // 短いレポートでは全画面ボタンを出さない。
    expect(screen.queryByRole('button', { name: 'レポートを全画面で読む' })).toBeNull();
  });

  it('does not expose unsafe non-HTTPS source URLs as links', () => {
    const unsafe: ResearchReportResult = {
      ...result,
      sourceCount: 1,
      distinctDomainCount: 1,
      sources: [{ id: 'S1', title: 'Unsafe', url: 'http://example.com', domain: 'example.com', evidenceLevel: 'snippet', freshness: 'unknown', score: 30, scoreScope: 'retrieval-evidence-only', citation: '[S1](http://example.com)' }],
      report: 'report',
    };
    render(<ResearchMessageView result={unsafe} language="ja" onOpenReader={() => undefined} />);

    expect(screen.getByText('Unsafe')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '原文を開く' })).toBeNull();
    expect(screen.getByText(/HTTPS URLとして確認できない/)).toBeTruthy();
  });

  it('shows structured disagreements between sources', () => {
    const conflicted: ResearchReportResult = {
      ...result,
      conflicts: [{ kind: 'structured-value-mismatch', topic: 'price', values: ['1,000円', '1,200円'], sourceIds: ['S1', 'S2'], note: '' }],
    };
    render(<ResearchMessageView result={conflicted} language="ja" onOpenReader={() => undefined} />);

    expect(screen.getByText(/1,000円 \/ 1,200円/)).toBeTruthy();
  });

  it('truncates a long report in the conversation and offers the full-screen reader', () => {
    const longReport = ['## 要点', ...Array.from({ length: 60 }, (_, index) => `- 調査項目${index}についての確認済みの説明文です。出典に基づく内容だけを記載します。`)].join('\n');
    const onOpenReader = vi.fn();
    render(<ResearchMessageView result={{ ...result, report: longReport }} language="ja" onOpenReader={onOpenReader} />);

    expect(screen.queryByText(/調査項目59/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'レポートを全画面で読む' }));
    expect(onOpenReader).toHaveBeenCalledOnce();
  });

  it('reader overlay shows the whole report with a contents list and closes back to the chat', () => {
    const longReport = ['## 要点', '導入の文。', '## 詳細', ...Array.from({ length: 30 }, (_, index) => `- 項目${index}の説明。`)].join('\n');
    const onClose = vi.fn();
    render(<ResearchReaderOverlay result={{ ...result, report: longReport }} title="調査の依頼文" language="ja" onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: '調査レポート' });
    expect(dialog.textContent).toContain('調査の依頼文');
    expect(screen.getByRole('navigation', { name: '目次' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '詳細' })).toBeTruthy();
    expect(screen.getByText(/項目29の説明/)).toBeTruthy();
    expect(screen.getByText('Primary source')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '会話に戻る' }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
