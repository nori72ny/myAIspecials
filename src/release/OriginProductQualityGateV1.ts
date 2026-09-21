export type OriginProductQualityGateBlocker =
  | "UI_EXACT_HEAD_EVIDENCE_MISSING"
  | "UI_VIEWPORT_COVERAGE_INCOMPLETE"
  | "UI_RENDER_REGRESSION"
  | "AQ_LIVE_EVIDENCE_MISSING"
  | "AQ_NOT_PROMOTION_ELIGIBLE"
  | "CODING_HELDOUT_EVIDENCE_MISSING"
  | "CODING_NOT_QUALIFIED";

export type OriginClaudeCodeParityBlocker =
  | "CLAUDE_CODE_COMPARISON_MISSING"
  | "CLAUDE_CODE_IDENTITY_MISMATCH"
  | "CLAUDE_CODE_PARITY_NOT_ESTABLISHED";

export interface OriginQualityEvidenceProvenance {
  readonly source: "github-actions" | "controlled-external";
  readonly evidenceId: string;
  readonly headSha: string;
  readonly artifactDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface OriginUiQualityEvidence {
  readonly candidateSha: string;
  readonly provenance: OriginQualityEvidenceProvenance;
  readonly exactHeadValidated: boolean;
  readonly viewportScreenshots: readonly ("mobile" | "tablet" | "desktop")[];
  readonly horizontalOverflowDetected: boolean;
  readonly accessibilityAutomationPassed: boolean;
}

export interface OriginAnswerQualityEvidence {
  readonly candidateSha: string;
  readonly provenance: OriginQualityEvidenceProvenance;
  readonly liveRunCompleted: boolean;
  readonly promotionEligible: boolean;
  readonly caseCount: number;
  readonly familyCount: number;
  readonly zeroCost: boolean;
}

export interface OriginCodingQualityEvidence {
  readonly candidateSha: string;
  readonly provenance: OriginQualityEvidenceProvenance;
  readonly heldOutRunCompleted: boolean;
  readonly qualificationPassed: boolean;
  readonly attempted: number;
  readonly solved: number;
  readonly regressionCount: number;
  readonly zeroCost: boolean;
}

export interface OriginClaudeCodeComparisonEvidence {
  readonly candidateSha: string;
  readonly provenance: OriginQualityEvidenceProvenance;
  readonly sameCorpusDigest: boolean;
  readonly sameBaseSha: boolean;
  readonly sameTimeBudget: boolean;
  readonly sameEvaluatorVersion: boolean;
  readonly originAttempted: number;
  readonly originSolved: number;
  readonly originRegressionCount: number;
  readonly claudeCodeAttempted: number;
  readonly claudeCodeSolved: number;
  readonly claudeCodeRegressionCount: number;
}

export interface OriginProductQualityGateInput {
  readonly candidateSha: string;
  readonly ui: OriginUiQualityEvidence | null;
  readonly answer: OriginAnswerQualityEvidence | null;
  readonly coding: OriginCodingQualityEvidence | null;
  readonly claudeCode: OriginClaudeCodeComparisonEvidence | null;
}

export interface OriginClaudeCodeParityGateReport {
  readonly schemaVersion: "origin.claude-code-parity-gate.v1";
  readonly candidateSha: string;
  readonly parityEstablished: boolean;
  readonly blockers: readonly OriginClaudeCodeParityBlocker[];
}

export interface OriginProductQualityGateReport {
  readonly schemaVersion: "origin.product-quality-gate.v2";
  readonly candidateSha: string;
  readonly uiPassed: boolean;
  readonly answerPassed: boolean;
  readonly codingPassed: boolean;
  readonly passed: boolean;
  readonly blockers: readonly OriginProductQualityGateBlocker[];
  readonly claudeCodeParityEstablished: boolean;
  readonly claudeCodeBlockers: readonly OriginClaudeCodeParityBlocker[];
}

function hasAllViewports(items: readonly ("mobile" | "tablet" | "desktop")[]): boolean {
  if (!Array.isArray(items)) return false;
  const set = new Set(items);
  return set.has("mobile") && set.has("tablet") && set.has("desktop");
}

function validAttemptCounts(attempted: number, solved: number, regressions: number): boolean {
  return Number.isInteger(attempted)
    && Number.isInteger(solved)
    && Number.isInteger(regressions)
    && attempted > 0
    && solved >= 0
    && solved <= attempted
    && regressions >= 0;
}

const MAX_EVIDENCE_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function validEvidenceProvenance(
  provenance: OriginQualityEvidenceProvenance | null | undefined,
  candidateSha: string,
  nowMs: number,
): boolean {
  if (!provenance) return false;
  if (!/^[a-f0-9]{40}$/.test(candidateSha) || provenance.headSha !== candidateSha) return false;
  if (provenance.source !== "github-actions" && provenance.source !== "controlled-external") return false;
  if (!/^[A-Za-z0-9._:/-]{8,180}$/.test(provenance.evidenceId)) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(provenance.artifactDigest)) return false;

