import type { GroundedResearchReport } from "../../research/groundedResearchV11.js";
import type { OriginEvidenceLedger } from "./OriginEvidenceLedger.js";

export function deriveOriginConflictingClaimIdsFromResearch(
  report: GroundedResearchReport,
  ledger: OriginEvidenceLedger,
): readonly string[] {
  if (report.conflicts.length === 0) return Object.freeze([]);

  const sourceUrlById = new Map(
    report.sources.map((source) => [source.id, source.url]),
  );

  const conflictingUrls = new Set<string>();
  for (const conflict of report.conflicts) {
    for (const sourceId of conflict.sourceIds) {
      const url = sourceUrlById.get(sourceId);
      if (url) conflictingUrls.add(url);
    }
  }

  const urlsByClaim = new Map<string, Set<string>>();

  for (const entry of ledger.entries) {
    if (!entry.sourceUrl || !conflictingUrls.has(entry.sourceUrl)) continue;

    for (const claimId of entry.claimIds) {
      const urls = urlsByClaim.get(claimId) ?? new Set<string>();
      urls.add(entry.sourceUrl);
      urlsByClaim.set(claimId, urls);
    }
  }

  return Object.freeze(
    [...urlsByClaim.entries()]
      .filter(([, urls]) => urls.size >= 2)
      .map(([claimId]) => claimId)
      .sort(),
  );
}
