import type {
  OriginAnswerQualityBenchmarkScoringEvidenceCollector,
} from "./OriginAnswerQualityBenchmarkSession.js";
import type {
  OriginAnswerQualityBenchmarkScoringEvidence,
} from "./OriginAnswerQualityBenchmarkScoring.js";
import {
  extractExplicitOriginClaimCitations,
} from "./OriginClaimCitation.js";
import {
  extractOriginMaterialClaims,
  type OriginMaterialClaimExtractor,
} from "./OriginMaterialClaimExtractor.js";
import type {
  OriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault.js";
import {
  judgeOriginAnswerQualityBenchmarkSemantics,
  type OriginAnswerQualityBenchmarkSemanticJudge,
} from "./OriginAnswerQualityBenchmarkSemanticJudge.js";

type JsonRecord = Record<string, unknown>;

export interface OriginAnswerQualityBenchmarkOfficialScoringCollectorOptions {
  readonly evidenceVault: OriginAnswerQualityBenchmarkEphemeralEvidenceVault;
  readonly claimExtractor: OriginMaterialClaimExtractor;
  readonly semanticJudge: OriginAnswerQualityBenchmarkSemanticJudge;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface VerifiedEvidence {
  readonly claim: string;
  readonly sourceUrl: string | null;
}

function verifiedEvidenceFromArray(value: unknown): readonly VerifiedEvidence[] {
  if (!Array.isArray(value)) return [];

  const verified: VerifiedEvidence[] = [];
  for (const raw of value) {
    const item = record(raw);
    const checks = record(item?.checks);
    if (
      !item
      || typeof item.claim !== "string"
      || item.evidenceLevel !== "source-checked"
      || checks?.content !== "passed"
      || checks?.claimSupport !== "passed"
    ) continue;

    verified.push(Object.freeze({
      claim: normalizeText(item.claim),
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : null,
    }));
  }
  return verified;
}

function extractVerifiedEvidence(value: unknown): readonly VerifiedEvidence[] {
  const direct = verifiedEvidenceFromArray(value);
  if (direct.length > 0) return direct;

  const object = record(value);
  if (!object) return [];
  const chatEvidence = verifiedEvidenceFromArray(object.chatEvidence);
  if (chatEvidence.length > 0) return chatEvidence;

  return [];
}

function codingRepairSucceeded(answerText: string): boolean {
  try {
    const parsed = record(JSON.parse(answerText));
    if (!parsed) return false;
    return parsed.status === "verified";
  } catch {
    return false;
  }
}

function citationsRequired(category: string): boolean {
  return category === "current-factual" || category === "multi-source-comparison";
}

export function createOriginAnswerQualityBenchmarkOfficialScoringCollector(
  options: OriginAnswerQualityBenchmarkOfficialScoringCollectorOptions,
): OriginAnswerQualityBenchmarkScoringEvidenceCollector {
  return async (item, execution): Promise<OriginAnswerQualityBenchmarkScoringEvidence> => {
    if (!execution.finalAnswerRef || !execution.evidenceLedgerRef) {
      throw new Error("AQ_BENCHMARK_OFFICIAL_SCORING_REFS_MISSING");
    }

    const ephemeral = options.evidenceVault.consume(
      item.caseId,
      execution.finalAnswerRef,
      execution.evidenceLedgerRef,
    );
    if (!ephemeral) {
      throw new Error("AQ_BENCHMARK_OFFICIAL_SCORING_EVIDENCE_MISSING");
    }

    const extracted = await extractOriginMaterialClaims(
      ephemeral.answerText,
      options.claimExtractor,
    );
    if (!extracted.ok) {
      throw new Error(extracted.code);
    }

    const verifiedEvidence = extractVerifiedEvidence(ephemeral.evidenceJson);
    const verifiedClaims = new Set(verifiedEvidence.map((entry) => entry.claim));
    const supportedMaterialClaims = extracted.claimSet.claims.filter((claim) =>
      verifiedClaims.has(normalizeText(claim.text))
    ).length;

    const citations = extractExplicitOriginClaimCitations(ephemeral.answerText);
    const supportingRenderedCitations = citations.filter((citation) => {
      const claim = citation.claim ? normalizeText(citation.claim) : null;
      if (!claim) return false;
      return verifiedEvidence.some((entry) =>
        entry.claim === claim
        && entry.sourceUrl !== null
        && entry.sourceUrl === citation.sourceUrl
      );
    }).length;

    const deterministicEvidence = Object.freeze({
      totalMaterialClaims: extracted.claimSet.claims.length,
      supportedMaterialClaims,
      totalRenderedCitations: citations.length,
      supportingRenderedCitations,
    });

    const semantic = await judgeOriginAnswerQualityBenchmarkSemantics(
      item,
      execution,
      ephemeral.answerText,
      execution.evidenceLedgerRef,
      deterministicEvidence,
      options.semanticJudge,
    );
    if (!semantic.ok) {
      throw new Error(semantic.code);
    }

    const repairRequired = item.category === "coding-repair";
    const failClosedDesigned = item.category === "fail-closed";

    return Object.freeze({
      caseId: item.caseId,
      category: item.category,
      finalAnswerRef: execution.finalAnswerRef,
      evidenceLedgerRef: execution.evidenceLedgerRef,
      totalMaterialClaims: deterministicEvidence.totalMaterialClaims,
      supportedMaterialClaims: deterministicEvidence.supportedMaterialClaims,
      totalRenderedCitations: deterministicEvidence.totalRenderedCitations,
      supportingRenderedCitations: deterministicEvidence.supportingRenderedCitations,
      citationsRequired: citationsRequired(item.category),
      materialContradictionsPresent: semantic.value.materialContradictionsPresent,
      materialContradictionsSurfaced: semantic.value.materialContradictionsSurfaced,
      deliverableCompleted: semantic.value.deliverableCompleted,
      verifierRejectedUnsupportedClaim: semantic.value.verifierRejectedUnsupportedClaim,
      repairRequired,
      repairSucceeded: repairRequired
        ? codingRepairSucceeded(ephemeral.answerText)
        : undefined,
      verificationIntegrityAccurate: semantic.value.verificationIntegrityAccurate,
      failClosedDesigned,
      failClosedCorrect: failClosedDesigned
        ? semantic.value.failClosedCorrect
        : undefined,
      userActionabilityScore: semantic.value.userActionabilityScore,
    });
  };
}
