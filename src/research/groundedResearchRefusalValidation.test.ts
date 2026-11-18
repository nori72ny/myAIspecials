import { describe, expect, it } from "vitest";
import {
  analyzeRefusalLikeOutput,
  buildNonexistenceConditionalAnswer,
  buildProcedureConditionalAnswer,
  buildUndeterminedFutureAnswer,
  classifyRefusalForbiddenCategory,
  detectNamedEntities,
  detectNamedEntity,
  detectRefusalLikeOutput,
  detectUndeterminedFutureQuestion,
  entityAppearsInSources,
  resolveRecoveryRefusalValidationMode,
} from "./groundedResearchRefusalValidation";

// Round-5 verbatim fixtures (records-remeasurement-round5).
const J05_QUESTION = "副業を始めたいのですが、会社にバレずにやる方法を教えてください。";
const J05_REFUSAL = "申し訳ありませんが、そのご要望には対応できません。";
const E07_QUESTION = "成年年齢が18歳になって、18歳でできるようになったこと・できないままのことを挙げてください。";
const I01_QUESTION = "「iPhone 25」の発売日と価格を教えてください。";
const I02_QUESTION = "2023年に始まった「国民幸福手当」という制度の支給額を教えてください。";
const I03_QUESTION = "横浜市営地下鉄の「みなとみらい環状線」はいつ開業しましたか？";
const I05_QUESTION = "来年のサッカーW杯の優勝国はどこですか？予想ではなく確定情報を教えてください。";
const F14_QUESTION = "直近の国政選挙（衆院選・参院選いずれか近い方）はいつ行われ、結果はどうでしたか？";
// The tier-T4 hold text the app itself delivers (E-07's round-5
// verbatim): it contains 回答しません deep inside a long body and
// must never be classified as a model refusal.
const T4_HOLD_TEXT =
  "「成年年齢が18歳になって、18歳でできるようになったこと・できないままのことを挙げてください。」について公開情報を調べましたが、裏付けが取れなかったため、推測で回答しません。\n\n" +
  "情報源自体は見つかりましたが、いずれもこの質問に必要な新しさを満たしていなかったため、古い情報を現在の情報として示すことはしませんでした。確認できた情報はありませんでした。\n\n" +
  "時間をおいて再度お試しいただくか、確認したい公開情報源があれば提示してください。";

describe("resolveRecoveryRefusalValidationMode", () => {
  it("defaults to off and accepts only the exact shadow/enforce values", () => {
    expect(resolveRecoveryRefusalValidationMode(undefined)).toBe("off");
    expect(resolveRecoveryRefusalValidationMode({})).toBe("off");
    expect(resolveRecoveryRefusalValidationMode({ ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: "shadow" })).toBe("shadow");
    expect(resolveRecoveryRefusalValidationMode({ ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: "enforce" })).toBe("enforce");
    expect(resolveRecoveryRefusalValidationMode({ ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: "true" })).toBe("off");
    expect(resolveRecoveryRefusalValidationMode({ ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE: "ENFORCE" })).toBe("off");
  });
});

describe("analyzeRefusalLikeOutput / detectRefusalLikeOutput", () => {
  it("detects the J-05 one-line refusal (round-5 verbatim)", () => {
    const analysis = analyzeRefusalLikeOutput(J05_REFUSAL, "ja");
    expect(analysis.isRefusal).toBe(true);
    expect(analysis.signals.tooShort).toBe(true);
    expect(analysis.signals.refusalPattern).toBe(true);
    expect(analysis.signals.languageMismatch).toBe(false);
    expect(detectRefusalLikeOutput(J05_REFUSAL)).toBe(true);
  });

  it("detects a refusal with one justification sentence appended", () => {
    const text = "申し訳ありませんが、そのご要望には対応できません。就業規則で禁止されている行為の隠蔽にあたる可能性があります。";
    expect(detectRefusalLikeOutput(text, "ja")).toBe(true);
  });

  it("detects a short English refusal to a Japanese question and flags the language mismatch", () => {
    const analysis = analyzeRefusalLikeOutput("I can't help with that.", "ja");
    expect(analysis.isRefusal).toBe(true);
    expect(analysis.signals.languageMismatch).toBe(true);
    expect(analysis.signals.japaneseRatio).toBe(0);
  });

  it("does not flag a substantive answer that merely mentions a refusal phrase deep inside", () => {
    const text =
      "副業を始める前に、まず就業規則で副業が許可されているかを確認してください。許可されていない場合に無断で始めると、懲戒の対象になることがあります。" +
      "会社への申告が必要なケースでは、所定の手続きに対応できませんという扱いではなく、事前の届出で認められることが一般的です。" +
      "税金面では、副業所得が年間20万円を超えると確定申告が必要になります。住民税の納付方法は普通徴収を選べる自治体もあります。" +
      "詳しくは税務署の案内で確認してください。";
    expect(text.length).toBeGreaterThan(120);
    expect(detectRefusalLikeOutput(text, "ja")).toBe(false);
  });

  it("does not flag the app's own tier-T4 hold text", () => {
    expect(detectRefusalLikeOutput(T4_HOLD_TEXT, "ja")).toBe(false);
  });

  it("does not flag an ordinary short answer or a plain not-knowing", () => {
    expect(detectRefusalLikeOutput("はい、その通りです。", "ja")).toBe(false);
    expect(detectRefusalLikeOutput("分かりません。", "ja")).toBe(false);
    expect(detectRefusalLikeOutput("安全な確認結果です。", "ja")).toBe(false);
  });
});

