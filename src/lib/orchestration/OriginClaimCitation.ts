import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { normalizeOriginPublicHttpsUrl } from "./OriginPublicSourceUrl";
import { containsSensitiveInput } from "./SensitiveInputDetector";

const MAX_CITATIONS = 10;
const MAX_CLAIM_LENGTH = 1_000;
const MAX_LABEL_LENGTH = 200;
const CITATION_MARKERS = [
  "〔出典: [",
  "〔出典： [",
  "〔Source: [",
] as const;

function cleanClaim(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

export function extractExplicitOriginClaimCitations(
  content: string,
): OriginAnswerEvidenceItem[] {
  const citations: OriginAnswerEvidenceItem[] = [];
  const seen = new Set<string>();

  for (const line of content.split(/\r?\n/)) {
    if (citations.length >= MAX_CITATIONS) break;

    let markerIndex = -1;
    let marker = "";
    for (const candidate of CITATION_MARKERS) {
      const candidateIndex = line.indexOf(candidate);
      if (candidateIndex >= 0 && (markerIndex < 0 || candidateIndex < markerIndex)) {
        markerIndex = candidateIndex;
        marker = candidate;
      }
    }
    if (markerIndex < 0) continue;

    const claim = cleanClaim(line.slice(0, markerIndex));
    const labelStart = markerIndex + marker.length - 1;
    const separator = line.indexOf("](", labelStart + 1);
    const urlEnd = separator >= 0 ? line.indexOf(")", separator + 2) : -1;
    const blockEnd = urlEnd >= 0 ? line.indexOf("〕", urlEnd + 1) : -1;
    if (
      !claim
      || claim.length > MAX_CLAIM_LENGTH
      || containsSensitiveInput(claim)
      || separator < 0
      || urlEnd < 0
      || blockEnd !== urlEnd + 1
      || line.slice(blockEnd + 1).trim().length > 0
    ) continue;

    const label = line.slice(labelStart + 1, separator).trim();
    const sourceUrl = normalizeOriginPublicHttpsUrl(
      line.slice(separator + 2, urlEnd).trim(),
    );
    if (!label || label.length > MAX_LABEL_LENGTH || !sourceUrl) continue;

    const key = `${claim}\u0000${sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      label,
      sourceUrl,
      claim,
      claimBinding: "explicit-inline-citation",
      evidenceLevel: "provided",
      checks: {
        safeUrl: "passed",
        content: "not-run",
        freshness: "not-run",
        claimSupport: "not-run",
      },
    });
  }

  return citations;
}
