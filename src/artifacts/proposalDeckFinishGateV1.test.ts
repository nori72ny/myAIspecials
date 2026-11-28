/**
 * ProposalDeck Finish Gate V1 のテスト。
 *
 * 合格条件（CHATGPT_ADVICE_SCORES_2026-11-28 統括裁定）:
 * - 独立採点（2026-11-28）で再現した仕上がり欠陥4件をそのまま
 *   回帰ケースとして検出する（定型タイトル／しますです／価格の
 *   無印断定／810人×5%≠10件・全9回と予定表6件の矛盾）。
 * - 仮定明示のある金額、正しい積、整合する回数、正当な語
 *   （ますます等）は違反にしない。
 * - 接続（checkProposalDeck options / チャット経路）では shadow の
 *   意味論を守る: フィールドは分離して返り、成立可否は変えない。
 */
import { describe, expect, it } from "vitest";
import {
  checkProposalDeckFinishGate,
  type ProposalDeckFinishGateViolation,
} from "./proposalDeckFinishGateV1";
import type { ProposalDeck } from "./proposalDeckV1";
import { checkProposalDeck } from "./proposalDeckSelfCheckV1";
import { buildProposalDeckChatArtifact } from "../legacy/originProposalDeckChat";

const seg = (path: string, text: string) => ({ path, text });
const codesOf = (violations: ProposalDeckFinishGateViolation[]) =>
  violations.map((violation) => violation.code);
const check = (segments: { path: string; text: string }[]) =>
  checkProposalDeckFinishGate({ deckSegments: segments });

describe("proposalDeckFinishGate template text", () => {
  it("detects the echoed skeleton title (independent scoring 2026-11-28, defect 1)", () => {
    const violations = check([seg("title", "提案のタイトル")]);
    expect(codesOf(violations)).toEqual(["TEMPLATE_TEXT_REMAINING"]);
    expect(violations[0].path).toBe("title");
  });

  it("detects instruction example lines left in the body", () => {
    expect(codesOf(check([seg("subtitle", "副題（あれば1行だけ）")]))).toEqual([
      "TEMPLATE_TEXT_REMAINING",
    ]);
    expect(codesOf(check([seg("summary.points[0]", "要点の1つ目")]))).toEqual([
      "TEMPLATE_TEXT_REMAINING",
    ]);
    expect(codesOf(check([seg("closing.nextSteps[0]", "次に取るステップ")]))).toEqual([
      "TEMPLATE_TEXT_REMAINING",
    ]);
  });

  it("does not flag real titles or sentences that merely contain the words", () => {
    expect(check([seg("title", "新サービス導入のご提案")])).toEqual([]);
    expect(check([seg("closing.nextSteps[0]", "次に取るステップを決めます")])).toEqual([]);
  });
});

describe("proposalDeckFinishGate grammar", () => {
  it("detects doubled politeness (independent scoring 2026-11-28, defect 2)", () => {
    const violations = check([
      seg("sections[0].message", "本提案により、転記作業を自動化しますです。"),
    ]);
    expect(codesOf(violations)).toEqual(["GRAMMAR_POLITENESS_DUPLICATION"]);
    expect(
      codesOf(check([seg("sections[0].bullets[0].lead", "ご確認くださいです")])),
    ).toEqual(["GRAMMAR_POLITENESS_DUPLICATION"]);
  });

  it("does not flag correct polite forms or the adverb ますます", () => {
    expect(check([seg("sections[0].message", "本提案により、転記作業を自動化します。")])).toEqual([]);
    expect(check([seg("sections[0].message", "ますます重要性が高まります。")])).toEqual([]);
    expect(check([seg("sections[0].message", "導入で月40時間を削減できます。")])).toEqual([]);
  });
});

