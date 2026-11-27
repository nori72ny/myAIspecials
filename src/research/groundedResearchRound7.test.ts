import { describe, expect, it } from "vitest";
import {
  extractRecoveryValues,
  voteRecoveryValues,
  type RecoveryValueSourceInput,
} from "./groundedResearchValueExtraction.js";
import { tryRecoveryTemplateFallback } from "./groundedResearchTemplateFallback.js";

/**
 * Round-7 measures (ANSWER_ROUND7_DIAGNOSIS_2026-11-27): the vote and
 * the template arbitration learn to read the EDITION (the reference
 * period a release reports) instead of judging a value's newness by
 * the date of the article that happens to restate it.
 *
 * The fixtures reproduce the diagnosis's simulation pools
 * (round7-diag-sim2.log) — the same pools that, before this measure,
 * confirmed the STALE value in all three statistics questions:
 *  - B3 (unemployment): the deterministic official release-page
 *    candidate (stat.go.jp, September's 2.4%, undated) plus one news
 *    report, against August's 2.5% restated by three domains in
 *    November articles — the old vote confirmed 2.5% (score 6 vs 4)
 *    and the template fired it with as-of 2026-11-08, exactly the
 *    production failure;
 *  - B1 (job-offer ratio): September's 1.19 stated by MHLW alone
 *    (single domain, ineligible) against April's 1.18 stated by
 *    three domains including MHLW's own old-edition page — the old
 *    vote confirmed 1.18 unconditionally (score 5 vs 4) and the
 *    template fired it with as-of 2026-05-29;
 *  - B2 (real GDP): the current quarter's -0.0% against the
 *    previous quarter's 0.3% restated in a November article — the
 *    old vote confirmed 0.3% (score 6 vs 4).
 *
 * After the measure, a group whose stated edition is strictly older
 * than the newest edition stated anywhere in the pool is
 * disqualified: editions, not article dates, decide which value is
 * current. A group stating no edition is of unknown vintage and is
 * never disqualified by this rule (the packet's measure-C
 * discipline), and a pool stating only one edition behaves exactly
 * as before.
 */
const NOW = Date.parse("2026-11-27T00:00:00.000Z");

function source(
  domain: string,
  excerpt: string,
  options: { title?: string; publishedAt?: string } = {},
): RecoveryValueSourceInput {
  return {
    title: options.title ?? `${domain} の記事`,
    url: `https://${domain}/article`,
    excerpt,
    domain,
    ...(options.publishedAt ? { publishedAt: options.publishedAt } : {}),
  };
}

const UNEMPLOYMENT_QUESTION = "完全失業率の最新の値を教えてください";

/** The diagnosis's B3 pool (see the header): September 2.4% vs August 2.5%. */
function unemploymentSources(): RecoveryValueSourceInput[] {
  return [
    // The deterministic release-page candidate (round 6): the
    // Statistics Bureau's standing summary PDF. Tavily extract
    // returns no provider date, the value sentence itself states no
    // date, and the candidate's title is the topic's release terms
    // with no edition — the edition lives in the page's own heading.
    source(
      "stat.go.jp",
      "労働力調査（基本集計）2026年（令和8年）9月分結果の概要。完全失業率（季節調整値）は2.4％でした。就業者数は6,852万人でした。",
      { title: "労働力調査 基本集計" },
    ),
    source(
      "news-a.example",
      "総務省が発表した労働力調査によると、2026年9月の完全失業率は2.4%でした。",
      { publishedAt: "2026-10-31" },
    ),
    // August's value, restated in November: the article dates are
    // new, the edition is old — the shape that beat the old vote.
    source(
      "jil.go.jp",
      "2026年8月分の完全失業率（季節調整値）は2.5%でした。前月と同水準でした。",
      { title: "労働力調査 2026年8月分 結果の概要", publishedAt: "2026-11-08" },
    ),
    source(
      "news-b.example",
      "完全失業率は2.5%に悪化しました。",
      { publishedAt: "2026-11-08" },
    ),
    source(
      "news-c.example",
      "8月の完全失業率は2.5%でした。",
      { publishedAt: "2026-11-06" },
    ),
  ];
}

const JOB_RATIO_QUESTION = "有効求人倍率の最新の値を教えてください";

