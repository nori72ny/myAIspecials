import { describe, expect, it } from "vitest";
import type { OriginProviderExecutionRequest, OriginProviderExecutionResult } from "../legacy/originProviderClient.js";
import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  buildQuoteFirstContractInstruction,
  buildQuoteFirstRegistry,
  buildQuoteFirstRegistrySection,
  describeQuoteFirstEngagement,
  parseQuoteFirstScaffold,
  resolveQuoteFirstMode,
  type QuoteFirstRegistry,
} from "./groundedResearchQuoteFirst.js";
import {
  adoptGroundedResearchSynthesis,
  buildGroundedResearchSynthesisInstruction,
  buildGroundedResearchSynthesisPrompt,
  executeGroundedResearchSynthesisWithRetry,
  type QuoteFirstAdoptionContext,
} from "./groundedResearchSynthesisV12.js";

// Quote-first generation contract (EXTERNAL_KNOWHOW_ANSWER_SEARCH_
// 2026-11-19 §3 item 1). The fixtures reproduce the SHAPE of the
// round-6 stale-value fatals — an old figure and a current figure
// coexisting in the source pool — for F-03 (policy rate), F-15 (GDP
// forecast vs actual), and E-15 (operating target rate). The fatal
// drafts themselves are not replayable (the round-6 live pools were
// not recorded), so these are synthetic pools of the same type.

function source(partial: Partial<OriginResearchSource> & Pick<OriginResearchSource, "title" | "url" | "excerpt">): OriginResearchSource {
  return {
    sourceType: "web-search",
    domain: "example.jp",
    rank: 1,
    evidenceLevel: "page-verified",
    retrievedAt: "2026-11-19T00:00:00.000Z",
    freshness: "recent",
    ...partial,
  } as OriginResearchSource;
}

/** F-03 shape: a blog carrying the stale 0.25%, the BOJ carrying the current 1.25%. */
const f03Sources: OriginResearchSource[] = [
  source({
    title: "政策金利は据え置き？個人ブログの解説",
    url: "https://blog.example.jp/rate",
    domain: "blog.example.jp",
    rank: 1,
    excerpt: "政策金利は0.25%程度に据え置かれています。",
  }),
  source({
    title: "金融政策決定会合の結果について",
    url: "https://www.boj.or.jp/mopo/result.htm",
    domain: "boj.or.jp",
    rank: 2,
    excerpt: "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定しました。",
  }),
];
const F03_QUESTION = "現在の政策金利は何%ですか";

/** The "gap" pool: one excerpt holding BOTH the quoted current value and an unquoted stale one. */
const gapSources: OriginResearchSource[] = [
  source({
    title: "金融政策決定会合の結果について",
    url: "https://www.boj.or.jp/mopo/result.htm",
    domain: "boj.or.jp",
    rank: 1,
    excerpt:
      "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定しました。2026年6月時点では、無担保コール翌日物は1.0%程度でした。",
  }),
  source({
    title: "日銀の金融政策に市場の注目",
    url: "https://news.example.jp/boj",
    domain: "news.example.jp",
    rank: 2,
    excerpt: "政策金利の動向に市場の注目が集まっています。",
  }),
];
const GAP_QUESTION = "現在の政策金利は何%ですか";

function entryByText(registry: QuoteFirstRegistry, fragment: string) {
  const entry = registry.entries.find((candidate) => candidate.text.includes(fragment));
  if (!entry) throw new Error(`registry has no entry containing: ${fragment}`);
  return entry;
}

function scaffoldLine(registry: QuoteFirstRegistry, fragment: string): string {
  const entry = entryByText(registry, fragment);
  return `${entry.quoteId} [${entry.sourceId}](${entry.url}): 「${entry.text}」`;
}

/**
 * The gap draft: the conclusion and the market line are bound to
 * quoted sentences; the middle unit asserts the stale 1.0% citing the
 * BOJ source. The existing validator accepts it (1.0% sits in the
 * cited excerpt's union); quote-first binding does not (the model
 * never quoted the sentence carrying 1.0%).
 */
