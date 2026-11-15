import { describe, expect, it, vi } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient";
import {
  buildGroundedResearchRecordsInstruction,
  buildGroundedResearchRecordsPacket,
  buildGroundedResearchSelectionInstruction,
  checkGroundedResearchRenderedAnswer,
  evaluateGroundedResearchRecords,
  evaluateGroundedResearchSelection,
  executeGroundedResearchRecordsSynthesis,
  recordsClaimShapeViolation,
  renderGroundedResearchRecordsAnswer,
  type GroundedResearchRecordsPacket,
} from "./groundedResearchRecordsV13";

// R-PR-8a (RPR8_DESIGN_2026-11-15 §8a): the claim shape gate and
// rendering-stage duplicate-claim removal. Fixture shapes are modeled
// on the R-PR-7 measurement defects: A-02 (the same claim rendered
// twice under different source tags), F-02 (SNS share chrome and wiki
// template text flowing into answers), E-10 (page-head metadata
// dumps). All names/prices are fixture data.

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

function jsonOutput(records: unknown[]): string {
  return JSON.stringify({ records });
}

// --- Prime-minister packet (same fixtures as the R-PR-2 tests) --------

const PM_UNIT_1 = "高市早苗は、第105代内閣総理大臣に指名された。";
const PM_UNIT_2 = "内閣総理大臣は、国会の議決により指名される。";
const PM2_UNIT_1 = "2026年11月現在、内閣総理大臣は高市早苗氏である。";

function pmPacket(): GroundedResearchRecordsPacket {
  return buildGroundedResearchRecordsPacket([
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
  ]);
}

const PM_RECORD_1 = { evidence: ["E1_1"], quote: PM_UNIT_1, text: "現在の内閣総理大臣は高市早苗です。" };
const PM_RECORD_2 = { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "2026年11月時点でも内閣総理大臣は高市早苗氏です。" };

// --- A-02 shape: the same claim stated by two sources ------------------

const CLAIM_A = "従業員は一定の条件を満たせば退職できます。";
const CLAIM_B = "従業員は、一定の条件を満たせば退職できます。";

function claimSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "退職制度の案内",
      url: "https://hr.example.co.jp/retire",
      domain: "hr.example.co.jp",
      excerpt: `${CLAIM_A}制度の対象者は従業員です。`,
    }),
    makeSource({
      title: "退職制度の解説",
      url: "https://guide.example.com/retire",
      domain: "guide.example.com",
      excerpt: `${CLAIM_B}制度は2025年4月に始まりました。`,
    }),
  ];
}

function bodyLines(rendered: string): string[] {
  const lines = rendered.split("\n");
  const listStart = lines.findIndex((line) => line === "## 出典" || line === "## Sources");
  return (listStart >= 0 ? lines.slice(0, listStart) : lines).filter((line) => line.startsWith("- "));
}

