import type { OriginAnswerEvidenceItem } from "./OriginAnswerEnvelope.js";
import { extractExplicitOriginClaimCitations } from "./OriginClaimCitation.js";
import { bindOriginAnswerEvidenceToClaims } from "./OriginClaimEvidenceBinder.js";
import type { OriginSourceVerificationExecutor } from "./OriginSourceVerification.js";
import { executeOriginSourceVerification } from "./OriginSourceVerification.js";
import {
  extractOriginMaterialClaims,
  type OriginMaterialClaimExtractor,
} from "./OriginMaterialClaimExtractor.js";
import {
  judgeOriginAnswerQualityClaimsAgainstPrompt,
  type OriginAnswerQualityBenchmarkPromptClaimJudge,
} from "./OriginAnswerQualityBenchmarkPromptClaimJudge.js";
import {
  judgeOriginAnswerQualityBenchmarkSemantics,
  type OriginAnswerQualityBenchmarkSemanticJudge,
} from "./OriginAnswerQualityBenchmarkSemanticJudge.js";
import type {
  OriginAnswerQualityBenchmarkScoringEvidenceCollector,
} from "./OriginAnswerQualityBenchmarkSession.js";
import type {
  OriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault.js";

export interface OriginAnswerQualityBenchmarkOfficialScoringCollectorOptions {
  readonly evidenceVault: OriginAnswerQualityBenchmarkEphemeralEvidenceVault;
  readonly materialClaimExtractor: OriginMaterialClaimExtractor;
  readonly promptClaimJudge: OriginAnswerQualityBenchmarkPromptClaimJudge;
  readonly semanticJudge: OriginAnswerQualityBenchmarkSemanticJudge;
  readonly sourceVerificationExecutor: OriginSourceVerificationExecutor;
  readonly nowMs?: () => number;
  readonly maxSourceVerifications?: number;
}

const DEFAULT_MAX_SOURCE_VERIFICATIONS = 8;
const MAX_RENDERED_CITATIONS = 100;

function citationsRequired(category: string): boolean {
  return category === "current-factual" || category === "multi-source-comparison";
}

function renderedCitationCount(answerText: string): number {
  const regex = /\[[^\]\n]{1,200}\]\((https:\/\/[^)\s]{1,2000})\)/g;
  let count = 0;
  while (regex.exec(answerText) && count < MAX_RENDERED_CITATIONS) count += 1;
  return count;
}

function supportedClaimIdsFromLedger(
  evidence: readonly OriginAnswerEvidenceItem[],
  claimSet: Awaited<ReturnType<typeof extractOriginMaterialClaims>> extends { ok: true; claimSet: infer T } ? T : never,
  observedAt: string,
): Set<string> {
  const bound = bindOriginAnswerEvidenceToClaims(claimSet, evidence, observedAt);
  if (!bound.ok) throw new Error(bound.code);

  const supported = new Set<string>();
  for (const entry of bound.ledger.entries) {
    if (entry.verificationState !== "claim-supported") continue;
    for (const claimId of entry.claimIds) supported.add(claimId);
  }
  return supported;
}

function deterministicBlockedEvidence(
  item: Parameters<OriginAnswerQualityBenchmarkScoringEvidenceCollector>[0],
  execution: Parameters<OriginAnswerQualityBenchmarkScoringEvidenceCollector>[1],
) {
  const repairRequired = item.category === "coding-repair";
  const failClosedDesigned = item.category === "fail-closed";
  return {
    caseId: item.caseId,
    category: item.category,
    finalAnswerRef: execution.finalAnswerRef,
    evidenceLedgerRef: execution.evidenceLedgerRef,
    totalMaterialClaims: 0,
    supportedMaterialClaims: 0,
    totalRenderedCitations: 0,
    supportingRenderedCitations: 0,
    citationsRequired: citationsRequired(item.category),
    materialContradictionsPresent: 0,
    materialContradictionsSurfaced: 0,
    deliverableCompleted: false,
    verifierRejectedUnsupportedClaim: false,
    repairRequired,
    repairSucceeded: repairRequired ? false : undefined,
    verificationIntegrityAccurate: execution.verifierResult === "BLOCKED_UNVERIFIED",
    failClosedDesigned,
    failClosedCorrect: failClosedDesigned
      ? execution.verifierResult === "BLOCKED_UNVERIFIED"
      : undefined,
    userActionabilityScore: 0 as const,
  };
}

