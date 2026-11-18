import { describe, expect, it } from "vitest";
import type { RecoveryValueSourceInput } from "./groundedResearchValueExtraction.js";
import {
  resolveRecoveryTemplateFallbackMode,
  tryRecoveryTemplateFallback,
} from "./groundedResearchTemplateFallback.js";

/**
 * PR-4 tests (RECOVERY_BUILD_STAGE1_DESIGN_2026-11-18, PR-4). The
 * fixtures mirror the round-5 ledger shapes measured in the replay
 * (F-04's two-source price, F-03's stale-vs-current rate contest with
 * a fresher fringe value, F-09's undated team confirmation), reduced
 * to the smallest sentences that carry them.
 */
const NOW = Date.parse("2026-11-19T00:00:00.000Z");

function source(domain: string, excerpt: string, title = `${domain} の記事`): RecoveryValueSourceInput {
  return { title, url: `https://${domain}/article`, excerpt, domain };
}

const GASOLINE_QUESTION = "レギュラーガソリンの全国平均価格は今いくらくらいですか？";
const gasolineSources = (): RecoveryValueSourceInput[] => [
  source("enecho.example", "資源エネルギー庁が2026年11月16日に公表した調査では、レギュラーガソリンの全国平均価格は170.0円でした。"),
  source("news.example", "ガソリン価格の全国平均は、2026年11月16日時点で170.0円となっています。"),
];

describe("resolveRecoveryTemplateFallbackMode", () => {
  it("is off unless the env value is exactly shadow or enforce", () => {
    expect(resolveRecoveryTemplateFallbackMode(undefined)).toBe("off");
    expect(resolveRecoveryTemplateFallbackMode({})).toBe("off");
    expect(resolveRecoveryTemplateFallbackMode({ ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE: "on" })).toBe("off");
    expect(resolveRecoveryTemplateFallbackMode({ ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE: "shadow" })).toBe("shadow");
    expect(resolveRecoveryTemplateFallbackMode({ ORIGIN_RECOVERY_TEMPLATE_FALLBACK_MODE: "enforce" })).toBe("enforce");
  });
});

