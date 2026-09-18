import { describe, expect, it } from "vitest";

import {
  appendOriginAnswerQualityUsageEvent,
  createOriginAnswerQualityUsageMeter,
  readOriginAnswerQualityExecutionUsage,
} from "./OriginAnswerQualityUsageMeter";

describe("OriginAnswerQualityUsageMeter", () => {
  it("derives usage from immutable execution events", () => {
    let meter = createOriginAnswerQualityUsageMeter(1_000);
    meter = appendOriginAnswerQualityUsageEvent(meter, {
      type: "provider-execution",
      costUsd: 0,
    });
    meter = appendOriginAnswerQualityUsageEvent(meter, { type: "source-fetch" });
    meter = appendOriginAnswerQualityUsageEvent(meter, { type: "source-fetch" });
    meter = appendOriginAnswerQualityUsageEvent(meter, { type: "repair-action" });

    expect(readOriginAnswerQualityExecutionUsage(meter, 2_500)).toEqual({
      providerExecutions: 1,
      sourceFetches: 2,
      repairActions: 1,
      elapsedMs: 1_500,
      costUsd: 0,
    });
  });

  it("does not mutate prior meter snapshots", () => {
    const before = createOriginAnswerQualityUsageMeter(1_000);
    const after = appendOriginAnswerQualityUsageEvent(before, {
      type: "provider-execution",
      costUsd: 0,
    });

    expect(before.events).toHaveLength(0);
    expect(after.events).toHaveLength(1);
  });

  it("preserves non-zero provider cost so the budget can fail closed", () => {
    let meter = createOriginAnswerQualityUsageMeter(1_000);
    meter = appendOriginAnswerQualityUsageEvent(meter, {
      type: "provider-execution",
      costUsd: 0.01,
    });

    expect(readOriginAnswerQualityExecutionUsage(meter, 1_001).costUsd).toBe(0.01);
  });

  it("rejects invalid event cost and invalid time", () => {
    const meter = createOriginAnswerQualityUsageMeter(1_000);

    expect(() => appendOriginAnswerQualityUsageEvent(meter, {
      type: "provider-execution",
      costUsd: -1,
    })).toThrow("AQ_USAGE_METER_INVALID_EVENT");

    expect(() => readOriginAnswerQualityExecutionUsage(meter, 999))
      .toThrow("AQ_USAGE_METER_INVALID_TIME");
  });
});
