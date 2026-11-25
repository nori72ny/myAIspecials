/**
 * ProposalDeck Numeric Grounding V1 のテスト。
 *
 * 合格条件（DOCUMENT_WAVE2 §4 単位2）:
 * - 再測定の実応答 S-2 / S-4: 捏造と計算誤りを検出する。
 * - 再測定の実応答 S-1 / S-3 と DG-0 の sampleAnswer 6件:
 *   正当な派生・端数処理・仮置き明示を違反にしない（major 検出ゼロ）。
 * 素材は DG-0 フィクスチャの依頼文＋素材文（本番の入力形状と同じ）。
 */
import { describe, expect, it } from "vitest";
import {
  checkProposalDeckNumericGrounding,
  extractGroundedNumericTokens,
  type ProposalDeckNumericGroundingViolation,
} from "./proposalDeckNumericGroundingV1";
import { DOCUMENT_INSPECTION_FIXTURE_CASES } from "./documentInspectionFixturesV1";
import { REMEASUREMENT_DECK_DRAFTS } from "./proposalDeckNumericGroundingV1.fixtures";
import { buildProposalDeckChatArtifact } from "../legacy/originProposalDeckChat";

/** 再測定の実施日（S-2 の当日日付の刻印を基準日として扱う）。 */
const REFERENCE_DATE = new Date("2026-11-25T00:00:00+09:00");

function fixtureCase(id: string) {
  const found = DOCUMENT_INSPECTION_FIXTURE_CASES.find((entry) => entry.id === id);
  if (!found) throw new Error(`fixture case ${id} not found`);
  return found;
}

function segmentsOf(text: string) {
  return text.split("\n").map((line, index) => ({ path: `draft[${index}]`, text: line }));
}

function checkDraft(id: string, draft: string): ProposalDeckNumericGroundingViolation[] {
  const fixture = fixtureCase(id);
  return checkProposalDeckNumericGrounding({
    deckSegments: segmentsOf(draft),
    sourceTexts: [fixture.requestText, fixture.materialsText],
    referenceDate: REFERENCE_DATE,
  });
}

const majorOf = (violations: ProposalDeckNumericGroundingViolation[]) =>
  violations.filter((violation) => violation.code !== "SOURCE_NUMERIC_MISSING");
const minorOf = (violations: ProposalDeckNumericGroundingViolation[]) =>
  violations.filter((violation) => violation.code === "SOURCE_NUMERIC_MISSING");
const messagesWith = (violations: ProposalDeckNumericGroundingViolation[], fragment: string) =>
  violations.filter((violation) => violation.message.includes(fragment));

describe("proposalDeckNumericGrounding tokenizer", () => {
  it("normalizes units into comparable values", () => {
    const tokens = extractGroundedNumericTokens(
      "売上84000千円、対象24万店、月額9800円、解約率1.5%、期間は6週間",
    );
    const byRaw = new Map(tokens.map((token) => [token.raw, token]));
    expect(byRaw.get("84000千円")).toMatchObject({ cls: "money", value: 84_000_000 });
    expect(byRaw.get("24万店")).toMatchObject({ cls: "count", value: 240_000 });
    expect(byRaw.get("9800円")).toMatchObject({ cls: "money", value: 9_800 });
    expect(byRaw.get("1.5%")).toMatchObject({ cls: "percent", value: 1.5 });
    expect(byRaw.get("6週間")).toMatchObject({ cls: "time", unit: "week", value: 6 });
  });

  it("reads a composite 億+万円 figure as one token", () => {
    const tokens = extractGroundedNumericTokens("年間売上は2億9400万円です");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ cls: "money", value: 294_000_000 });
  });

  it("extracts a full date as one token and does not fragment it", () => {
    const tokens = extractGroundedNumericTokens("（2026年11月25日時点）");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ cls: "date", dateKey: "2026-11-25" });
  });

  it("does not tokenize ordinals or period labels as quantities", () => {
    expect(extractGroundedNumericTokens("第1月から第4月まで")).toHaveLength(0);
    expect(extractGroundedNumericTokens("3年目に3000店を達成")).toHaveLength(1);
  });
});