describe("recordsClaimShapeViolation (R-PR-8a shape gate rules)", () => {
  it("flags table pipes, half- or full-width", () => {
    expect(recordsClaimShapeViolation("項目 | 内容 | 備考")).toBe("table-pipe");
    expect(recordsClaimShapeViolation("料金は区分｜によって決まります。")).toBe("table-pipe");
  });

  it("flags navigation fragments: SNS share prompts and player fallbacks (F-02 shape)", () => {
    expect(recordsClaimShapeViolation("Xでシェアする Facebookでシェアする")).toBe("navigation-fragment");
    expect(recordsClaimShapeViolation("この動画が再生できない方はこちらをクリックしてください。")).toBe(
      "navigation-fragment",
    );
  });

  it("flags wiki template chrome: navbox headers and citation search (F-02 shape)", () => {
    expect(recordsClaimShapeViolation("歴代首相 在任期間 備考 表 話 編 歴")).toBe("template-fragment");
    expect(recordsClaimShapeViolation("詳細は出典検索で確認できます。")).toBe("template-fragment");
  });

  it("flags a bracketed editorial currency stamp (E-10 shape)", () => {
    const dump =
      "No.6498 適格請求書等保存方式（インボイス制度） [令和8年4月1日現在法令等] 対象税目 消費税 概要 令和5年10月1日から、適格請求書等保存方式が開始しています。";
    expect(recordsClaimShapeViolation(dump)).toBe("metadata-labels");
  });

  it("flags two or more standalone metadata labels in one text", () => {
    expect(recordsClaimShapeViolation("対象税目 概要 は次のとおりです。")).toBe("metadata-labels");
  });

  it("flags texts with no sentence ending as incomplete fragments", () => {
    expect(recordsClaimShapeViolation("従業員の地位と職")).toBe("incomplete-sentence");
    expect(recordsClaimShapeViolation("内閣総理大臣は国会の議決により指名される")).toBe("incomplete-sentence");
    expect(recordsClaimShapeViolation("")).toBe("incomplete-sentence");
  });

  it("accepts ordinary claim sentences (counterexamples pin the false-positive boundary)", () => {
    const accepted = [
      // Plain claims, ja and en.
      "現在の内閣総理大臣は高市早苗です。",
      "Google Pixel 10の価格は124,800円です。",
      "The library opened on April 1, 2024.",
      "従業員は一定の条件を満たせば退職できます。",
      // A label word inside prose is not a standalone label chunk.
      "制度の概要は次のとおりです。",
      "対象税目は消費税です。",
      // Exactly one standalone label chunk is not a metadata dump.
      "対象税目 消費税の概要は次のとおりです。",
      // 表 alone is not the navbox sequence; シェア inside a word is
      // not a share prompt.
      "結果は表のとおりです。",
      "市場シェアは30%です。",
      // Sentence-final punctuation before a closing bracket counts.
      "彼は「準備が整った」と述べた。",
    ];
    for (const text of accepted) {
      expect(recordsClaimShapeViolation(text), text).toBeNull();
    }
  });
});

describe("validateGroundedResearchRecords claim shape gate (step 7b)", () => {
  it("rejects artifact-shaped texts with TEXT_CLAIM_SHAPE_INVALID, one per shape kind", () => {
    const packet = pmPacket();
    const cases: { evidence: string[]; quote: string; text: string }[] = [
      // Table pipe.
      { evidence: ["E1_1"], quote: PM_UNIT_1, text: "内閣総理大臣は | 高市早苗 | です。" },
      // Navigation fragment.
      { evidence: ["E1_1"], quote: PM_UNIT_1, text: "動画が再生できない方はこちらです。" },
      // Wiki template chrome.
      { evidence: ["E1_1"], quote: PM_UNIT_1, text: "内閣総理大臣の一覧は表 話 編 歴で示されます。" },
      // Standalone metadata labels.
      { evidence: ["E1_1"], quote: PM_UNIT_1, text: "対象税目 概要 内閣総理大臣は高市早苗です。" },
      // Bracketed editorial stamp (numerics copied from the quote, so
      // the record reaches the shape step).
      { evidence: ["E2_1"], quote: PM2_UNIT_1, text: "内閣総理大臣は高市早苗氏です[2026年11月現在]。" },
      // No sentence ending.
      { evidence: ["E1_1"], quote: PM_UNIT_1, text: "内閣総理大臣は高市早苗です" },
    ];
    for (const record of cases) {
      const result = evaluateGroundedResearchRecords(jsonOutput([record]), packet);
      expect(result.accepted, record.text).toEqual([]);
      expect(result.rejections, record.text).toEqual([{ recordIndex: 0, code: "TEXT_CLAIM_SHAPE_INVALID" }]);
      expect(result.rejectionCounts.TEXT_CLAIM_SHAPE_INVALID, record.text).toBe(1);
    }
  });

  it("counts the new code in rejectionCounts while valid records still adopt", () => {
    const artifact = { evidence: ["E1_1"], quote: PM_UNIT_1, text: "内閣総理大臣は | 高市早苗 | です。" };
    const result = evaluateGroundedResearchRecords(jsonOutput([artifact, PM_RECORD_1, PM_RECORD_2]), pmPacket());
    expect(result.rejections).toEqual([{ recordIndex: 0, code: "TEXT_CLAIM_SHAPE_INVALID" }]);
    expect(result.rejectionCounts.TEXT_CLAIM_SHAPE_INVALID).toBe(1);
    expect(result.accepted).toHaveLength(2);
    expect(result.coverage.satisfied).toBe(true);
  });

  it("accepts a normal claim that merely mentions a label word in prose", () => {
    const record = {
      evidence: ["E1_1"],
      quote: PM_UNIT_1,
      text: "制度の概要は次のとおりで、内閣総理大臣は高市早苗です。",
    };
    const result = evaluateGroundedResearchRecords(jsonOutput([record, PM_RECORD_2]), pmPacket());
    expect(result.rejections).toEqual([]);
    expect(result.accepted).toHaveLength(2);
  });
});

