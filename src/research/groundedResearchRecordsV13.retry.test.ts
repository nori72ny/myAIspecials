import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import {
  buildGroundedResearchRecordsInstruction,
  executeGroundedResearchRecordsSynthesis,
  mergeGroundedResearchAcceptedRecords,
  type GroundedResearchAcceptedRecord,
} from "./groundedResearchRecordsV13";

// R-PR-5 (design §10, §11, §12): the per-record fresh retry inside
// the shared helper. The retry executor is a callback the routers
// wire; these tests pin the helper-side contract: firing conditions,
// skip reasons, per-record merge semantics, failure containment, the
// time gate, the metrics split (main fields keep the initial
// evaluation; retry output lands in the retry fields), and the
// at-most-three executions bound. Route advancement itself (which
// plan the retry executes on) is pinned in
// originRecordsRetryRoute.test.ts. Fixtures reuse the prime-minister
// shape of the R-PR-2/3/4 tests; all names are fixture data.

function makeSource(overrides: Partial<OriginResearchSource> = {}): OriginResearchSource {
  return {
    title: "Source title",
    url: "https://example.com/article",
    excerpt: "これは十分な長さの最初の文です。次も十分な長さの文です。",
    sourceType: "web-search",
    domain: "example.com",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T10:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...overrides,
  };
}

const PM_UNIT_1 = "高市早苗は、第105代内閣総理大臣に指名された。";
const PM_UNIT_2 = "内閣総理大臣は、国会の議決により指名される。";
const PM2_UNIT_1 = "2026年11月現在、内閣総理大臣は高市早苗氏である。";

function pmSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "内閣総理大臣の指名について",
      url: "https://www.kantei.example.go.jp/souri/",
      domain: "kantei.example.go.jp",
      excerpt: `${PM_UNIT_1}${PM_UNIT_2}`,
    }),
    makeSource({
      title: "首相ニュース",
      url: "https://news.example.co.jp/pm",
      domain: "news.example.co.jp",
      excerpt: `${PM2_UNIT_1}高市氏は自由民主党の総裁を務めている。`,
    }),
  ];
}

const PM_RECORDS_JSON = JSON.stringify({
  records: [
    { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
    { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" },
  ],
});

const SINGLE_RECORD_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" }],
});

const SECOND_RECORD_JSON = JSON.stringify({
  records: [{ evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" }],
});

const FABRICATED_RECORDS_JSON = JSON.stringify({
  records: [{ evidence: ["E1_1"], quote: "パケットに存在しない引用文です。", text: "現在の内閣総理大臣は高市早苗です。" }],
});

const SELECTION_JSON = "{\"select\":[\"E1_1\",\"E2_1\"]}";
const SELECTION_EMPTY_JSON = "{\"select\":[]}";

const EXPECTED_PM_RENDER = [
  "- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)",
  "- 2026年11月時点でも内閣総理大臣は高市早苗氏です。 [S2](https://news.example.co.jp/pm)",
  "",
  "## 出典",
  "- S1: 内閣総理大臣の指名について（kantei.example.go.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S1](https://www.kantei.example.go.jp/souri/)",
  "- S2: 首相ニュース（news.example.co.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S2](https://news.example.co.jp/pm)",
].join("\n");

const fakePlan = { providerId: "openrouter", modelId: "google/gemma-4-31b-it:free" } as unknown as OriginProviderExecutionRequest["plan"];

function executionResult(text: string, durationMs: number): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
    attempts: [{ providerId: "openrouter", modelId: "google/gemma-4-31b-it:free", outcome: "succeeded", durationMs }],
  } as OriginProviderExecutionResult;
}

/** The route-2 result shape the retry executor returns. */
function retryExecutionResult(text: string, durationMs?: number): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: { requestedModel: "@cf/google/gemma-4-26b-a4b-it", servedModel: "@cf/google/gemma-4-26b-a4b-it", strategy: "verified-free-failover", provider: "Cloudflare", attempt: 2, fallbackUsed: true },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
    ...(durationMs === undefined
      ? {}
      : { attempts: [{ providerId: "cloudflare-workers-ai-free", modelId: "@cf/google/gemma-4-26b-a4b-it", outcome: "succeeded", durationMs }] }),
  } as OriginProviderExecutionResult;
}

