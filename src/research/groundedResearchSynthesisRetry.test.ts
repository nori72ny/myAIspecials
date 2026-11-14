import { describe, expect, it, vi } from "vitest";
import type { OriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  adoptGroundedResearchSynthesis,
  buildGroundedResearchSynthesisInstruction,
  executeGroundedResearchSynthesisWithRetry,
  isGroundedResearchSynthesisRetryEnabled,
  scanGroundedResearchSynthesisFeedbackMaterial,
  GROUNDED_RESEARCH_SYNTHESIS_RETRY_TIME_GATE_MS,
  type GroundedResearchSynthesisRetryOptions,
} from "./groundedResearchSynthesisV12";

/**
 * Permanent fixtures for the feedback retry
 * (SYNTHESIS_RETRY_DESIGN_2026-11-14 §2): one corrective retry — scan-based
 * rejection reasons only, WITHOUT the failed synthesis itself — between the
 * unchanged adoption gate (validator + salvage) and the partial-answer
 * fallback. The gate itself is never modified by the retry. (The original
 * Method B handed the failed text back as a draft to correct; production
 * measurement showed the "corrected" draft returning worse, so the draft
 * was removed and the model now rewrites from scratch.)
 */

function source(partial: Partial<OriginResearchSource> & Pick<OriginResearchSource, "title" | "url" | "excerpt">): OriginResearchSource {
  return {
    sourceType: "web-search",
    domain: new URL(partial.url).hostname,
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-14T03:00:00.000Z",
    freshness: "recent",
    sourceAuthority: "unclassified",
    ...partial,
  };
}

const priceSources: OriginResearchSource[] = [
  source({ title: "料金資料1", url: "https://example.com/one", excerpt: "料金は100円と記載されています。" }),
  source({ title: "料金資料2", url: "https://example.org/two", excerpt: "別資料では料金は120円と記載されています。" }),
];

function executionResult(text: string): OriginProviderExecutionResult {
  return {
    text,
    transportRequestCount: 1,
    actualCostUsd: 0,
    providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
    routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary", provider: "OpenRouter", attempt: 1, fallbackUsed: false },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 },
  };
}

// The retry helper treats the plan opaquely (it reuses the reference), so
// the fixture pins only the fields a reader needs to recognise it.
const initialRequest: OriginProviderExecutionRequest = {
  plan: { providerLabel: "ORIGIN 無料AI", modelId: "google/gemma-4-31b-it:free" } as unknown as OriginExecutionPlan,
  messages: [{ role: "user", content: "ユーザーの質問\n\n信頼できない証拠パケット開始\n<source id=\"S1\">…</source>\n信頼できない証拠パケット終了" }],
  systemInstruction: "SYNTHESIS-INSTRUCTION",
};

const VALID_TEXT = [
  "料金は100円です。[S1](https://example.com/one) [S2](https://example.org/two)",
  "別資料では料金は120円と記載されています。[S2](https://example.org/two)",
].join("\n");

// Four uncited units: the salvage removes at most three and aborts, so the
// adoption gate rejects this text with UNCITED_FACTUAL_UNIT. The last line
// is cited but carries a year no cited excerpt supports — a numeric defect
// the fail-fast validator never reaches, hidden behind the uncited units.
const FAILING_TEXT = [
  "料金は100円です。[S1](https://example.com/one) [S2](https://example.org/two)",
  "補足文その1です",
  "補足文その2です",
  "補足文その3です",
  "補足文その4です",
  "料金は2025年に100円でした。[S1](https://example.com/one)",
].join("\n");

function retryOptions(
  initialText: string,
  overrides: Partial<GroundedResearchSynthesisRetryOptions> = {},
): GroundedResearchSynthesisRetryOptions {
  return {
    initialRequest,
    initialResult: executionResult(initialText),
    initialAdoption: adoptGroundedResearchSynthesis(initialText, priceSources),
    sources: priceSources,
    language: "ja",
    elapsedMs: 1_000,
    enabled: true,
    assertZeroCost: () => {},
    ...overrides,
  };
}