describe("renderGroundedResearchRecordsAnswer duplicate-claim removal (R-PR-8a)", () => {
  it("renders the A-02 shape once, with the citations of both sources merged", () => {
    const packet = buildGroundedResearchRecordsPacket(claimSources());
    const evaluation = evaluateGroundedResearchRecords(
      jsonOutput([
        { evidence: ["E1_1"], quote: CLAIM_A, text: CLAIM_A },
        { evidence: ["E2_1"], quote: CLAIM_B, text: CLAIM_A },
      ]),
      packet,
    );
    expect(evaluation.accepted).toHaveLength(2);
    const rendered = renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja");
    const lines = bodyLines(rendered);
    expect(lines).toEqual([
      "- 従業員は一定の条件を満たせば退職できます。 [S1](https://hr.example.co.jp/retire) [S2](https://guide.example.com/retire)",
    ]);
    // The merged rendering still passes the post-render check against
    // the full accepted set (consistency with §6.5).
    expect(checkGroundedResearchRenderedAnswer(rendered, packet, evaluation.accepted)).toEqual({ ok: true });
  });

  it("does not repeat the citation when the duplicate claim comes from the same source", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "退職制度の案内",
        url: "https://hr.example.co.jp/retire",
        domain: "hr.example.co.jp",
        excerpt: `${CLAIM_A}${CLAIM_B}制度の対象者は従業員です。`,
      }),
      claimSources()[1],
    ]);
    const evaluation = evaluateGroundedResearchRecords(
      jsonOutput([
        { evidence: ["E1_1"], quote: CLAIM_A, text: CLAIM_A },
        { evidence: ["E1_2"], quote: CLAIM_B, text: CLAIM_A },
      ]),
      packet,
    );
    expect(evaluation.accepted).toHaveLength(2);
    const rendered = renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja");
    const lines = bodyLines(rendered);
    expect(lines).toHaveLength(1);
    expect(lines[0].split("[S1]").length - 1).toBe(1);
  });

  it("keeps distinct claims on separate lines", () => {
    const packet = buildGroundedResearchRecordsPacket(claimSources());
    const evaluation = evaluateGroundedResearchRecords(
      jsonOutput([
        { evidence: ["E1_1"], quote: CLAIM_A, text: CLAIM_A },
        { evidence: ["E2_1"], quote: CLAIM_B, text: CLAIM_A },
        { evidence: ["E2_2"], quote: "制度は2025年4月に始まりました。", text: "制度は2025年4月に始まりました。" },
      ]),
      packet,
    );
    expect(evaluation.accepted).toHaveLength(3);
    const lines = bodyLines(renderGroundedResearchRecordsAnswer(evaluation.accepted, packet, "ja"));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("制度は2025年4月に始まりました。");
  });
});

// --- Selection layer --------------------------------------------------------

function dumpSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "退職制度の案内",
      url: "https://hr.example.co.jp/retire",
      domain: "hr.example.co.jp",
      // E1_1 is the share-chrome unit (F-02 shape); E1_2 is the claim.
      excerpt: `Xでシェアする Facebookでシェアする 制度の対象者は従業員です。${CLAIM_A}`,
    }),
    claimSources()[1],
  ];
}

