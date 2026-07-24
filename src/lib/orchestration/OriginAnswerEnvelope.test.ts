import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createOriginAnswerEnvelope,
  type OriginAnswerEnvelope,
  type OriginAnswerEnvelopeInput,
  type OriginAnswerTechnicalTrace,
} from "./OriginAnswerEnvelope";

const baseInput: OriginAnswerEnvelopeInput = {
  language: "ja",
  conclusion: "最初に結論を示します。",
  answer: [
    "依頼に対する具体的な回答です。",
    "",
    "公式資料がこの回答を裏付けています。〔出典: [公式資料](https://example.com/evidence)〕",
  ].join("\n"),
  evidence: [{
    label: "公式資料",
    sourceUrl: "https://example.com/evidence",
    claim: "公式資料がこの回答を裏付けています。",
    claimBinding: "explicit-inline-citation",
    evidenceLevel: "source-checked",
    checks: {
      safeUrl: "passed",
      content: "passed",
      freshness: "passed",
      claimSupport: "passed",
    },
  }],
  verification: {
    status: "not-run",
    independentReviewPerformed: false,
    summary: "今回は別のAIによる確認を実施していません。",
  },
  limitations: ["実環境では未確認です。"],
  nextActions: ["実環境の確認後に判断します。"],
};

describe("OriginAnswerEnvelope", () => {
  it("creates the same provider-neutral answer structure for every eligible AI", () => {
    const result = createOriginAnswerEnvelope(baseInput);

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: "origin.answer.v1",
        ...baseInput,
        richOutputs: [],
      },
    });
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty("providerId");
    expect(result.value).not.toHaveProperty("modelId");
    expectTypeOf(result.value).toMatchTypeOf<OriginAnswerEnvelope>();
    expectTypeOf(result.value).not.toMatchTypeOf<OriginAnswerTechnicalTrace>();
  });

  it("rejects a passed review label when no independent review ran", () => {
    const result = createOriginAnswerEnvelope({
      ...baseInput,
      verification: {
        status: "passed",
        independentReviewPerformed: false,
        summary: "別のAIで確認済みです。",
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "INVALID_VERIFICATION",
      message: "独立確認の実行状態と表示内容が一致しません。",
    });
  });

  it("accepts an independent-review label only when the review actually ran", () => {
    const result = createOriginAnswerEnvelope({
      ...baseInput,
      verification: {
        status: "passed",
        independentReviewPerformed: true,
        summary: "異なる提供元のAIによる確認を完了しました。",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects unsafe evidence URLs and source-checked claims without a source", () => {
    const credentialUrl = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{
        label: "不正な参照",
        sourceUrl: "https://user:secret@example.com/evidence",
        claim: "不正な参照を使う主張です。",
        claimBinding: "explicit-inline-citation",
        evidenceLevel: "source-checked",
        checks: {
          safeUrl: "passed",
          content: "passed",
          freshness: "passed",
          claimSupport: "passed",
        },
      }],
    });
    const missingSource = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{ label: "参照未設定", evidenceLevel: "source-checked" }],
    });
    const privateTarget = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{
        label: "ローカル参照",
        sourceUrl: "https://127.0.0.1/evidence",
        evidenceLevel: "provided",
      }],
    });

    expect(credentialUrl.ok).toBe(false);
    expect(missingSource.ok).toBe(false);
    expect(privateTarget.ok).toBe(false);
  });

  it("rejects checked-source claims unless content and claim support were actually checked", () => {
    const missingChecks = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{
        label: "公式資料",
        sourceUrl: "https://example.com/evidence",
        claim: "公式資料がこの回答を裏付けています。",
        claimBinding: "explicit-inline-citation",
        evidenceLevel: "source-checked",
      }],
    });
    const contradictoryProvided = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{
        label: "公式資料",
        sourceUrl: "https://example.com/evidence",
        claim: "公式資料がこの回答を裏付けています。",
        claimBinding: "explicit-inline-citation",
        evidenceLevel: "provided",
        checks: {
          safeUrl: "passed",
          content: "passed",
          freshness: "passed",
          claimSupport: "passed",
        },
      }],
    });

    expect(missingChecks.ok).toBe(false);
    expect(contradictoryProvided.ok).toBe(false);
  });

  it("rejects a checked source without an explicit claim or with a secret-bearing claim", () => {
    const noClaim = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{
        label: "主張なし",
        sourceUrl: "https://example.com/no-claim",
        evidenceLevel: "source-checked",
        checks: {
          safeUrl: "passed",
          content: "passed",
          freshness: "passed",
          claimSupport: "passed",
        },
      }],
    });
    const secretClaim = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{
        label: "秘密情報を含む主張",
        sourceUrl: "https://example.com/secret-claim",
        claim: "Authorization: Bearer synthetic_claim_secret_123456",
        claimBinding: "explicit-inline-citation",
        evidenceLevel: "provided",
      }],
    });

    expect(noClaim.ok).toBe(false);
    expect(secretClaim.ok).toBe(false);
  });

  it("rejects a claim that was not created from an explicit citation binding", () => {
    const result = createOriginAnswerEnvelope({
      ...baseInput,
      answer: "出典との対応を推測してはいけない主張です。〔出典: [結び付け方式なし](https://example.com/unbound)〕",
      evidence: [{
        label: "結び付け方式なし",
        sourceUrl: "https://example.com/unbound",
        claim: "出典との対応を推測してはいけない主張です。",
        evidenceLevel: "provided",
      }],
    });

    expect(result.ok).toBe(false);
  });

  it("rejects an explicit binding that is not present in the answer body", () => {
    const result = createOriginAnswerEnvelope({
      ...baseInput,
      evidence: [{
        label: "本文にない対応",
        sourceUrl: "https://example.com/not-in-answer",
        claim: "本文には存在しない主張です。",
        claimBinding: "explicit-inline-citation",
        evidenceLevel: "provided",
      }],
    });

    expect(result.ok).toBe(false);
  });

  it("does not present a chart or artifact unless a real artifact reference exists", () => {
    const invalid = createOriginAnswerEnvelope({
      ...baseInput,
      richOutputs: [{ kind: "chart", label: "比較グラフ", artifactId: " " }],
    });
    const valid = createOriginAnswerEnvelope({
      ...baseInput,
      richOutputs: [{ kind: "chart", label: "比較グラフ", artifactId: "artifact-chart-001" }],
    });

    expect(invalid).toEqual({
      ok: false,
      code: "INVALID_RICH_OUTPUT",
      message: "生成成果物の参照情報が正しくありません。",
    });
    expect(valid.ok).toBe(true);
  });

  it("rejects blank required content instead of fabricating a complete answer", () => {
    const result = createOriginAnswerEnvelope({ ...baseInput, conclusion: "   " });

    expect(result).toEqual({
      ok: false,
      code: "INVALID_ANSWER_CONTENT",
      message: "回答内容、制約、または次の行動の形式が正しくありません。",
    });
  });
});
