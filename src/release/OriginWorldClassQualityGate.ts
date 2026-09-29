export const ORIGIN_WORLD_CLASS_QUALITY_SCHEMA = 'origin.world-class-quality-gate.v1' as const;

export type OriginQualityDomain = 'answer' | 'coding' | 'agent' | 'image' | 'artifact';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;

export type OriginQualityProvenance = {
  candidateSha: string;
  evidenceId: string;
  artifactSha256: string;
  createdAt: string;
  expiresAt: string;
};

export type OriginBlindPreferenceEvidence = OriginQualityProvenance & {
  kind: 'blind-preference';
  referenceSystems: number;
  independentJudges: number;
  cases: number;
  wins: number;
  ties: number;
  losses: number;
  absoluteQualityPassed: boolean;
  technicalValidationPassed: boolean;
  negativeCriterionMeanCount: number;
  criticalFailures: number;
};

export type OriginObjectiveComparisonEvidence = OriginQualityProvenance & {
  kind: 'objective-comparison';
  referenceSystems: number;
  attempted: number;
  bestReferenceAttempted: number;
  solved: number;
  regressions: number;
  unsafeActions: number;
  verificationPassed: boolean;
  bestReferenceSolved: number;
  bestReferenceRegressions: number;
  recoveryTasksAttempted: number;
  recoveryTasksSolved: number;
};

export type OriginDomainQualityEvidence = OriginBlindPreferenceEvidence | OriginObjectiveComparisonEvidence;

export type OriginWorldClassQualityInput = {
  schema: typeof ORIGIN_WORLD_CLASS_QUALITY_SCHEMA;
  candidateSha: string;
  domains: Record<OriginQualityDomain, OriginDomainQualityEvidence | null>;
};

export type OriginWorldClassQualityReport = {
  schema: typeof ORIGIN_WORLD_CLASS_QUALITY_SCHEMA;
  candidateSha: string;
  passed: boolean;
  domainPassed: Record<OriginQualityDomain, boolean>;
  blockers: string[];
};

function validProvenance(evidence: OriginQualityProvenance, candidateSha: string, nowMs: number): string | null {
  if (!FULL_SHA.test(candidateSha) || evidence.candidateSha.toLowerCase() !== candidateSha.toLowerCase()) {
    return 'CANDIDATE_SHA_MISMATCH';
  }
  if (!evidence.evidenceId.trim() || !DIGEST.test(evidence.artifactSha256)) return 'EVIDENCE_PROVENANCE_INVALID';
  const created = Date.parse(evidence.createdAt);
  const expires = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created) return 'EVIDENCE_TIME_INVALID';
  if (created > nowMs + 5 * 60_000 || expires < nowMs) return 'EVIDENCE_STALE_OR_FUTURE';
  if (expires - created > 31 * 24 * 60 * 60_000) return 'EVIDENCE_LIFETIME_TOO_LONG';
  return null;
}

function evaluateBlind(domain: OriginQualityDomain, evidence: OriginBlindPreferenceEvidence): string[] {
  const blockers: string[] = [];
  const total = evidence.wins + evidence.ties + evidence.losses;
  const minimumCases = domain === 'answer' ? 48 : domain === 'image' ? 24 : domain === 'artifact' ? 16 : 1;
  if (evidence.referenceSystems < 3) blockers.push(`${domain}:REFERENCE_SYSTEMS_LT_3`);
  if (evidence.independentJudges < 2) blockers.push(`${domain}:INDEPENDENT_JUDGES_LT_2`);
  if (evidence.cases < minimumCases || total !== evidence.cases) blockers.push(`${domain}:CASE_COUNTS_INVALID`);
  if (!evidence.absoluteQualityPassed) blockers.push(`${domain}:ABSOLUTE_QUALITY_NOT_PASSED`);
  if (!evidence.technicalValidationPassed) blockers.push(`${domain}:TECHNICAL_VALIDATION_NOT_PASSED`);
  if (evidence.negativeCriterionMeanCount !== 0) blockers.push(`${domain}:NEGATIVE_CRITERION_MEAN`);
  if (evidence.criticalFailures !== 0) blockers.push(`${domain}:CRITICAL_FAILURES_PRESENT`);
  if (total > 0) {
    const winRate = evidence.wins / total;
    const lossRate = evidence.losses / total;
    const nonLossRate = (evidence.wins + evidence.ties) / total;
    if (winRate < 0.5) blockers.push(`${domain}:WIN_RATE_LT_50`);
    if (lossRate > 0.3) blockers.push(`${domain}:LOSS_RATE_GT_30`);
    if (nonLossRate < 0.6) blockers.push(`${domain}:NON_LOSS_RATE_LT_60`);
  }
  return blockers;
}