describe("evaluateGroundedResearchSelection claim shape gate (R-PR-8a)", () => {
  it("drops a navigation-shaped unit and reports shapeDroppedIdCount", () => {
    const packet = buildGroundedResearchRecordsPacket(dumpSources());
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E1_1\",\"E1_2\",\"E2_1\"]}", packet);
    expect(evaluation.shapeDroppedIdCount).toBe(1);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E1_2", "E2_1"]);
    expect(evaluation.adopted).toBe(true);
  });

  it("does not count a dropped unit toward coverage", () => {
    const packet = buildGroundedResearchRecordsPacket(dumpSources());
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E1_1\",\"E2_1\"]}", packet);
    expect(evaluation.shapeDroppedIdCount).toBe(1);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E2_1"]);
    expect(evaluation.citedSourceCount).toBe(1);
    expect(evaluation.adopted).toBe(false);
    expect(evaluation.code).toBe("SELECTION_INSUFFICIENT_COVERAGE");
  });

  it("drops a truncated tail fragment with no sentence ending", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "制度の説明",
        url: "https://hr.example.co.jp/about",
        domain: "hr.example.co.jp",
        excerpt: "制度の対象者は従業員です。従業員の地位と職務の範囲に関する詳細な説明",
      }),
      claimSources()[1],
    ]);
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E1_1\",\"E1_2\",\"E2_1\"]}", packet);
    expect(evaluation.shapeDroppedIdCount).toBe(1);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E1_1", "E2_1"]);
    expect(evaluation.adopted).toBe(true);
  });

  it("drops a page-head metadata dump unit (E-10 shape)", () => {
    const packet = buildGroundedResearchRecordsPacket([
      makeSource({
        title: "タックスアンサー",
        url: "https://www.nta.example.go.jp/taxes/",
        domain: "nta.example.go.jp",
        excerpt:
          "No.6498 適格請求書等保存方式（インボイス制度） [令和8年4月1日現在法令等] 対象税目 消費税 概要 令和5年10月1日から、適格請求書等保存方式が開始しています。",
      }),
      makeSource({
        title: "制度の解説",
        url: "https://guide.example.com/invoice",
        domain: "guide.example.com",
        excerpt: "適格請求書等保存方式は2023年10月に始まりました。事業者は登録を受ける必要があります。",
      }),
    ]);
    const evaluation = evaluateGroundedResearchSelection("{\"select\":[\"E1_1\",\"E2_1\",\"E2_2\"]}", packet);
    expect(evaluation.shapeDroppedIdCount).toBe(1);
    expect(evaluation.selectedUnits.map((unit) => unit.id)).toEqual(["E2_1", "E2_2"]);
    expect(evaluation.adopted).toBe(false);
    expect(evaluation.code).toBe("SELECTION_INSUFFICIENT_COVERAGE");
  });
});

// --- Shared execution helper: metrics wiring --------------------------------

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

describe("executeGroundedResearchRecordsSynthesis shape gate metrics (R-PR-8a)", () => {
  it("records selectionShapeDroppedCount and renders the surviving claim once with merged citations", async () => {
    const fabricated = jsonOutput([
      { evidence: ["E1_2"], quote: "パケットに存在しない引用文です。", text: CLAIM_A },
    ]);
    const execute = vi.fn(async (request: OriginProviderExecutionRequest) => {
      if (request.systemInstruction === buildGroundedResearchRecordsInstruction("ja")) {
        return executionResult(fabricated);
      }
      if (request.systemInstruction === buildGroundedResearchSelectionInstruction("ja")) {
        return executionResult("{\"select\":[\"E1_1\",\"E1_2\",\"E2_1\"]}");
      }
      throw new Error("unexpected instruction");
    });
    const outcome = await executeGroundedResearchRecordsSynthesis(execute, {
      plan: fakePlan,
      // Deliberately NOT a single-fact-slot question (see the R-PR-4
      // selection tests): the records stage must run first.
      query: "公開情報の要点を調査してください",
      sources: dumpSources(),
      language: "ja",
      enabled: true,
      assertZeroCost: () => {},
    });
    expect(outcome.adopted).toBe(true);
    expect(outcome.metrics).toMatchObject({
      finalForm: "selection",
      selectionAttempted: true,
      selectionSelectedUnitCount: 2,
      selectionShapeDroppedCount: 1,
      selectionCode: "SELECTION_ADOPTED",
    });
    // The share chrome never reaches the answer, and the claim the
    // two sources state in different punctuation renders once, with
    // both citations merged (selection rendering + dedup combined).
    expect(outcome.text).not.toContain("シェア");
    expect(outcome.text?.split("一定の条件を満たせば退職できます").length - 1).toBe(1);
    expect(outcome.text).toContain(
      "- 従業員は一定の条件を満たせば退職できます。 [S1](https://hr.example.co.jp/retire) [S2](https://guide.example.com/retire)",
    );
  });
});
