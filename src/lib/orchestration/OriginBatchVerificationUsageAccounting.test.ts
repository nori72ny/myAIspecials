import { describe, expect, it } from "vitest";

import { createOriginAnswerQualityUsageMeter, readOriginAnswerQualityExecutionUsage } from "./OriginAnswerQualityUsageMeter";
import { recordOriginBatchVerificationUsage } from "./OriginBatchVerificationUsageAccounting";

describe("OriginBatchVerificationUsageAccounting", () => {
  it("records each source fetch and one batch assessor execution", () => {
    const meter = createOriginAnswerQualityUsageMeter(1_000);
    const next = recordOriginBatchVerificationUsage(meter, {
      evidence: [],
      attempted: 3,
      fetched: 2,
      verified: 2,
      failed: 1,
      sourceFetches: 3,
      assessorExecutions: 1,
    });

    expect(readOriginAnswerQualityExecutionUsage(next, 1_500)).toEqual({
      providerExecutions: 1,
      sourceFetches: 3,
      repairActions: 0,
      elapsedMs: 500,
      costUsd: 0,
    });
  });

  it("records no provider execution when assessor did not run", () => {
    const meter = createOriginAnswerQualityUsageMeter(1_000);
    const next = recordOriginBatchVerificationUsage(meter, {
      evidence: [],
      attempted: 2,
      fetched: 0,
      verified: 0,
      failed: 2,
      sourceFetches: 0,
      assessorExecutions: 0,
    });

    expect(readOriginAnswerQualityExecutionUsage(next, 1_001)).toEqual({
      providerExecutions: 0,
      sourceFetches: 0,
      repairActions: 0,
      elapsedMs: 1,
      costUsd: 0,
    });
  });
});