describe("scanGroundedResearchSynthesisFeedbackMaterial", () => {
  it("counts every uncited unit and names unsupported tokens hidden behind them", () => {
    const material = scanGroundedResearchSynthesisFeedbackMaterial(FAILING_TEXT, priceSources);
    expect(material.totalFactualUnits).toBe(6);
    expect(material.uncitedUnits).toBe(4);
    expect(material.citedSourceCount).toBe(2);
    expect(material.requiredSourceCount).toBe(2);
    // 2025年 appears in no cited excerpt; 100円 is supported and not named.
    expect(material.unsupportedNumericTokens).toEqual(["2025年"]);
    expect(material.unsupportedNumericTokenCount).toBe(1);
  });

  it("finds no unsupported tokens in a fully supported text", () => {
    const material = scanGroundedResearchSynthesisFeedbackMaterial(VALID_TEXT, priceSources);
    expect(material.uncitedUnits).toBe(0);
    expect(material.unsupportedNumericTokens).toEqual([]);
    expect(material.unsupportedNumericTokenCount).toBe(0);
  });
});

describe("executeGroundedResearchSynthesisWithRetry", () => {
  it("rescues a rejected synthesis: the retry returns the corrected full text and is adopted", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const onRetryAttempt = vi.fn();
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT, { onRetryAttempt }));

    expect(outcome.retried).toBe(true);
    expect(outcome.adoption.adopted).toBe(true);
    if (outcome.adoption.adopted === true) expect(outcome.adoption.text).toBe(VALID_TEXT);
    expect(outcome.result.text).toBe(VALID_TEXT);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(onRetryAttempt).toHaveBeenCalledTimes(1);
    expect(onRetryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      synthesisRetryReasonCode: "UNCITED_FACTUAL_UNIT",
      totalFactualUnits: 6,
      uncitedUnits: 4,
      unsupportedNumericTokenCount: 1,
    }));
  });

  it("builds the retry request from the initial one: same plan, identical system instruction, feedback appended to the user message", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT));

    const retryRequest = execute.mock.calls[0]?.[0] as OriginProviderExecutionRequest;
    expect(retryRequest.plan).toBe(initialRequest.plan);
    expect(retryRequest.systemInstruction).toBe(initialRequest.systemInstruction);
    expect(retryRequest.messages).toHaveLength(1);
    const content = retryRequest.messages[0]?.content ?? "";
    expect(content.startsWith(initialRequest.messages[0]?.content ?? "")).toBe(true);
    expect(content).toContain("前回の回答と検証結果");
    // The composite feedback carries BOTH scan materials: the uncited
    // count and the named unsupported token, even though the fail-fast
    // validator only ever reported the uncited units.
    expect(content).toContain("全6行の事実行のうち4行に引用トークンがありませんでした");
    expect(content).toContain("2025年");
    expect(content).toContain("逐語で含まれていません");
    // The feedback orders a from-scratch rewrite, not a draft correction.
    expect(content).toContain("破棄されました");
    expect(content).toContain("最初から書き直した全文を返してください");
  });

  it("never sends the failed draft back: no line of the rejected text appears in the retry request", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT));

    const content = (execute.mock.calls[0]?.[0] as OriginProviderExecutionRequest).messages[0]?.content ?? "";
    // Every line of the rejected synthesis — cited, uncited, and the
    // numeric-defect line alike — must be absent; only the scan's counts
    // and named tokens cross over into the feedback.
    for (const line of FAILING_TEXT.split("\n")) {
      expect(content).not.toContain(line);
    }
    expect(content).not.toContain("下書き");
    expect(content).not.toContain("修正対象");
  });

  it("keeps the initial verdict when the retry also fails validation", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(FAILING_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT));

    expect(outcome.retried).toBe(true);
    expect(outcome.adoption.adopted).toBe(false);
    if (outcome.adoption.adopted === false) {
      // The FIRST failure code and the initial salvage record are preserved.
      expect(outcome.adoption.failureCode).toBe("UNCITED_FACTUAL_UNIT");
      expect(outcome.adoption.salvageAttempted).toBe(true);
    }
    expect(outcome.retryFailureCode).toBe("UNCITED_FACTUAL_UNIT");
    expect(outcome.retryUnitDiagnostics).toEqual(expect.objectContaining({
      totalFactualUnits: 6,
      uncitedUnits: 4,
    }));
    expect(outcome.result.text).toBe(FAILING_TEXT);
  });

  it("fires at most once: a failing retry is never retried again", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(FAILING_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT));
    expect(outcome.retried).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const content = (execute.mock.calls[0]?.[0] as OriginProviderExecutionRequest).messages[0]?.content ?? "";
    expect(content.match(/前回の回答と検証結果/g)).toHaveLength(1);
  });

  it("does not retry when the elapsed time is past the gate", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT, {
      elapsedMs: GROUNDED_RESEARCH_SYNTHESIS_RETRY_TIME_GATE_MS + 1,
    }));
    expect(outcome.retried).toBe(false);
    expect(outcome.retrySkipped).toBe("time-budget");
    expect(execute).not.toHaveBeenCalled();
  });

  it("still retries at exactly the gate boundary", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT, {
      elapsedMs: GROUNDED_RESEARCH_SYNTHESIS_RETRY_TIME_GATE_MS,
    }));
    expect(outcome.retried).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the kill switch is off", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT, { enabled: false }));
    expect(outcome.retried).toBe(false);
    expect(outcome.retrySkipped).toBe("disabled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not retry a salvage-adopted synthesis", async () => {
    // One uncited unit of three: the salvage removes it and adopts, so the
    // retry must not fire at all.
    const salvageable = [
      "料金は100円です。[S1](https://example.com/one) [S2](https://example.org/two)",
      "これは引用のない補足文です",
      "別資料では料金は120円と記載されています。[S2](https://example.org/two)",
    ].join("\n");
    const options = retryOptions(salvageable);
    expect(options.initialAdoption.adopted).toBe(true);
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, options);
    expect(outcome.retried).toBe(false);
    expect(outcome.adoption.adopted).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not retry a first-pass-valid synthesis", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(VALID_TEXT));
    expect(outcome.retried).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not retry a non-target failure (EMPTY_SYNTHESIS has no text to scan)", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(""));
    expect(outcome.retried).toBe(false);
    expect(outcome.retrySkipped).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("applies the caller's $0 assertion to the retry result", async () => {
    const retryResult = executionResult(VALID_TEXT);
    const execute = vi.fn().mockResolvedValue(retryResult);
    const assertZeroCost = vi.fn();
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT, { assertZeroCost }));
    expect(outcome.adoption.adopted).toBe(true);
    expect(assertZeroCost).toHaveBeenCalledTimes(1);
    expect(assertZeroCost).toHaveBeenCalledWith(retryResult);
  });

  it("contains a retry execution failure: the initial verdict stands", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("provider down"));
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT));
    expect(outcome.retried).toBe(true);
    expect(outcome.retryError).toBe(true);
    expect(outcome.adoption.adopted).toBe(false);
    expect(outcome.result.text).toBe(FAILING_TEXT);
  });

  it("contains a $0 assertion failure on the retry result: the initial verdict stands", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    const assertZeroCost = vi.fn(() => { throw new Error("cost evidence invalid"); });
    const outcome = await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT, { assertZeroCost }));
    expect(outcome.retried).toBe(true);
    expect(outcome.retryError).toBe(true);
    expect(outcome.adoption.adopted).toBe(false);
  });

  it("builds the feedback section in English when the request language is English", async () => {
    const execute = vi.fn().mockResolvedValue(executionResult(VALID_TEXT));
    await executeGroundedResearchSynthesisWithRetry(execute, retryOptions(FAILING_TEXT, { language: "en" }));
    const content = (execute.mock.calls[0]?.[0] as OriginProviderExecutionRequest).messages[0]?.content ?? "";
    expect(content).toContain("PREVIOUS ANSWER AND VALIDATION RESULT");
    expect(content).toContain("had no citation token");
    expect(content).toContain("2025年");
    // English feedback also orders a from-scratch rewrite and carries no draft.
    expect(content).toContain("rewritten from scratch");
    expect(content).not.toContain("DRAFT TO CORRECT");
    expect(content).not.toContain("補足文その4です");
  });
});

