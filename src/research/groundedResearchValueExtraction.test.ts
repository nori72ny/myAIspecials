import { describe, expect, it } from "vitest";
import {
  classifyRecoveryAnswerType,
  extractAndVoteRecoveryValues,
  extractRecoveryValues,
  logRecoveryValueVoteShadow,
  resolveRecoveryValueVoteMode,
  voteRecoveryValues,
  type RecoveryCandidateValue,
  type RecoveryValueSourceInput,
} from "./groundedResearchValueExtraction";

function candidate(
  partial: Partial<RecoveryCandidateValue> & Pick<RecoveryCandidateValue, "normalizedValue">,
): RecoveryCandidateValue {
  return {
    type: "rate_percent",
    displayValue: partial.normalizedValue,
    sourceIndex: 0,
    domain: "example.com",
    authorityTier: "general",
    inTitleOnly: false,
    packetScore: 5,
    ...partial,
  };
}

describe("classifyRecoveryAnswerType", () => {
  it("classifies the round-5 F-group question shapes", () => {
    // F-03 asks for the rate first, the decision date second: the
    // rate wins (a rate question whose answer also carries a date).
    expect(classifyRecoveryAnswerType("日銀の政策金利は今いくつですか？いつ決まったものですか？")).toBe("rate_percent");
    expect(classifyRecoveryAnswerType("現在の日本の総人口は何人ですか？")).toBe("count_people");
    expect(classifyRecoveryAnswerType("レギュラーガソリンの全国平均価格を教えてください")).toBe("price_money");
    expect(classifyRecoveryAnswerType("Windows 11の最新のバージョンを教えてください")).toBe("version");
    expect(classifyRecoveryAnswerType("今年の日本シリーズで優勝したチームはどこですか？")).toBe("team_name");
    expect(classifyRecoveryAnswerType("現在の日本の内閣総理大臣は誰ですか？")).toBe("person_name");
  });

  it("does not call a bare duration (何年) a date question (E-02)", () => {
    expect(
      classifyRecoveryAnswerType("交通事故の損害賠償請求権の時効は何年ですか？"),
    ).not.toBe("date");
  });
});

