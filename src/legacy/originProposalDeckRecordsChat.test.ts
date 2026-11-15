/**
 * D-PR-6: 資料レコード経路の配線部品（キルスイッチ、モード判定、
 * 生成前計画、生成後の組立〜成果物化）。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assembleDeckFromMaterial } from "../artifacts/proposalDeckAssemblyV1.js";
import {
  buildDeckRecordsChatArtifact,
  detectDeckRecordsMode,
  isDeckRecordsEnabled,
  planDeckRecordsRequest,
  PROPOSAL_DECK_RECORDS_FAILURE_TEXT,
} from "./originProposalDeckRecordsChat.js";

describe("isDeckRecordsEnabled (§10.2)", () => {
  it("is OFF when unset and for the false spellings", () => {
    expect(isDeckRecordsEnabled({})).toBe(false);
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: "false" })).toBe(false);
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: "0" })).toBe(false);
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: "off" })).toBe(false);
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: "no" })).toBe(false);
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: " FALSE " })).toBe(false);
  });

  it("is ON for any other value", () => {
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: "true" })).toBe(true);
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: "1" })).toBe(true);
    expect(isDeckRecordsEnabled({ ORIGIN_DECK_RECORDS_ENABLED: "on" })).toBe(true);
  });
});

describe("detectDeckRecordsMode (§13-13 initial thresholds)", () => {
  it("treats a theme-only request as mode B", () => {
    expect(
      detectDeckRecordsMode("中小企業向けのクラウド会計サービスの提案資料を作ってください"),
    ).toBe("B");
  });

  it("treats a request carrying a table as mode A", () => {
    const request = [
      "この表で提案資料を作ってください",
      "| 項目 | 効果 |",
      "| --- | --- |",
      "| 仕訳 | 月40時間削減 |",
    ].join("\n");
    expect(detectDeckRecordsMode(request)).toBe("A");
  });

  it("treats a request with three or more bullet lines as mode A", () => {
    const request = [
      "提案資料を作ってください",
      "- 経理の手間を月40時間削減できます",
      "- 初期費用を3か月で回収できます",
      "- 来月から段階的に導入できます",
    ].join("\n");
    expect(detectDeckRecordsMode(request)).toBe("A");
  });

  it("treats a request with a multi-sentence body as mode A", () => {
    const request =
      "提案資料を作ってください。対象は中小企業です。経理担当者が少なく、月末に業務が集中しています。";
    expect(detectDeckRecordsMode(request)).toBe("A");
  });

  it("keeps a single sentence with two bullets in mode B", () => {
    const request = [
      "提案資料を作ってください",
      "- 経理の手間を削減できます",
      "- 初期費用を回収できます",
    ].join("\n");
    expect(detectDeckRecordsMode(request)).toBe("B");
  });
});

const VALID_DRAFT = [
  "[導入]",
  "本資料では、経理の手間を減らす進め方をご提案します。",
  "[資料タイトル]",
  "経理の手間を減らす仕組みのご提案",
  "[要点]",
  "経理の手間を月40時間削減できます",
  "初期費用を3か月で回収できます",
  "来月から段階的に導入できます",
  "[節1_題目]",
  "現状の課題",
  "[節1_主張]",
  "経理担当者が少なく、月末に業務が集中しています。",
  "[節1_本文]",
  "紙の領収書の管理に時間がかかっています",
  "仕訳の転記作業が発生しています",
  "[節2_題目]",
  "解決策",
  "[節2_主張]",
  "仕訳の自動化で月末作業の手間を減らせます。",
  "[節2_本文]",
  "領収書を撮影するだけで取り込めます",
  "転記作業が不要になります",
  "[節3_題目]",
  "導入効果",
  "[節3_主張]",
  "月40時間の作業を削減できます。",
  "[節3_本文]",
  "残業代を年間120万円削減できます",
  "月末の締め作業が2日早くなります",
  "[次の一手]",
  "まずは無料相談をお申し込みください",
  "[前提]",
  "対象は経理部門に限ります",
].join("\n");

describe("mode B wiring (draft on the ordinary generation)", () => {
  it("plans the draft instruction for a theme-only request", () => {
    const plan = planDeckRecordsRequest(
      "中小企業向けのクラウド会計サービスの提案資料を作ってください",
    );
    expect(plan.mode).toBe("B");
    expect(plan.instruction).toContain("提案資料の起草形式");
    expect(plan.deterministicAssembly).toBeNull();
  });

  it("creates a verified artifact and a tag-free chat rendering from a valid draft", () => {
    const plan = planDeckRecordsRequest(
      "中小企業向けのクラウド会計サービスの提案資料を作ってください",
    );
    const outcome = buildDeckRecordsChatArtifact({
      requestText: "中小企業向けのクラウド会計サービスの提案資料を作ってください",
      answerText: VALID_DRAFT,
      plan,
      durationMs: 1234,
    });
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    const artifact = outcome.artifact;
    expect(artifact.artifactType).toBe("pptx");
    expect(artifact.filename).toBe("経理の手間を減らす仕組みのご提案.pptx");
    const bytes = Buffer.from(artifact.data, "base64");
    expect(bytes.length).toBe(artifact.byteLength);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    expect(bytes.includes(Buffer.from("ppt/presentation.xml"))).toBe(true);
    // チャット表示は組立文書からの決定的描画であり、タグは出ない。
    expect(outcome.chatText).toContain("# 経理の手間を減らす仕組みのご提案");
    expect(outcome.chatText).toContain("### 現状の課題");
    expect(outcome.chatText).not.toContain("[節1_主張]");
    expect(outcome.chatText).not.toContain("[資料タイトル]");
    expect(outcome.metrics.mode).toBe("B");
    expect(outcome.metrics.finalForm).toBe("created");
    expect(outcome.metrics.executionCount).toBe(1);
    expect(outcome.metrics.durationMs).toBe(1234);
  });

  it("reports insufficiency with specific questions when the draft lacks next steps", () => {
    const plan = planDeckRecordsRequest(
      "中小企業向けのクラウド会計サービスの提案資料を作ってください",
    );
    const draft = VALID_DRAFT.replace("[次の一手]\nまずは無料相談をお申し込みください\n", "");
    const outcome = buildDeckRecordsChatArtifact({
      requestText: "中小企業向けのクラウド会計サービスの提案資料を作ってください",
      answerText: draft,
      plan,
    });
    expect(outcome.status).toBe("insufficient");
    if (outcome.status !== "insufficient") return;
    expect(outcome.metrics.missingCodes).toContain("MISSING_NEXT_ACTION");
    expect(outcome.chatText).toContain("資料の作成には、次の情報が不足しています。");
    expect(outcome.chatText).toContain("提案したい次の行動");
    // 作れた範囲（タイトル・要点）は部分表示される。
    expect(outcome.chatText).toContain("# 経理の手間を減らす仕組みのご提案");
  });

  it("fails (not insufficient) when the answer is not a draft at all", () => {
    const plan = planDeckRecordsRequest(
      "中小企業向けのクラウド会計サービスの提案資料を作ってください",
    );
    const outcome = buildDeckRecordsChatArtifact({
      requestText: "中小企業向けのクラウド会計サービスの提案資料を作ってください",
      answerText: "構成案だけの自由文の回答です。",
      plan,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.chatText).toBe(PROPOSAL_DECK_RECORDS_FAILURE_TEXT);
    expect(outcome.metrics.finalForm).toBe("failed");
  });
});

const STRUCTURED_MATERIAL = [
  "クラウド会計サービスのご提案",
  "",
  "要点",
  "",
  "- 経理の手間を月40時間削減できます",
  "- 初期費用を3か月で回収できます",
  "- 来月から段階的に導入できます",
  "",
  "現状の課題",
  "",
  "経理担当者が少なく、月末に業務が集中しています。紙の領収書の管理に時間がかかっています。仕訳の転記作業が発生しています。",
  "",
  "解決策",
  "",
  "仕訳の自動化で月末作業の手間を減らせます。領収書を撮影するだけで取り込めます。転記作業が不要になります。",
  "",
  "導入効果",
  "",
  "月40時間の作業を削減できます。残業代を年間120万円削減できます。月末の締め作業が2日早くなります。",
  "",
  "次の一手",
  "",
  "- まずは無料相談をお申し込みください",
].join("\n");

describe("mode A wiring (deterministic placement first)", () => {
  it("adopts the deterministic placement without any placement instruction", () => {
    const requestText = `次の素材で提案資料を作ってください。\n\n${STRUCTURED_MATERIAL}`;
    const plan = planDeckRecordsRequest(requestText);
    expect(plan.mode).toBe("A");
    expect(plan.instruction).toBeNull();
    expect(plan.deterministicAssembly?.ok).toBe(true);

    const outcome = buildDeckRecordsChatArtifact({
      requestText,
      answerText: "資料とは関係のない通常の回答文です。",
      plan,
    });
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.metrics.executionCount).toBe(0);
    expect(outcome.metrics.placementFormatKind).toBe("deterministic");
    // チャット表示は素材の逐語から組み立てられ、生成の回答文は使われない。
    expect(outcome.chatText).toContain("経理の手間を月40時間削減できます");
    expect(outcome.chatText).not.toContain("資料とは関係のない通常の回答文です");
  });

  it("plans a placement instruction when deterministic placement is insufficient", () => {
    const material = [
      "経理の手間を月40時間削減できます",
      "初期費用を3か月で回収できます",
      "来月から段階的に導入できます",
      "経理担当者が少なく、月末に業務が集中しています。",
      "紙の領収書の管理に時間がかかっています。",
      "仕訳の自動化で月末作業の手間を減らせます。",
      "領収書を撮影するだけで取り込めます。",
      "月40時間の作業を削減できます。",
      "まずは無料相談をお申し込みください",
    ].join("\n\n");
    const requestText = `次の素材で提案資料を作ってください。\n\n${material}`;
    const plan = planDeckRecordsRequest(requestText);
    expect(plan.mode).toBe("A");
    expect(plan.deterministicAssembly?.ok).toBe(false);
    expect(plan.instruction).toContain("提案資料の配置計画");
    expect(plan.instruction).toContain("材料:");
    expect(plan.instruction).toContain("M1:");
  });

  it("creates from a model placement plan when deterministic placement is insufficient", () => {
    const material = [
      "クラウド会計サービスのご提案",
      "経理の手間を月40時間削減できます",
      "初期費用を3か月で回収できます",
      "来月から段階的に導入できます",
      "経理担当者が少なく、月末に業務が集中しています。",
      "紙の領収書の管理に時間がかかっています。",
      "仕訳の自動化で月末作業の手間を減らせます。",
      "領収書を撮影するだけで取り込めます。",
      "月40時間の作業を削減できます。",
      "残業代を年間120万円削減できます。",
      "まずは無料相談をお申し込みください",
    ].join("\n\n");
    const requestText = `次の素材で提案資料を作ってください。\n\n${material}`;
    const plan = planDeckRecordsRequest(requestText);
    expect(plan.instruction).not.toBeNull();
    const units = plan.deterministicAssembly?.units ?? [];
    const idOf = (fragment: string) =>
      units.find((unit) => unit.text.includes(fragment))?.id;
    const placement = JSON.stringify({
      title_ref: idOf("クラウド会計サービスのご提案"),
      summary_refs: [
        idOf("月40時間削減できます"),
        idOf("3か月で回収できます"),
        idOf("段階的に導入できます"),
      ],
      sections: [
        {
          topic_ref: null,
          headline_ref: idOf("業務が集中しています"),
          body_refs: [idOf("領収書の管理に時間がかかっています")],
        },
        {
          topic_ref: null,
          headline_ref: idOf("手間を減らせます"),
          body_refs: [idOf("撮影するだけで取り込めます")],
        },
        {
          topic_ref: null,
          headline_ref: idOf("月40時間の作業を削減できます"),
          body_refs: [idOf("120万円削減できます")],
        },
      ],
      next_step_refs: [idOf("無料相談をお申し込みください")],
      missing: [],
    });
    const outcome = buildDeckRecordsChatArtifact({
      requestText,
      answerText: placement,
      plan,
    });
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.metrics.executionCount).toBe(1);
    expect(outcome.metrics.placementFormatKind).toBe("json");
  });

  it("falls back to the deterministic shortfall when the placement output is unparseable", () => {
    const materialWithoutNextSteps = STRUCTURED_MATERIAL.replace(
      "\n次の一手\n\n- まずは無料相談をお申し込みください",
      "",
    );
    const deterministic = assembleDeckFromMaterial({
      materialText: materialWithoutNextSteps,
    });
    expect(deterministic.ok).toBe(false);
    expect(deterministic.missing.map((entry) => entry.code)).toContain(
      "MISSING_NEXT_ACTION",
    );
    const outcome = buildDeckRecordsChatArtifact({
      requestText: materialWithoutNextSteps,
      answerText: "配置計画として解釈できない文章です。",
      plan: {
        mode: "A",
        materialUnitCount: deterministic.units.length,
        instruction: "placement",
        deterministicAssembly: deterministic,
      },
    });
    expect(outcome.status).toBe("insufficient");
    if (outcome.status !== "insufficient") return;
    expect(outcome.metrics.missingCodes).toContain("MISSING_NEXT_ACTION");
    expect(outcome.chatText).toContain("提案したい次の行動");
  });
});
