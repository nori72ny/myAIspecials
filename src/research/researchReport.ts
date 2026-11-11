/**
 * 「詳しく調べる」（リサーチ）の結果モデル。
 *
 * 旧 ResearchWorkspaceV31（専用画面）から、結果の型・検証・取得ロジックを
 * 切り出したもの。画面構成の見直し（2026-11-09、オーナー承認）で
 * リサーチはチャット内のモードになったため、結果は会話メッセージに
 * 保持され、履歴にも保存される。調査 API（/api/research/v1.1/query）と
 * その無料・出典グラウンディングの契約は従来どおりで、ここは
 * 「見せ方」のためのモデル層に徹する。
 *
 * 検証はフェイルクローズド：無料条件（freeOnly / costUsd 0 /
 * paidFallbackUsed false）や出典の形が契約と少しでも食い違えば、
 * 結果として認めず表示しない。
 */

import { isResearchProviderName, type ResearchProviderName } from './researchProviderVocabulary';

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  evidenceLevel: 'snippet' | 'page-verified';
  freshness: 'recent' | 'older' | 'unknown';
  score: number;
  scoreScope: 'retrieval-evidence-only';
  citation: string;
};

export type ResearchConflict = {
  kind: 'structured-value-mismatch';
  topic: 'price' | 'version' | 'percentage';
  values: string[];
  sourceIds: string[];
  note: string;
};

export type ResearchReportResult = {
  ok: true;
  version: '1.1';
  status: 'grounded';
  provider?: ResearchProviderName;
  freeOnly: true;
  costUsd: 0;
  paidFallbackUsed: false;
  sourceCount: number;
  distinctDomainCount: number;
  confidence: 'strong' | 'moderate' | 'limited';
  confidenceScope: 'retrieval-evidence-only';
  semanticConflictDetection: 'conservative-structured-only';
  sources: ResearchSource[];
  conflicts: ResearchConflict[];
  report: string;
};

export type ResearchFailure = {
  ok?: false;
  code?: string;
  message?: string;
};

export type ResearchLanguage = 'ja' | 'en';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function isResearchSource(value: unknown): value is ResearchSource {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.url === 'string'
    && typeof value.domain === 'string'
    && (value.evidenceLevel === 'snippet' || value.evidenceLevel === 'page-verified')
    && (value.freshness === 'recent' || value.freshness === 'older' || value.freshness === 'unknown')
    && typeof value.score === 'number'
    && Number.isFinite(value.score)
    && value.score >= 0
    && value.score <= 100
    && value.scoreScope === 'retrieval-evidence-only'
    && typeof value.citation === 'string';
}

export function isResearchConflict(value: unknown): value is ResearchConflict {
  if (!isRecord(value)) return false;
  return value.kind === 'structured-value-mismatch'
    && (value.topic === 'price' || value.topic === 'version' || value.topic === 'percentage')
    && isStringArray(value.values)
    && isStringArray(value.sourceIds)
    && typeof value.note === 'string';
}

export function isResearchReportResult(value: unknown): value is ResearchReportResult {
  if (!isRecord(value) || !Array.isArray(value.sources) || !Array.isArray(value.conflicts)) return false;
  const providerValid = value.provider === undefined || isResearchProviderName(value.provider);
  const confidenceValid = value.confidence === 'strong' || value.confidence === 'moderate' || value.confidence === 'limited';
  return value.ok === true
    && value.version === '1.1'
    && value.status === 'grounded'
    && providerValid
    && value.freeOnly === true
    && value.costUsd === 0
    && value.paidFallbackUsed === false
    && Number.isInteger(value.sourceCount)
    && (value.sourceCount as number) >= 1
    && Number.isInteger(value.distinctDomainCount)
    && (value.distinctDomainCount as number) >= 1
    && (value.distinctDomainCount as number) <= (value.sourceCount as number)
    && value.sourceCount === value.sources.length
    && confidenceValid
    && value.confidenceScope === 'retrieval-evidence-only'
    && value.semanticConflictDetection === 'conservative-structured-only'
    && value.sources.every(isResearchSource)
    && value.conflicts.every(isResearchConflict)
    && typeof value.report === 'string';
}

