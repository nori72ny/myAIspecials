import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import type { GroundedResearchConflict } from "./groundedResearchV11";
import {
  buildGroundedResearchRecordsInstruction,
  buildGroundedResearchRecordsPacket,
  buildGroundedResearchRecordsPrompt,
  checkGroundedResearchRenderedAnswer,
  evaluateGroundedResearchRecords,
  executeGroundedResearchRecordsSynthesis,
  isGroundedResearchRecordsEnabled,
  renderGroundedResearchRecordsAnswer,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-3 (design §5, §6.5, §7, §11, §14.3): records instruction/prompt,
// deterministic rendering, the post-render check, the kill switch, and
// the shared execution helper. Fixtures reuse the prime-minister /
// Pixel shapes of the R-PR-2 tests; all names/prices are fixture data.

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

function pmPacket(): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket(pmSources());
}

const PM_RECORDS_JSON = JSON.stringify({
  records: [
    { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" },
    { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" },
  ],
});

const EXPECTED_PM_RENDER = [
  "- 現在の内閣総理大臣は高市早苗です。 [S1](https://www.kantei.example.go.jp/souri/)",
  "- 2026年11月時点でも内閣総理大臣は高市早苗氏です。 [S2](https://news.example.co.jp/pm)",
  "",
  "## 出典",
  "- S1: 内閣総理大臣の指名について（kantei.example.go.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S1](https://www.kantei.example.go.jp/souri/)",
  "- S2: 首相ニュース（news.example.co.jp）／公開日: 公開日不明／取得日: 2026年11月14日 [S2](https://news.example.co.jp/pm)",
].join("\n");

describe("isGroundedResearchRecordsEnabled (design §14.3)", () => {
  it("defaults to OFF when the variable is unset", () => {
    expect(isGroundedResearchRecordsEnabled({})).toBe(false);
  });

  it("treats the disabling values as OFF, case- and space-insensitively", () => {
    for (const value of ["false", "0", "off", "no", "FALSE", " Off "]) {
      expect(isGroundedResearchRecordsEnabled({ ORIGIN_SYNTHESIS_RECORDS_ENABLED: value })).toBe(false);
    }
  });

  it("treats any other set value as ON (same interpretation as the retry switch)", () => {
    for (const value of ["true", "1", "on", "yes", "TRUE"]) {
      expect(isGroundedResearchRecordsEnabled({ ORIGIN_SYNTHESIS_RECORDS_ENABLED: value })).toBe(true);
    }
  });
});

describe("buildGroundedResearchRecordsInstruction (design §5.1)", () => {
  it("keeps the ja instruction within the design length target", () => {
    const instruction = buildGroundedResearchRecordsInstruction("ja");
    expect([...instruction].length).toBeLessThanOrEqual(1800);
  });

  it("prescribes the schema key order evidence, then quote, then text", () => {
    const instruction = buildGroundedResearchRecordsInstruction("ja");
    const schemaAt = instruction.indexOf("\"records\"");
    expect(schemaAt).toBeGreaterThanOrEqual(0);
    const evidenceAt = instruction.indexOf("\"evidence\"", schemaAt);
    const quoteAt = instruction.indexOf("\"quote\"", schemaAt);
    const textAt = instruction.indexOf("\"text\"", schemaAt);
    expect(evidenceAt).toBeGreaterThanOrEqual(0);
    expect(evidenceAt).toBeLessThan(quoteAt);
    expect(quoteAt).toBeLessThan(textAt);
  });

  it("carries the verbatim rule, the both-sides rule, and the empty-records rule", () => {
    const instruction = buildGroundedResearchRecordsInstruction("ja");
    expect(instruction).toContain("一字も変えず");
    expect(instruction).toContain("両方のレコードを出してください");
    expect(instruction).toContain("{\"records\":[]}");
    // The model never writes the answer's structure.
    expect(instruction).toContain("アプリ側が生成するため、書かないでください");
  });

  it("includes the fictional few-shot pair: a correct record and a rejected conversion", () => {
    const instruction = buildGroundedResearchRecordsInstruction("ja");
    expect(instruction).toContain("すべて架空です");
    expect(instruction).toContain("E7_1");
    expect(instruction).toContain("約12万円");
    expect(instruction).toContain("却下されます");
  });

  it("provides the en form with the same contract markers", () => {
    const instruction = buildGroundedResearchRecordsInstruction("en");
    expect(instruction).toContain("\"records\"");
    expect(instruction).toContain("verbatim");
    expect(instruction).toContain("entirely fictional");
  });
});

describe("buildGroundedResearchRecordsPrompt (design §5.2)", () => {
  it("contains the question, the E-ID unit lines, and the output contract — but no packet URL", () => {
    const prompt = buildGroundedResearchRecordsPrompt("現在の内閣総理大臣は誰ですか？", pmPacket(), [], "ja");
    expect(prompt).toContain("現在の内閣総理大臣は誰ですか？");
    expect(prompt).toContain("[E1_1] 高市早苗は、第105代内閣総理大臣に指名された。");
    expect(prompt).toContain("出力契約");
    // The model never sees a URL (design §5.2): the full packet URLs
    // must not appear anywhere in the message.
    expect(prompt).not.toContain("https://www.kantei.example.go.jp/souri/");
    expect(prompt).not.toContain("https://news.example.co.jp/pm");
    expect(prompt).not.toContain("citation_token");
  });

  it("states the no-conflict default when there are no conflict signals", () => {
    const prompt = buildGroundedResearchRecordsPrompt("質問", pmPacket(), [], "ja");
    expect(prompt).toContain("不一致シグナル");
    expect(prompt).toContain("保守的な構造化値の不一致は検出されていません");
  });

  it("renders conflict signals in the V12 form when present", () => {
    const conflict: GroundedResearchConflict = {
      kind: "structured-value-mismatch",
      topic: "price",
      values: ["124,800円", "119,800円"],
      sourceIds: ["S1", "S2"],
      note: "fixture",
    };
    const prompt = buildGroundedResearchRecordsPrompt("質問", pmPacket(), [conflict], "ja");
    expect(prompt).toContain("price: 124,800円 / 119,800円 (S1, S2)");
  });
});

describe("renderGroundedResearchRecordsAnswer (design §7)", () => {
  it("renders the adopted records deterministically, in model order, with the full source list", () => {
    const packet = pmPacket();
    const evaluation = evaluateGroundedResearchRecords(PM_RECORDS_JSON, packet);
    expect(evaluation.accepted).toHaveLength(2);
    const first = renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja");
    const second = renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja");
    expect(first).toBe(second);
    expect(first).toBe(EXPECTED_PM_RENDER);
  });

  it("lists every packet source even when only one source is cited", () => {
    const packet = pmPacket();
    const evaluation = evaluateGroundedResearchRecords(
      JSON.stringify({ records: [{ evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" }] }),
      packet,
    );
    const rendered = renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja");
    expect(rendered).toContain("- S2: 首相ニュース（news.example.co.jp）");
  });

  it("uses the packet's published-date form when a publication date exists", () => {
    const sources = pmSources();
    sources[0] = { ...sources[0], revisionTimestamp: "2026-10-01T00:00:00.000Z" };
    const packet = buildGroundedResearchRecordsPacket(sources);
    const evaluation = evaluateGroundedResearchRecords(PM_RECORDS_JSON, packet);
    const rendered = renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja");
    expect(rendered).toContain("公開日: 2026年10月1日");
  });

  it("renders the en form with ISO dates and a Sources heading", () => {
    const packet = pmPacket();
    const evaluation = evaluateGroundedResearchRecords(PM_RECORDS_JSON, packet);
    const rendered = renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "en");
    expect(rendered).toContain("## Sources");
    expect(rendered).toContain("/ Published: date unknown / Retrieved: 2026-11-14");
  });
});

describe("checkGroundedResearchRenderedAnswer (design §6.5)", () => {
  function renderedFixture() {
    const packet = pmPacket();
    const evaluation = evaluateGroundedResearchRecords(PM_RECORDS_JSON, packet);
    return {
      packet,
      accepted: evaluation.accepted,
      rendered: renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja"),
    };
  }

  it("passes on the genuinely rendered answer", () => {
    const { packet, accepted, rendered } = renderedFixture();
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, accepted)).toEqual({ ok: true });
  });

  it("fails when a body line loses its citation token", () => {
    const { packet, accepted, rendered } = renderedFixture();
    const tampered = rendered.replace(" [S1](https://www.kantei.example.go.jp/souri/)", "");
    const check = checkGroundedResearchRenderedAnswer(tampered, packet, accepted);
    expect(check).toEqual({ ok: false, code: "RENDER_CHECK_FAILED", detail: "body-line-without-packet-citation" });
  });

  it("fails when a body line cites a URL outside the packet", () => {
    const { packet, accepted, rendered } = renderedFixture();
    const tampered = rendered.replace(
      "- 現在の内閣総理大臣は高市早苗です。",
      "- 現在の内閣総理大臣は高市早苗です。[S9](https://evil.example.com/x)",
    );
    const check = checkGroundedResearchRenderedAnswer(tampered, packet, accepted);
    expect(check).toEqual({ ok: false, code: "RENDER_CHECK_FAILED", detail: "url-outside-packet" });
  });

  it("fails when a body number is not present in any adopted quote", () => {
    const { packet, accepted, rendered } = renderedFixture();
    const tampered = rendered.replace("2026年11月時点でも", "2027年3月時点でも");
    const check = checkGroundedResearchRenderedAnswer(tampered, packet, accepted);
    expect(check).toEqual({ ok: false, code: "RENDER_CHECK_FAILED", detail: "numeric-outside-quotes" });
  });
});

// --- Shared execution helper ------------------------------------------------

const fakePlan = { providerId: "openrouter", modelId: "google/gemma-4-31b-it:free" } as unknown as OriginProviderExecutionRequest["plan"];

function executionResult(text: string): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
    attempts: [{ providerId: "openrouter", modelId: "google/gemma-4-31b-it:free", outcome: "succeeded", durationMs: 1234 }],
  } as OriginProviderExecutionResult;
}

function helperOptions(overrides: Partial<Parameters<typeof executeGroundedResearchRecordsSynthesis>[1]> = {}) {
  return {
    plan: fakePlan,
    query: "現在の内閣総理大臣は誰ですか？",
    sources: pmSources(),
    language: "ja" as const,
    enabled: true,
    assertZeroCost: () => {},
    ...overrides,
  };
}

describe("executeGroundedResearchRecordsSynthesis (design §11/§12/§14.1)", () => {
  it("does not execute at all when the kill switch is off", async () => {
    const execute = vi.fn(async () => executionResult(PM_RECORDS_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ enabled: false }));
    expect(outcome.attempted).toBe(false);
    expect(outcome.adopted).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("adopts valid JSON records and returns the rendered answer with stage metrics", async () => {
    const execute = vi.fn(async (_request: OriginProviderExecutionRequest) => executionResult(PM_RECORDS_JSON));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.attempted).toBe(true);
    expect(outcome.adopted).toBe(true);
    expect(outcome.text).toBe(EXPECTED_PM_RENDER);
    expect(outcome.usedSourceIds).toEqual(["S1", "S2"]);
    expect(outcome.result?.text).toBe(PM_RECORDS_JSON);
    expect(outcome.metrics).toMatchObject({
      packetSourceCount: 2,
      executionCount: 1,
      synthesisDurationMs: 1234,
      zeroCostAsserted: true,
      formatKind: "json",
      parsedRecordCount: 2,
      acceptedRecordCount: 2,
      requiredSourceCount: 2,
      citedSourceCount: 2,
      coverageSatisfied: true,
      renderedRecordCount: 2,
      renderCheckFailed: false,
      finalForm: "records",
    });
    // Exactly one execution, with the records request: the plan is the
    // caller's, the instruction is the records instruction, and the
    // user message carries E-IDs but no packet URL.
    expect(execute).toHaveBeenCalledTimes(1);
    const request = execute.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect(request?.plan).toBe(fakePlan);
    expect(request?.systemInstruction).toBe(buildGroundedResearchRecordsInstruction("ja"));
    expect(request?.messages[0]?.content).toContain("[E1_1]");
    expect(request?.messages[0]?.content).not.toContain("https://www.kantei.example.go.jp/souri/");
  });

  it("adopts the text form as well and reports formatKind text", async () => {
    const textForm = [
      "REC",
      "E: E1_1",
      `Q: ${PM_UNIT_1}`,
      "T: 現在の内閣総理大臣は高市早苗です。",
      "END",
      "REC",
      "E: E2_1",
      `Q: ${PM2_UNIT_1}`,
      "T: 2026年11月時点でも内閣総理大臣は高市早苗氏です。",
      "END",
    ].join("\n");
    const execute = vi.fn(async () => executionResult(textForm));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics?.formatKind).toBe("text");
    expect(outcome.text).toBe(EXPECTED_PM_RENDER);
  });

  it("fails closed with NO_ACCEPTED_RECORDS when every record is rejected", async () => {
    const fabricated = JSON.stringify({
      records: [{ evidence: ["E1_1"], quote: "パケットに存在しない引用文です。", text: "現在の内閣総理大臣は高市早苗です。" }],
    });
    const execute = vi.fn(async () => executionResult(fabricated));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("NO_ACCEPTED_RECORDS");
    expect(outcome.metrics?.finalForm).toBe("partial");
    expect(outcome.metrics?.rejectionCounts.QUOTE_NOT_SUBSTRING).toBe(1);
    expect(outcome.text).toBeUndefined();
  });

  it("fails with INSUFFICIENT_SOURCE_COVERAGE when survivors cite only one of two packet sources", async () => {
    const single = JSON.stringify({
      records: [{ evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" }],
    });
    const execute = vi.fn(async () => executionResult(single));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions());
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("INSUFFICIENT_SOURCE_COVERAGE");
    expect(outcome.metrics?.acceptedRecordCount).toBe(1);
    expect(outcome.metrics?.coverageSatisfied).toBe(false);
  });

  it("spends no execution when the packet is empty (EMPTY_RECORDS_PACKET)", async () => {
    const execute = vi.fn(async () => executionResult(PM_RECORDS_JSON));
    const emptySources = pmSources().map((source) => ({ ...source, excerpt: "   " }));
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, helperOptions({ sources: emptySources }));
    expect(outcome.attempted).toBe(true);
    expect(outcome.adopted).toBe(false);
    expect(outcome.failureCode).toBe("EMPTY_RECORDS_PACKET");
    expect(outcome.metrics?.executionCount).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("lets execution errors propagate to the caller's provider-failure handling", async () => {
    const execute = vi.fn(async () => { throw new Error("provider down"); });
    await expect(executeGroundedResearchRecordsSynthesis(execute, helperOptions())).rejects.toThrow("provider down");
  });

  it("lets a $0 assertion failure propagate", async () => {
    const execute = vi.fn(async () => executionResult(PM_RECORDS_JSON));
    const options = helperOptions({ assertZeroCost: () => { throw new Error("cost violation"); } });
    await expect(executeGroundedResearchRecordsSynthesis(execute, options)).rejects.toThrow("cost violation");
  });
});