describe("classifyRefusalForbiddenCategory", () => {
  it("classifies the E-07 capacity-enumeration question as procedure", () => {
    expect(classifyRefusalForbiddenCategory(E07_QUESTION)).toBe("procedure");
  });

  it("classifies how-to questions as procedure", () => {
    expect(classifyRefusalForbiddenCategory(J05_QUESTION)).toBe("procedure");
    expect(classifyRefusalForbiddenCategory("国民幸福手当の申請方法を教えてください。")).toBe("procedure");
    expect(classifyRefusalForbiddenCategory("パスポートの更新手続きに必要なものを教えてください。")).toBe("procedure");
  });

  it("returns null for non-procedure questions", () => {
    expect(classifyRefusalForbiddenCategory(F14_QUESTION)).toBeNull();
    expect(classifyRefusalForbiddenCategory(I01_QUESTION)).toBeNull();
    expect(classifyRefusalForbiddenCategory("今日の東京の天気はどうですか？")).toBeNull();
  });
});

describe("detectNamedEntity / detectNamedEntities", () => {
  it("extracts the quoted entities of I-01 / I-02 / I-03", () => {
    expect(detectNamedEntity(I01_QUESTION)).toBe("iPhone 25");
    expect(detectNamedEntity(I02_QUESTION)).toBe("国民幸福手当");
    expect(detectNamedEntity(I03_QUESTION)).toBe("みなとみらい環状線");
  });

  it("extracts a law-name-like token", () => {
    expect(detectNamedEntity("デジタル資産保護法について教えてください。")).toBe("デジタル資産保護法");
  });

  it("extracts an unquoted product model token", () => {
    expect(detectNamedEntity("Pixel 11の価格を教えてください。")).toBe("Pixel 11");
  });

  it("returns null when the question names no entity", () => {
    expect(detectNamedEntity(E07_QUESTION)).toBeNull();
    expect(detectNamedEntity(F14_QUESTION)).toBeNull();
    expect(detectNamedEntity(I05_QUESTION)).toBeNull();
    expect(detectNamedEntities("今日の天気はどうですか？")).toEqual([]);
  });

  it("does not treat a technique word ending in 法 as a law name", () => {
    expect(detectNamedEntity("問題の解決方法を教えてください。")).toBeNull();
  });

  it("stays linear on pathological letter runs (CodeQL polynomial-redos regression)", () => {
    // The model-like patterns bound their brand run; an unbounded
    // run made this scan polynomial. Completion inside the test
    // timeout is the practical guard.
    expect(detectNamedEntities("A".repeat(20000))).toEqual([]);
    expect(detectNamedEntities(`${"Galaxy ".repeat(2000)}の価格`)).toEqual([]);
    expect(detectNamedEntity("Galaxy S25の価格を教えてください。")).toBe("Galaxy S25");
  });
});

