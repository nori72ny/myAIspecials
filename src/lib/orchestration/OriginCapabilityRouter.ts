/**
 * ORIGIN v2 capability routing.
 *
 * This layer selects the work capability before provider selection. It never
 * selects a paid provider/model and it never performs network I/O.
 */
export type OriginCapability =
  | "answer"
  | "research"
  | "coding"
  | "writing"
  | "analysis";

export interface OriginCapabilityDecision {
  capability: OriginCapability;
  reason: "explicit" | "keyword" | "default";
  confidence: "high" | "medium" | "low";
}

// ASCII terms use word boundaries; Japanese terms intentionally do not because
// Japanese text has no whitespace-delimited word boundaries.
const RESEARCH = /(?:\b(research|source|sources|verify|citation|latest|compare)\b|調査|情報源|出典|最新|比較|検証)/i;
const CODING = /(?:\b(code|coding|bug|debug|typescript|javascript|python|api|github|commit|test|build|deploy)\b|コード|修正|バグ|実装|テスト|デプロイ)/i;
const WRITING = /(?:\b(write|rewrite|draft|email|message|caption)\b|文章|書いて|添削|メール|文章作成|投稿)/i;
const ANALYSIS = /(?:\b(analyze|analysis|audit|review|architecture|risk)\b|分析|監査|レビュー|設計|評価|リスク)/i;

export function selectOriginCapability(
  input: string,
  explicit?: OriginCapability,
): OriginCapabilityDecision {
  if (explicit) {
    return { capability: explicit, reason: "explicit", confidence: "high" };
  }

  const text = input.trim();
  if (RESEARCH.test(text)) {
    return { capability: "research", reason: "keyword", confidence: "high" };
  }
  if (CODING.test(text)) {
    return { capability: "coding", reason: "keyword", confidence: "high" };
  }
  if (WRITING.test(text)) {
    return { capability: "writing", reason: "keyword", confidence: "high" };
  }
  if (ANALYSIS.test(text)) {
    return { capability: "analysis", reason: "keyword", confidence: "medium" };
  }

  return { capability: "answer", reason: "default", confidence: "low" };
}

/**
 * Deterministic, zero-cost-safe execution order for v2.
 * Provider choice remains owned by the existing zero-cost policy layer.
 */
export function capabilityExecutionOrder(
  decision: OriginCapabilityDecision,
): readonly OriginCapability[] {
  const rest: OriginCapability[] = ["answer", "research", "coding", "writing", "analysis"];
  return [decision.capability, ...rest.filter((item) => item !== decision.capability)];
}
