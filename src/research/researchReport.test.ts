// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGroundedResearch,
  isResearchReportResult,
  researchFailureMessage,
  safeExternalUrl,
} from './researchReport';

const validPayload = {
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

afterEach(() => { vi.restoreAllMocks(); });

describe('researchReport model', () => {
  it('accepts a response that satisfies the grounded free-only contract', () => {
    expect(isResearchReportResult(validPayload)).toBe(true);
  });

  it('rejects paid or fallback-tainted results fail-closed', () => {
    expect(isResearchReportResult({ ...validPayload, freeOnly: false })).toBe(false);
    expect(isResearchReportResult({ ...validPayload, costUsd: 1 })).toBe(false);
    expect(isResearchReportResult({ ...validPayload, paidFallbackUsed: true })).toBe(false);
    expect(isResearchReportResult({ ...validPayload, sourceCount: 3 })).toBe(false);
    expect(isResearchReportResult({ ...validPayload, sources: [{ id: 'S1' }] })).toBe(false);
    expect(isResearchReportResult(null)).toBe(false);
    expect(isResearchReportResult('grounded')).toBe(false);
  });

  it('only treats credential-free HTTPS URLs as safe external links', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl('http://example.com/a')).toBeNull();
    expect(safeExternalUrl('https://user:pass@example.com/a')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
  });

  it('maps failure codes to the established user-facing messages', () => {
    expect(researchFailureMessage('SENSITIVE_INPUT_BLOCKED', undefined, 'ja')).toContain('外部情報源への送信を停止');
    expect(researchFailureMessage('RESEARCH_SOURCE_CONSTRAINT_UNMET', undefined, 'ja')).toContain('無関係な出典では補完していません');
    expect(researchFailureMessage('RESEARCH_SOURCE_UNAVAILABLE', undefined, 'ja')).toContain('未確認内容で補完していません');
    expect(researchFailureMessage('INVALID_RESEARCH_QUERY', undefined, 'ja')).toBe('調査内容を1〜1200文字で入力してください。');
    expect(researchFailureMessage(undefined, undefined, 'ja')).toContain('調査を完了できませんでした');
  });

  it('returns the validated result from the research endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(validPayload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await fetchGroundedResearch('現在の公開情報を調査', 'ja');
    expect(outcome.ok === true && outcome.result.report).toContain('確認できた内容');
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe('/api/research/v1.1/query');
    expect(JSON.parse(init.body as string)).toEqual({ query: '現在の公開情報を調査' });
  });

  it('withholds a nominal success that violates the contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...validPayload, freeOnly: false, costUsd: 1, paidFallbackUsed: true, report: 'must not render' }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const outcome = await fetchGroundedResearch('query', 'ja');
    expect(outcome.ok === false && outcome.message).toContain('応答を検証できなかったため、安全に停止');
  });

  it('maps an API failure code instead of showing the raw payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'RESEARCH_SOURCE_CONSTRAINT_UNMET' }), { status: 422, headers: { 'Content-Type': 'application/json' } })));

    const outcome = await fetchGroundedResearch('Google公式ヘルプだけで説明して', 'ja');
    expect(outcome.ok === false && outcome.message).toContain('指定された公式情報源またはドメイン');
  });

  it('reports a connection failure without inventing content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));

    const outcome = await fetchGroundedResearch('query', 'ja');
    expect(outcome.ok === false && outcome.message).toContain('調査APIへ接続できませんでした');
  });

  it('lets AbortError propagate so the caller can stop silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted.', 'AbortError'); }));

    await expect(fetchGroundedResearch('query', 'ja')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
