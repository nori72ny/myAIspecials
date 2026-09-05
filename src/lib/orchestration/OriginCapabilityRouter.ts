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

type Signal = { capability: OriginCapability; pattern: RegExp; weight: number };

const SIGNALS: readonly Signal[] = [
  { capability: "research", pattern: /\b(research|source|sources|verify|citation|latest|compare|調査|情報源|出典|最新|比較|検証)\b/i, weight: 3 },
  { capability: "coding", pattern: /\b(code|coding|bug|debug)\b/i, weight: 3 },
  { capability: "coding", pattern: /\b(typescript|javascript|python|api|github|commit|test|build|deploy|コード|修正|バグ|実装|テスト|デプロイ)\b/i, weight: 3 },
  { capability: "writing", pattern: /\b(write|rewrite|draft|email|message|caption|文章|書いて|添削|メール|文章作成|投稿)\b/i, weight: 3 },
  { capability: "analysis", pattern: /\b(analyze|analysis|audit|review|architecture|risk|分析|監査|レビュー|設計|評価|リスク)\b/i, weight: 3 },
];

const CAPABILITIES: readonly OriginCapability[] = ["answer", "research", "coding", "writing", "analysis"];

export function selectOriginCapability(
  input: string,
  explicit?: OriginCapability,
): OriginCapabilityDecision {
  if (explicit) return { capability: explicit, reason: "explicit", confidence: "high" };

  const text = input.trim();
  if (!text) return { capability: "answer", reason: "default", confidence: "low" };

  const scores = new Map<OriginCapability, number>(CAPABILITIES.map((capability) => [capability, 0]));
  for (const signal of SIGNALS) {
    if (signal.pattern.test(text)) scores.set(signal.capability, (scores.get(signal.capability) ?? 0) + signal.weight);
  }

  const ranked = CAPABILITIES
    .map((capability, order) => ({ capability, score: scores.get(capability) ?? 0, order }))
    .sort((left, right) => right.score - left.score || left.order - right.order);
  const winner = ranked[0];
  if (!winner || winner.score === 0) return { capability: "answer", reason: "default", confidence: "low" };

  const tied = ranked.filter((item) => item.score === winner.score).length > 1;
  return {
    capability: winner.capability,
    reason: "keyword",
    confidence: tied ? "medium" : "high",
  };
}

/**
 * Deterministic, zero-cost-safe execution order for v2.
 * Provider choice remains owned by the existing zero-cost policy layer.
 */
export function capabilityExecutionOrder(
  decision: OriginCapabilityDecision,
): readonly OriginCapability[] {
  return [decision.capability, ...CAPABILITIES.filter((item) => item !== decision.capability)];
}