describe("proposalDeckFinishGate schedule counts", () => {
  it("accepts a consistent frequency × duration = total", () => {
    expect(
      check([seg("sections[3].message", "月3回開催し、3か月で全9回を実施します")]),
    ).toEqual([]);
    expect(
      check([seg("sections[3].message", "週3回開催し、3週間で全9回を実施します")]),
    ).toEqual([]);
  });

  it("detects frequency × duration contradicting the stated total", () => {
    const violations = check([
      seg("sections[3].message", "月3回開催し、3か月で全6回を実施します"),
    ]);
    expect(codesOf(violations)).toEqual(["SCHEDULE_COUNT_MISMATCH"]);
  });

  it("detects the stated total contradicting the enumerated sessions (defect 4: 全9回 vs 6 listed)", () => {
    const violations = check([
      seg(
        "sections[3].bullets[0].detail",
        "全9回開催します。第1回は顔合わせ、第2回は基礎、第3回は実践、第4回は応用、第5回は演習、第6回はまとめです",
      ),
    ]);
    expect(codesOf(violations)).toEqual(["SCHEDULE_COUNT_MISMATCH"]);
  });

  it("accepts an enumeration that matches the stated total", () => {
    expect(
      check([
        seg(
          "sections[3].bullets[0].detail",
          "全3回開催します。第1回は顔合わせ、第2回は実践、第3回はまとめです",
        ),
      ]),
    ).toEqual([]);
  });

  it("detects a session number beyond the stated total", () => {
    const violations = check([
      seg("sections[3].message", "全9回で実施します"),
      seg("sections[3].bullets[0].detail", "第10回は特別編として開催します"),
    ]);
    expect(codesOf(violations)).toEqual(["SCHEDULE_COUNT_MISMATCH"]);
  });

  it("detects a date list contradicting the stated total in the same segment", () => {
    const violations = check([
      seg("sections[3].bullets[0].detail", "全3回開催します。日程は4月1日、4月8日です"),
    ]);
    expect(codesOf(violations)).toEqual(["SCHEDULE_COUNT_MISMATCH"]);
  });

  it("does not judge while part of the schedule is still being adjusted", () => {
    expect(
      check([seg("sections[3].message", "月3回開催し、3か月で全6回を実施します（残りは調整中）")]),
    ).toEqual([]);
  });
});

describe("proposalDeckFinishGate product claims", () => {
  it("detects 810人 × 5% stated as 10件 (independent scoring 2026-11-28, defect 4)", () => {
    const violations = check([
      seg("sections[0].bullets[0].detail", "参加者810人、転換率5%で受注見込み10件を見込んでいます"),
    ]);
    expect(codesOf(violations)).toEqual(["PRODUCT_RESULT_MISMATCH"]);
  });

  it("detects an explicit formula whose stated result is wrong", () => {
    const violations = check([
      seg("sections[0].bullets[0].detail", "810人×5%=10件が受注見込みです"),
    ]);
    expect(codesOf(violations)).toEqual(["PRODUCT_RESULT_MISMATCH"]);
  });

  it("accepts correct products within the shared rounding band", () => {
    expect(
      check([seg("sections[0].bullets[0].detail", "参加者810人、転換率5%で受注見込み40件を見込んでいます")]),
    ).toEqual([]);
    expect(
      check([seg("sections[0].bullets[0].detail", "810人×5%=41件が受注見込みです")]),
    ).toEqual([]);
  });

  it("does not treat a complement or a bare rate pair as a product claim", () => {
    expect(
      check([seg("sections[0].bullets[0].detail", "参加者810人の5%が離脱し、残りは770人です")]),
    ).toEqual([]);
    expect(
      check([seg("sections[0].bullets[0].detail", "離脱率は5%で、継続率は95%です")]),
    ).toEqual([]);
  });
});

describe("proposalDeckFinishGate assumption labels", () => {
  it("detects prices asserted without any assumption label (defect 3)", () => {
    const violations = check([
      seg("sections[4].bullets[0].lead", "初期費用は300,000円です"),
      seg("sections[4].bullets[1].lead", "月額は50,000円です"),
      seg("assumptions[0]", "前提条件を置きます"),
    ]);
    expect(codesOf(violations)).toEqual([
      "ASSUMPTION_NOT_LABELED",
      "ASSUMPTION_NOT_LABELED",
    ]);
  });

  it("accepts a price labelled as an assumption in the same segment", () => {
    expect(check([seg("sections[4].bullets[0].lead", "初期費用は30万円（仮定）です")])).toEqual([]);
  });

  it("accepts a price whose value is labelled in the assumptions", () => {
    expect(
      check([
        seg("sections[4].bullets[0].lead", "初期費用は30万円です"),
        seg("assumptions[0]", "初期費用30万円は仮定です"),
      ]),
    ).toEqual([]);
  });

  it("sizes unlabelled effect figures too (shadow purpose), but not unpriced text", () => {
    expect(
      codesOf(check([seg("sections[2].message", "年間120万円のコストを削減できます")])),
    ).toEqual(["ASSUMPTION_NOT_LABELED"]);
    expect(check([seg("sections[2].message", "年間120万円を削減できます")])).toEqual([]);
  });
});