function gapDraft(registry: QuoteFirstRegistry): string {
  return [
    "## 根拠引用",
    scaffoldLine(registry, "1.25%程度に引き上げる"),
    scaffoldLine(registry, "市場の注目が集まっています"),
    "## 結論",
    "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定しました。[S1](https://www.boj.or.jp/mopo/result.htm)",
    "## 根拠",
    "現在の政策金利は1.0%程度です。[S1](https://www.boj.or.jp/mopo/result.htm)",
    "政策金利の動向に市場の注目が集まっています。[S2](https://news.example.jp/boj)",
    "## 出典",
    "boj.or.jp・公開日不明 [S1](https://www.boj.or.jp/mopo/result.htm)",
    "news.example.jp・公開日不明 [S2](https://news.example.jp/boj)",
  ].join("\n");
}

describe("resolveQuoteFirstMode", () => {
  it("is off unless the exact shadow/enforce strings are registered (fail closed)", () => {
    expect(resolveQuoteFirstMode(undefined)).toBe("off");
    expect(resolveQuoteFirstMode({})).toBe("off");
    expect(resolveQuoteFirstMode({ ORIGIN_QUOTE_FIRST_MODE: "shadow" })).toBe("shadow");
    expect(resolveQuoteFirstMode({ ORIGIN_QUOTE_FIRST_MODE: "enforce" })).toBe("enforce");
    expect(resolveQuoteFirstMode({ ORIGIN_QUOTE_FIRST_MODE: "SHADOW" })).toBe("off");
    expect(resolveQuoteFirstMode({ ORIGIN_QUOTE_FIRST_MODE: "on" })).toBe("off");
    expect(resolveQuoteFirstMode({ ORIGIN_QUOTE_FIRST_MODE: "" })).toBe("off");
  });
});

describe("buildQuoteFirstRegistry", () => {
  it("assigns sequential Q IDs over the PR-2 packet, mapped to their sources", () => {
    const registry = buildQuoteFirstRegistry(f03Sources, F03_QUESTION);
    const stale = entryByText(registry, "0.25%");
    const current = entryByText(registry, "1.25%");
    expect(stale.sourceId).toBe("S1");
    expect(current.sourceId).toBe("S2");
    expect(registry.entries.map((entry) => entry.quoteId)).toEqual(
      registry.entries.map((_, index) => `Q${index + 1}`),
    );
    expect(registry.byId.get(current.quoteId)).toBe(current);
  });

  it("bounds the registry to the first eight sources, like the packet and the validator", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      source({
        title: `政策金利の記事${index + 1}`,
        url: `https://example.jp/a${index + 1}`,
        rank: index + 1,
        excerpt: `政策金利は${index + 1}.5%です。`,
      }),
    );
    const registry = buildQuoteFirstRegistry(many, F03_QUESTION);
    expect(registry.entries.every((entry) => entry.sourceIndex < 8)).toBe(true);
  });

  it("is empty when no source sentence is answer-bearing for the question", () => {
    const registry = buildQuoteFirstRegistry(
      [source({ title: "会社概要", url: "https://example.jp/about", excerpt: "ホーム 会社概要 アクセス 採用情報" })],
      F03_QUESTION,
    );
    expect(registry.entries).toEqual([]);
  });
});

