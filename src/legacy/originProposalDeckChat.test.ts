import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classifyOriginRequestIntent } from "../lib/orchestration/OriginRequestIntent";
import {
  buildProposalDeckChatArtifact,
  isProposalDeckChatRequest,
} from "./originProposalDeckChat";

const VALID_SKELETON = `# 業務効率化ツール導入のご提案
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

## 前提・未確認事項
- 費用は概算であり、正式見積もりは別途取得する
`;

describe("isProposalDeckChatRequest", () => {
  it.each([
    ["slides requested", "営業部向けに、業務効率化ツールの導入を提案する提案資料を作ってください。スライド形式でお願いします。", true],
    ["proposal document", "新サービスの提案書を作成してください。", true],
    ["proposal material without slides wording", "コスト削減の提案資料を作成してください。", true],
    ["generic report", "月次報告書を作成してください。", false],
    ["manual document", "操作手順書を作ってください。", false],
    ["ordinary chat", "今日の会議の議事録を要約してください。", false],
  ])("classifies %s", (_label, prompt, expected) => {
    const intent = classifyOriginRequestIntent(prompt, "documentation");
    expect(isProposalDeckChatRequest(intent, prompt)).toBe(expected);
  });
});

describe("buildProposalDeckChatArtifact", () => {
  it("creates a pptx payload that satisfies the client artifact contract", () => {
    const outcome = buildProposalDeckChatArtifact(VALID_SKELETON);
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    const artifact = outcome.artifact;

    // UnifiedChatCore.parseOriginArtifacts の検証条件の写し:
    expect(artifact.artifactType).toBe("pptx");
    expect(artifact.id).toMatch(/^artifact-pptx-[a-f0-9]{20}$/);
    expect(artifact.kind).toBe("presentation");
    expect(artifact.filename.endsWith(".pptx")).toBe(true);
    expect(artifact.filename).not.toMatch(/[\\/\0]/);
    expect(artifact.filename.length).toBeLessThanOrEqual(240);
    expect(artifact.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.byteLength).toBeGreaterThan(0);
    expect(artifact.byteLength).toBeLessThanOrEqual(1_500_000);
    expect(artifact.encoding).toBe("base64");
    expect(artifact.data.length).toBeLessThanOrEqual(2_100_000);
    expect(artifact.verified).toBe(true);
    expect(artifact.verification.length).toBeGreaterThan(0);
    expect(artifact.freeOnly).toBe(true);
    expect(artifact.costUsd).toBe(0);
    expect(artifact.paidFallbackUsed).toBe(false);

    // ダウンロード時の再検証 (sha256 / パッケージ) と一致すること:
    const bytes = Buffer.from(artifact.data, "base64");
    expect(bytes.length).toBe(artifact.byteLength);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    expect(artifact.id).toBe(`artifact-pptx-${artifact.sha256.slice(0, 20)}`);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from("ppt/presentation.xml"))).toBe(true);
  });

  it("is deterministic for the same answer", () => {
    const first = buildProposalDeckChatArtifact(VALID_SKELETON);
    const second = buildProposalDeckChatArtifact(VALID_SKELETON);
    expect(first).toEqual(second);
  });

  it("fails without a file for a free-form answer", () => {
    const outcome = buildProposalDeckChatArtifact("構成案だけの自由文の回答です。");
    expect(outcome).toEqual({
      status: "failed",
      failureCode: "PROPOSAL_DECK_PARSE_NO_HEADINGS",
      failureShape: {
        totalChars: 15,
        markdownHeadingCount: 0,
        numberedHeadingCount: 0,
        bracketStandaloneLineCount: 0,
        boldLabelLineCount: 0,
        bulletLineCount: 0,
        tableRowCount: 0,
        rejectedHeadingCount: 0,
        rejectedHeadingTooLongCount: 0,
        rejectedHeadingColonCount: 0,
        rejectedHeadingSequenceMismatchCount: 0,
      },
    });
  });

  it("keeps the generic parse code when structure exists but does not match", () => {
    const outcome = buildProposalDeckChatArtifact(
      "# 会議のメモ\n## 雑談\n- コーヒーを買う\n- 次回の日程を決める\n",
    );
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.failureCode).toBe("PROPOSAL_DECK_SKELETON_NOT_MATCHED");
      expect(outcome.failureShape?.markdownHeadingCount).toBe(2);
      expect(outcome.failureShape?.bulletLineCount).toBe(2);
    }
  });

  it("fails without a file when the summary does not have exactly three points", () => {
    const twoPoints = VALID_SKELETON.replace("- 導入費用は初年度で回収できる見込み\n", "");
    const outcome = buildProposalDeckChatArtifact(twoPoints);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.failureCode).toBe("PROPOSAL_DECK_BUILD_SUMMARY_POINTS_INVALID");
    }
  });

  it("fails without a file when a placeholder remains (self-check gate)", () => {
    const withPlaceholder = VALID_SKELETON.replace(
      "**初期費用は50万円**：設定と研修を含む金額です",
      "**初期費用は[金額]万円**：設定と研修を含む金額です",
    );
    const outcome = buildProposalDeckChatArtifact(withPlaceholder);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.failureCode).toBe("PROPOSAL_DECK_SELF_CHECK_FAILED");
      expect(outcome.violationCodes).toContain("PLACEHOLDER_REMAINING");
    }
  });
});
