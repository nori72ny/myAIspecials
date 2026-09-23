import type { OriginResearchSource } from "../legacy/originResearchSource.js";

export type GroundedResearchConfidence = "strong" | "moderate" | "limited";

export type GroundedSourceAssessment = {
  id: string;
  title: string;
  url: string;
  domain: string;
  evidenceLevel: OriginResearchSource["evidenceLevel"];
  freshness: OriginResearchSource["freshness"];
  score: number;
  scoreScope: "retrieval-evidence-only";
  citation: string;
};

export type GroundedResearchConflict = {
  kind: "structured-value-mismatch";
  topic: "price" | "version" | "percentage";
  values: string[];
  sourceIds: string[];
  resolution: "unresolved" | "prefer-recent-page-verified";
  preferredSourceId?: string;
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

    const strongCandidates = [...sourceIds].filter((sourceId) => {
      const index = Number(sourceId.slice(1)) - 1;
      const source = sources[index];
      return source?.evidenceLevel === "page-verified" && source.freshness === "recent";
    });
    const uniqueStrongCandidate = strongCandidates.length === 1 ? strongCandidates[0] : undefined;
    const candidateValueCount = uniqueStrongCandidate
      ? [...values.values()].filter((ids) => ids.has(uniqueStrongCandidate)).length
      : 0;
    const preferredSourceId = uniqueStrongCandidate && candidateValueCount === 1
      ? uniqueStrongCandidate
      : undefined;

    conflicts.push({
      kind: "structured-value-mismatch",
      topic,
      values: [...values.keys()].slice(0, 8),
      sourceIds: [...sourceIds].slice(0, 8),
      resolution: preferredSourceId ? "prefer-recent-page-verified" : "unresolved",
      ...(preferredSourceId ? { preferredSourceId } : {}),
      note: preferredSourceId
        ? `${preferredSourceId} is the retrieval-evidence preference because it is the only recent, page-verified source for this mismatch. This does not establish publisher authority or factual truth.`
        : "Different structured values were retrieved. No unique recent page-verified source resolves the mismatch; publisher authority and semantic context remain unassessed.",
    });
  }
  return conflicts;
}

export function buildGroundedResearchReport(sources: OriginResearchSource[]): GroundedResearchReport {
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
      score: scoreSource(source, domainCounts.get(domain) ?? 1),
      scoreScope: "retrieval-evidence-only",
      citation: `[S${index + 1}](${source.url})`,
    };
  });

  const conflicts = detectConflicts(bounded);
  const confidence = confidenceFor(bounded);
  const evidenceLines = bounded.map((source, index) => {
    const assessment = assessments[index];
    return `### ${assessment.id}: ${source.title}\n${source.excerpt}\n\nSource: ${assessment.citation}\nEvidence: ${assessment.evidenceLevel}; freshness: ${assessment.freshness}; retrieval score: ${assessment.score}/100`;
  });
  const conflictLines = conflicts.length === 0
    ? "No conservative structured-value mismatch was detected. Semantic agreement/conflict remains unassessed."
    : conflicts.map((conflict) => {
        const preference = conflict.preferredSourceId
          ? ` · retrieval preference: ${conflict.preferredSourceId} (recent + page-verified; publisher authority unassessed)`
          : " · unresolved";
        return `- ${conflict.topic}: ${conflict.values.join(" vs ")} (${conflict.sourceIds.join(", ")})${preference}`;
      }).join("\n");

  return {
    version: "1.1",
    sourceCount: bounded.length,
    distinctDomainCount: domainCounts.size,
    confidence,
    confidenceScope: "retrieval-evidence-only",
    semanticConflictDetection: "conservative-structured-only",
    sources: assessments,
    conflicts,
    report: `# ORIGIN Grounded Research V1.1\n\nRetrieval confidence: **${confidence}**. This score evaluates retrieval evidence only, not factual truth or publisher authority.\n\n## Evidence\n\n${evidenceLines.join("\n\n")}\n\n## Conflict review\n${conflictLines}`,
  };
}