describe("isGroundedResearchSynthesisRetryEnabled", () => {
  it("defaults to ON when the variable is unset", () => {
    expect(isGroundedResearchSynthesisRetryEnabled({})).toBe(true);
  });

  it("stays ON for explicit true-like values", () => {
    expect(isGroundedResearchSynthesisRetryEnabled({ ORIGIN_SYNTHESIS_RETRY_ENABLED: "true" })).toBe(true);
    expect(isGroundedResearchSynthesisRetryEnabled({ ORIGIN_SYNTHESIS_RETRY_ENABLED: "1" })).toBe(true);
  });

  it("turns OFF for false-like values, case-insensitively", () => {
    for (const value of ["false", "0", "off", "no", "FALSE", " Off "]) {
      expect(isGroundedResearchSynthesisRetryEnabled({ ORIGIN_SYNTHESIS_RETRY_ENABLED: value })).toBe(false);
    }
  });
});

describe("synthesis instruction source-list form (candidate A)", () => {
  it("prescribes Markdown section headings and an exact-token source list in Japanese", () => {
    const ja = buildGroundedResearchSynthesisInstruction("ja");
    expect(ja).toContain("各節の見出しはMarkdown見出しで書いてください（## 結論、## 根拠、## 出典）");
    expect(ja).toContain("箇条書き記号付きの行や太字だけの行で書かないでください");
    expect(ja).toContain("## 出典 の見出し");
    expect(ja).toContain("citation_token を一字も変えず完全にコピーしてください");
    expect(ja).toContain("素のURLだけの行");
    expect(ja).toContain("リンク文字列だけの行は書かないでください");
  });

  it("prescribes Markdown section headings and an exact-token source list in English", () => {
    const en = buildGroundedResearchSynthesisInstruction("en");
    expect(en).toContain("Write every section heading as a Markdown heading (## Conclusion, ## Evidence, ## Sources)");
    expect(en).toContain("under a ## Sources heading");
    expect(en).toContain("Copy every citation token exactly and in full");
    expect(en).toContain("only a bare URL");
  });
});

