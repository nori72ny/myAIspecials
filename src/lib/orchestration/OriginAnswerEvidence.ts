import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope";
import { normalizeOriginPublicHttpsUrl } from "./OriginPublicSourceUrl";

const MAX_EVIDENCE_ITEMS = 10;
const MAX_LABEL_LENGTH = 200;

export function extractProvidedOriginEvidence(
  content: string,
): OriginAnswerEvidenceItem[] {
  const evidence: OriginAnswerEvidenceItem[] = [];
  const seenUrls = new Set<string>();
  let cursor = 0;

  while (cursor < content.length && evidence.length < MAX_EVIDENCE_ITEMS) {
    const labelStart = content.indexOf("[", cursor);
    if (labelStart < 0) break;

    const separator = content.indexOf("](", labelStart + 1);
    if (separator < 0) break;

    const urlEnd = content.indexOf(")", separator + 2);
    if (urlEnd < 0) break;

    const label = content.slice(labelStart + 1, separator).trim();
    const sourceUrl = normalizeOriginPublicHttpsUrl(content.slice(separator + 2, urlEnd).trim());
    cursor = urlEnd + 1;

    if (
      label.length === 0
      || label.length > MAX_LABEL_LENGTH
      || label.includes("\n")
      || !sourceUrl
      || seenUrls.has(sourceUrl)
    ) continue;

    seenUrls.add(sourceUrl);
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