describe("voteRecoveryValues boundaries", () => {
  it("does not confirm a value stated by a single domain", () => {
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "2.4", domain: "a.example", sourceIndex: 0 }),
      candidate({ normalizedValue: "2.4", domain: "a.example", sourceIndex: 0 }),
    ]);
    expect(vote?.status).toBe("single");
  });

  it("does not confirm a title-only value even across two domains", () => {
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "2.4", domain: "a.example", sourceIndex: 0, inTitleOnly: true }),
      candidate({ normalizedValue: "2.4", domain: "b.example", sourceIndex: 1, inTitleOnly: true }),
    ]);
    expect(vote?.status).toBe("single");
    expect(vote?.groups[0].titleOnly).toBe(true);
  });

  it("confirms when two independent domains state the value in body text", () => {
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "2.4", domain: "a.example", sourceIndex: 0 }),
      candidate({ normalizedValue: "2.4", domain: "b.example", sourceIndex: 1 }),
    ]);
    expect(vote?.status).toBe("confirmed");
    expect(vote?.domains).toEqual(["a.example", "b.example"]);
  });

  it("weights official domains above a larger number of general domains", () => {
    // Design weights: official 3 / major-news 2 / specialist 2 /
    // general 1. official+major (5) beats three generals (3).
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "100", domain: "stat.go.jp", authorityTier: "official", sourceIndex: 0 }),
      candidate({ normalizedValue: "100", domain: "news.example", authorityTier: "major-news", sourceIndex: 1 }),
      candidate({ normalizedValue: "90", domain: "g1.example", sourceIndex: 2 }),
      candidate({ normalizedValue: "90", domain: "g2.example", sourceIndex: 3 }),
      candidate({ normalizedValue: "90", domain: "g3.example", sourceIndex: 4 }),
    ]);
    expect(vote?.status).toBe("confirmed");
    expect(vote?.normalizedValue).toBe("100");
    expect(vote?.score).toBe(5);
  });

  it("calls an exact tie at the top contested", () => {
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "100", domain: "a.example", sourceIndex: 0 }),
      candidate({ normalizedValue: "100", domain: "b.example", sourceIndex: 1 }),
      candidate({ normalizedValue: "90", domain: "c.example", sourceIndex: 2 }),
      candidate({ normalizedValue: "90", domain: "d.example", sourceIndex: 3 }),
    ]);
    expect(vote?.status).toBe("contested");
  });

  it("degrades to contested when a rival holds a strictly newer value date (F-03 shape)", () => {
    // Five general domains mention June's 1.0 somewhere; three state
    // September's 1.25. The score leader is the stale value, so the
    // date-conflict guard must stop the confirmation.
    const june = { statedDate: "2026-06-01" };
    const september = { statedDate: "2026-09-01" };
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "1", domain: "a.example", sourceIndex: 0, ...june }),
      candidate({ normalizedValue: "1", domain: "b.example", sourceIndex: 1, ...june }),
      candidate({ normalizedValue: "1", domain: "c.example", sourceIndex: 2 }),
      candidate({ normalizedValue: "1", domain: "d.example", sourceIndex: 3 }),
      candidate({ normalizedValue: "1", domain: "e.example", sourceIndex: 4 }),
      candidate({ normalizedValue: "1.25", domain: "d.example", sourceIndex: 3, ...september }),
      candidate({ normalizedValue: "1.25", domain: "e.example", sourceIndex: 4, ...september }),
      candidate({ normalizedValue: "1.25", domain: "f.example", sourceIndex: 5, ...september }),
    ]);
    expect(vote?.status).toBe("contested");
  });

  it("confirms the newer value when it also leads on score", () => {
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "1", domain: "a.example", sourceIndex: 0, statedDate: "2026-06-01" }),
      candidate({ normalizedValue: "1", domain: "b.example", sourceIndex: 1, statedDate: "2026-06-01" }),
      candidate({ normalizedValue: "1.25", domain: "c.example", authorityTier: "official", sourceIndex: 2, statedDate: "2026-09-01" }),
      candidate({ normalizedValue: "1.25", domain: "d.example", sourceIndex: 3, statedDate: "2026-09-01" }),
    ]);
    expect(vote?.status).toBe("confirmed");
    expect(vote?.normalizedValue).toBe("1.25");
  });

  it("gives the recency bonus to the group holding the newest value date", () => {
    const vote = voteRecoveryValues([
      candidate({ normalizedValue: "100", domain: "a.example", sourceIndex: 0, statedDate: "2026-10-01" }),
      candidate({ normalizedValue: "100", domain: "b.example", sourceIndex: 1 }),
      candidate({ normalizedValue: "90", domain: "c.example", authorityTier: "official", sourceIndex: 2 }),
      candidate({ normalizedValue: "90", domain: "d.example", sourceIndex: 3 }),
    ]);
    // 100-group: 1 + 1 + 1 (recency) = 3; 90-group: 3 + 1 = 4.
    // The official-backed 90 still wins on weight; the bonus only
    // shows in the 100-group's score.
    const group100 = vote?.groups.find((g) => g.normalizedValue === "100");
    expect(group100?.score).toBe(3);
  });
});

