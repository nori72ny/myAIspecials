// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchWorkspaceV31 from '../ResearchWorkspaceV31';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ResearchWorkspaceV31', () => {
  it('renders grounded sources from the real research response contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
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
        report: '# ORIGIN Grounded Research V1.1',
      }),
    }));

    render(<ResearchWorkspaceV31 />);
    fireEvent.change(screen.getByLabelText('調べたいこと'), { target: { value: '現在の公開情報を調査' } });
    fireEvent.click(screen.getByRole('button', { name: '調査する' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Research summary' })).not.toBeNull());
    expect(screen.getByText('Primary source')).not.toBeNull();
    expect(screen.getByText('Second source')).not.toBeNull();
    expect(screen.getByText('確認度: Moderate')).not.toBeNull();
    expect(screen.getAllByRole('link', { name: '原文を開く' })).toHaveLength(2);
  });

  it('shows fail-closed messaging for sensitive input rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, code: 'SENSITIVE_INPUT_BLOCKED' }) }));
    render(<ResearchWorkspaceV31 />);
    fireEvent.change(screen.getByLabelText('調べたいこと'), { target: { value: 'sensitive test' } });
    fireEvent.click(screen.getByRole('button', { name: '調査する' }));

    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('外部情報源への送信を停止');
  });

  it('fails closed when a nominal success response violates the free-only result contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        version: '1.1',
        status: 'grounded',
        freeOnly: false,
        costUsd: 1,
        paidFallbackUsed: true,
        sourceCount: 1,
        distinctDomainCount: 1,
        confidence: 'limited',
        confidenceScope: 'retrieval-evidence-only',
        semanticConflictDetection: 'conservative-structured-only',
        sources: [{ id: 'S1', title: 'Unexpected', url: 'https://example.com', domain: 'example.com', evidenceLevel: 'snippet', freshness: 'unknown', score: 30, scoreScope: 'retrieval-evidence-only', citation: '[S1](https://example.com)' }],
        conflicts: [],
        report: 'must not render',
      }),
    }));

    render(<ResearchWorkspaceV31 />);
    fireEvent.change(screen.getByLabelText('調べたいこと'), { target: { value: 'query' } });
    fireEvent.click(screen.getByRole('button', { name: '調査する' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('応答を検証できなかったため、安全に停止');
    expect(screen.queryByRole('region', { name: 'Research summary' })).toBeNull();
    expect(screen.queryByText('Unexpected')).toBeNull();
  });

  it('does not expose unsafe non-HTTPS source URLs as links', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true, version: '1.1', status: 'grounded', freeOnly: true, costUsd: 0, paidFallbackUsed: false,
        sourceCount: 1, distinctDomainCount: 1, confidence: 'limited', confidenceScope: 'retrieval-evidence-only', semanticConflictDetection: 'conservative-structured-only',
        sources: [{ id: 'S1', title: 'Unsafe', url: 'http://example.com', domain: 'example.com', evidenceLevel: 'snippet', freshness: 'unknown', score: 30, scoreScope: 'retrieval-evidence-only', citation: '[S1](http://example.com)' }],
        conflicts: [], report: 'report',
      }),
    }));
    render(<ResearchWorkspaceV31 />);
    fireEvent.change(screen.getByLabelText('調べたいこと'), { target: { value: 'query' } });
    fireEvent.click(screen.getByRole('button', { name: '調査する' }));

    await screen.findByText('Unsafe');
    expect(screen.queryByRole('link', { name: '原文を開く' })).toBeNull();
    expect(screen.getByText(/HTTPS URLとして確認できない/)).not.toBeNull();
  });
});