describe("tryRecoveryTemplateFallback", () => {
  it("does nothing in off mode", () => {
    const result = tryRecoveryTemplateFallback({
      question: GASOLINE_QUESTION,
      sources: gasolineSources(),
      env: {},
      nowMs: NOW,
    });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("mode-off");
    expect(result.text).toBeUndefined();
  });

  it("fires on a confirmed price with the as-of date and the confirming sources only (F-04 shape)", () => {
    const sources = [
      ...gasolineSources(),
      source("blog.example", "ガソリン価格の全国平均は2026年11月16日時点で171.5円でした。"),
    ];
    const shadow = tryRecoveryTemplateFallback({
      question: GASOLINE_QUESTION,
      sources,
      mode: "shadow",
      nowMs: NOW,
    });
    expect(shadow.fired).toBe(true);
    expect(shadow.resolution).toBe("vote");
    expect(shadow.value).toBe("170.0円");
    expect(shadow.asOf).toBe("2026-11-16");
    expect(shadow.domains).toEqual(expect.arrayContaining(["enecho.example", "news.example"]));
    expect(shadow.text).toContain("170.0円");
    expect(shadow.text).toContain("2026年11月16日の公表情報では");
    expect(shadow.text).toContain("## 出典");
    // Only the sources stating the confirmed value are listed.
    expect(shadow.text).toContain("enecho.example");
    expect(shadow.text).not.toContain("blog.example");
    expect(shadow.confirmingSources).toHaveLength(2);
    // Shadow and enforce compute the identical result; delivery is
    // the caller's decision.
    const enforce = tryRecoveryTemplateFallback({
      question: GASOLINE_QUESTION,
      sources,
      mode: "enforce",
      nowMs: NOW,
    });
    expect(enforce.text).toBe(shadow.text);
    expect(enforce.value).toBe(shadow.value);
  });

  it("accepts the replay-harness call shape (candidates + answerType)", () => {
    const result = tryRecoveryTemplateFallback({
      question: GASOLINE_QUESTION,
      candidates: gasolineSources(),
      answerType: "price_money",
      mode: "shadow",
      nowMs: NOW,
    });
    expect(result.fired).toBe(true);
    expect(result.value).toBe("170.0円");
  });

  it("arbitrates a contested rate by the newest publication point, ignoring a fresher fringe value (F-03 shape)", () => {
    const question = "日銀の政策金利は今いくつですか？いつ決まったものですか？";
    const sources: RecoveryValueSourceInput[] = [
      // The stale 1.00%: three independent domains, June.
      source("a.example", "2026年6月の会合で、政策金利は1.00%に決定しました。"),
      source("b.example", "政策金利は2026年6月に1.00%へ引き上げられました。"),
      source("c.example", "2026年6月時点の政策金利は1.00%です。"),
      // The current 1.25%: two domains, September, three statements.
      source("d.example", "日本銀行は2026年9月に政策金利を1.25%へ引き上げることを決定しました。政策金利は1.25%です。"),
      source("e.example", "2026年9月の決定で、政策金利は1.25%となりました。"),
      // The fringe 2% (the inflation target): two domains, October —
      // newest of all, but neither the leader nor its top challenger.
      source("f.example", "2026年10月30日に公表された資料では、物価安定の目標は2%とされています。"),
      source("g.example", "2026年10月30日の資料で、物価目標は2%と示されました。"),
    ];
    const result = tryRecoveryTemplateFallback({ question, sources, mode: "enforce", nowMs: NOW });
    expect(result.voteStatus).toBe("contested");
    expect(result.fired).toBe(true);
    expect(result.resolution).toBe("freshness-arbitration");
    expect(result.value).toBe("1.25%");
    expect(result.asOf).toBe("2026-09-01");
    expect(result.text).toContain("1.25%");
    expect(result.text).not.toContain("では2%です");
  });

  it("does not fire when the arbitration pool's newest dates tie", () => {
    const question = "最新の完全失業率を教えてください。いつの分ですか？";
    const sources: RecoveryValueSourceInput[] = [
      source("a.example", "2026年9月の完全失業率は2.4%でした。"),
      source("b.example", "完全失業率は2026年9月時点で2.4%です。"),
      source("c.example", "2026年9月の完全失業率は2.5%でした。"),
      source("d.example", "完全失業率は2026年9月時点で2.5%です。"),
    ];
    const result = tryRecoveryTemplateFallback({ question, sources, mode: "enforce", nowMs: NOW });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("contested-without-freshness-winner");
  });

  it("does not fire on a single-source value (F-05/F-15 shape)", () => {
    const question = "最新の有効求人倍率を教えてください。いつの分ですか？";
    const sources: RecoveryValueSourceInput[] = [
      source("blog.example", "2026年9月の有効求人倍率は1.19倍でした。"),
      source("mhlw.example", "有効求人倍率の集計結果を公表しました。"),
    ];
    const result = tryRecoveryTemplateFallback({ question, sources, mode: "enforce", nowMs: NOW });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("not-confirmed");
    expect(result.voteStatus).toBe("single");
  });

  it("does not fire on title-only values", () => {
    const question = "最新の完全失業率を教えてください。いつの分ですか？";
    const sources: RecoveryValueSourceInput[] = [
      source("a.example", "労働力調査の結果を公表しました。", "完全失業率は2.4%"),
      source("b.example", "月例の統計を更新しました。", "完全失業率2.4%に改善"),
    ];
    const result = tryRecoveryTemplateFallback({ question, sources, mode: "enforce", nowMs: NOW });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("not-confirmed");
  });

  it("never templates a person name, even when sources agree (gate fatal classes stay excluded)", () => {
    const question = "日本の内閣総理大臣は誰ですか？";
    const sources: RecoveryValueSourceInput[] = [
      source("a.example", "内閣総理大臣は高市早苗です。2026年10月21日に就任しました。"),
      source("b.example", "高市早苗内閣総理大臣が2026年10月21日に会見しました。"),
    ];
    const result = tryRecoveryTemplateFallback({ question, sources, mode: "enforce", nowMs: NOW });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("type-not-templated");
    expect(result.type).toBe("person_name");
  });

  it("does not fire when the confirmed value's newest publication point is over 365 days old", () => {
    const question = "最新の完全失業率を教えてください。いつの分ですか？";
    const stale: RecoveryValueSourceInput[] = [
      source("a.example", "2025年11月18日の公表では、完全失業率は2.4%でした。"),
      source("b.example", "完全失業率は2025年11月18日時点で2.4%です。"),
    ];
    const result = tryRecoveryTemplateFallback({ question, sources: stale, mode: "enforce", nowMs: NOW });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("value-stale");

    const boundary: RecoveryValueSourceInput[] = [
      source("a.example", "2025年11月19日の公表では、完全失業率は2.4%でした。"),
      source("b.example", "完全失業率は2025年11月19日時点で2.4%です。"),
    ];
    const atBoundary = tryRecoveryTemplateFallback({ question, sources: boundary, mode: "enforce", nowMs: NOW });
    expect(atBoundary.fired).toBe(true);
    expect(atBoundary.value).toBe("2.4%");
  });

  it("does not fire on an undated confirmed team name, and fires when it is dated (F-09 shape)", () => {
    const question = "プロ野球の日本シリーズで優勝した直近のチームはどこですか？";
    const undated: RecoveryValueSourceInput[] = [
      source("a.example", "ソフトバンクホークスが日本シリーズで優勝し、日本一になりました。"),
      source("b.example", "ソフトバンクが4連勝で日本一を決めました。"),
    ];
    const result = tryRecoveryTemplateFallback({ question, sources: undated, mode: "enforce", nowMs: NOW });
    expect(result.fired).toBe(false);
    expect(result.reason).toBe("value-undated");

    const dated: RecoveryValueSourceInput[] = [
      source("a.example", "2026年11月1日、ソフトバンクホークスが日本シリーズで優勝し、日本一になりました。"),
      source("b.example", "ソフトバンクが2026年11月1日に4連勝で日本一を決めました。"),
    ];
    const datedResult = tryRecoveryTemplateFallback({ question, sources: dated, mode: "enforce", nowMs: NOW });
    expect(datedResult.fired).toBe(true);
    // The display form is the strongest occurrence's surface (PR-3):
    // the short and full club names vote as one group, and either
    // surface may be the one displayed.
    expect(["ソフトバンク", "ソフトバンクホークス"]).toContain(datedResult.value);
    expect(datedResult.text).toContain("ソフトバンク");
  });

  it("prefers the source publication date over the sentence's stated date for the window", () => {
    const question = "日本の総人口の最新の推計値と、その基準日を教えてください。";
    const sources: RecoveryValueSourceInput[] = [
      {
        title: "人口推計",
        url: "https://stat.example/a",
        excerpt: "総人口は1億2269万人でした。",
        domain: "stat.example",
        revisionTimestamp: "2026-11-10T00:00:00.000Z",
      },
      {
        title: "人口推計の報道",
        url: "https://news.example/b",
        excerpt: "日本の総人口は1億2269万人と報じられました。",
        domain: "news.example",
        revisionTimestamp: "2026-11-11T00:00:00.000Z",
      },
    ];
    const result = tryRecoveryTemplateFallback({ question, sources, mode: "enforce", nowMs: NOW });
    expect(result.fired).toBe(true);
    expect(result.value).toBe("1億2269万人");
    expect(result.asOf).toBe("2026-11-11");
  });
});