describe("extraction guards (round-5 shapes)", () => {
  const populationSources: RecoveryValueSourceInput[] = [
    {
      title: "人口推計（2026年10月報）",
      url: "https://www.stat.go.jp/data/jinsui/",
      domain: "stat.go.jp",
      authorityTier: "official",
      excerpt:
        "＜総人口＞ １億２２６９万人で、前年同月に比べ減少 ▲５３万人 （▲０．４３％）",
    },
    {
      title: "日本の総人口1億2,269万人、53万人減 総務省が10月推計を公表",
      url: "https://news.example/population",
      domain: "news.example",
      authorityTier: "major-news",
      excerpt: "2026年10月1日現在の日本の総人口は1億2269万人でした。",
    },
    {
      title: "Population by Country",
      url: "https://www.worldometers.info/population/",
      domain: "worldometers.info",
      excerpt: "The current population of Japan is 122,256,017 based on the United Nations estimates.",
    },
  ];

  it("F-07: confirms the Statistics Bureau figure, not the UN estimate", () => {
    const vote = extractAndVoteRecoveryValues(
      populationSources,
      "現在の日本の総人口は何人ですか？",
    );
    expect(vote?.status).toBe("confirmed");
    expect(vote?.normalizedValue).toBe("122690000");
    expect(vote?.value).toContain("1億2269万人");
    expect(vote?.domains).toContain("stat.go.jp");
  });

  it("F-07: the ▲53万人 delta never becomes a population candidate", () => {
    const candidates = extractRecoveryValues(
      populationSources,
      "現在の日本の総人口は何人ですか？",
    );
    expect(
      candidates.some((c) => c.normalizedValue === "530000"),
    ).toBe(false);
  });

  it("parses composed Japanese numbers (1億2281万2千 = 122,812,000)", () => {
    const candidates = extractRecoveryValues(
      [
        {
          title: "人口推計",
          url: "https://www.stat.go.jp/x",
          domain: "stat.go.jp",
          excerpt: "総人口は１億２２８１万２千人でした。",
        },
      ],
      "現在の日本の総人口は何人ですか？",
    );
    expect(candidates.map((c) => c.normalizedValue)).toContain("122812000");
  });

  it("F-03: the left side of a change construction is the previous rate", () => {
    const candidates = extractRecoveryValues(
      [
        {
          title: "政策金利",
          url: "https://smd-am.example/x",
          domain: "smd-am.example",
          excerpt: "日本銀行は2026年9月に政策金利を1.00％から1.25％へ引き上げた。",
        },
      ],
      "日銀の政策金利は今いくつですか？",
    );
    const values = candidates.map((c) => c.normalizedValue);
    expect(values).toContain("1.25");
    expect(values).not.toContain("1");
  });

  it("F-03: a rate inside a forecast-only frame is not extracted", () => {
    const candidates = extractRecoveryValues(
      [
        {
          title: "政策金利の見通し",
          url: "https://example.com/x",
          domain: "example.com",
          excerpt: "政策金利は2027年に1.75％まで引き上げられると見込んでいる。",
        },
      ],
      "日銀の政策金利は今いくつですか？",
    );
    expect(candidates).toHaveLength(0);
  });

  it("F-04: a price labelled 基準 is a target, not the current price", () => {
    const candidates = extractRecoveryValues(
      [
        {
          title: "ガソリン価格",
          url: "https://example.com/x",
          domain: "example.com",
          excerpt: "レギュラーガソリンの平均価格は170円で、12月に基準175円へ引き上げの見通し。",
        },
      ],
      "レギュラーガソリンの全国平均価格を教えてください",
    );
    const values = candidates.map((c) => c.normalizedValue);
    expect(values).toContain("170");
    expect(values).not.toContain("175");
  });

  it("F-09: short and full team names vote together", () => {
    const vote = extractAndVoteRecoveryValues(
      [
        {
          title: "日本シリーズ",
          url: "https://toyokeizai.example/x",
          domain: "toyokeizai.example",
          excerpt: "ソフトバンクホークスが4連勝で日本一に輝いた。ソフトバンクホークスの優勝は5年ぶり。",
        },
        {
          title: "日本シリーズ結果",
          url: "https://jobpitch.example/x",
          domain: "jobpitch.example",
          excerpt: "日本シリーズはソフトバンクが優勝した。ソフトバンクの優勝で幕を閉じた。",
        },
      ],
      "今年の日本シリーズで優勝したチームはどこですか？",
    );
    expect(vote?.status).toBe("confirmed");
    expect(vote?.normalizedValue).toBe("ソフトバンク");
  });

  it("F-13: the same domain twice is still one domain (no confirmation)", () => {
    const vote = extractAndVoteRecoveryValues(
      [
        {
          title: "Windows 11 release health",
          url: "https://learn.microsoft.com/a",
          domain: "learn.microsoft.com",
          excerpt: "The latest version is Windows 11, version 26H2.",
        },
        {
          title: "Windows 11 updates",
          url: "https://learn.microsoft.com/b",
          domain: "learn.microsoft.com",
          excerpt: "Windows 11 version 26H2 is now available.",
        },
      ],
      "Windows 11の最新のバージョンを教えてください",
    );
    expect(vote?.status).toBe("single");
  });
});

