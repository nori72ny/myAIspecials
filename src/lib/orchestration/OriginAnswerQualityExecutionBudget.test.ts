import { describe, expect, it } from "vitest";

import {
  checkOriginAnswerQualityExecutionBudget,
  DEFAULT_ORIGIN_AQ_EXECUTION_BUDGET,
} from "./OriginAnswerQualityExecutionBudget";

describe("OriginAnswerQualityExecutionBudget", () => {
  it("accepts a bounded zero-cost AQ execution", () => {
    expect(checkOriginAnswerQualityExecutionBudget({
      providerExecutions: 3,
      sourceFetches: 8,
      repairActions: 3,
      elapsedMs: 90_000,
      costUsd: 0,
    })).toEqual({ ok: true });
  });

  it("fails closed when provider, source, repair or time budgets are exceeded", () => {
    expect(checkOriginAnswerQualityExecutionBudget({
      providerExecutions: 4,
      sourceFetches: 0,
      repairActions: 0,
      elapsedMs: 1,
      costUsd: 0,
    })).toEqual({ ok: false, code: "AQ_PROVIDER_EXECUTION_BUDGET_EXCEEDED" });

    expect(checkOriginAnswerQualityExecutionBudget({
      providerExecutions: 0,
      sourceFetches: 9,
      repairActions: 0,
      elapsedMs: 1,
      costUsd: 0,
    })).toEqual({ ok: false, code: "AQ_SOURCE_FETCH_BUDGET_EXCEEDED" });

    expect(checkOriginAnswerQualityExecutionBudget({
      providerExecutions: 0,
      sourceFetches: 0,
      repairActions: 4,
      elapsedMs: 1,
      costUsd: 0,
    })).toEqual({ ok: false, code: "AQ_REPAIR_BUDGET_EXCEEDED" });

    expect(checkOriginAnswerQualityExecutionBudget({
      providerExecutions: 0,
      sourceFetches: 0,
      repairActions: 0,
      elapsedMs: 90_001,
      costUsd: 0,
    })).toEqual({ ok: false, code: "AQ_WALL_TIME_BUDGET_EXCEEDED" });
  });

  it("never allows any non-zero cost", () => {
    expect(checkOriginAnswerQualityExecutionBudget({
      providerExecutions: 0,
      sourceFetches: 0,
      repairActions: 0,
      elapsedMs: 1,
      costUsd: 0.000001,
    })).toEqual({ ok: false, code: "AQ_COST_BUDGET_EXCEEDED" });
  });

  it("uses conservative finite defaults", () => {
    expect(DEFAULT_ORIGIN_AQ_EXECUTION_BUDGET).toEqual({
      schemaVersion: "origin.aq-budget.v1",
      maxProviderExecutions: 3,
      maxSourceFetches: 8,
      maxRepairActions: 3,
      maxWallTimeMs: 90_000,
      maxCostUsd: 0,
    });
  });
});