describe("describeQuoteFirstEngagement", () => {
  it("is undefined when the mode is off, so off requests stay out of the observation entirely", () => {
    const registry = buildQuoteFirstRegistry(f03Sources, F03_QUESTION);
    expect(describeQuoteFirstEngagement("off", registry)).toBeUndefined();
  });

  it("records an armed request whose registry is empty as not engaged (the material-side population)", () => {
    const registry = buildQuoteFirstRegistry(
      [source({ title: "会社概要", url: "https://example.jp/about", excerpt: "ホーム 会社概要 アクセス 採用情報" })],
      F03_QUESTION,
    );
    expect(describeQuoteFirstEngagement("shadow", registry)).toEqual({
      quoteFirstMode: "shadow",
      quoteFirstEngaged: false,
      quoteFirstRegistryQuotes: 0,
      quoteFirstRegistrySources: 0,
    });
  });

  it("counts registry sentences and their distinct sources for an engaged request", () => {
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    const engagement = describeQuoteFirstEngagement("enforce", registry);
    expect(engagement?.quoteFirstMode).toBe("enforce");
    expect(engagement?.quoteFirstEngaged).toBe(true);
    expect(engagement?.quoteFirstRegistryQuotes).toBe(registry.entries.length);
    expect(engagement?.quoteFirstRegistrySources).toBe(
      new Set(registry.entries.map((entry) => entry.sourceIndex)).size,
    );
    expect(engagement?.quoteFirstRegistrySources).toBeGreaterThanOrEqual(1);
    expect(engagement?.quoteFirstRegistrySources).toBeLessThanOrEqual(2);
  });
});

describe("prompt and instruction builders", () => {
  it("leave the request byte-identical when no quote-first section is passed", () => {
    const prompt = buildGroundedResearchSynthesisPrompt(GAP_QUESTION, gapSources, [], "ja", []);
    expect(prompt).not.toContain("引用レジストリ");
    expect(prompt).not.toContain("quote-first");
    const instruction = buildGroundedResearchSynthesisInstruction("ja", []);
    expect(instruction).not.toContain("quote-first");
  });

  it("carry the registry lines and the contract when the caller passes them", () => {
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    const section = buildQuoteFirstRegistrySection(registry, "ja");
    const prompt = buildGroundedResearchSynthesisPrompt(GAP_QUESTION, gapSources, [], "ja", [], section);
    expect(prompt).toContain("引用レジストリ（quote-first）");
    expect(prompt).toContain("1.25%程度に引き上げることを決定しました");
    const instruction = buildGroundedResearchSynthesisInstruction(
      "ja",
      [],
      buildQuoteFirstContractInstruction("ja"),
    );
    expect(instruction).toContain("追加の契約（quote-first生成）");
    expect(instruction).toContain("## 根拠引用");
  });
});

describe("parseQuoteFirstScaffold", () => {
  const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);

  it("verifies verbatim quotes and strips the scaffold from the text", () => {
    const draft = gapDraft(registry);
    const parsed = parseQuoteFirstScaffold(draft, registry);
    expect(parsed.found).toBe(true);
    expect(parsed.declaredCount).toBe(2);
    expect(parsed.verifiedQuotes).toHaveLength(2);
    expect(parsed.invalidCount).toBe(0);
    expect(parsed.strippedText).not.toContain("根拠引用");
    expect(parsed.strippedText).toContain("## 結論");
  });

  it("rejects a fabricated quote (a number altered inside the sentence)", () => {
    const entry = entryByText(registry, "1.25%程度に引き上げる");
    const draft = [
      "## 根拠引用",
      `${entry.quoteId} [${entry.sourceId}](${entry.url}): 「日本銀行は、無担保コール翌日物を1.50%程度に引き上げることを決定しました。」`,
      "## 結論",
      "本文です。",
    ].join("\n");
    const parsed = parseQuoteFirstScaffold(draft, registry);
    expect(parsed.declaredCount).toBe(1);
    expect(parsed.verifiedQuotes).toEqual([]);
    expect(parsed.invalidCount).toBe(1);
  });

  it("rejects a genuine sentence attributed to the wrong source", () => {
    const entry = entryByText(registry, "1.25%程度に引き上げる");
    const draft = [
      "## 根拠引用",
      `${entry.quoteId} [S2](https://news.example.jp/boj): 「${entry.text}」`,
      "## 結論",
      "本文です。",
    ].join("\n");
    const parsed = parseQuoteFirstScaffold(draft, registry);
    expect(parsed.verifiedQuotes).toEqual([]);
    expect(parsed.invalidCount).toBe(1);
  });

  it("tolerates a dropped trailing sentence terminator in the model's copy", () => {
    const entry = entryByText(registry, "1.25%程度に引き上げる");
    const draft = [
      "## 根拠引用",
      `${entry.quoteId} [${entry.sourceId}](${entry.url}): 「${entry.text.replace(/。$/, "")}」`,
      "## 結論",
      "本文です。",
    ].join("\n");
    const parsed = parseQuoteFirstScaffold(draft, registry);
    expect(parsed.verifiedQuotes).toHaveLength(1);
    expect(parsed.invalidCount).toBe(0);
  });

  it("reports found=false and returns the text untouched when there is no scaffold", () => {
    const text = "## 結論\n本文です。[S1](https://www.boj.or.jp/mopo/result.htm)";
    const parsed = parseQuoteFirstScaffold(text, registry);
    expect(parsed.found).toBe(false);
    expect(parsed.strippedText).toBe(text);
  });
});

