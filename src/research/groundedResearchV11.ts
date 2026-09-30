import type { OriginResearchSource } from "../legacy/originResearchSource.js";

export type GroundedResearchConfidence = "strong" | "moderate" | "limited";

export type GroundedSourceAssessment = {
  id: string;
  title: string;
  url: string;
  domain: string;
  evidenceLevel: OriginResearchSource["evidenceLevel"];
  freshness: OriginResearchSource["freshness"];
  sourceAuthority: NonNullable<OriginResearchSource["sourceAuthority"]>;
  score: number;
  scoreScope: "retrieval-evidence-only";
  citation: string;
};

export type GroundedResearchConflict = {
  kind: "structured-value-mismatch";
  topic: "price" | "version" | "percentage";
  values: string[];
  sourceIds: string[];
  note: string;
};

export type GroundedResearchReport = {
  version: "1.1";
  sourceCount: number;
  distinctDomainCount: number;
  confidence: GroundedResearchConfidence;
  confidenceScope: "retrieval-evidence-only";
  semanticConflictDetection: "conservative-structured-only";
  sources: GroundedSourceAssessment[];
  conflicts: GroundedResearchConflict[];
  report: string;
};

function domainOf(source: OriginResearchSource): string {
  if (source.domain) return source.domain.toLowerCase().replace(/^www\./, "");
  try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
}

function scoreSource(source: OriginResearchSource, domainOccurrenceCount: number): number {
  let score = source.evidenceLevel === "page-verified" ? 55 : 30;
  if (source.freshness === "recent") score += 15;
  else if (source.freshness === "older") score += 5;
  score += domainOccurrenceCount === 1 ? 15 : 5;
  if (source.sourceType === "encyclopedia") score += 5;
  return Math.min(score, 95);
}

function confidenceFor(sources: OriginResearchSource[]): GroundedResearchConfidence {
  const domains = new Set(sources.map(domainOf));
  const pageVerified = sources.filter((source) => source.evidenceLevel === "page-verified").length;
  const recent = sources.filter((source) => source.freshness === "recent").length;
  if (domains.size >= 3 && pageVerified >= 2 && recent >= 1) return "strong";
  if (domains.size >= 2 && (pageVerified >= 1 || recent >= 1)) return "moderate";
  return "limited";
}

function structuredValues(text: string): Array<{ topic: GroundedResearchConflict["topic"]; value: string }> {
  const values: Array<{ topic: GroundedResearchConflict["topic"]; value: string }> = [];
  const compact = text.normalize("NFKC").replace(/\s+/g, " ");
  const patterns: Array<{ topic: GroundedResearchConflict["topic"]; regex: RegExp }> = [
    { topic: "percentage", regex: /(?:率|割合|percentage|rate)[^\d]{0,24}(\d+(?:\.\d+)?%)/gi },
    { topic: "price", regex: /(?:価格|料金|price|cost)[^\d¥$€£]{0,24}([¥$€£]?\d[\d,.]*(?:円|\s?(?:usd|jpy|eur|gbp))?)/gi },
    { topic: "version", regex: /(?:バージョン|version)[^\d]{0,16}(v?\d+(?:\.\d+){0,3})/gi },
  ];
  for (const { topic, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(compact)) && values.length < 20) values.push({ topic, value: match[1].toLowerCase() });
  }
  return values;
}