/** The diagnosis's B1 pool: September 1.19 (MHLW only) vs April 1.18. */
function jobRatioSources(): RecoveryValueSourceInput[] {
  return [
    source(
      "mhlw.go.jp",
      "令和8年9月分の有効求人倍率（季節調整値）は1.19倍でした。",
      { title: "一般職業紹介状況（令和8年9月分）", publishedAt: "2026-10-30" },
    ),
    // MHLW's own old-edition page: official support for the stale
    // value, which is why the §4 guard alone could not stop it.
    source(
      "mhlw.go.jp",
      "令和8年4月分の有効求人倍率（季節調整値）は1.18倍でした。",
      { title: "一般職業紹介状況（令和8年4月分）", publishedAt: "2026-05-29" },
    ),
    source(
      "news-a.example",
      "有効求人倍率は1.18倍でした。",
      { publishedAt: "2026-05-29" },
    ),
    source(
      "news-b.example",
      "2026年4月分の有効求人倍率は1.18倍と発表されました。",
      { publishedAt: "2026-05-29" },
    ),
  ];
}

const GDP_QUESTION = "実質GDPの最新の成長率を教えてください";

/** The diagnosis's B2 pool shape: Q3 -0.0% vs Q2 0.3% restated in November. */
function gdpSources(): RecoveryValueSourceInput[] {
  return [
    source(
      "esri.cao.go.jp",
      "2026年7-9月期の実質GDP（季節調整値）は前期比-0.0%となり、年率換算では-0.1%でした。",
      { title: "四半期別GDP速報 2026年7-9月期 1次速報値", publishedAt: "2026-11-17" },
    ),
    source(
      "news-a.example",
      "内閣府が発表した2026年7-9月期の実質GDPは前期比-0.0%でした。",
      { publishedAt: "2026-11-17" },
    ),
    source(
      "esri.cao.go.jp",
      "2026年4-6月期の実質GDPは前期比0.3%でした。",
      { title: "四半期別GDP速報 2026年4-6月期 1次速報値", publishedAt: "2026-08-17" },
    ),
    source(
      "news-b.example",
      "2026年4-6月期の実質GDPは前期比0.3%増でした。",
      { publishedAt: "2026-08-17" },
    ),
    // The previous quarter's value restated as history in a
    // November article: a new article date carrying an old value.
    source(
      "news-c.example",
      "実質GDPの伸びは前期の0.3%増から鈍化しました。",
      { publishedAt: "2026-11-16" },
    ),
  ];
}

describe("round-7 edition discipline: B3 unemployment", () => {
  it("disqualifies the older-edition group and confirms September's 2.4%", () => {
    const candidates = extractRecoveryValues(unemploymentSources(), UNEMPLOYMENT_QUESTION);
    const vote = voteRecoveryValues(candidates);
    expect(vote).not.toBeNull();
    expect(vote?.status).toBe("confirmed");
    expect(vote?.value).toBe("2.4%");
    const stale = vote?.groups.find((group) => group.normalizedValue === "2.5");
    expect(stale?.editionSortKey).toBe(202608);
    expect(stale?.editionDisqualified).toBe(true);
    const current = vote?.groups.find((group) => group.normalizedValue === "2.4");
    expect(current?.editionSortKey).toBe(202609);
    expect(current?.editionDisqualified).toBeUndefined();
  });

  it("fires the template with 2.4%, not the stale 2.5%", () => {
    const result = tryRecoveryTemplateFallback({
      question: UNEMPLOYMENT_QUESTION,
      sources: unemploymentSources(),
      mode: "enforce",
      nowMs: NOW,
    });
    expect(result.fired).toBe(true);
    expect(result.value).toBe("2.4%");
    expect(result.asOf).toBe("2026-10-31");
    expect(result.text).toContain("2.4%");
    expect(result.text).not.toContain("2.5%");
  });

  it("fires on the edition alone when the winning group is entirely undated (Q3)", () => {
    // The deterministic candidate's known weakness: no publication
    // date anywhere in its group. The edition is the value's date
    // of last resort (the search layer's edition-date fallback
    // convention), so the template can still state the current
    // value instead of refusing it.
    const sources: RecoveryValueSourceInput[] = [
      source(
        "stat.go.jp",
        "労働力調査（基本集計）2026年（令和8年）9月分結果の概要。完全失業率（季節調整値）は2.4％でした。",
        { title: "労働力調査 基本集計" },
      ),
      source(
        "news-d.example",
        "労働力調査（基本集計）2026年（令和8年）9月分の結果によると、完全失業率は2.4%でした。",
      ),
      source(
        "jil.go.jp",
        "2026年8月分の完全失業率（季節調整値）は2.5%でした。",
        { title: "労働力調査 2026年8月分 結果の概要", publishedAt: "2026-11-08" },
      ),
      source(
        "news-b.example",
        "完全失業率は2.5%に悪化しました。",
        { publishedAt: "2026-11-08" },
      ),
    ];
    const result = tryRecoveryTemplateFallback({
      question: UNEMPLOYMENT_QUESTION,
      sources,
      mode: "enforce",
      nowMs: NOW,
    });
    expect(result.fired).toBe(true);
    expect(result.value).toBe("2.4%");
    // The as-of falls back to the edition's reference month start.
    expect(result.asOf).toBe("2026-09-01");
  });

  it("leaves a pool that states only the old edition exactly as before", () => {
    // No newer edition anywhere in the pool: the discipline is
    // inert and the old value still confirms — the vote cannot
    // know an edition it was never shown (the upstream freshness
    // layers own that judgement).
    const sources = unemploymentSources().slice(2);
    const vote = voteRecoveryValues(extractRecoveryValues(sources, UNEMPLOYMENT_QUESTION));
    expect(vote?.status).toBe("confirmed");
    expect(vote?.value).toBe("2.5%");
    const stale = vote?.groups.find((group) => group.normalizedValue === "2.5");
    expect(stale?.editionDisqualified).toBeUndefined();
  });
});