describe("adoptGroundedResearchSynthesis with a quote-first context", () => {
  it("off (no context): a scaffold-bearing draft is judged exactly as before, scaffold included", () => {
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    const adoption = adoptGroundedResearchSynthesis(gapDraft(registry), gapSources);
    expect(adoption.adopted).toBe(true);
    if (!adoption.adopted) throw new Error("expected adoption");
    expect(adoption.quoteFirst).toBeUndefined();
    expect(adoption.text).toContain("## 根拠引用");
  });

  it("shadow: the stale unit is reported unbound but the answer is delivered unchanged", () => {
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    const adoption = adoptGroundedResearchSynthesis(gapDraft(registry), gapSources, {
      quoteFirst: { mode: "shadow", registry },
    });
    expect(adoption.adopted).toBe(true);
    if (!adoption.adopted) throw new Error("expected adoption");
    // The scaffold is a working area and is never delivered...
    expect(adoption.text).not.toContain("根拠引用");
    // ...but the stale claim survives: shadow never changes the outcome.
    expect(adoption.text).toContain("現在の政策金利は1.0%程度です");
    expect(adoption.salvaged).toBe(false);
    expect(adoption.quoteFirst).toMatchObject({
      mode: "shadow",
      scaffoldFound: true,
      quotesVerified: 2,
      quotesInvalid: 0,
      unboundUnits: 1,
      unboundNumericUnits: 1,
      enforcedRemovedUnits: 0,
    });
  });

  it("enforce: the stale unit resting on an unquoted sentence is removed before the gate", () => {
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    const adoption = adoptGroundedResearchSynthesis(gapDraft(registry), gapSources, {
      quoteFirst: { mode: "enforce", registry },
    });
    expect(adoption.adopted).toBe(true);
    if (!adoption.adopted) throw new Error("expected adoption");
    expect(adoption.text).not.toContain("現在の政策金利は1.0%程度です");
    expect(adoption.text).toContain("1.25%程度に引き上げることを決定しました");
    expect(adoption.text).not.toContain("根拠引用");
    // Delivered removals ride the existing salvage fields, so the
    // partial-answer disclosure applies unchanged.
    expect(adoption.salvaged).toBe(true);
    expect(adoption.removedUnits).toBe(1);
    expect(adoption.quoteFirst).toMatchObject({
      mode: "enforce",
      unboundUnits: 1,
      enforcedRemovedUnits: 1,
    });
  });

  it("enforce rail: when most units are unbound the strip aborts and the ordinary verdict stands", () => {
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    // Only the BOJ quote is declared; the stale unit AND the market
    // unit are unbound (2 of 3 body units), so the strip must not run.
    const draft = [
      "## 根拠引用",
      scaffoldLine(registry, "1.25%程度に引き上げる"),
      "## 結論",
      "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定しました。[S1](https://www.boj.or.jp/mopo/result.htm)",
      "## 根拠",
      "現在の政策金利は1.0%程度です。[S1](https://www.boj.or.jp/mopo/result.htm)",
      "政策金利の動向に市場の注目が集まっています。[S2](https://news.example.jp/boj)",
      "## 出典",
      "boj.or.jp・公開日不明 [S1](https://www.boj.or.jp/mopo/result.htm)",
      "news.example.jp・公開日不明 [S2](https://news.example.jp/boj)",
    ].join("\n");
    const adoption = adoptGroundedResearchSynthesis(draft, gapSources, {
      quoteFirst: { mode: "enforce", registry },
    });
    expect(adoption.adopted).toBe(true);
    if (!adoption.adopted) throw new Error("expected adoption");
    expect(adoption.text).toContain("現在の政策金利は1.0%程度です");
    expect(adoption.quoteFirst).toMatchObject({
      unboundUnits: 2,
      enforcedRemovedUnits: 0,
      enforceAborted: "too-many-unbound",
    });
  });

  it("enforce fallback: when stripping would break source coverage, the unstripped verdict stands", () => {
    // No source-list section, and the unbound unit is the only body
    // citation of S2: removing it collapses coverage below the
    // required two sources, so the enforced text fails the gate and
    // the fallback must deliver the unstripped adoption instead. The
    // unit's numbers sit in S1's excerpt (the ordinary gate accepts
    // them) but in no verified quote (binding rejects the unit).
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    const soleCarrierDraft = [
      "## 根拠引用",
      scaffoldLine(registry, "1.25%程度に引き上げる"),
      scaffoldLine(registry, "市場の注目が集まっています"),
      "## 結論",
      "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定しました。[S1](https://www.boj.or.jp/mopo/result.htm)",
      "## 根拠",
      "2026年6月時点の水準は1.0%程度でした。[S1](https://www.boj.or.jp/mopo/result.htm) [S2](https://news.example.jp/boj)",
    ].join("\n");
    const adoption = adoptGroundedResearchSynthesis(soleCarrierDraft, gapSources, {
      quoteFirst: { mode: "enforce", registry },
    });
    expect(adoption.adopted).toBe(true);
    if (!adoption.adopted) throw new Error("expected adoption");
    expect(adoption.text).toContain("2026年6月時点の水準は1.0%程度でした");
    expect(adoption.quoteFirst).toMatchObject({
      enforcedRemovedUnits: 0,
      enforceFellBack: true,
    });
  });
});

