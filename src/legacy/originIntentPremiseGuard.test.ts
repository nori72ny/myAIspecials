import { describe, expect, it, vi } from "vitest";
import {
  ORIGIN_STABLE_FACT_REGISTRY,
  checkOriginPremiseGuard,
  extractOriginPremiseLedger,
  isOriginStableFactEntryActive,
  resolveOriginIntentPremiseGuardEffectiveMode,
  resolveOriginIntentPremiseGuardMode,
  runOriginIntentPremiseGuardShadow,
} from "./originIntentPremiseGuard.js";
import type { OriginChatMessage } from "./originProviderClient.js";

const NOW_MS = Date.parse("2026-11-22T00:00:00.000Z");

const user = (content: string): OriginChatMessage => ({ role: "user", content });
const assistant = (content: string): OriginChatMessage => ({
  role: "assistant",
  content,
});

describe("premise guard mode resolution", () => {
  it("defaults to off and only accepts the exact shadow/enforce values", () => {
    expect(resolveOriginIntentPremiseGuardMode(undefined)).toBe("off");
    expect(resolveOriginIntentPremiseGuardMode({})).toBe("off");
    expect(
      resolveOriginIntentPremiseGuardMode({ ORIGIN_INTENT_PREMISE_GUARD_MODE: "off" }),
    ).toBe("off");
    expect(
      resolveOriginIntentPremiseGuardMode({ ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow" }),
    ).toBe("shadow");
    expect(
      resolveOriginIntentPremiseGuardMode({ ORIGIN_INTENT_PREMISE_GUARD_MODE: "enforce" }),
    ).toBe("enforce");
    expect(
      resolveOriginIntentPremiseGuardMode({ ORIGIN_INTENT_PREMISE_GUARD_MODE: "SHADOW" }),
    ).toBe("off");
    expect(
      resolveOriginIntentPremiseGuardMode({ ORIGIN_INTENT_PREMISE_GUARD_MODE: "true" }),
    ).toBe("off");
  });

  it("enforce resolves but stays effectively shadow in PR1", () => {
    expect(
      resolveOriginIntentPremiseGuardEffectiveMode({
        ORIGIN_INTENT_PREMISE_GUARD_MODE: "enforce",
      }),
    ).toBe("shadow");
    expect(
      resolveOriginIntentPremiseGuardEffectiveMode({
        ORIGIN_INTENT_PREMISE_GUARD_MODE: "shadow",
      }),
    ).toBe("shadow");
    expect(resolveOriginIntentPremiseGuardEffectiveMode({})).toBe("off");
  });
});

describe("stable fact registry", () => {
  it("starts with the consumption tax rate only, active inside its evidence window", () => {
    expect(ORIGIN_STABLE_FACT_REGISTRY).toHaveLength(1);
    const entry = ORIGIN_STABLE_FACT_REGISTRY[0];
    expect(entry.id).toBe("consumption-tax-rate");
    expect(entry.allowedRatesPercent).toEqual([10, 8]);
    expect(isOriginStableFactEntryActive(entry, NOW_MS)).toBe(true);
  });

  it("fails closed after reviewAfter", () => {
    const entry = ORIGIN_STABLE_FACT_REGISTRY[0];
    const after = Date.parse(entry.reviewAfter) + 1;
    expect(isOriginStableFactEntryActive(entry, after)).toBe(false);
  });
});

describe("ledger extraction", () => {
  it("records a numeric user correction only under a correction marker", () => {
    const withMarker = extractOriginPremiseLedger([
      user("参加者は50人想定です。"),
      user("訂正します。参加者は30人でした。"),
    ]);
    expect(withMarker).toHaveLength(1);
    expect(withMarker[0].numeric).toEqual({
      family: "headcount",
      oldAmount: 50,
      newAmount: 30,
    });

    const withoutMarker = extractOriginPremiseLedger([
      user("参加者は50人想定です。"),
      user("参加者は30人でお願いします。"),
    ]);
    expect(withoutMarker).toHaveLength(0);
  });

  it("does not record an unchanged re-assertion as a correction", () => {
    const ledger = extractOriginPremiseLedger([
      user("月収は30万円です。貯金は月5万円。"),
      user("訂正します。月収は25万円でした。でも貯金目標の月5万円はそのままにしたい。"),
    ]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].label).toBe("月収");
  });

  it("matches a correction whose label is a suffix variant （広告予算→予算）", () => {
    const ledger = extractOriginPremiseLedger([
      user("広告予算は10万円です。"),
      user("訂正します。予算は3万円でした。"),
    ]);
    // The turn re-asserts 予算=3万円 against 広告予算=10万円.
    const numeric = ledger.find((entry) => entry.numeric);
    expect(numeric?.numeric).toEqual({
      family: "money",
      oldAmount: 100_000,
      newAmount: 30_000,
    });
  });

  it("requires topic continuity for categorical replacements", () => {
    const noContinuity = extractOriginPremiseLedger([
      user("温泉より街歩きの方がいいな。"),
    ]);
    expect(noContinuity).toHaveLength(0);

    const withContinuity = extractOriginPremiseLedger([
      user("温泉旅行を計画して。"),
      assistant("温泉プランです。"),
      user("うーん、温泉より街歩きの方がいいな。そっちで組み直して。"),
    ]);
    expect(withContinuity).toHaveLength(1);
    expect(withContinuity[0].oldValue).toBe("温泉");
    expect(withContinuity[0].newValue).toBe("街歩き");
  });

  it("extracts ORIGIN's own tax correction from an assistant turn", () => {
    const ledger = extractOriginPremiseLedger([
      user("消費税が15%に上がったから計算して。"),
      assistant("消費税率は現在10%ですが、計算します。"),
    ]);
    const entry = ledger.find((candidate) => candidate.kind === "assistant-correction");
    expect(entry?.conceptId).toBe("consumption-tax-rate");
    expect(entry?.numeric).toEqual({ family: "percent", oldAmount: 15, newAmount: 10 });
  });
});

describe("C-1 old-value reuse", () => {
  const messages = [
    user("参加者は50人想定です。"),
    user("訂正します。参加者は30人でした。"),
    user("椅子は何脚いるかな。"),
  ];

  it("fires when the answer operatively uses the superseded value in any family unit", () => {
    const result = checkOriginPremiseGuard({
      messages,
      answerText: "必要な椅子の数は 50脚です。",
      nowMs: NOW_MS,
    });
    expect(result.violationCounts["old-value-reuse"]).toBe(1);
  });

  it("does not fire for the operative value, a larger number, a negation clause, or a hypothetical clause", () => {
    for (const answerText of [
      "必要な椅子の数は30脚です。",
      "150人規模の会場なら椅子は150脚です。",
      "50人ではなく30人が前提です。椅子は30脚必要です。",
      "仮に50人だった場合は、椅子が50脚必要です。",
      "訂正後の前提で、椅子は30脚です。",
    ]) {
      const result = checkOriginPremiseGuard({
        messages,
        answerText,
        nowMs: NOW_MS,
      });
      expect(result.violationCounts["old-value-reuse"], answerText).toBe(0);
    }
  });

  it("does not count a verbatim quotation of the user's own turn", () => {
    const quoting = [
      user("参加者は50人想定です。"),
      user("訂正します。参加者は30人でした。"),
      user("「参加者は50人想定です。」という話でしたね。"),
    ];
    const result = checkOriginPremiseGuard({
      messages: quoting,
      answerText: "「参加者は50人想定です。」という前提は訂正済みです。椅子は30脚です。",
      nowMs: NOW_MS,
    });
    expect(result.violationCounts["old-value-reuse"]).toBe(0);
  });
});

describe("C-2 stable-fact applied value", () => {
  it("fires on an applied 15% factor and passes an applied 10% factor", () => {
    const bad = checkOriginPremiseGuard({
      messages: [user("税抜8,000円の商品の税込価格を計算して。")],
      answerText: "消費税を計算します。8,000円 × 1.15 = 9,200円です。",
      nowMs: NOW_MS,
    });
    expect(bad.violationCounts["stable-fact-applied-value"]).toBe(1);
    expect(bad.c2AppliedRates).toContain(15);

    const good = checkOriginPremiseGuard({
      messages: [user("税抜8,000円の商品の税込価格を計算して。")],
      answerText: "消費税率は10%です。8,000円 × 1.10 = 8,800円です。",
      nowMs: NOW_MS,
    });
    expect(good.violationCounts["stable-fact-applied-value"]).toBe(0);
  });

  it("fires on the rate implied by a bare 税込 result (no formula shown)", () => {
    const result = checkOriginPremiseGuard({
      messages: [user("消費税が15%に上がったから、税抜8,000円の商品の税込価格を計算して。")],
      answerText: "税込価格は 9,200円 です。",
      nowMs: NOW_MS,
    });
    expect(result.violationCounts["stable-fact-applied-value"]).toBe(1);
    expect(result.c2AppliedRates).toContain(15);
  });

  it("is fenced by an explicitly hypothetical user turn (FP-04 shape)", () => {
    const result = checkOriginPremiseGuard({
      messages: [
        user("仮の話として計算してほしいんですが、もし消費税が15%だったら、税抜8,000円の商品の税込価格はいくらになりますか。"),
      ],
      answerText: "仮定の計算です。8,000円 × 1.15 = 9,200円です。",
      nowMs: NOW_MS,
    });
    expect(result.violationCounts["stable-fact-applied-value"]).toBe(0);
  });

  it("is concept-bound: other taxes do not trigger it", () => {
    const result = checkOriginPremiseGuard({
      messages: [user("所得税の計算をして。")],
      answerText: "所得税率は5%です。100,000円 × 0.05 = 5,000円です。",
      nowMs: NOW_MS,
    });
    expect(result.violationCounts["stable-fact-applied-value"]).toBe(0);
  });

  it("stops when the registry entry's evidence has expired", () => {
    const result = checkOriginPremiseGuard({
      messages: [user("税抜8,000円の商品の税込価格を計算して。")],
      answerText: "8,000円 × 1.15 = 9,200円です。消費税の計算です。",
      nowMs: Date.parse("2027-06-01T00:00:00.000Z"),
    });
    expect(result.violationCounts["stable-fact-applied-value"]).toBe(0);
    expect(result.c2AppliedRates).toEqual([]);
  });
});

describe("C-4 fabricated-citation form", () => {
  it("fires on URL-less authority-claiming brackets only", () => {
    const base = { messages: [user("計算して。")], nowMs: NOW_MS };
    expect(
      checkOriginPremiseGuard({
        ...base,
        answerText: "税込は9,200円です。〔出典: 公式税率計算例〕",
      }).violationCounts["fabricated-citation-form"],
    ).toBe(1);
    expect(
      checkOriginPremiseGuard({
        ...base,
        answerText: "〔出典: 公式サイト〕 https://example.com を参照。",
      }).violationCounts["fabricated-citation-form"],
    ).toBe(0);
    expect(
      checkOriginPremiseGuard({
        ...base,
        answerText: "〔出典: [○○市公式サイト](https://www.city.example.jp/)〕",
      }).violationCounts["fabricated-citation-form"],
    ).toBe(0);
    expect(
      checkOriginPremiseGuard({
        ...base,
        answerText: "〔出典: 事務職と営業職のスキルマッピングに関する一般的知見〕",
      }).violationCounts["fabricated-citation-form"],
    ).toBe(0);
    expect(
      checkOriginPremiseGuard({
        ...base,
        answerText: "〔出典: 例示データ〕",
      }).violationCounts["fabricated-citation-form"],
    ).toBe(0);
  });
});

describe("shadow runner", () => {
  it("logs counts only and returns the result", () => {
    const logger = vi.fn();
    const result = runOriginIntentPremiseGuardShadow({
      requestId: "req-1",
      messages: [
        user("参加者は50人想定です。"),
        user("訂正します。参加者は30人でした。"),
        user("椅子は何脚いるかな。"),
      ],
      answerText: "必要な椅子の数は 50脚です。",
      nowMs: NOW_MS,
      logger,
    });
    expect(result.violationCounts["old-value-reuse"]).toBe(1);
    expect(logger).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.mock.calls[0];
    expect(message).toContain("intent premise guard");
    expect(fields).toMatchObject({
      premiseGuardMode: "shadow",
      ledgerUserCorrections: 1,
      violationOldValueReuse: 1,
    });
    // The log must never carry answer or question text.
    expect(JSON.stringify(fields)).not.toContain("椅子");
  });

  it("never throws on malformed input", () => {
    const logger = vi.fn();
    const result = runOriginIntentPremiseGuardShadow({
      requestId: "req-2",
      messages: [{ role: "user", content: undefined } as unknown as OriginChatMessage],
      answerText: "回答",
      nowMs: NOW_MS,
      logger,
    });
    expect(result.violations).toEqual([]);
  });
});