export function researchFailureFrom(value: unknown): ResearchFailure {
  if (!isRecord(value)) return {};
  return {
    ok: value.ok === false ? false : undefined,
    code: typeof value.code === 'string' ? value.code : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  };
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function researchConflictTopicLabel(topic: string, language: ResearchLanguage): string {
  if (language === 'en') {
    if (topic === 'price') return 'Price';
    if (topic === 'version') return 'Version';
    if (topic === 'percentage') return 'Percentage';
    return topic;
  }
  if (topic === 'price') return '価格';
  if (topic === 'version') return 'バージョン';
  if (topic === 'percentage') return '割合';
  return topic;
}

export function researchConfidenceLabel(value: ResearchReportResult['confidence'], language: ResearchLanguage): string {
  if (language === 'en') {
    if (value === 'strong') return 'High';
    if (value === 'moderate') return 'Moderate';
    return 'Limited';
  }
  if (value === 'strong') return '高';
  if (value === 'moderate') return '中';
  return '限定的';
}

export function researchFailureMessage(code: string | undefined, message: string | undefined, language: ResearchLanguage): string {
  if (language === 'en') {
    if (code === 'SENSITIVE_INPUT_BLOCKED') return 'The request may contain sensitive information, so nothing was sent to external sources.';
    if (code === 'RESEARCH_SOURCE_CONSTRAINT_UNMET') return 'No supporting evidence could be confirmed from the specified official sources or domains. Unrelated sources were not used as a substitute.';
    if (code === 'RESEARCH_SOURCE_UNAVAILABLE') return 'No verifiable information related to the question could be obtained from free public sources. Nothing unconfirmed was filled in.';
    if (code === 'INVALID_RESEARCH_QUERY') return 'Enter a research question of 1–1200 characters.';
    return message || 'The research could not be completed. Nothing unconfirmed is shown.';
  }
  if (code === 'SENSITIVE_INPUT_BLOCKED') return '機微情報の可能性があるため、外部情報源への送信を停止しました。';
  if (code === 'RESEARCH_SOURCE_CONSTRAINT_UNMET') return '指定された公式情報源またはドメインから、質問に関連する根拠を確認できませんでした。無関係な出典では補完していません。';
  if (code === 'RESEARCH_SOURCE_UNAVAILABLE') return '無料の公開情報源から質問に関連する確認可能な情報を取得できませんでした。未確認内容で補完していません。';
  if (code === 'INVALID_RESEARCH_QUERY') return '調査内容を1〜1200文字で入力してください。';
  return message || '調査を完了できませんでした。確認できていない内容は表示していません。';
}

export type GroundedResearchOutcome =
  | { ok: true; result: ResearchReportResult }
  | { ok: false; message: string };

/**
 * 調査 API を呼び、応答を契約どおり検証して返す。検証に失敗した応答は
 * 結果として扱わない（フェイルクローズド）。AbortError は呼び出し側の
 * 停止処理に委ねるため、そのまま投げる。
 */
export async function fetchGroundedResearch(query: string, language: ResearchLanguage, signal?: AbortSignal): Promise<GroundedResearchOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/research/v1.1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    });
  } catch (error) {
    if ((error as DOMException | null)?.name === 'AbortError') throw error;
    return { ok: false, message: language === 'en' ? 'Could not reach the research service. Nothing unconfirmed was filled in.' : '調査APIへ接続できませんでした。未確認内容で補完していません。' };
  }
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const failure = researchFailureFrom(data);
    return { ok: false, message: researchFailureMessage(failure.code, failure.message, language) };
  }
  if (!isResearchReportResult(data)) {
    return { ok: false, message: language === 'en' ? 'The research response could not be verified, so it was withheld for safety. Nothing unconfirmed is shown.' : '調査APIの応答を検証できなかったため、安全に停止しました。未確認内容は表示していません。' };
  }
  return { ok: true, result: data };
}