// The fixture query is deliberately NOT a single-fact-slot question
// (R-PR-6, design §9): a slot-shaped question (e.g. the prime-minister
// question the fixtures are modeled on) takes the slot branch first,
// where the fresh retry never fires (the execution-count
// adjudication). This file pins the retry contract for requests that
// reach the records stage directly; the slot branch is pinned in
// groundedResearchRecordsV13.slot.test.ts.
function helperOptions(overrides: Partial<Parameters<typeof executeGroundedResearchRecordsSynthesis>[1]> = {}) {
  return {
    plan: fakePlan,
    query: "公開情報の要点を調査してください",
    sources: pmSources(),
    language: "ja" as const,
    enabled: true,
    assertZeroCost: () => {},
    ...overrides,
  };
}

/** Routes each executor call by its instruction (records vs selection) and records the calls. */
function recordingExecute(recordsText: string, selectionText: string) {
  const calls: { request: OriginProviderExecutionRequest; result: OriginProviderExecutionResult }[] = [];
  const execute = vi.fn(async (request: OriginProviderExecutionRequest) => {
    const isRecords = request.systemInstruction === buildGroundedResearchRecordsInstruction("ja");
    const result = executionResult(isRecords ? recordsText : selectionText, isRecords ? 1234 : 555);
    calls.push({ request, result });
    return result;
  });
  return { execute, calls };
}