describe("synthesis instruction few-shot example", () => {
  it("appends a clearly fictional worked example to the Japanese instruction", () => {
    const ja = buildGroundedResearchSynthesisInstruction("ja");
    expect(ja).toContain("出力形式の実例（出典・内容はすべて架空の最小例です）");
    expect(ja).toContain("## 結論\n架空市の図書館は2024年4月1日に開館しました。[S1](https://example.com/)");
    expect(ja).toContain("## 根拠\n開館日は、架空市の公表資料に2024年4月1日と記載されています。[S1](https://example.com/)");
    expect(ja).toContain("## 出典\nexample.com・2024年3月1日 [S1](https://example.com/)");
    // The example is an addition at the tail: every pre-existing required
    // substring of the instruction is unchanged.
    expect(ja).toContain("citation_token を一字も変えず完全にコピーしてください");
  });

  it("appends a clearly fictional worked example to the English instruction", () => {
    const en = buildGroundedResearchSynthesisInstruction("en");
    expect(en).toContain("entirely fictional");
    expect(en).toContain("## Conclusion\nThe library in the fictional city opened on April 1, 2024. [S1](https://example.com/)");
    expect(en).toContain("## Sources\nexample.com, March 1, 2024 [S1](https://example.com/)");
    expect(en).toContain("Copy every citation token exactly and in full");
  });
});
