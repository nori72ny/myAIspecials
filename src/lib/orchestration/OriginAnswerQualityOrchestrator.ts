import {
  decideOriginAnswerQuality,
  type OriginAnswerQualityDecision,
} from "./OriginAnswerQualityDecisionController.js";
import {
  executeOriginRepairPlan,
  type OriginRepairExecutionContext,
  type OriginRepairExecutor,
  type OriginRepairExecutionResult,
} from "./OriginRepairExecutor.js";
import { decideOriginReverificationGate } from "./OriginReverificationGate.js";
import type { OriginVerificationResult } from "./OriginVerifier.js";

export interface OriginAnswerQualityOrchestratorInput {
  readonly verification: OriginVerificationResult;
  readonly language: "ja" | "en";
  readonly independentReviewRequired: boolean;
  readonly independentReviewPerformed: boolean;
}

export interface OriginAnswerQualityOrchestratorResult {
  readonly initial: OriginAnswerQualityDecision;
  readonly repair?: OriginRepairExecutionResult;
  readonly final: OriginAnswerQualityDecision;
  readonly reverificationPerformed: boolean;
}

export interface OriginReverificationExecutor {
  (): Promise<OriginVerificationResult>;
}

export async function runOriginAnswerQualityOrchestrator(
  input: OriginAnswerQualityOrchestratorInput,
  repairExecutor: OriginRepairExecutor,
  repairContext: OriginRepairExecutionContext,
  reverify?: OriginReverificationExecutor,
): Promise<OriginAnswerQualityOrchestratorResult> {
  const initial = decideOriginAnswerQuality(input.verification, {
    language: input.language,
    independentReviewRequired: input.independentReviewRequired,
    independentReviewPerformed: input.independentReviewPerformed,
  });

  if (!initial.repairPlan.required) {
    return Object.freeze({
      initial,
      final: initial,
      reverificationPerformed: false,
    });
  }

  const repair = await executeOriginRepairPlan(
    initial.repairPlan,
    repairExecutor,
    repairContext,
  );
  const gate = decideOriginReverificationGate(input.verification, repair);

  if (gate.decision !== "REVERIFY_REQUIRED" || !reverify) {
    const blockedVerification: OriginVerificationResult = Object.freeze({
      ...input.verification,
      decision: "BLOCKED_UNVERIFIED" as const,
      issues: Object.freeze([...input.verification.issues]),
    });
    const final = decideOriginAnswerQuality(blockedVerification, {
      language: input.language,
      independentReviewRequired: input.independentReviewRequired,
      independentReviewPerformed: input.independentReviewPerformed,
    });

    return Object.freeze({
      initial,
      repair,
      final,
      reverificationPerformed: false,
    });
  }

  const reverification = await reverify();
  const final = decideOriginAnswerQuality(reverification, {
    language: input.language,
    independentReviewRequired: input.independentReviewRequired,
    independentReviewPerformed: input.independentReviewPerformed,
  });

  return Object.freeze({
    initial,
    repair,
    final,
    reverificationPerformed: true,
  });
}