export function createOriginAnswerQualityBenchmarkOfficialScoringCollector(
  options: OriginAnswerQualityBenchmarkOfficialScoringCollectorOptions,
): OriginAnswerQualityBenchmarkScoringEvidenceCollector {
  const maxSourceVerifications =
    options.maxSourceVerifications ?? DEFAULT_MAX_SOURCE_VERIFICATIONS;
  if (
    !Number.isInteger(maxSourceVerifications)
    || maxSourceVerifications < 1
    || maxSourceVerifications > DEFAULT_MAX_SOURCE_VERIFICATIONS
  ) {
    throw new Error("AQ_BENCHMARK_OFFICIAL_SCORER_SOURCE_BUDGET_INVALID");
  }

  return async (item, execution) => {
    if (execution.costUsd !== 0) {
      throw new Error("AQ_BENCHMARK_OFFICIAL_SCORER_NON_ZERO_EXECUTION_COST");
    }

    if (execution.finalAnswerRef === null || execution.evidenceLedgerRef === null) {
      return deterministicBlockedEvidence(item, execution);
    }

    const ephemeral = options.evidenceVault.consume(
      item.caseId,
      execution.finalAnswerRef,
      execution.evidenceLedgerRef,
    );
    if (!ephemeral) {
      throw new Error("AQ_BENCHMARK_OFFICIAL_SCORER_EPHEMERAL_EVIDENCE_MISSING");
    }

    try {
      const extracted = await extractOriginMaterialClaims(
        ephemeral.answerText,
        options.materialClaimExtractor,
      );
      if (!extracted.ok) throw new Error(extracted.code);

      const factualClaims = extracted.claimSet.claims.filter(
        (claim) => claim.kind === "factual",
      );

      const promptSupport = await judgeOriginAnswerQualityClaimsAgainstPrompt({
        caseId: item.caseId,
        prompt: item.prompt,
        claimSet: extracted.claimSet,
      }, options.promptClaimJudge);
      if (!promptSupport.ok) throw new Error(promptSupport.code);

      const supportedClaimIds = new Set(promptSupport.value.supportedClaimIds);
      const explicitCitations = extractExplicitOriginClaimCitations(
        ephemeral.answerText,
      );
      const verifiedEvidence: OriginAnswerEvidenceItem[] = [];

      for (
        let index = 0;
        index < explicitCitations.length && index < maxSourceVerifications;
        index += 1
      ) {
        const citation = explicitCitations[index];
        const verified = await executeOriginSourceVerification({
          verificationId: `aq-${item.caseId}-citation-${index + 1}`,
          evidence: citation,
        }, options.sourceVerificationExecutor, options.nowMs?.() ?? Date.now());

        if (verified.ok) verifiedEvidence.push(verified.evidence);
      }

      const observedAt = new Date(options.nowMs?.() ?? Date.now()).toISOString();
      const citationSupportedClaimIds = supportedClaimIdsFromLedger(
        verifiedEvidence,
        extracted.claimSet,
        observedAt,
      );
      for (const claimId of citationSupportedClaimIds) {
        supportedClaimIds.add(claimId);
      }

      const factualClaimIds = new Set(factualClaims.map((claim) => claim.id));
      const supportedMaterialClaims = [...supportedClaimIds]
        .filter((claimId) => factualClaimIds.has(claimId))
        .length;
      const unsupportedMaterialClaims =
        factualClaims.length - supportedMaterialClaims;

      const semantic = await judgeOriginAnswerQualityBenchmarkSemantics({
        caseId: item.caseId,
        category: item.category,
        prompt: item.prompt,
        answerText: ephemeral.answerText,
      }, options.semanticJudge);
      if (!semantic.ok) throw new Error(semantic.code);

      const completionNeedsVerifiedExecution =
        item.category === "coding-generation"
        || item.category === "coding-repair"
        || item.category === "artifact-generation";
      const deliverableCompleted = semantic.value.deliverableCompleted
        && (!completionNeedsVerifiedExecution || execution.verifierResult === "PASS");

      const repairRequired = item.category === "coding-repair";
      const failClosedDesigned = item.category === "fail-closed";

      return {
        caseId: item.caseId,
        category: item.category,
        finalAnswerRef: execution.finalAnswerRef,
        evidenceLedgerRef: execution.evidenceLedgerRef,
        totalMaterialClaims: factualClaims.length,
        supportedMaterialClaims,
        totalRenderedCitations: renderedCitationCount(ephemeral.answerText),
        supportingRenderedCitations: verifiedEvidence.length,
        citationsRequired: citationsRequired(item.category),
        materialContradictionsPresent:
          semantic.value.materialContradictionsPresent,
        materialContradictionsSurfaced:
          semantic.value.materialContradictionsSurfaced,
        deliverableCompleted,
        verifierRejectedUnsupportedClaim:
          unsupportedMaterialClaims > 0 && execution.verifierResult !== "PASS",
        repairRequired,
        repairSucceeded: repairRequired
          ? execution.verifierResult === "PASS"
          : undefined,
        verificationIntegrityAccurate:
          semantic.value.verificationIntegrityAccurate
          && !(unsupportedMaterialClaims > 0 && execution.verifierResult === "PASS"),
        failClosedDesigned,
        failClosedCorrect: failClosedDesigned
          ? semantic.value.failClosedCorrect
          : undefined,
        userActionabilityScore: semantic.value.userActionabilityScore,
      };
    } finally {
      // The vault is consume-once. No raw answer/evidence remains reachable through
      // the collector after this case returns or fails.
    }
  };
}
