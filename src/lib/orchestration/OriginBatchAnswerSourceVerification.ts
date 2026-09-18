import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope.js";
import {
  assessOriginClaimsAgainstSourcesBatch,
  type OriginBatchClaimAssessor,
  type OriginBatchClaimAssessmentItem,
} from "./OriginBatchClaimAssessor.js";
import {
  fetchOriginPublicSource,
  type OriginPinnedFetchTransport,
} from "./OriginPublicSourceFetch.js";
import type { OriginDnsResolver } from "./OriginPublicNetworkPolicy.js";

export interface OriginBatchAnswerSourceVerificationOptions {
  readonly assessor?: OriginBatchClaimAssessor;
  readonly resolver?: OriginDnsResolver;
  readonly transport?: OriginPinnedFetchTransport;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly now?: () => number;
}

export interface OriginBatchAnswerSourceVerificationSummary {
  readonly evidence: readonly OriginAnswerEvidenceItem[];
  readonly attempted: number;
  readonly fetched: number;
  readonly verified: number;
  readonly failed: number;
  readonly assessorExecutions: number;
}

const MAX_ITEMS = 8;

function isEligible(item: OriginAnswerEvidenceItem): boolean {
  return item.evidenceLevel === "provided"
    && item.claimBinding === "explicit-inline-citation"
    && typeof item.claim === "string"
    && item.claim.trim().length > 0
    && typeof item.sourceUrl === "string"
    && item.sourceUrl.trim().length > 0
    && item.checks.safeUrl === "passed"
    && item.checks.content === "not-run"
    && item.checks.freshness === "not-run"
    && item.checks.claimSupport === "not-run";
}

export async function verifyOriginAnswerSourcesBatch(
  evidence: readonly OriginAnswerEvidenceItem[],
  options: OriginBatchAnswerSourceVerificationOptions = {},
): Promise<OriginBatchAnswerSourceVerificationSummary> {
  const eligible = evidence
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isEligible(item))
    .slice(0, MAX_ITEMS);

  if (eligible.length === 0) {
    return Object.freeze({
      evidence: Object.freeze([...evidence]),
      attempted: 0,
      fetched: 0,
      verified: 0,
      failed: 0,
      assessorExecutions: 0,
    });
  }

  const fetchResults = await Promise.all(
    eligible.map(async ({ item, index }) => {
      const result = await fetchOriginPublicSource(item.sourceUrl!, {
        resolver: options.resolver,
        transport: options.transport,
        timeoutMs: options.timeoutMs,
        maxBytes: options.maxBytes,
        now: options.now,
      });
      return { item, index, result };
    }),
  );

  const fetchedItems: OriginBatchClaimAssessmentItem[] = [];
  const fetchedIndex = new Map<string, number>();

  for (const entry of fetchResults) {
    if (!entry.result.ok) continue;

    const id = `answer-source-${entry.index + 1}`;
    fetchedItems.push({
      id,
      claim: entry.item.claim!,
      source: entry.result.value,
    });
    fetchedIndex.set(id, entry.index);
  }

  const next = [...evidence];
  let verified = 0;
  let assessorExecutions = 0;

  if (fetchedItems.length > 0 && options.assessor) {
    assessorExecutions = 1;
    const assessed = await assessOriginClaimsAgainstSourcesBatch(
      fetchedItems,
      options.assessor,
    );

    if (assessed.ok) {
      for (const output of assessed.record.items) {
        const index = fetchedIndex.get(output.id);
        if (index === undefined) continue;
        const original = next[index];

        next[index] = {
          ...original,
          evidenceLevel: "source-checked",
          checks: {
            safeUrl: "passed",
            content: "passed",
            freshness: "not-applicable",
            claimSupport: "passed",
          },
        };
        verified += 1;
      }
    }
  }

  const fetched = fetchedItems.length;
  const failed = eligible.length - verified;

  return Object.freeze({
    evidence: Object.freeze(next),
    attempted: eligible.length,
    fetched,
    verified,
    failed,
    assessorExecutions,
  });
}