describe("shadow-mode wiring", () => {
  it("resolveRecoveryValueVoteMode defaults to off", () => {
    expect(resolveRecoveryValueVoteMode(undefined)).toBe("off");
    expect(resolveRecoveryValueVoteMode({})).toBe("off");
    expect(resolveRecoveryValueVoteMode({ ORIGIN_RECOVERY_VALUE_VOTE_MODE: "on" })).toBe("off");
    expect(resolveRecoveryValueVoteMode({ ORIGIN_RECOVERY_VALUE_VOTE_MODE: "shadow" })).toBe("shadow");
  });

  it("logRecoveryValueVoteShadow logs flat scalar fields and returns the vote", () => {
    const logged: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const vote = logRecoveryValueVoteShadow({
      requestId: "req-1",
      question: "現在の日本の総人口は何人ですか？",
      sources: [
        {
          title: "人口推計",
          url: "https://www.stat.go.jp/x",
          domain: "stat.go.jp",
          authorityTier: "official",
          excerpt: "総人口は１億２２６９万人でした。",
        },
        {
          title: "人口ニュース",
          url: "https://news.example/x",
          domain: "news.example",
          excerpt: "日本の総人口は1億2269万人でした。",
        },
      ],
      logger: (message, fields) => logged.push({ message, fields }),
    });
    expect(vote?.status).toBe("confirmed");
    expect(logged).toHaveLength(1);
    expect(logged[0].fields.recoveryVoteStatus).toBe("confirmed");
    expect(logged[0].fields.recoveryVoteValue).toBe("122690000");
    // Flat scalars only: no nested objects ride the log line.
    for (const value of Object.values(logged[0].fields)) {
      expect(["string", "number"]).toContain(typeof value);
    }
  });

  it("logRecoveryValueVoteShadow never throws on empty input", () => {
    const vote = logRecoveryValueVoteShadow({
      requestId: "req-2",
      question: "現在の日本の総人口は何人ですか？",
      sources: [],
      logger: () => undefined,
    });
    expect(vote).toBeNull();
  });
});

