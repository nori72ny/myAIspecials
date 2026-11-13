import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import AgentLivePanel, { AgentResearchSourceCards, parseAgentResearchArtifact } from './AgentLivePanel';
import type { AgentRunView } from '../agent/agentRunClient';

afterEach(() => {
  cleanup();
});

const steps = [
  { toolName: 'web_search_grounding', params: { query: '富士山 高さ' } },
  { toolName: 'document_generator', params: { content: 'まとめてください' } },
];

const researchRunView: AgentRunView = {
  runId: 'run-1',
  status: 'running',
  goal: '富士山について調べてください',
  plan: steps,
  stepsState: [
    {
      id: 'task-1', status: 'completed', attempts: 1,
      liveDetail: {
        startedAt: 1000, finishedAt: 13000, query: '富士山 高さ',
        sources: [
          { title: '富士山の高さと登山情報', url: 'https://example.jp/fuji/', domain: 'example.jp', excerpt: '富士山は標高3,776mの日本最高峰です。' },
          { title: '富士登山オフィシャルサイト', url: 'https://example.org/tozan/', domain: 'example.org', excerpt: '開山期は7月上旬から9月上旬です。' },
        ],
      },
    },
    { id: 'task-2', status: 'running', attempts: 1, liveDetail: { startedAt: 13000 } },
  ],
};

describe('AgentLivePanel (PR-L2)', () => {
  it('renders the timeline with durations and the research frame', () => {
    render(<AgentLivePanel steps={steps} runView={researchRunView} statusHint="active" catState="working" />);
    expect(screen.getByText('いまの作業')).toBeTruthy();
    expect(screen.getByText('文書を作っています')).toBeTruthy();
    expect(screen.getByText('出典2件 · 12秒')).toBeTruthy();
    expect(screen.getByText('富士山の高さと登山情報')).toBeTruthy();
    expect(screen.getByText('https://example.jp/fuji/')).toBeTruthy();
    expect(screen.getByText('富士山は標高3,776mの日本最高峰です。')).toBeTruthy();
    expect(screen.getByText('「富士山 高さ」で調べました')).toBeTruthy();
    expect(screen.getByRole('link', { name: '原文を開く' }).getAttribute('href')).toBe('https://example.jp/fuji/');
  });

  it('switches the framed source from the other-pages list', () => {
    render(<AgentLivePanel steps={steps} runView={researchRunView} statusHint="active" catState="working" />);
    fireEvent.click(screen.getByRole('button', { name: /富士登山オフィシャルサイト/ }));
    expect(screen.getByText('開山期は7月上旬から9月上旬です。')).toBeTruthy();
    expect(screen.getByText('https://example.org/tozan/')).toBeTruthy();
    expect(screen.getByRole('link', { name: '原文を開く' }).getAttribute('href')).toBe('https://example.org/tozan/');
  });

  it('does not linkify an unsafe source URL', () => {
    const view: AgentRunView = {
      ...researchRunView,
      stepsState: [
        {
          id: 'task-1', status: 'completed', attempts: 1,
          liveDetail: { sources: [{ title: '安全でないページ', url: 'http://insecure.example/page', excerpt: '抜粋' }] },
        },
        { id: 'task-2', status: 'queued', attempts: 0 },
      ],
    };
    render(<AgentLivePanel steps={steps} runView={view} statusHint="active" catState="working" />);
    expect(screen.getByText('安全でないページ')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '原文を開く' })).toBeNull();
    expect(screen.getByText('安全なHTTPS URLとして確認できないためリンクを無効化しました。')).toBeTruthy();
  });

  it('renders steps without liveDetail as progress rows only (old records)', () => {
    const view: AgentRunView = {
      runId: 'run-old',
      status: 'completed',
      goal: 'g',
      plan: steps,
      stepsState: [
        { id: 'task-1', status: 'completed', attempts: 1 },
        { id: 'task-2', status: 'completed', attempts: 1 },
      ],
    };
    render(<AgentLivePanel steps={steps} runView={view} statusHint="completed" catState="done" />);
    expect(screen.getByText('作業が完了しました')).toBeTruthy();
    expect(screen.getByText('ウェブ調査')).toBeTruthy();
    expect(screen.queryByText('ほかに見たページ')).toBeNull();
    expect(screen.queryByRole('link', { name: '原文を開く' })).toBeNull();
  });

  it('shows the target path while a file step is current', () => {
    const fileSteps = [{ toolName: 'file_writer', params: { path: 'artifacts/request-draft.md', content: '# たたき台' } }];
    const view: AgentRunView = {
      runId: 'run-2',
      status: 'running',
      goal: 'g',
      plan: fileSteps,
      stepsState: [{ id: 'task-1', status: 'running', attempts: 1, liveDetail: { startedAt: 5000 } }],
    };
    render(<AgentLivePanel steps={fileSteps} runView={view} statusHint="active" catState="working" />);
    expect(screen.getByText('ファイルを作っています')).toBeTruthy();
    expect(screen.getByText('対象のファイル')).toBeTruthy();
    expect(screen.getByText('artifacts/request-draft.md')).toBeTruthy();
  });
});

describe('parseAgentResearchArtifact (PR-L2)', () => {
  it('parses the grounding artifact shape', () => {
    const parsed = parseAgentResearchArtifact(JSON.stringify({
      provider: 'tavily',
      sources: [
        { title: 'T', url: 'https://a.example/', domain: 'a.example', excerpt: 'E', evidenceLevel: 'extracted' },
        { title: 'broken' },
      ],
    }));
    expect(parsed?.sources).toEqual([
      { title: 'T', url: 'https://a.example/', domain: 'a.example', excerpt: 'E', evidenceLevel: 'extracted' },
    ]);
  });

  it('rejects markdown and other JSON shapes', () => {
    expect(parseAgentResearchArtifact('# 見出し\n\n本文')).toBeNull();
    expect(parseAgentResearchArtifact('{"foo": 1}')).toBeNull();
    expect(parseAgentResearchArtifact('{"provider": "tavily"}')).toBeNull();
    expect(parseAgentResearchArtifact('not json')).toBeNull();
  });
});

describe('AgentResearchSourceCards (PR-L2)', () => {
  it('renders cards with excerpts and safe links only', () => {
    render(<AgentResearchSourceCards sources={[
      { title: '安全な出典', url: 'https://example.jp/a', domain: 'example.jp', excerpt: '抜粋です。', evidenceLevel: 'extracted' },
      { title: '危険な出典', url: 'javascript:alert(1)', excerpt: 'x' },
    ]} />);
    expect(screen.getByText('安全な出典')).toBeTruthy();
    expect(screen.getByText(/本文確認済み/)).toBeTruthy();
    expect(screen.getByText('抜粋です。')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: '原文を開く' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.jp/a');
    expect(screen.getByText('安全なHTTPS URLとして確認できないためリンクを無効化しました。')).toBeTruthy();
  });
});