/** 総スライド数6で現行自己チェックの全ルールを満たす deck（自己チェックのテストと同じ形）。 */
function validDeck(): ProposalDeck {
  const section = (
    role: ProposalDeck["sections"][number]["role"],
    message: string,
  ): ProposalDeck["sections"][number] => ({
    role,
    message,
    bullets: [{ lead: "転記作業", detail: "週10時間を占めます" }],
  });
  return {
    title: "業務効率化ツールの導入提案",
    subtitle: "営業部の手作業を削減します",
    date: "2026-11-12",
    summary: {
      headline: "導入で営業部の月40時間を削減できます",
      points: ["月40時間の削減", "初期費用は3か月で回収", "来月から段階導入"],
    },
    sections: [
      section("challenge", "現状の手作業で月40時間が失われています"),
      section("solution", "導入で月40時間を削減できます"),
      section("value", "年間120万円のコストを削減できます"),
    ],
    closing: { ask: "導入の承認をお願いします", nextSteps: ["来週キックオフ"] },
    assumptions: ["利用人数は20名を前提とします"],
  };
}

describe("finish gate wiring via checkProposalDeck (shadow semantics)", () => {
  it("is absent unless requested, exactly like numeric grounding", () => {
    const result = checkProposalDeck(validDeck());
    expect(result.ok).toBe(true);
    expect("finishGateViolations" in result).toBe(false);
  });

  it("is separated from violations and never changes ok", () => {
    const result = checkProposalDeck(validDeck(), { finishGate: {} });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    // validDeck の効果額（年間120万円のコスト）は無印のため shadow で検出される。
    expect(result.finishGateViolations?.map((violation) => violation.code)).toEqual([
      "ASSUMPTION_NOT_LABELED",
    ]);
  });

  it("does not run when enabled is false", () => {
    const result = checkProposalDeck(validDeck(), { finishGate: { enabled: false } });
    expect("finishGateViolations" in result).toBe(false);
  });

  it("reports the echoed title as shadow while the deck still passes", () => {
    const deck = validDeck();
    deck.title = "提案のタイトル";
    const result = checkProposalDeck(deck, { finishGate: {} });
    expect(result.ok).toBe(true);
    expect(result.finishGateViolations?.map((violation) => violation.code)).toContain(
      "TEMPLATE_TEXT_REMAINING",
    );
  });
});

const CLEAN_SKELETON = `# 業務効率化ツール導入のご提案
営業部の定型作業を自動化する提案

## 要約
導入で営業部の定型作業を月40時間削減できます。
- 見積作成の自動化で月40時間を削減
- 承認フローを一本化し待ち時間を解消
- 導入費用は初年度で回収できる見込み

## 課題
営業部の定型作業が商談時間を圧迫しています。
- **見積作成に月40時間**：転記が中心で商談準備が後回しです

## 解決策
定型作業をツールへ移し、承認を一本化します。
- **見積の自動作成**：案件を選ぶだけで見積書が出ます

## 価値
生まれた時間を商談に回し、受注を伸ばせます。
- **月40時間の創出**：担当者の時間を商談へ回せます

## 計画
3か月で段階導入し、現場の負担を抑えます。
- **初月は試行導入**：一部チームで試し課題を洗います

## 費用・効果
導入費用は初年度の削減効果で回収できます。
- **初期費用は50万円（仮定）**：設定と研修を含む金額です

## 次のステップ
依頼事項：来週の部長会議で導入可否をご判断ください
- 導入範囲と開始時期を決める
- 試行チームの担当者を選ぶ
`;

const DEFECTIVE_SKELETON = CLEAN_SKELETON.replace(
  "# 業務効率化ツール導入のご提案",
  "# 提案のタイトル",
).replace(
  "定型作業をツールへ移し、承認を一本化します。",
  "定型作業をツールへ移し、承認を一本化しますです。",
);

describe("finish gate wiring via buildProposalDeckChatArtifact", () => {
  it("attaches an empty code list for a clean deck (gate ran, nothing found)", () => {
    const outcome = buildProposalDeckChatArtifact(CLEAN_SKELETON);
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.finishGateViolationCodes).toEqual([]);
  });

  it("attaches shadow codes for the echoed title and doubled politeness without changing creation", () => {
    const outcome = buildProposalDeckChatArtifact(DEFECTIVE_SKELETON);
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.finishGateViolationCodes).toContain("TEMPLATE_TEXT_REMAINING");
    expect(outcome.finishGateViolationCodes).toContain("GRAMMAR_POLITENESS_DUPLICATION");
  });
});