  const createdAt = Date.parse(provenance.createdAt);
  const expiresAt = Date.parse(provenance.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return false;
  if (createdAt > nowMs + MAX_CLOCK_SKEW_MS) return false;
  if (expiresAt <= nowMs || expiresAt < createdAt) return false;
  if (expiresAt - createdAt > MAX_EVIDENCE_LIFETIME_MS) return false;
  return true;
}

export function evaluateOriginClaudeCodeParityGate(
  input: Pick<OriginProductQualityGateInput, "candidateSha" | "claudeCode">,
  nowMs: number = Date.now(),
): OriginClaudeCodeParityGateReport {
  const blockers: OriginClaudeCodeParityBlocker[] = [];
  let parityEstablished = false;

  if (
    !input.claudeCode
    || input.claudeCode.candidateSha !== input.candidateSha
    || !validEvidenceProvenance(input.claudeCode.provenance, input.candidateSha, nowMs)
  ) {
    blockers.push("CLAUDE_CODE_COMPARISON_MISSING");
  } else {
    const identityMatches = input.claudeCode.sameCorpusDigest === true
      && input.claudeCode.sameBaseSha === true
      && input.claudeCode.sameTimeBudget === true
      && input.claudeCode.sameEvaluatorVersion === true
      && input.claudeCode.originAttempted === input.claudeCode.claudeCodeAttempted
      && validAttemptCounts(
        input.claudeCode.originAttempted,
        input.claudeCode.originSolved,
        input.claudeCode.originRegressionCount,
      )
      && validAttemptCounts(
        input.claudeCode.claudeCodeAttempted,
        input.claudeCode.claudeCodeSolved,
        input.claudeCode.claudeCodeRegressionCount,
      );

    if (!identityMatches) {
      blockers.push("CLAUDE_CODE_IDENTITY_MISMATCH");
    } else {
      parityEstablished =
        input.claudeCode.originSolved >= input.claudeCode.claudeCodeSolved
        && input.claudeCode.originRegressionCount <= input.claudeCode.claudeCodeRegressionCount;
      if (!parityEstablished) blockers.push("CLAUDE_CODE_PARITY_NOT_ESTABLISHED");
    }
  }

  return Object.freeze({
    schemaVersion: "origin.claude-code-parity-gate.v1",
    candidateSha: input.candidateSha,
    parityEstablished,
    blockers: Object.freeze([...new Set(blockers)]),
  });
}

export function evaluateOriginProductQualityGate(
  input: OriginProductQualityGateInput,
  nowMs: number = Date.now(),
): OriginProductQualityGateReport {
  const blockers: OriginProductQualityGateBlocker[] = [];

  let uiPassed = false;
  if (
    !input.ui
    || input.ui.candidateSha !== input.candidateSha
    || !validEvidenceProvenance(input.ui.provenance, input.candidateSha, nowMs)
    || input.ui.exactHeadValidated !== true
  ) {
    blockers.push("UI_EXACT_HEAD_EVIDENCE_MISSING");
  } else {
    if (!hasAllViewports(input.ui.viewportScreenshots)) {
      blockers.push("UI_VIEWPORT_COVERAGE_INCOMPLETE");
    }
    if (input.ui.horizontalOverflowDetected !== false || input.ui.accessibilityAutomationPassed !== true) {
      blockers.push("UI_RENDER_REGRESSION");
    }
    uiPassed = hasAllViewports(input.ui.viewportScreenshots)
      && input.ui.horizontalOverflowDetected === false
      && input.ui.accessibilityAutomationPassed === true;
  }

  let answerPassed = false;
  if (
    !input.answer
    || input.answer.candidateSha !== input.candidateSha
    || !validEvidenceProvenance(input.answer.provenance, input.candidateSha, nowMs)
    || input.answer.liveRunCompleted !== true
  ) {
    blockers.push("AQ_LIVE_EVIDENCE_MISSING");
  } else {
    answerPassed = input.answer.promotionEligible === true
      && input.answer.caseCount === 40
      && input.answer.familyCount === 10
      && input.answer.zeroCost === true;
    if (!answerPassed) blockers.push("AQ_NOT_PROMOTION_ELIGIBLE");
  }

  let codingPassed = false;
  if (
    !input.coding
    || input.coding.candidateSha !== input.candidateSha
    || !validEvidenceProvenance(input.coding.provenance, input.candidateSha, nowMs)
    || input.coding.heldOutRunCompleted !== true
  ) {
    blockers.push("CODING_HELDOUT_EVIDENCE_MISSING");
  } else {
    codingPassed = input.coding.qualificationPassed === true
      && input.coding.zeroCost === true
      && validAttemptCounts(
        input.coding.attempted,
        input.coding.solved,
        input.coding.regressionCount,
      );
    if (!codingPassed) blockers.push("CODING_NOT_QUALIFIED");
  }

  const parity = evaluateOriginClaudeCodeParityGate(
    { candidateSha: input.candidateSha, claudeCode: input.claudeCode },
    nowMs,
  );

  return Object.freeze({
    schemaVersion: "origin.product-quality-gate.v2",
    candidateSha: input.candidateSha,
    uiPassed,
    answerPassed,
    codingPassed,
    passed: uiPassed && answerPassed && codingPassed,
    blockers: Object.freeze([...new Set(blockers)]),
    claudeCodeParityEstablished: parity.parityEstablished,
    claudeCodeBlockers: parity.blockers,
  });
}