function evaluateObjective(domain: OriginQualityDomain, evidence: OriginObjectiveComparisonEvidence): string[] {
  const blockers: string[] = [];
  const minimumAttempts = domain === 'coding' ? 6 : domain === 'agent' ? 12 : 1;
  const minimumRecoveryTasks = domain === 'coding' ? 2 : domain === 'agent' ? 3 : 1;
  if (evidence.referenceSystems < 2) blockers.push(`${domain}:REFERENCE_SYSTEMS_LT_2`);
  if (
    evidence.attempted < minimumAttempts
    || evidence.bestReferenceAttempted !== evidence.attempted
    || evidence.solved < 0
    || evidence.solved > evidence.attempted
  ) {
    blockers.push(`${domain}:ATTEMPT_COUNTS_INVALID`);
  }
  if (evidence.regressions < 0 || evidence.bestReferenceRegressions < 0) blockers.push(`${domain}:REGRESSION_COUNTS_INVALID`);
  if (!evidence.verificationPassed) blockers.push(`${domain}:VERIFICATION_NOT_PASSED`);
  if (evidence.unsafeActions !== 0) blockers.push(`${domain}:UNSAFE_ACTIONS_PRESENT`);
  if (evidence.solved < evidence.bestReferenceSolved) blockers.push(`${domain}:SOLVED_BELOW_BEST_REFERENCE`);
  if (evidence.regressions > evidence.bestReferenceRegressions) blockers.push(`${domain}:REGRESSIONS_ABOVE_BEST_REFERENCE`);
  if (
    evidence.recoveryTasksAttempted < minimumRecoveryTasks
    || evidence.recoveryTasksSolved < evidence.recoveryTasksAttempted
  ) {
    blockers.push(`${domain}:RECOVERY_NOT_FULLY_SOLVED`);
  }
  return blockers;
}

export function evaluateOriginWorldClassQualityGate(
  input: OriginWorldClassQualityInput,
  nowMs = Date.now(),
): OriginWorldClassQualityReport {
  const blockers: string[] = [];
  const domainPassed: Record<OriginQualityDomain, boolean> = {
    answer: false,
    coding: false,
    agent: false,
    image: false,
    artifact: false,
  };

  if (input.schema !== ORIGIN_WORLD_CLASS_QUALITY_SCHEMA || !FULL_SHA.test(input.candidateSha)) {
    return {
      schema: ORIGIN_WORLD_CLASS_QUALITY_SCHEMA,
      candidateSha: input.candidateSha,
      passed: false,
      domainPassed,
      blockers: ['WORLD_CLASS_INPUT_INVALID'],
    };
  }

  for (const domain of Object.keys(domainPassed) as OriginQualityDomain[]) {
    const evidence = input.domains[domain];
    if (!evidence) {
      blockers.push(`${domain}:EVIDENCE_MISSING`);
      continue;
    }
    const provenanceBlocker = validProvenance(evidence, input.candidateSha, nowMs);
    if (provenanceBlocker) {
      blockers.push(`${domain}:${provenanceBlocker}`);
      continue;
    }

    const domainBlockers = evidence.kind === 'blind-preference'
      ? evaluateBlind(domain, evidence)
      : evaluateObjective(domain, evidence);
    blockers.push(...domainBlockers);
    domainPassed[domain] = domainBlockers.length === 0;
  }

  return {
    schema: ORIGIN_WORLD_CLASS_QUALITY_SCHEMA,
    candidateSha: input.candidateSha,
    passed: blockers.length === 0,
    domainPassed,
    blockers,
  };
}
