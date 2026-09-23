import type { HeldOutCodingScoreV14 } from '../agent/heldOutCodingBenchmarkV14.js';
import type { HeldOutFinalEvidenceV14 } from '../agent/heldOutCodingFinalQualificationV14.js';

export const TRUSTED_CANDIDATE_CODING_QUALIFICATION_VERSION_V15 =
  'origin-trusted-candidate-coding-qualification-v1' as const;

export function deriveTrustedCandidateCodingQualificationV15(
  evidence: HeldOutFinalEvidenceV14,
  scores: readonly HeldOutCodingScoreV14[],
) {
  const taskCount = evidence.taskCount;
  const regressionCount = scores.reduce((sum, score) => sum + score.regressions.length, 0);
  const exactTaskSet = scores.length === taskCount
    && new Set(scores.map(score => score.taskId)).size === taskCount;

  const qualificationPassed = evidence.eligible === true
    && taskCount >= 6
    && evidence.attempted === taskCount
    && evidence.solved === taskCount
    && evidence.allAxesPassing === taskCount
    && evidence.totalCostUsd === 0
    && regressionCount === 0
    && exactTaskSet;

  return Object.freeze({
    schemaVersion: TRUSTED_CANDIDATE_CODING_QUALIFICATION_VERSION_V15,
    heldOutRunCompleted: evidence.attempted === taskCount && exactTaskSet,
    qualificationPassed,
    attempted: evidence.attempted,
    solved: evidence.solved,
    regressionCount,
    zeroCost: evidence.totalCostUsd === 0,
  });
}