describe("round-6 fatal shapes", () => {
  it("F-03 shape: asserting the stale blog value against the BOJ quote is unbound; resting on the stale quote itself is bound (binding is not a truth check)", () => {
    const registry = buildQuoteFirstRegistry(f03Sources, F03_QUESTION);
    const crossDraft = [
      "## 根拠引用",
      scaffoldLine(registry, "1.25%程度に引き上げる"),
      "## 結論",
      "現在の政策金利は0.25%程度です。[S2](https://www.boj.or.jp/mopo/result.htm)",
      "## 根拠",
      "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定しました。[S2](https://www.boj.or.jp/mopo/result.htm)",
      "## 出典",
      "blog.example.jp・公開日不明 [S1](https://blog.example.jp/rate)",
      "boj.or.jp・公開日不明 [S2](https://www.boj.or.jp/mopo/result.htm)",
    ].join("\n");
    const crossAdoption = adoptGroundedResearchSynthesis(crossDraft, f03Sources, {
      quoteFirst: { mode: "shadow", registry },
    });
    expect(crossAdoption.quoteFirst?.unboundUnits).toBeGreaterThanOrEqual(1);
    expect(crossAdoption.quoteFirst?.unboundNumericUnits).toBeGreaterThanOrEqual(1);

    const faithfulStaleDraft = [
      "## 根拠引用",
      scaffoldLine(registry, "0.25%程度に据え置かれて"),
      scaffoldLine(registry, "1.25%程度に引き上げる"),
      "## 結論",
      "政策金利は0.25%程度に据え置かれています。[S1](https://blog.example.jp/rate)",
      "## 根拠",
      "日本銀行は、無担保コール翌日物を1.25%程度に引き上げることを決定しました。[S2](https://www.boj.or.jp/mopo/result.htm)",
      "## 出典",
      "blog.example.jp・公開日不明 [S1](https://blog.example.jp/rate)",
      "boj.or.jp・公開日不明 [S2](https://www.boj.or.jp/mopo/result.htm)",
    ].join("\n");
    const faithfulAdoption = adoptGroundedResearchSynthesis(faithfulStaleDraft, f03Sources, {
      quoteFirst: { mode: "shadow", registry },
    });
    // Faithfully quoted, so bound — value choice between the two
    // quotes belongs to the PR-3 vote / §4 guard layer, not binding.
    expect(faithfulAdoption.quoteFirst?.unboundUnits).toBe(0);
  });

  it("F-15 shape: presenting the forecast value as the actual, cited to the official release, is unbound and stripped in enforce", () => {
    const f15Sources: OriginResearchSource[] = [
      source({
        title: "政府の経済見通し",
        url: "https://news.example.jp/outlook",
        domain: "news.example.jp",
        rank: 1,
        excerpt: "政府は2026年度の年間成長率を1.0%と予測しています。",
      }),
      source({
        title: "四半期別GDP速報 2026年7-9月期",
        url: "https://www.esri.cao.go.jp/gdp.htm",
        domain: "esri.cao.go.jp",
        rank: 2,
        excerpt: "2026年7-9月期の実質GDPは前期比0.0%でした。年率換算では0.1%の減少でした。",
      }),
    ];
    const question = "最新の実質GDP成長率はどうでしたか";
    const registry = buildQuoteFirstRegistry(f15Sources, question);
    const draft = [
      "## 根拠引用",
      scaffoldLine(registry, "前期比0.0%でした"),
      scaffoldLine(registry, "0.1%の減少でした"),
      "## 結論",
      "2026年7-9月期の実質GDPは前期比0.0%でした。[S2](https://www.esri.cao.go.jp/gdp.htm)",
      "## 根拠",
      "実質GDPは1.0%の成長となりました。[S2](https://www.esri.cao.go.jp/gdp.htm)",
      "年率換算では0.1%の減少でした。[S2](https://www.esri.cao.go.jp/gdp.htm) [S1](https://news.example.jp/outlook)",
      "## 出典",
      "news.example.jp・公開日不明 [S1](https://news.example.jp/outlook)",
      "esri.cao.go.jp・公開日不明 [S2](https://www.esri.cao.go.jp/gdp.htm)",
    ].join("\n");
    const adoption = adoptGroundedResearchSynthesis(draft, f15Sources, {
      quoteFirst: { mode: "enforce", registry },
    });
    expect(adoption.adopted).toBe(true);
    if (!adoption.adopted) throw new Error("expected adoption");
    expect(adoption.text).not.toContain("実質GDPは1.0%の成長となりました");
    expect(adoption.quoteFirst).toMatchObject({ unboundUnits: 1, enforcedRemovedUnits: 1 });
  });

  it("E-15 shape: the June rate asserted as current against the current official quote is unbound; the correct target-and-level answer is bound", () => {
    const e15Sources: OriginResearchSource[] = [
      source({
        title: "日銀、6月に政策金利を引き上げ",
        url: "https://news.example.jp/june",
        domain: "news.example.jp",
        rank: 1,
        excerpt: "日銀は2026年6月、政策金利を1.0%に引き上げました。",
      }),
      source({
        title: "金融政策の運営について",
        url: "https://www.boj.or.jp/mopo/operation.htm",
        domain: "boj.or.jp",
        rank: 2,
        excerpt: "日本銀行は、無担保コール翌日物を1.25%程度に誘導しています。",
      }),
    ];
    const question = "政策金利の操作対象と現在の水準を教えてください";
    const registry = buildQuoteFirstRegistry(e15Sources, question);
    const wrongDraft = [
      "## 根拠引用",
      scaffoldLine(registry, "無担保コール翌日物を1.25%程度に誘導"),
      scaffoldLine(registry, "政策金利を1.0%に引き上げました"),
      "## 結論",
      "現在の誘導水準は1.0%です。[S2](https://www.boj.or.jp/mopo/operation.htm)",
      "## 根拠",
      "2026年6月には政策金利を1.0%に引き上げました。[S1](https://news.example.jp/june)",
      "## 出典",
      "news.example.jp・公開日不明 [S1](https://news.example.jp/june)",
      "boj.or.jp・公開日不明 [S2](https://www.boj.or.jp/mopo/operation.htm)",
    ].join("\n");
    const wrongAdoption = adoptGroundedResearchSynthesis(wrongDraft, e15Sources, {
      quoteFirst: { mode: "shadow", registry },
    });
    expect(wrongAdoption.quoteFirst?.unboundUnits).toBe(1);
    expect(wrongAdoption.quoteFirst?.unboundNumericUnits).toBe(1);

    const rightDraft = [
      "## 根拠引用",
      scaffoldLine(registry, "無担保コール翌日物を1.25%程度に誘導"),
      scaffoldLine(registry, "政策金利を1.0%に引き上げました"),
      "## 結論",
      "操作対象は無担保コール翌日物で、現在の誘導水準は1.25%程度です。[S2](https://www.boj.or.jp/mopo/operation.htm)",
      "## 根拠",
      "2026年6月には政策金利を1.0%に引き上げました。[S1](https://news.example.jp/june)",
      "## 出典",
      "news.example.jp・公開日不明 [S1](https://news.example.jp/june)",
      "boj.or.jp・公開日不明 [S2](https://www.boj.or.jp/mopo/operation.htm)",
    ].join("\n");
    const rightAdoption = adoptGroundedResearchSynthesis(rightDraft, e15Sources, {
      quoteFirst: { mode: "shadow", registry },
    });
    expect(rightAdoption.quoteFirst?.unboundUnits).toBe(0);
  });
});

