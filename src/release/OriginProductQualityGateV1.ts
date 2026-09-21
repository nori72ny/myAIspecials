export type OriginProductQualityGateBlocker =
  | "UI_EXACT_HEAD_EVIDENCE_MISSING"
  | "UI_VIEWPORT_COVERAGE_INCOMPLETE"
  | "UI_RENDER_REGRESSION"
  | "AQ_LIVE_EVIDENCE_MISSING"
  | "AQ_NOT_PROMOTION_ELIGIBLE"
  | "CODING_HELDOUT_EVIDENCE_MISSING"
  | "CODING_NOT_QUALIFIED"
  | "CLAUDE_CODE_COMPARISON_MISSING"
  | "CLAUDE_CODE_IDENTITY_MISMATCH"
  | "CLAUDE_CODE_PARITY_NOT_ESTABLISHED";

export interface OriginUiQualityEvidence {
  readonly candidateSha: string;
  readonly exactHeadValidated: boolean;
  readonly viewportScreenshots: readonly ("mobile" | "tablet" | "desktop")[];
  readonly horizontalOverflowDetected: boolean;
  readonly accessibilityAutomationPassed: boolean;
}

export interface OriginAnswerQualityEvidence {
  readonly candidateSha: string;
  readonly liveRunCompleted: boolean;
  readonly promotionEligible: boolean;
  readonly caseCount: number;
  readonly familyCount: number;
  readonly zeroCost: boolean;
}

export interface OriginCodingQualityEvidence {
  readonly candidateSha: string;
  readonly heldOutRunCompleted: boolean;
  readonly qualificationPassed: boolean;
  readonly attempted: number;
  readonly solved: number;
  readonly regressionCount: number;
  readonly zeroCost: boolean;
}

export interface OriginClaudeCodeComparisonEvidence {
  readonly candidateSha: string;
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

export interface OriginProductQualityGateReport {
  readonly schemaVersion: "origin.product-quality-gate.v1";
  readonly candidateSha: string;
  readonly uiPassed: boolean;
  readonly answerPassed: boolean;
  readonly codingPassed: boolean;
  readonly claudeCodeParityEstablished: boolean;
  readonly passed: boolean;
  readonly blockers: readonly OriginProductQualityGateBlocker[];
}

function hasAllViewports(items: readonly ("mobile" | "tablet" | "desktop")[]): boolean {
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

export function evaluateOriginProductQualityGate(
  input: OriginProductQualityGateInput,
): OriginProductQualityGateReport {
  const blockers: OriginProductQualityGateBlocker[] = [];

  let uiPassed = false;
  if (!input.ui || input.ui.candidateSha !== input.candidateSha || !input.ui.exactHeadValidated) {
    blockers.push("UI_EXACT_HEAD_EVIDENCE_MISSING");
  } else {
    if (!hasAllViewports(input.ui.viewportScreenshots)) {
      blockers.push("UI_VIEWPORT_COVERAGE_INCOMPLETE");
    }
    if (input.ui.horizontalOverflowDetected || !input.ui.accessibilityAutomationPassed) {
      blockers.push("UI_RENDER_REGRESSION");
    }
    uiPassed = hasAllViewports(input.ui.viewportScreenshots)
      && !input.ui.horizontalOverflowDetected
      && input.ui.accessibilityAutomationPassed;
  }

  let answerPassed = false;
  if (
    !input.answer
    || input.answer.candidateSha !== input.candidateSha
    || !input.answer.liveRunCompleted
  ) {
    blockers.push("AQ_LIVE_EVIDENCE_MISSING");
  } else {
    answerPassed = input.answer.promotionEligible
      && input.answer.caseCount === 40
      && input.answer.familyCount === 10
      && input.answer.zeroCost;
    if (!answerPassed) blockers.push("AQ_NOT_PROMOTION_ELIGIBLE");
  }

  let codingPassed = false;
  if (
    !input.coding
    || input.coding.candidateSha !== input.candidateSha
    || !input.coding.heldOutRunCompleted
  ) {
    blockers.push("CODING_HELDOUT_EVIDENCE_MISSING");
  } else {
    codingPassed = input.coding.qualificationPassed
      && input.coding.zeroCost
      && validAttemptCounts(
        input.coding.attempted,
        input.coding.solved,
        input.coding.regressionCount,
      );
    if (!codingPassed) blockers.push("CODING_NOT_QUALIFIED");
  }

  let claudeCodeParityEstablished = false;
  if (!input.claudeCode || input.claudeCode.candidateSha !== input.candidateSha) {
    blockers.push("CLAUDE_CODE_COMPARISON_MISSING");
  } else {
    const identityMatches = input.claudeCode.sameCorpusDigest
      && input.claudeCode.sameBaseSha
      && input.claudeCode.sameTimeBudget
      && input.claudeCode.sameEvaluatorVersion
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
      claudeCodeParityEstablished =
        input.claudeCode.originSolved >= input.claudeCode.claudeCodeSolved
        && input.claudeCode.originRegressionCount <= input.claudeCode.claudeCodeRegressionCount;
      if (!claudeCodeParityEstablished) blockers.push("CLAUDE_CODE_PARITY_NOT_ESTABLISHED");
    }
  }

  const uniqueBlockers = Object.freeze([...new Set(blockers)]);
  return Object.freeze({
    schemaVersion: "origin.product-quality-gate.v1",
    candidateSha: input.candidateSha,
    uiPassed,
    answerPassed,
    codingPassed,
    claudeCodeParityEstablished,
    passed: uiPassed && answerPassed && codingPassed && claudeCodeParityEstablished,
    blockers: uniqueBlockers,
  });
}
