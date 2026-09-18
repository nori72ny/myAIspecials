import type { OriginAnswerEvidenceItem } from "../lib/orchestration/OriginAnswerEnvelope.js";
import { normalizeOriginPublicHttpsUrl } from "../lib/orchestration/OriginPublicSourceUrl.js";
import type { OriginResearchSource } from "../legacy/originResearchSource.js";

const MAX_ITEMS = 8;

export function projectResearchSourcesToAnswerEvidence(
  sources: readonly OriginResearchSource[],
): OriginAnswerEvidenceItem[] {
  const evidence: OriginAnswerEvidenceItem[] = [];

  for (const source of sources.slice(0, MAX_ITEMS)) {
    const sourceUrl = normalizeOriginPublicHttpsUrl(source.url);
    const label = source.title.trim();
    if (!sourceUrl || !label) continue;

    evidence.push({
      label,
      sourceUrl,
      evidenceLevel: "provided",
      checks: {
        safeUrl: "passed",
        content: "not-run",
        freshness: "not-run",
        claimSupport: "not-run",
      },
    });
  }

  return evidence;
}