describe("S-3: triangle-sign rates in the ESRI GDP release shape (round 7)", () => {
  // Fixture provenance: the head of the Tavily-extract linearization
  // of the real ESRI summary PDF (gaiyou2631.pdf, 2026年7-9月期
  // 1次速報), reproduced locally with pdf.js content-stream order
  // plus the production intake transform (whitespace collapse,
  // 2,000-character cap) of extractTavilyPages. The PDF emits the
  // headline block bottom-up, so the value run "▲0.0％（年率
  // ▲0.1％）となった。" arrives as a label-less sentence of its own,
  // ahead of the sentence carrying its label. Before the fix the
  // rate extractor dropped the ▲ sign: the headline entered the
  // vote as +0.0% / +0.1% and the real ▲0.4% merged into the
  // nominal +0.4% group.
  const esriSource: RecoveryValueSourceInput = {
    title: "2026年7-9月期四半期別GDP速報（1次速報値） 結果の概要",
    url: "https://www.esri.cao.go.jp/jp/sna/data/data_list/sokuhou/files/2026/qe263/pdf/gaiyou2631.pdf",
    domain: "esri.cao.go.jp",
    authorityTier: "official",
    excerpt: "Ⅰ．国内総生産（支出側）及び各需要項目 GDP(Expenditure Approach) and Its Components 1．ポイント Main Points(Japanese) ［１］ＧＤＰ成長率（季節調整済前期比） ［２］ＧＤＰの内外需別の寄与度 ▲0.6％ptとなった。また、名目は国内需要（内需）が1.5％pt、財貨・サービスの純輸出 令 和 8 年 11 月 16 日 内 閣 府 経 済 社 会 総 合 研 究 所 国 民 経 済 計 算 部 となった。 ▲0.0％（年率▲0.1％）となった。また、名目ＧＤＰの成長率は、0.4％（年率1.6％） 2026 年 7 ～ 9 月 期 の 実 質 Ｇ Ｄ Ｐ （ 国 内 総 生 産 ・ 2020 暦 年 連 鎖 価 格 ） の 成 長 率 は 、 ＧＤＰ成長率のうち、どの需要がＧＤＰをどれだけ増加させたかを示す寄与度でみる と、実質は国内需要（内需）が0.6％pt、財貨・サービスの純輸出（輸出－輸入）が （輸出－輸入）が▲1.1％ptとなった。 Economic and Social Research Institute Cabinet Office, Government of Japan Released: 2026.11.16 2026年7～9月期四半期別ＧＤＰ速報 （１次速報値） Quarterly Estimates of GDP for July - September 2026 (First Preliminary Estimates) -0.4 0.3 0.5 0.4 -0.0 -2.0 -1.0 0.0 1.0 2.0 3.0 7-9 2025 10-12 1-3 2026 4-6 7-9 (％) 実質ＧＤＰ成長率の推移 0.2 1.1 0.7 1.4 0.4 -2.0 -1.0 0.0 1.0 2.0 3.0 7-9 2025 10-12 1-3 2026 4-6 7-9 (％) 名目ＧＤＰ成長率の推移 -0.3 0.3 0.1 -0.2 0.6 -0.1 -0.0 0.3 0.6 -0.6 -3.0 -2.0 -1.0 0.0 1.0 2.0 3.0 4.0 7-9 2025 10-12 1-3 2026 4-6 7-9 (％pt) 実質ＧＤＰの内外需要別寄与度の推移 外需寄与度 内需寄与度 0.2 0.9 0.7 1.2 1.5 -0.0 0.2 0.0 0.2 -1.1 -3.0 -2.0 -1.0 0.0 1.0 2.0 3.0 4.0 7-9 2025 10-12 1-3 2026 4-6 7-9 (％pt) 名目ＧＤＰの内外需要別寄与度の推移 外需寄与度 内需寄与度 ［３］需要項目別の動向（季節調整済前期比） （１）民間需要の動向 民間最終消費支出は 、 実質▲0.3％（4～6月期は▲0.3％） 、 名目0.5％（4～6月期は 0.8 ％ ） と な っ た 。 そ の う ち 、 家 計 最 終 消 費 支 出 は 、 実 質 ▲ 0.3 ％ （ 4 ～ 6 月 期 は ▲ 0.4％） 、 名目0.4％（4～6月期は0.7％）となった 。 家計最終消費支出（除く持ち家の帰属 家賃）は 、 実質▲0.4％（4～6月期は▲0.5％） 、 名目0.4％（4～6月期は0.8％）となった 。",
  };
  const gdpQuestion = "実質GDPの最新の成長率を教えてください";

  it("keeps the ▲ sign: the headline -0.0% / annualized -0.1% become candidates", () => {
    const candidates = extractRecoveryValues([esriSource], gdpQuestion);
    const displays = candidates.map((c) => c.displayValue);
    expect(displays).toContain("-0.0%");
    expect(displays).toContain("-0.1%");
    expect(displays).not.toContain("0.1%");
    const annualized = candidates.find((c) => c.displayValue === "-0.1%");
    expect(annualized?.normalizedValue).toBe("-0.1");
  });

  it("does not merge a negative real figure into the positive group of the same magnitude", () => {
    const candidates = extractRecoveryValues([esriSource], gdpQuestion);
    const group04 = candidates.filter((c) => c.normalizedValue === "0.4");
    const groupMinus04 = candidates.filter((c) => c.normalizedValue === "-0.4");
    // The nominal +0.4% statements stay positive; the real ▲0.4%
    // (household consumption) is its own negative candidate.
    expect(group04.length).toBeGreaterThan(0);
    expect(groupMinus04.length).toBeGreaterThan(0);
    expect(group04.every((c) => c.displayValue === "0.4%")).toBe(true);
  });

  it("confirms -0.0% when a second domain states the same value in ASCII form", () => {
    const vote = extractAndVoteRecoveryValues(
      [
        esriSource,
        {
          title: "実質GDP、前期比-0.0%",
          url: "https://news.example/gdp",
          domain: "news.example",
          authorityTier: "major-news",
          excerpt: "2026年7～9月期の実質GDPは前期比-0.0%だった。",
        },
      ],
      gdpQuestion,
    );
    expect(vote?.status).toBe("confirmed");
    expect(vote?.value).toBe("-0.0%");
    expect(vote?.domains).toEqual(["esri.cao.go.jp", "news.example"]);
  });

  it("signs a bare triangle rate and leaves an unattached section-mark ▲ unsigned", () => {
    const candidates = extractRecoveryValues(
      [
        {
          title: "統計",
          url: "https://example.com/x",
          domain: "example.com",
          excerpt:
            "消費者物価は△0.2％となった。▲2026年7～9月期の実質成長率は0.5%となった。",
        },
      ],
      "実質成長率を教えてください",
    );
    const values = candidates.map((c) => c.normalizedValue);
    expect(values).toContain("-0.2");
    expect(values).toContain("0.5");
    expect(values).not.toContain("-0.5");
  });

  it("keeps the change-construction exclusion for a triangle-signed left side", () => {
    const candidates = extractRecoveryValues(
      [
        {
          title: "成長率",
          url: "https://example.com/y",
          domain: "example.com",
          excerpt: "前期比は▲0.5%から0.2%へ変化した。",
        },
      ],
      "成長率を教えてください",
    );
    const values = candidates.map((c) => c.normalizedValue);
    expect(values).toContain("0.2");
    expect(values).not.toContain("-0.5");
  });
});