describe("executeGroundedResearchRecordsSynthesis fresh retry (R-PR-5)", () => {
  it("never consults the retry when the initial records are adopted", async () => {
    const { execute } = recordingExecute(PM_RECORDS_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(PM_RECORDS_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(executeRetry).not.toHaveBeenCalled();
    expect(outcome.metrics).toMatchObject({
      executionCount: 1,
      finalForm: "records",
      retryAttempted: false,
      retrySkipped: null,
      retryRouteAdvanced: false,
      retryExecutionFailed: false,
    });
  });

  it("skips as disabled when no retry callback is wired, keeping the pre-R-PR-5 flow", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      finalForm: "selection",
      selectionCode: "SELECTION_ADOPTED",
      retryAttempted: false,
      retrySkipped: "disabled",
      retryRouteAdvanced: false,
      retryExecutionFailed: false,
      retryParsedRecordCount: 0,
      retryAcceptedRecordCount: 0,
      mergedAcceptedRecordCount: 0,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("adopts the merged records after a zero-survivor first attempt, with metrics split by stage", async () => {
    const { execute, calls } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const retry = retryExecutionResult(PM_RECORDS_JSON, 777);
    const executeRetry = vi.fn(
      async (_request: OriginProviderExecutionRequest, _firstResult: OriginProviderExecutionResult) => retry,
    );
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({
      executeRetry,
      startedAtMs: 1_000,
      now: () => 2_000,
    }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_PM_RENDER);
    expect(outcome.usedSourceIds).toEqual(["S1", "S2"]);
    // The consumed result is the retry execution's.
    expect(outcome.result).toBe(retry);
    // The selection layer never ran: exactly one executor call.
    expect(execute).toHaveBeenCalledTimes(1);
    // The callback received the initial request object and result.
    expect(executeRetry).toHaveBeenCalledTimes(1);
    expect(executeRetry.mock.calls[0]?.[0]).toBe(calls[0]?.request);
    expect(executeRetry.mock.calls[0]?.[1]).toBe(calls[0]?.result);
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      finalForm: "records-after-retry",
      renderedRecordCount: 2,
      synthesisDurationMs: 1234 + 777,
      // Main stage fields keep the INITIAL evaluation.
      parsedRecordCount: 1,
      acceptedRecordCount: 0,
      rejectionCounts: { QUOTE_NOT_SUBSTRING: 1 },
      // Retry stage fields carry the retry evaluation and the merge.
      retryAttempted: true,
      retrySkipped: null,
      retryRouteAdvanced: true,
      retryExecutionFailed: false,
      retryFormatKind: "json",
      retryParsedRecordCount: 2,
      retryTotalRecordCount: 2,
      retryTruncatedRecordCount: 0,
      retryMalformedRecordCount: 0,
      retryAcceptedRecordCount: 2,
      mergedAcceptedRecordCount: 2,
      selectionAttempted: false,
      selectionCode: null,
    });
    expect(outcome.metrics?.retryRejectionCounts.QUOTE_NOT_SUBSTRING).toBe(0);
  });

  it("completes coverage by merging retry records after the initial survivors, in order", async () => {
    const { execute } = recordingExecute(SINGLE_RECORD_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(SECOND_RECORD_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_PM_RENDER);
    expect(outcome.metrics).toMatchObject({
      finalForm: "records-after-retry",
      acceptedRecordCount: 1,
      retryAcceptedRecordCount: 1,
      mergedAcceptedRecordCount: 2,
      renderedRecordCount: 2,
    });
  });

  it("drops retry records that duplicate an initial survivor (same source and quote start)", async () => {
    const { execute } = recordingExecute(SINGLE_RECORD_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(PM_RECORDS_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_PM_RENDER);
    expect(outcome.metrics).toMatchObject({
      retryParsedRecordCount: 2,
      retryAcceptedRecordCount: 2,
      mergedAcceptedRecordCount: 2,
      renderedRecordCount: 2,
    });
  });

  it("records the no-next-route skip when the callback cannot advance, then selects", async () => {
    const { execute, calls } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(
      async (_request: OriginProviderExecutionRequest, _firstResult: OriginProviderExecutionResult) => null,
    );
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      finalForm: "selection",
      retryAttempted: false,
      retrySkipped: "no-next-route",
      retryRouteAdvanced: false,
    });
    expect(executeRetry).toHaveBeenCalledTimes(1);
    expect(executeRetry.mock.calls[0]?.[0]).toBe(calls[0]?.request);
    expect(executeRetry.mock.calls[0]?.[1]).toBe(calls[0]?.result);
  });

  it("records the derivation stage when the callback reports a detailed skip (R-PR-8d)", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async () => ({
      skipDetail: "cloudflare-plan-failed:FREE_MODEL_EVIDENCE_STALE" as const,
    }));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      finalForm: "selection",
      retryAttempted: false,
      retrySkipped: "no-next-route",
      retrySkipDetail: "cloudflare-plan-failed:FREE_MODEL_EVIDENCE_STALE",
      retryRouteAdvanced: false,
    });
    expect(executeRetry).toHaveBeenCalledTimes(1);
  });

  it("leaves retrySkipDetail null for a bare-null callback and for a fired retry (R-PR-8d)", async () => {
    const bareNull = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const bareNullOutcome = await executeGroundedResearchRecordsSynthesis(
      bareNull.execute,
      helperOptions({ executeRetry: vi.fn(async () => null) }),
    );
    expect(bareNullOutcome.metrics).toMatchObject({
      retrySkipped: "no-next-route",
      retrySkipDetail: null,
    });

    const fired = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const firedOutcome = await executeGroundedResearchRecordsSynthesis(
      fired.execute,
      helperOptions({ executeRetry: vi.fn(async () => retryExecutionResult(PM_RECORDS_JSON)) }),
    );
    expect(firedOutcome.adopted).toBe(true);
    expect(firedOutcome.metrics).toMatchObject({
      finalForm: "records-after-retry",
      retryAttempted: true,
      retrySkipped: null,
      retrySkipDetail: null,
    });
  });

  it("contains a retry execution error and proceeds to the selection layer", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async (): Promise<OriginProviderExecutionResult | null> => {
      throw new Error("route 2 unavailable");
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      // The invoked retry counts as an execution even though it threw
      // (the selection layer's execution-count precedent).
      executionCount: 3,
      finalForm: "selection",
      retryAttempted: true,
      retrySkipped: null,
      retryRouteAdvanced: false,
      retryExecutionFailed: true,
    });
  });

  it("keeps the initial failure code when the retry errors and selection also fails", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_EMPTY_JSON);
    const executeRetry = vi.fn(async (): Promise<OriginProviderExecutionResult | null> => {
      throw new Error("route 2 unavailable");
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(outcome.metrics?.retryExecutionFailed).toBe(true);
    expect(outcome.metrics?.finalForm).toBe("partial");
  });

  it("contains a $0 assertion failure on the retry result (the route did advance)", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(PM_RECORDS_JSON));
    const assertZeroCost = (result: OriginProviderExecutionResult) => {
      if (result.routingEvidence.provider === "Cloudflare") throw new Error("cost unverified");
    };
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry, assertZeroCost }));
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      finalForm: "selection",
      retryAttempted: true,
      retryRouteAdvanced: true,
      retryExecutionFailed: true,
      retryParsedRecordCount: 0,
    });
  });

  it("skips on the time gate without invoking the callback", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(PM_RECORDS_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({
      executeRetry,
      startedAtMs: 0,
      now: () => 60_000,
    }));
    expect(executeRetry).not.toHaveBeenCalled();
    expect(outcome.metrics).toMatchObject({
      executionCount: 2,
      finalForm: "selection",
      retryAttempted: false,
      retrySkipped: "time-budget",
    });
  });

  it("fires at exactly the time-gate boundary (elapsed equal to the gate)", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(PM_RECORDS_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({
      executeRetry,
      startedAtMs: 0,
      now: () => 50_000,
    }));
    expect(executeRetry).toHaveBeenCalledTimes(1);
    expect(outcome.metrics?.finalForm).toBe("records-after-retry");
  });

  it("re-judges the standing failure code over the merged set", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_EMPTY_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(SINGLE_RECORD_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(false);
    // The retry produced one survivor, so the standing code is the
    // coverage verdict over the merged set, not the initial
    // zero-survivor verdict.
    expect(outcome.failureCode).toBe("INSUFFICIENT_SOURCE_COVERAGE");
    expect(outcome.metrics).toMatchObject({
      executionCount: 3,
      retryAcceptedRecordCount: 1,
      mergedAcceptedRecordCount: 1,
      selectionAttempted: true,
      selectionCode: "SELECTION_NO_UNITS",
    });
  });

  it("never exceeds three executions per request", async () => {
    const { execute } = recordingExecute(FABRICATED_RECORDS_JSON, SELECTION_EMPTY_JSON);
    const executeRetry = vi.fn(async () => retryExecutionResult(FABRICATED_RECORDS_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ executeRetry }));
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(executeRetry).toHaveBeenCalledTimes(1);
    expect(outcome.metrics).toMatchObject({
      executionCount: 3,
      finalForm: "partial",
      retryParsedRecordCount: 1,
      retryAcceptedRecordCount: 0,
      mergedAcceptedRecordCount: 0,
    });
  });
});