describe("executeGroundedResearchSynthesisWithRetry quote-first forwarding", () => {
  it("adopts the retried text under the same context (scaffold stripped, report attached)", async () => {
    const registry = buildQuoteFirstRegistry(gapSources, GAP_QUESTION);
    const context: QuoteFirstAdoptionContext = { mode: "shadow", registry };
    const initialText = "引用のない下書きです。";
    const initialAdoption = adoptGroundedResearchSynthesis(initialText, gapSources);
    expect(initialAdoption.adopted).toBe(false);
    const executionResult = {
      text: gapDraft(registry),
      transportRequestCount: 1,
      actualCostUsd: 0 as const,
      providerDataPolicy: { allowProviderFallbacks: false as const, dataCollection: "deny" as const, requireZeroDataRetention: true as const },
      routingEvidence: { requestedModel: "google/gemma-4-31b-it:free", servedModel: "google/gemma-4-31b-it:free", strategy: "adaptive-primary" as const, provider: "OpenRouter", attempt: 1 as const, fallbackUsed: false as const },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0 as const },
    } as unknown as OriginProviderExecutionResult;
    const outcome = await executeGroundedResearchSynthesisWithRetry(
      async () => executionResult,
      {
        initialRequest: {
          plan: {},
          messages: [{ role: "user", content: "question" }],
        } as unknown as OriginProviderExecutionRequest,
        initialResult: { ...executionResult, text: initialText },
        initialAdoption,
        sources: gapSources,
        language: "ja",
        elapsedMs: 0,
        enabled: true,
        assertZeroCost: () => undefined,
        quoteFirst: context,
      },
    );
    expect(outcome.retried).toBe(true);
    expect(outcome.adoption.adopted).toBe(true);
    if (!outcome.adoption.adopted) throw new Error("expected adoption");
    expect(outcome.adoption.text).not.toContain("根拠引用");
    expect(outcome.adoption.quoteFirst).toMatchObject({ mode: "shadow", scaffoldFound: true });
  });
});