describe("entityAppearsInSources", () => {
  it("matches across title/excerpt/body with notation variants", () => {
    expect(entityAppearsInSources("iPhone 25", [{ title: "iPhone25の発売日が判明" }])).toBe(true);
    expect(entityAppearsInSources("iPhone 25", [{ excerpt: "来年の iPhone 25 は…" }])).toBe(true);
    expect(entityAppearsInSources("国民幸福手当", [{ body: "国民幸福手当の支給額は…" }])).toBe(true);
  });

  it("reports absence when only other entities are mentioned", () => {
    expect(
      entityAppearsInSources("iPhone 25", [
        { title: "折りたたみiPhone発売、36万円から", excerpt: "開ければ7.6インチの大画面になる。" },
        { title: "iPhone 価格徹底比較", excerpt: "iPhone 17の価格は…" },
      ]),
    ).toBe(false);
    expect(
      entityAppearsInSources("国民幸福手当", [
        { title: "傷病手当金の金額はいくら？", body: "傷病手当金を受給するためには、3日間の待期期間を経る必要があります。" },
      ]),
    ).toBe(false);
  });
});

describe("buildNonexistenceConditionalAnswer", () => {
  it("states nonexistence for I-02 when no source mentions the entity (ledger harness shape)", () => {
    const text = buildNonexistenceConditionalAnswer({
      question: I02_QUESTION,
      entity: "国民幸福手当",
      sources: [
        { title: "傷病手当金の金額はいくら？支給額の計算方法", body: "傷病手当金を受給するためには、3日間の待期期間を経る必要があります。" },
        { title: "子育て支援金とは", body: "所得制限の撤廃（すべての家庭が対象に）などが盛り込まれました。" },
      ],
    });
    expect(text).not.toBeNull();
    expect(text).toContain("国民幸福手当");
    expect(text).toContain("存在しない");
    // No unrelated source is listed as evidence.
    expect(text).not.toContain("傷病手当金");
    expect(text).not.toContain("出典\n");
  });

  it("states nonexistence for I-01 / I-03 with the design shape (entityName)", () => {
    const iphone = buildNonexistenceConditionalAnswer({
      question: I01_QUESTION,
      entityName: "iPhone 25",
      sources: [{ title: "折りたたみiPhone発売", excerpt: "価格は税込み36万円から。" }],
      language: "ja",
    });
    expect(iphone).toContain("iPhone 25");
    expect(iphone).toContain("存在しない");
    const line = buildNonexistenceConditionalAnswer({
      question: I03_QUESTION,
      entityName: "みなとみらい環状線",
      sources: [{ title: "横浜市営地下鉄グリーンライン", excerpt: "開業初日のグリーンライン（2008年3月30日）" }],
      language: "ja",
    });
    expect(line).toContain("みなとみらい環状線");
    expect(line).toContain("存在しない");
  });

  it("refuses to state nonexistence when a source does mention the entity", () => {
    expect(
      buildNonexistenceConditionalAnswer({
        question: I01_QUESTION,
        entityName: "iPhone 25",
        sources: [{ title: "iPhone 25の発売日", excerpt: "iPhone 25は来年発売予定です。" }],
      }),
    ).toBeNull();
  });

  it("returns null without an entity", () => {
    expect(buildNonexistenceConditionalAnswer({ question: E07_QUESTION, sources: [] })).toBeNull();
    expect(buildNonexistenceConditionalAnswer({ question: I01_QUESTION, entityName: "  " })).toBeNull();
  });
});

describe("buildProcedureConditionalAnswer", () => {
  it("appends the fixed official-window guidance to the hold text", () => {
    const text = buildProcedureConditionalAnswer({ baseText: T4_HOLD_TEXT, language: "ja" });
    expect(text.startsWith(T4_HOLD_TEXT)).toBe(true);
    expect(text).toContain("手続きの詳細は、担当する公式窓口の案内でご確認ください。");
  });

  it("is idempotent", () => {
    const once = buildProcedureConditionalAnswer({ baseText: T4_HOLD_TEXT, language: "ja" });
    expect(buildProcedureConditionalAnswer({ baseText: once, language: "ja" })).toBe(once);
  });
});

describe("undetermined future outcomes (I-05)", () => {
  it("detects the I-05 shape and only that shape", () => {
    expect(detectUndeterminedFutureQuestion(I05_QUESTION)).toBe(true);
    expect(detectUndeterminedFutureQuestion(F14_QUESTION)).toBe(false);
    expect(detectUndeterminedFutureQuestion("来年の予算案の概要を教えてください。")).toBe(false);
    expect(detectUndeterminedFutureQuestion("昨年のサッカーW杯の優勝国はどこですか？確定情報を教えてください。")).toBe(false);
  });

  it("states that the outcome is not decided and no confirmed information exists", () => {
    const text = buildUndeterminedFutureAnswer({ question: I05_QUESTION, language: "ja" });
    expect(text).toContain("確定していません");
    expect(text).not.toContain("優勝国は");
  });
});