describe("mergeGroundedResearchAcceptedRecords (design §10)", () => {
  function accepted(text: string, sourceId: string, sourceIndex: number, quoteStart: number): GroundedResearchAcceptedRecord {
    return {
      sourceId,
      sourceIndex,
      evidenceIds: [`E${sourceIndex + 1}_1`],
      quote: `quote at ${quoteStart}`,
      text,
      quoteStart,
    };
  }

  it("keeps first-attempt order, lets the first attempt win duplicates, appends new retry records", () => {
    const first = [accepted("first-a", "S1", 0, 0), accepted("first-b", "S2", 1, 10)];
    const second = [accepted("retry-a-duplicate", "S1", 0, 0), accepted("retry-c", "S3", 2, 20)];
    const merged = mergeGroundedResearchAcceptedRecords(first, second);
    expect(merged.map((record) => record.text)).toEqual(["first-a", "first-b", "retry-c"]);
  });

  it("treats the same quote start on a different source as a different record", () => {
    const merged = mergeGroundedResearchAcceptedRecords(
      [accepted("a", "S1", 0, 0)],
      [accepted("b", "S2", 1, 0)],
    );
    expect(merged).toHaveLength(2);
  });

  it("handles empty sides", () => {
    const only = [accepted("a", "S1", 0, 0)];
    expect(mergeGroundedResearchAcceptedRecords([], only)).toEqual(only);
    expect(mergeGroundedResearchAcceptedRecords(only, [])).toEqual(only);
    expect(mergeGroundedResearchAcceptedRecords([], [])).toEqual([]);
  });
});