describe("round-7 edition discipline: B1 job-offer ratio", () => {
  it("never confirms the old value: 1.19 leads and 1.18 is edition-disqualified", () => {
    const candidates = extractRecoveryValues(jobRatioSources(), JOB_RATIO_QUESTION);
    const vote = voteRecoveryValues(candidates);
    expect(vote).not.toBeNull();
    // 1.19 is stated by a single domain, so it cannot CONFIRM
    // (PR-3's two-domain rule is unchanged) — but the stale 1.18
    // must not confirm either. Before the measure this pool
    // confirmed 1.18 unconditionally.
    expect(vote?.value).toBe("1.19倍");
    expect(vote?.status).toBe("single");
    const stale = vote?.groups.find((group) => group.normalizedValue === "1.18");
    expect(stale?.editionSortKey).toBe(202604);
    expect(stale?.editionDisqualified).toBe(true);
  });

  it("does not fire the template with the stale 1.18", () => {
    const result = tryRecoveryTemplateFallback({
      question: JOB_RATIO_QUESTION,
      sources: jobRatioSources(),
      mode: "enforce",
      nowMs: NOW,
    });
    expect(result.fired).toBe(false);
    expect(result.value).toBeUndefined();
  });

  it("confirms and fires 1.19 once a second domain states September's value", () => {
    const sources: RecoveryValueSourceInput[] = [
      ...jobRatioSources(),
      source(
        "news-c.example",
        "有効求人倍率は1.19倍に上昇しました。",
        { publishedAt: "2026-10-30" },
      ),
    ];
    const vote = voteRecoveryValues(extractRecoveryValues(sources, JOB_RATIO_QUESTION));
    expect(vote?.status).toBe("confirmed");
    expect(vote?.value).toBe("1.19倍");
    const result = tryRecoveryTemplateFallback({
      question: JOB_RATIO_QUESTION,
      sources,
      mode: "enforce",
      nowMs: NOW,
    });
    expect(result.fired).toBe(true);
    expect(result.value).toBe("1.19倍");
    expect(result.asOf).toBe("2026-10-30");
  });
});

describe("round-7 edition discipline: B2 real GDP", () => {
  it("confirms the current quarter's -0.0% over the restated 0.3%", () => {
    const candidates = extractRecoveryValues(gdpSources(), GDP_QUESTION);
    const vote = voteRecoveryValues(candidates);
    expect(vote?.status).toBe("confirmed");
    expect(vote?.normalizedValue).toBe("0");
    const stale = vote?.groups.find((group) => group.normalizedValue === "0.3");
    expect(stale?.editionSortKey).toBe(202606);
    expect(stale?.editionDisqualified).toBe(true);
  });

  it("fires the template with -0.0%, not 0.3%", () => {
    const result = tryRecoveryTemplateFallback({
      question: GDP_QUESTION,
      sources: gdpSources(),
      mode: "enforce",
      nowMs: NOW,
    });
    expect(result.fired).toBe(true);
    expect(result.value).toBe("-0.0%");
    expect(result.asOf).toBe("2026-11-17");
  });
});
