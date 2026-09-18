export type OriginAnswerQualityExecutionStage =
  | "claim-extraction"
  | "claim-coverage-review"
  | "source-verification"
  | "independent-review"
  | "repair";

export interface OriginAnswerQualityExecutionBudget {
  readonly schemaVersion: "origin.aq-budget.v1";
  readonly maxProviderExecutions: number;
  readonly maxSourceFetches: number;
  readonly maxRepairActions: number;
  readonly maxWallTimeMs: number;
  readonly maxCostUsd: 0;
}

export interface OriginAnswerQualityExecutionUsage {
  readonly providerExecutions: number;
  readonly sourceFetches: number;
  readonly repairActions: number;
  readonly elapsedMs: number;
  readonly costUsd: number;
}

export type OriginAnswerQualityBudgetCheck =
  | { ok: true }
  | {
      ok: false;
      code:
        | "AQ_PROVIDER_EXECUTION_BUDGET_EXCEEDED"
        | "AQ_SOURCE_FETCH_BUDGET_EXCEEDED"
        | "AQ_REPAIR_BUDGET_EXCEEDED"
        | "AQ_WALL_TIME_BUDGET_EXCEEDED"
        | "AQ_COST_BUDGET_EXCEEDED";
    };

export const DEFAULT_ORIGIN_AQ_EXECUTION_BUDGET: OriginAnswerQualityExecutionBudget =
  Object.freeze({
    schemaVersion: "origin.aq-budget.v1",
    maxProviderExecutions: 3,
    maxSourceFetches: 8,
    maxRepairActions: 3,
    maxWallTimeMs: 90_000,
    maxCostUsd: 0,
  });

function validCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function checkOriginAnswerQualityExecutionBudget(
  usage: OriginAnswerQualityExecutionUsage,
  budget: OriginAnswerQualityExecutionBudget = DEFAULT_ORIGIN_AQ_EXECUTION_BUDGET,
): OriginAnswerQualityBudgetCheck {
  if (
    !validCount(usage.providerExecutions)
    || !validCount(usage.sourceFetches)
    || !validCount(usage.repairActions)
    || !Number.isFinite(usage.elapsedMs)
    || usage.elapsedMs < 0
    || !Number.isFinite(usage.costUsd)
  ) {
    return { ok: false, code: "AQ_COST_BUDGET_EXCEEDED" };
  }

  if (usage.costUsd !== 0 || budget.maxCostUsd !== 0) {
    return { ok: false, code: "AQ_COST_BUDGET_EXCEEDED" };
  }

  if (usage.providerExecutions > budget.maxProviderExecutions) {
    return { ok: false, code: "AQ_PROVIDER_EXECUTION_BUDGET_EXCEEDED" };
  }

  if (usage.sourceFetches > budget.maxSourceFetches) {
    return { ok: false, code: "AQ_SOURCE_FETCH_BUDGET_EXCEEDED" };
  }

  if (usage.repairActions > budget.maxRepairActions) {
    return { ok: false, code: "AQ_REPAIR_BUDGET_EXCEEDED" };
  }

  if (usage.elapsedMs > budget.maxWallTimeMs) {
    return { ok: false, code: "AQ_WALL_TIME_BUDGET_EXCEEDED" };
  }

  return { ok: true };
}