describe("proposalDeckNumericGrounding remeasurement drafts", () => {
  it("S-1: legitimate derivations only — zero violations", () => {
    const violations = checkDraft("S-1", REMEASUREMENT_DECK_DRAFTS["S-1"]);
    expect(violations).toEqual([]);
  });

  it("S-3: legitimate derivations only — zero major violations", () => {
    const violations = checkDraft("S-3", REMEASUREMENT_DECK_DRAFTS["S-3"]);
    expect(majorOf(violations)).toEqual([]);
    // 素材の月12,000件が原稿に無いことだけが minor として残る。
    expect(minorOf(violations)).toHaveLength(1);
    expect(minorOf(violations)[0].message).toContain("12000件");
  });

  it("S-2: detects the wrong percent claim and the wrong formula result", () => {
    const violations = checkDraft("S-2", REMEASUREMENT_DECK_DRAFTS["S-2"]);
    const mismatches = violations.filter((violation) => violation.code === "NUMERIC_FORMULA_MISMATCH");
    // 「初期開発費1800万円は3年目の売上2.9億円の1.2%」（正しくは約6.2%）
    expect(messagesWith(mismatches, "1.2%")).toHaveLength(1);
    // 「月額9800円×3000店＝2億9400万円」（積は2940万円）
    expect(messagesWith(mismatches, "2億9400万円")).toHaveLength(1);
  });

  it("S-2: detects fabricated figures and deadline dates", () => {
    const violations = checkDraft("S-2", REMEASUREMENT_DECK_DRAFTS["S-2"]);
    const ungrounded = violations.filter((violation) => violation.code === "NUMERIC_NOT_GROUNDED");
    for (const raw of ["5%", "20時間", "200店", "1400店", "2026-12-10", "2026-12-15", "2026-12-20"]) {
      expect(messagesWith(ungrounded, raw).length, raw).toBeGreaterThanOrEqual(1);
    }
  });

  it("S-2: does not flag the payback bound, the labelled assumption, the reference date, or the 3-year horizon", () => {
    const violations = checkDraft("S-2", REMEASUREMENT_DECK_DRAFTS["S-2"]);
    // 投資回収2年以内は素材金額の比で裏付けられる。
    expect(messagesWith(violations, "数値です: 2年")).toHaveLength(0);
    // リピート率3%は仮置き明示のセグメント内にある。
    expect(messagesWith(violations, "数値です: 3%")).toHaveLength(0);
    // 当日日付の刻印は基準日と一致するため対象外。
    expect(messagesWith(violations, "2026年11月25日")).toHaveLength(0);
    // 「3年で」は素材の「3年目」と同じ期間を指す。
    expect(messagesWith(violations, "数値です: 3年")).toHaveLength(0);
  });

  it("S-4: detects the unit error and the fabricated cost/effect figures", () => {
    const violations = checkDraft("S-4", REMEASUREMENT_DECK_DRAFTS["S-4"]);
    const ungrounded = violations.filter((violation) => violation.code === "NUMERIC_NOT_GROUNDED");
    // 目標9000千円（素材は9000万円。千円換算で 900万円になり素材に無い）
    expect(messagesWith(ungrounded, "9000千円")).toHaveLength(1);
    for (const raw of ["30万円", "20万円", "2か月"]) {
      expect(messagesWith(ungrounded, raw).length, raw).toBeGreaterThanOrEqual(1);
    }
    // 既知の派生衝突: 「予測売上増加は約400万円」は、素材の差
    // （来月見込み8800万円 − 今月実績8400万円 = 400万円）と一致する。
    // 差分配生は S-1 の正当な派生（90−36=54時間 等）と同型であり、
    // 決定的照合では捏造と区別できないため、根拠ありとして扱う
    // （この行の捏造判定は意味層の仕事であり、shadow の数値照合の
    // 射程外であることをここに明記する）。
    expect(messagesWith(ungrounded, "400万円")).toHaveLength(0);
  });

  it("S-4: does not flag the correct percentages, and reports the two missing source figures as minor", () => {
    const violations = checkDraft("S-4", REMEASUREMENT_DECK_DRAFTS["S-4"]);
    // 93%（8400÷9000）と84%（42÷50）は正しい派生であり検出しない。
    expect(messagesWith(violations, "93%")).toHaveLength(0);
    expect(messagesWith(violations, "84%")).toHaveLength(0);
    const minor = minorOf(violations);
    expect(messagesWith(minor, "28件")).toHaveLength(1);
    expect(messagesWith(minor, "8800万円")).toHaveLength(1);
  });
});

describe("proposalDeckNumericGrounding DG-0 sample answers", () => {
  for (const id of ["S-1", "S-2", "S-3", "S-4", "S-5", "S-6"]) {
    it(`${id}: sample answer produces zero major violations`, () => {
      const fixture = fixtureCase(id);
      const violations = checkProposalDeckNumericGrounding({
        deckSegments: segmentsOf(fixture.sampleAnswer),
        sourceTexts: [fixture.requestText, fixture.materialsText],
        referenceDate: REFERENCE_DATE,
      });
      expect(majorOf(violations)).toEqual([]);
    });
  }
});

describe("proposalDeckNumericGrounding via buildProposalDeckChatArtifact (shadow wiring)", () => {
  const SKELETON_WITH_FIGURES = `# 業務効率化ツール導入のご提案
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
- **初期費用は50万円**：設定と研修を含む金額です

## 次のステップ
依頼事項：来週の部長会議で導入可否をご判断ください
- 導入範囲と開始時期を決める
- 試行チームの担当者を選ぶ
`;

  it("attaches grounding codes to a created outcome without changing creation", () => {
    const outcome = buildProposalDeckChatArtifact(SKELETON_WITH_FIGURES, {
      numericGroundingSourceTexts: ["素材: 営業部の定型作業は月10時間、初期費用は5万円です。"],
      referenceDate: REFERENCE_DATE,
    });
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    // 月40時間・50万円・3か月は素材（月10時間・5万円）に無い。
    expect(outcome.numericGroundingViolationCodes).toContain("NUMERIC_NOT_GROUNDED");
  });

  it("without source texts the outcome is exactly as before (no grounding field)", () => {
    const outcome = buildProposalDeckChatArtifact(SKELETON_WITH_FIGURES);
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect("numericGroundingViolationCodes" in outcome).toBe(false);
  });
});
