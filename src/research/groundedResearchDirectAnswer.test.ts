import { describe, expect, it } from "vitest";
import type { OriginResearchSource } from "../legacy/originResearchSource";
import {
  GROUNDED_RESEARCH_FACT_SLOT_ENTRIES,
  matchGroundedResearchFactSlotEntry,
} from "./groundedResearchFactSlotsV13";
import {
  buildGroundedResearchRecordsPacket,
  evaluateGroundedResearchFactSlotStatedValues,
} from "./groundedResearchRecordsV13";
import {
  logResearchDirectAnswerShadow,
  resolveResearchDirectAnswerMode,
  tryResearchDirectAnswer,
} from "./groundedResearchDirectAnswer";

// P3-1 (WEEKLY_INSPECTION_P3_DESIGN_2026-11-23 §3 / §6): the
// deterministic direct-answer layer. The layer derives its
// candidate from the kept sources' own stated answers — at least
// two independent sources stating the same value, no competing
// stated value, no tier opposition — with no generation. These
// tests are the design's offline replay set: the Q2 replay must
// would-fire, and every should-not-fire shape must not.

function makeSource(overrides: Partial<OriginResearchSource>): OriginResearchSource {
  return {
    title: "資料",
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

const PM_QUERY = "現在の内閣総理大臣は誰ですか？";

function pmSources(): OriginResearchSource[] {
  return [
    makeSource({
      title: "内閣総理大臣の指名について",
      url: "https://www.kantei.example.go.jp/souri/",
      domain: "kantei.example.go.jp",
      excerpt: "高市早苗は、第105代内閣総理大臣に指名された。内閣総理大臣は、国会の議決により指名される。",
    }),
    makeSource({
      title: "首相ニュース",
      url: "https://news.example.co.jp/pm",
      domain: "news.example.co.jp",
      excerpt: "2026年11月現在、内閣総理大臣は高市早苗氏である。高市氏は自由民主党の総裁を務めている。",
    }),
  ];
}

describe("resolveResearchDirectAnswerMode", () => {
  it("is off unless the variable is exactly shadow or enforce", () => {
    expect(resolveResearchDirectAnswerMode(undefined)).toBe("off");
    expect(resolveResearchDirectAnswerMode({})).toBe("off");
    expect(resolveResearchDirectAnswerMode({ ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "on" })).toBe("off");
    expect(resolveResearchDirectAnswerMode({ ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "true" })).toBe("off");
    expect(resolveResearchDirectAnswerMode({ ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "shadow" })).toBe("shadow");
    expect(resolveResearchDirectAnswerMode({ ORIGIN_RESEARCH_DIRECT_ANSWER_MODE: "enforce" })).toBe("enforce");
  });
});

describe("tryResearchDirectAnswer — the Q2 replay (design §6)", () => {
  it("would-fires on the inspection's prime-minister question with two stating sources", () => {
    const attempt = tryResearchDirectAnswer({
      question: PM_QUERY,
      sources: pmSources(),
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.fired).toBe(true);
    expect(attempt.reason).toBeNull();
    expect(attempt.entryId).toBe("incumbent-prime-minister-jp");
    expect(attempt.agreementSourceCount).toBe(2);
    expect(attempt.fields).toHaveLength(1);
    expect(attempt.fields[0]).toMatchObject({
      fieldId: "holder",
      value: "高市早苗",
      tierOpposed: false,
      conflictDetected: false,
    });
    // The rendered core: the slot template sentence (base date from
    // the headline source), the verbatim quote, and the agreement
    // count — an answer with its grounds attached, not a card list.
    expect(attempt.text).toContain("2026年11月14日時点で、内閣総理大臣は高市早苗です。");
    expect(attempt.text).toContain("高市早苗は、第105代内閣総理大臣に指名された。");
    expect(attempt.text).toContain("2件の出典で一致しています");
    expect(attempt.text).toContain("[S1](https://www.kantei.example.go.jp/souri/)");
  });

  it("records the publication-gate judgement: the incumbent statement is held as position-status (§3.4)", () => {
    const attempt = tryResearchDirectAnswer({
      question: PM_QUERY,
      sources: pmSources(),
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.gateHeld).toBe(true);
    expect(attempt.gateFiringKinds).toContain("position-status");
  });

  it("computes the identical attempt in shadow and enforce (the layer itself never delivers)", () => {
    const shadow = tryResearchDirectAnswer({ question: PM_QUERY, sources: pmSources(), language: "ja", mode: "shadow" });
    const enforce = tryResearchDirectAnswer({ question: PM_QUERY, sources: pmSources(), language: "ja", mode: "enforce" });
    expect({ ...shadow, mode: "x" }).toEqual({ ...enforce, mode: "x" });
  });

  it("does not mutate the sources it reads", () => {
    const sources = pmSources();
    const before = JSON.stringify(sources);
    tryResearchDirectAnswer({ question: PM_QUERY, sources, language: "ja", mode: "shadow" });
    expect(JSON.stringify(sources)).toBe(before);
  });
});

describe("tryResearchDirectAnswer — zero false fires (design §6)", () => {
  it("mode off short-circuits: no fire, no text, no extraction", () => {
    const attempt = tryResearchDirectAnswer({
      question: PM_QUERY,
      sources: pmSources(),
      language: "ja",
      mode: "off",
    });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("mode-off");
    expect(attempt.text).toBeNull();
    expect(attempt.entryId).toBeNull();
  });

  it("does not fire on a question outside the registered fact types", () => {
    const attempt = tryResearchDirectAnswer({
      question: "内閣総理大臣の年収はいくらですか？",
      sources: pmSources(),
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("no-slot-entry");
  });

  it("does not fire on an entry-excluded question (history of officeholders)", () => {
    const attempt = tryResearchDirectAnswer({
      question: "歴代の内閣総理大臣を教えてください",
      sources: pmSources(),
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("no-slot-entry");
  });

  it("does not fire when only one source states the value", () => {
    const sources = pmSources();
    sources[1] = makeSource({
      title: "首相ニュース",
      url: "https://news.example.co.jp/pm",
      domain: "news.example.co.jp",
      excerpt: "内閣総理大臣は、国会の議決により指名される。国会議員の中から指名される。",
    });
    const attempt = tryResearchDirectAnswer({ question: PM_QUERY, sources, language: "ja", mode: "shadow" });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("SLOT_INSUFFICIENT_AGREEMENT");
  });

  it("does not fire when a third source states a competing incumbent (flat conflict)", () => {
    const sources = [
      ...pmSources(),
      makeSource({
        title: "内閣ニュース",
        url: "https://news2.example.co.jp/pm",
        domain: "news2.example.co.jp",
        excerpt: "2026年11月現在、内閣総理大臣は石破茂氏である。",
      }),
    ];
    const attempt = tryResearchDirectAnswer({ question: PM_QUERY, sources, language: "ja", mode: "shadow" });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("SLOT_SOURCE_CONFLICT");
    expect(attempt.fields[0]?.conflictDetected).toBe(true);
  });

  it("does not fire when the sources only mention a former officeholder", () => {
    const sources = [
      makeSource({
        excerpt: "前首相の石破茂氏は、退任後も党内で影響力を持っている。石破前首相は講演で経済政策に言及した。",
      }),
      makeSource({
        url: "https://news.example.co.jp/former",
        domain: "news.example.co.jp",
        excerpt: "石破茂前首相の回顧録が出版された。前内閣総理大臣としての日々を振り返っている。",
      }),
    ];
    const attempt = tryResearchDirectAnswer({ question: PM_QUERY, sources, language: "ja", mode: "shadow" });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("SLOT_NO_CANDIDATE");
  });

  it("does not fire when the name is only mentioned, never stated as the answer", () => {
    const sources = [
      makeSource({ excerpt: "高市早苗氏の政策について解説する。高市氏の経済政策は市場で注目されている。" }),
      makeSource({
        url: "https://news.example.co.jp/mention",
        domain: "news.example.co.jp",
        excerpt: "高市早苗氏へのインタビュー記事。高市氏は記者団の質問に答えた。",
      }),
    ];
    const attempt = tryResearchDirectAnswer({ question: PM_QUERY, sources, language: "ja", mode: "shadow" });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("SLOT_NO_CANDIDATE");
  });

  it("does not fire with fewer than two usable sources", () => {
    const attempt = tryResearchDirectAnswer({
      question: PM_QUERY,
      sources: [pmSources()[0]!],
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.fired).toBe(false);
    expect(attempt.reason).toBe("insufficient-sources");
  });
});

describe("tryResearchDirectAnswer — other registered fact types", () => {
  const PRICE_QUERY = "iPhone 18 Pro の価格を教えてください";

  function priceSources(): OriginResearchSource[] {
    return [
      makeSource({
        title: "iPhone 18 Pro 発表",
        url: "https://www.apple.com/jp/newsroom/iphone18",
        domain: "apple.com",
        excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。",
        retrievedAt: "2026-11-07T00:00:00.000Z",
        revisionTimestamp: "2026-09-10T00:00:00.000Z",
      }),
      makeSource({
        title: "iPhone価格まとめ",
        url: "https://example.jp/iphone",
        domain: "example.jp",
        excerpt: "iPhone 18 Proの価格は219,800円と報じられています。",
        retrievedAt: "2026-11-07T00:00:00.000Z",
      }),
    ];
  }

  it("would-fires on a product price two sources state identically", () => {
    const attempt = tryResearchDirectAnswer({
      question: PRICE_QUERY,
      sources: priceSources(),
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.fired).toBe(true);
    expect(attempt.entryId).toBe("product-price");
    expect(attempt.fields[0]).toMatchObject({ fieldId: "amount", value: "219,800円" });
    expect(attempt.text).toContain("2026年9月10日時点の価格は219,800円です。");
  });

  it("does not fire when the sources state different prices", () => {
    const sources = priceSources();
    sources[1] = makeSource({
      title: "iPhone価格まとめ",
      url: "https://example.jp/iphone",
      domain: "example.jp",
      excerpt: "iPhone 18 Proの価格は199,800円に改定されたと報じられています。",
      retrievedAt: "2026-11-07T00:00:00.000Z",
    });
    const attempt = tryResearchDirectAnswer({ question: PRICE_QUERY, sources, language: "ja", mode: "shadow" });
    expect(attempt.fired).toBe(false);
  });

  it("does not fire on a multi-amount page (no single stated price)", () => {
    const sources = priceSources();
    sources[0] = makeSource({
      title: "iPhone 18 Pro 発表",
      url: "https://www.apple.com/jp/newsroom/iphone18",
      domain: "apple.com",
      excerpt: "iPhone 18 Proの価格は219,800円。iPhone 18は169,800円で販売されている。",
      retrievedAt: "2026-11-07T00:00:00.000Z",
    });
    const attempt = tryResearchDirectAnswer({ question: PRICE_QUERY, sources, language: "ja", mode: "shadow" });
    expect(attempt.fired).toBe(false);
  });

  it("would-fires on the two-field NISA entry only when both fields are consistently stated", () => {
    const sources = [
      makeSource({
        title: "新NISAの概要",
        url: "https://www.fsa.example.go.jp/nisa/",
        domain: "fsa.example.go.jp",
        excerpt: "新NISAの年間投資枠は360万円です。生涯投資枠（非課税保有限度額）は1,800万円と定められています。",
      }),
      makeSource({
        title: "新NISAガイド",
        url: "https://guide.example.jp/nisa",
        domain: "guide.example.jp",
        excerpt: "新NISAでは年間360万円まで投資でき、生涯の非課税保有限度額は1,800万円です。",
      }),
    ];
    const attempt = tryResearchDirectAnswer({
      question: "新NISAの年間投資枠と生涯上限を教えてください",
      sources,
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.fired).toBe(true);
    expect(attempt.entryId).toBe("nisa-limits");
    expect(attempt.text).toContain("年間投資枠は360万円");
    expect(attempt.text).toContain("1,800万円");
  });

  it("does not fire when one field of a multi-field entry lacks stated agreement", () => {
    const sources = [
      makeSource({
        title: "新NISAの概要",
        url: "https://www.fsa.example.go.jp/nisa/",
        domain: "fsa.example.go.jp",
        excerpt: "新NISAの年間投資枠は360万円です。生涯投資枠（非課税保有限度額）は1,800万円と定められています。",
      }),
      makeSource({
        title: "新NISAガイド",
        url: "https://guide.example.jp/nisa",
        domain: "guide.example.jp",
        excerpt: "新NISAでは年間360万円まで投資できます。制度の詳細は金融機関で確認できます。",
      }),
    ];
    const attempt = tryResearchDirectAnswer({
      question: "新NISAの年間投資枠と生涯上限を教えてください",
      sources,
      language: "ja",
      mode: "shadow",
    });
    expect(attempt.fired).toBe(false);
  });
});

describe("evaluateGroundedResearchFactSlotStatedValues — the shared derivation", () => {
  it("derives the Q2 candidate from stated answers, with quotes and agreement", () => {
    const entry = matchGroundedResearchFactSlotEntry(PM_QUERY)!;
    const evaluation = evaluateGroundedResearchFactSlotStatedValues(
      entry,
      buildGroundedResearchRecordsPacket(pmSources()),
    );
    expect(evaluation.code).toBeNull();
    expect(evaluation.candidate?.fields.holder?.value).toBe("高市早苗");
    expect(evaluation.candidate?.fields.holder?.src).toBe("S1");
    expect(evaluation.candidate?.fields.holder?.quote).toContain("高市早苗は、第105代内閣総理大臣に指名された。");
    expect(evaluation.agreementSourceCount).toBe(2);
    expect(evaluation.supportSourceIds).toEqual(["S1", "S2"]);
  });

  it("fails closed for the vaccination entry: its vaccine field has no stated-answer extraction", () => {
    // The vaccination entry's vaccine-name value is generation-derived
    // on the records path; the deterministic layer must not invent a
    // derivation for it (design §4 boundary — extending the entry is a
    // later, separately-judged stage).
    const entry = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find((candidate) => candidate.id === "vaccination-start-jp")!;
    const evaluation = evaluateGroundedResearchFactSlotStatedValues(
      entry,
      buildGroundedResearchRecordsPacket(pmSources()),
    );
    expect(evaluation.code).toBe("SLOT_NO_CANDIDATE");
    expect(evaluation.candidate).toBeNull();
  });
});

describe("logResearchDirectAnswerShadow — the shadow record (design §3.2)", () => {
  it("records the firing breakdown and the gate judgement, and never a person name", () => {
    const attempt = tryResearchDirectAnswer({
      question: PM_QUERY,
      sources: pmSources(),
      language: "ja",
      mode: "shadow",
    });
    const calls: Array<{ message: string; fields: Record<string, unknown> }> = [];
    logResearchDirectAnswerShadow({
      requestId: "req-p3-test",
      attempt,
      logger: (message, fields) => calls.push({ message, fields }),
    });
    expect(calls).toHaveLength(1);
    const fields = calls[0]!.fields;
    expect(fields.directAnswerFired).toBe(true);
    expect(fields.directAnswerEntry).toBe("incumbent-prime-minister-jp");
    expect(fields.directAnswerAgreementSources).toBe(2);
    expect(fields.directAnswerSupportSources).toEqual(["S1", "S2"]);
    expect(fields.directAnswerGateHeld).toBe(true);
    expect(fields.directAnswerGateFiringKinds).toContain("position-status");
    expect(fields.directAnswerFields).toEqual([
      { field: "holder", statedSupport: 2, tierOpposed: false, conflict: false },
    ]);
    // Logging discipline: a person-name value is recorded as status
    // and counts only — the name itself never reaches the log.
    expect(JSON.stringify(fields)).not.toContain("高市早苗");
    expect(fields.directAnswerValues).toBeUndefined();
  });

  it("records a non-name value (numbers and codes discipline)", () => {
    const attempt = tryResearchDirectAnswer({
      question: "iPhone 18 Pro の価格を教えてください",
      sources: [
        makeSource({
          url: "https://www.apple.com/jp/newsroom/iphone18",
          domain: "apple.com",
          excerpt: "iPhone 18 Proは219,800円で、2026年9月18日に発売されます。",
          retrievedAt: "2026-11-07T00:00:00.000Z",
          revisionTimestamp: "2026-09-10T00:00:00.000Z",
        }),
        makeSource({
          url: "https://example.jp/iphone",
          domain: "example.jp",
          excerpt: "iPhone 18 Proの価格は219,800円と報じられています。",
          retrievedAt: "2026-11-07T00:00:00.000Z",
        }),
      ],
      language: "ja",
      mode: "shadow",
    });
    const calls: Array<{ message: string; fields: Record<string, unknown> }> = [];
    logResearchDirectAnswerShadow({
      requestId: "req-p3-test",
      attempt,
      logger: (message, fields) => calls.push({ message, fields }),
    });
    expect(calls[0]!.fields.directAnswerValues).toEqual({ amount: "219,800円" });
  });

  it("records a non-firing attempt with its reason and never throws on a broken logger", () => {
    const attempt = tryResearchDirectAnswer({
      question: PM_QUERY,
      sources: pmSources(),
      language: "ja",
      mode: "off",
    });
    const calls: Array<{ message: string; fields: Record<string, unknown> }> = [];
    logResearchDirectAnswerShadow({
      requestId: "req-p3-test",
      attempt,
      logger: (message, fields) => calls.push({ message, fields }),
    });
    expect(calls[0]!.fields.directAnswerFired).toBe(false);
    expect(calls[0]!.fields.directAnswerReason).toBe("mode-off");
    expect(() =>
      logResearchDirectAnswerShadow({
        requestId: "req-p3-test",
        attempt,
        logger: () => {
          throw new Error("logger down");
        },
      }),
    ).not.toThrow();
  });
});