function detectConflicts(sources: OriginResearchSource[]): GroundedResearchConflict[] {
  const byTopic = new Map<GroundedResearchConflict["topic"], Map<string, Set<string>>>();
  sources.forEach((source, index) => {
    const sourceId = `S${index + 1}`;
    for (const item of structuredValues(`${source.title} ${source.excerpt}`)) {
      const topic = byTopic.get(item.topic) ?? new Map<string, Set<string>>();
      const sourceIds = topic.get(item.value) ?? new Set<string>();
      sourceIds.add(sourceId);
      topic.set(item.value, sourceIds);
      byTopic.set(item.topic, topic);
    }
  });

  const conflicts: GroundedResearchConflict[] = [];
  for (const [topic, values] of byTopic) {
    if (values.size < 2) continue;
    const sourceIds = new Set<string>();
    for (const ids of values.values()) for (const id of ids) sourceIds.add(id);
    if (sourceIds.size < 2) continue;
    conflicts.push({
      kind: "structured-value-mismatch",
      topic,
      values: [...values.keys()].slice(0, 8),
      sourceIds: [...sourceIds].slice(0, 8),
      note: "Different structured values were retrieved. This is a review signal, not proof of factual contradiction.",
    });
  }
  return conflicts;
}

export function buildGroundedResearchReport(query: string, sources: OriginResearchSource[]): GroundedResearchReport {
  const bounded = sources.slice(0, 8);
  const domainCounts = new Map<string, number>();
  for (const source of bounded) {
    const domain = domainOf(source);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  const assessments = bounded.map((source, index): GroundedSourceAssessment => {
    const domain = domainOf(source);
    return {
      id: `S${index + 1}`,
      title: source.title,
      url: source.url,
      domain,
      evidenceLevel: source.evidenceLevel,
      freshness: source.freshness,
      sourceAuthority: source.sourceAuthority ?? (source.sourceType === "encyclopedia" ? "secondary-reference" : "unclassified"),
      score: scoreSource(source, domainCounts.get(domain) ?? 1),
      scoreScope: "retrieval-evidence-only",
      citation: `[S${index + 1}](${source.url})`,
    };
  });

  const conflicts = detectConflicts(bounded);
  const confidence = confidenceFor(bounded);
  const compactQuery = query.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 400);
  const summaryLines = bounded.map((source, index) => {
    const excerpt = source.excerpt.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 360);
    return `- ${excerpt} [S${index + 1}](${source.url})`;
  });
  const evidenceLines = bounded.map((source, index) => {
    const assessment = assessments[index];
    const evidenceLabel = assessment.evidenceLevel === "page-verified" ? "本文確認済み" : "検索結果の要約";
    const freshnessLabel = assessment.freshness === "recent" ? "最近" : assessment.freshness === "older" ? "古い可能性" : "不明";
    const authorityLabel = assessment.sourceAuthority === "official-domain-match"
      ? "公式ドメイン一致（ユーザー指定条件）"
      : assessment.sourceAuthority === "secondary-reference"
        ? "二次参照（百科事典）"
        : "権威性未分類";
    return `### ${assessment.id}: ${source.title}\n${source.excerpt}\n\n出典: ${assessment.citation}\n取得状態: ${evidenceLabel} / 更新時期: ${freshnessLabel} / 出典区分: ${authorityLabel} / 取得証拠スコア: ${assessment.score}/100`;
  });
  const conflictLines = conflicts.length === 0
    ? "取得した証拠から、価格・バージョン・割合の明示的な不一致は検出されませんでした。意味上の一致までは判定していません。"
    : conflicts.map((conflict) => `- ${conflict.topic}: ${conflict.values.join(" / ")} (${conflict.sourceIds.join(", ")})`).join("\n");

  return {
    version: "1.1",
    sourceCount: bounded.length,
    distinctDomainCount: domainCounts.size,
    confidence,
    confidenceScope: "retrieval-evidence-only",
    semanticConflictDetection: "conservative-structured-only",
    sources: assessments,
    conflicts,
    report: `## 確認できた内容\n\n依頼: ${compactQuery}\n\n${summaryLines.join("\n")}\n\n## 出典と取得状況\n\n${evidenceLines.join("\n\n")}\n\n## 照合メモ\n${conflictLines}\n\n※ 「公式ドメイン一致」は、ユーザーが明示した公式ソース条件とホスト名が一致したことだけを示します。内容の真偽や媒体の権威性そのものを独立検証した意味ではありません。取得証拠の強さも、質問への最終的な正しさを保証しません。`,
  };
}
