import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { originGroqRouteSystemInstruction } from "./originChatResponsePolicy";
import { PROPOSAL_DECK_SKELETON_INSTRUCTION } from "../artifacts/proposalDeckSkeletonV1";
import type { OriginProviderExecutionResult } from "./originProviderClient";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient";

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0];
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;
const result = (text: string): OriginProviderExecutionResult => ({
  text,
  actualCostUsd: 0,
  providerDataPolicy: { allowProviderFallbacks: false, dataCollection: "deny", requireZeroDataRetention: true },
  routingEvidence: {
    requestedModel: evidence.modelId,
    servedModel: evidence.modelId,
    strategy: "adaptive-primary",
    provider: "OpenRouter",
    attempt: 1,
    fallbackUsed: false,
  },
  usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
});

function appWith(streamExecute: OriginProviderStreamExecutor) {
  const app = express();
  app.use(express.json());
  app.use(createOriginStreamingChatRouter({
    env: { OPENROUTER_API_KEY: "synthetic-key" },
    streamExecute,
    catalogNow,
    createRequestId: () => "origin-stream-test",
  }));
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

const DECK_PROMPT = "営業部向けに、業務効率化ツールの導入を提案する提案資料を作ってください。スライド形式でお願いします。";

// Regression (2026-11-13 production, PROPOSAL_CHAT_TRIAGE_2026-11-13
// cause A): this natural phrasing — the exact first message sent in the
// production check — contains none of スライド / 提案書 / 資料を作成, so
// the intent catalog assigned no outputs and the deck path never fired.
// The deck trigger must accept 「提案資料を作ってください」 directly.
const PRODUCTION_DECK_PROMPT = "中小企業向けのクラウド会計サービスの販促提案資料を作ってください";

const SKELETON_ANSWER = `# 業務効率化ツール導入のご提案
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

function completeEvent(text: string): Record<string, unknown> {
  const line = text.split("\n").find((entry) => entry.includes('"type":"complete"'));
  expect(line).toBeDefined();
  return JSON.parse(line!.replace(/^data: /, "")) as Record<string, unknown>;
}

describe("createOriginStreamingChatRouter proposal deck (PR-3a)", () => {
  it("adds the skeleton instruction and attaches a pptx artifact on the completion event", async () => {
    let seenInstruction = "";
    let seenGroqInstruction: string | undefined;
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenInstruction = providerRequest.systemInstruction;
      seenGroqInstruction = providerRequest.groqSystemInstruction;
      handlers.onDelta(SKELETON_ANSWER);
      return result(SKELETON_ANSWER);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: DECK_PROMPT }] });

    expect(response.status).toBe(200);
    // The skeleton instruction rides on the standard instruction, and —
    // since 資料第1波 (2026-11-25) — also on the compact Groq instruction
    // as a dynamic addendum, so a route-3 answer can match the skeleton
    // too (before this, a route-3 answer never matched and produced no
    // file). The compact base itself stays byte-identical: the addendum
    // is not part of its character-budget contract, the same carriage as
    // the premise-guard block and the deck-records suffix.
    expect(seenInstruction).toContain("提案資料の作成形式（この依頼専用の追加ルール）");
    expect(seenGroqInstruction).toBe(
      `${originGroqRouteSystemInstruction()}\n\n${PROPOSAL_DECK_SKELETON_INSTRUCTION}`,
    );

    const complete = completeEvent(response.text);
    expect(complete.modelId).toBe(evidence.modelId);
    expect(complete.costEvidenceStatus).toBe("NOT_MEASURED");
    const artifacts = complete.artifacts as Array<Record<string, unknown>>;
    expect(Array.isArray(artifacts)).toBe(true);
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0];
    expect(artifact.artifactType).toBe("pptx");
    expect(artifact.kind).toBe("presentation");
    expect(String(artifact.id)).toMatch(/^artifact-pptx-[a-f0-9]{20}$/);
    const bytes = Buffer.from(String(artifact.data), "base64");
    expect(bytes.length).toBe(artifact.byteLength);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
    expect(bytes.includes(Buffer.from("ppt/presentation.xml"))).toBe(true);
    // No failure note is appended when the file is produced.
    expect(response.text).not.toContain("資料ファイルの作成はできませんでした");
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
  });

  it("fires for the natural production phrasing without any catalog keyword", async () => {
    let seenInstruction = "";
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenInstruction = providerRequest.systemInstruction;
      handlers.onDelta(SKELETON_ANSWER);
      return result(SKELETON_ANSWER);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PRODUCTION_DECK_PROMPT }] });

    expect(response.status).toBe(200);
    expect(seenInstruction).toContain("提案資料の作成形式（この依頼専用の追加ルール）");
    const complete = completeEvent(response.text);
    const artifacts = complete.artifacts as Array<Record<string, unknown>>;
    expect(Array.isArray(artifacts)).toBe(true);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifactType).toBe("pptx");
    expect(response.text).not.toContain("資料ファイルの作成はできませんでした");
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
  });

  it("attaches no file and appends the failure note when the answer is not in skeleton form", async () => {
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta("構成案だけの自由文の回答です。");
      return result("構成案だけの自由文の回答です。");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: DECK_PROMPT }] });

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('"artifacts"');
    const noteIndex = response.text.indexOf("資料ファイルの作成はできませんでした");
    const completeIndex = response.text.indexOf('"type":"complete"');
    expect(noteIndex).toBeGreaterThan(-1);
    expect(noteIndex).toBeLessThan(completeIndex);
    // The completion proof itself keeps its legacy shape.
    expect(response.text).toContain(`data: {"type":"complete","modelId":"${evidence.modelId}","servedModel":"${evidence.modelId}","costEvidenceStatus":"NOT_MEASURED","fallbackUsed":false}`);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
  });

  it("fires for a report-material request without 提案/企画 wording (DG-1 S-6, switch OFF)", async () => {
    let seenInstruction = "";
    let seenGroqInstruction: string | undefined;
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenInstruction = providerRequest.systemInstruction;
      seenGroqInstruction = providerRequest.groqSystemInstruction;
      handlers.onDelta(SKELETON_ANSWER);
      return result(SKELETON_ANSWER);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "四半期の経営レポート資料を作ってください" }] });

    expect(response.status).toBe(200);
    expect(seenInstruction).toContain("提案資料の作成形式（この依頼専用の追加ルール）");
    expect(seenGroqInstruction).toBe(
      `${originGroqRouteSystemInstruction()}\n\n${PROPOSAL_DECK_SKELETON_INSTRUCTION}`,
    );
    const complete = completeEvent(response.text);
    const artifacts = complete.artifacts as Array<Record<string, unknown>>;
    expect(Array.isArray(artifacts)).toBe(true);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifactType).toBe("pptx");
    expect(response.text).not.toContain("資料ファイルの作成はできませんでした");
  });

  it("leaves ordinary chat completely unchanged (no skeleton instruction, no artifacts key)", async () => {
    let seenInstruction = "";
    let seenGroqInstruction: string | undefined;
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenInstruction = providerRequest.systemInstruction;
      seenGroqInstruction = providerRequest.groqSystemInstruction;
      handlers.onDelta("短い案内文です。");
      return result("短い案内文です。");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "短い案内文を作ってください" }] });

    expect(response.status).toBe(200);
    expect(seenInstruction).not.toContain("提案資料の作成形式");
    // Non-deck requests keep the compact Groq instruction byte-identical
    // (no deck addendum) — the 資料第1波 carriage is deck-only.
    expect(seenGroqInstruction).toBe(originGroqRouteSystemInstruction());
    expect(response.text).not.toContain('"artifacts"');
    expect(response.text).not.toContain("資料ファイルの作成はできませんでした");
    expect(response.text).toContain(`data: {"type":"complete","modelId":"${evidence.modelId}","servedModel":"${evidence.modelId}","costEvidenceStatus":"NOT_MEASURED","fallbackUsed":false}`);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
  });
});

describe("createOriginStreamingChatRouter proposal deck wave-2 (units 1 & 3)", () => {
  // The S-5 shape from the 2026-11-25 remeasurement: a campaign-spec
  // deck request — a planning kind AND a deck request at once. The
  // planning instruction used to impose its premise table and required
  // parts on the same generation that had to follow the deck skeleton,
  // and the answer came back in the planning form (no deck).
  const PLANNING_DECK_PROMPT =
    "秋の販促キャンペーンの仕様資料を作ってください。素材: 期間は6週間、対象商品は3点、値引き率は15%、予算は600万円、期間中の売上目標は5000万円、来客は20%増の想定です。";

  it("deck + planning profile: instructions keep the number discipline but drop the premise table and required parts", async () => {
    let seenInstruction = "";
    let seenGroqInstruction: string | undefined;
    let seenDeckFlag: boolean | undefined;
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenInstruction = providerRequest.systemInstruction;
      seenGroqInstruction = providerRequest.groqSystemInstruction;
      seenDeckFlag = providerRequest.deckRequest;
      handlers.onDelta(SKELETON_ANSWER);
      return result(SKELETON_ANSWER);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: PLANNING_DECK_PROMPT }] });

    expect(response.status).toBe(200);
    // The deck path fired and the planning profile resolved (the
    // number discipline is present, so the absence checks below are
    // not vacuous).
    expect(seenInstruction).toContain("提案資料の作成形式（この依頼専用の追加ルール）");
    expect(seenInstruction).toContain("Number discipline (hard rule)");
    expect(seenGroqInstruction).toContain("- Numbers:");
    // Unit 1: no structural demands compete with the skeleton. (The
    // pin targets the planning protocol's own lines: the base chat
    // instruction mentions premise tables conditionally in its
    // correction rules, which is not a structural demand and stays.)
    expect(seenInstruction).not.toContain("Answer structure — premise table first");
    expect(seenInstruction).not.toContain("Required parts for this kind");
    expect(seenGroqInstruction).not.toContain("Premise table first");
    expect(seenGroqInstruction).not.toContain("Required parts:");
    // Unit 3: the deck mark rides the provider request for route 3.
    expect(seenDeckFlag).toBe(true);
    const complete = completeEvent(response.text);
    const artifacts = complete.artifacts as Array<Record<string, unknown>>;
    expect(Array.isArray(artifacts)).toBe(true);
    expect(artifacts).toHaveLength(1);
  });

  it("the same planning prompt without a deck request keeps the premise table and required parts", async () => {
    let seenInstruction = "";
    let seenGroqInstruction: string | undefined;
    let seenDeckFlag: boolean | undefined;
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenInstruction = providerRequest.systemInstruction;
      seenGroqInstruction = providerRequest.groqSystemInstruction;
      seenDeckFlag = providerRequest.deckRequest;
      handlers.onDelta("計画の本文です。");
      return result("計画の本文です。");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "秋の販促キャンペーンの計画を立ててください。予算は600万円です。" }] });

    expect(response.status).toBe(200);
    expect(seenInstruction).toContain("Number discipline (hard rule)");
    expect(seenInstruction).toContain("Answer structure — premise table first");
    expect(seenInstruction).toContain("Required parts for this kind");
    expect(seenGroqInstruction).toContain("Premise table first");
    expect(seenGroqInstruction).toContain("Required parts:");
    expect(seenDeckFlag).toBeUndefined();
    expect(response.text).not.toContain('"artifacts"');
  });

  // S-6 shape: the draft is cut off mid-skeleton (finish_reason=length)
  // and cannot be assembled. Exactly one continuation generation —
  // carrying the partial draft and the fixed continuation instruction —
  // recovers it.
  const CUT_INDEX = SKELETON_ANSWER.indexOf("## 費用・効果");
  const TRUNCATED_DRAFT = SKELETON_ANSWER.slice(0, CUT_INDEX);
  const CONTINUATION = SKELETON_ANSWER.slice(CUT_INDEX - 30);

  it("truncated deck draft: one continuation generation recovers the deck", async () => {
    const seenRequests: Array<{ messages: Array<{ role: string; content: string }>; deckRequest?: boolean }> = [];
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenRequests.push(providerRequest);
      if (seenRequests.length === 1) {
        handlers.onDelta(TRUNCATED_DRAFT);
        return { ...result(TRUNCATED_DRAFT), truncated: true };
      }
      return result(CONTINUATION);
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: DECK_PROMPT }] });

    expect(response.status).toBe(200);
    expect(streamExecute).toHaveBeenCalledTimes(2);
    const continuationMessages = seenRequests[1].messages;
    expect(continuationMessages[continuationMessages.length - 2]).toEqual({
      role: "assistant",
      content: TRUNCATED_DRAFT,
    });
    expect(continuationMessages[continuationMessages.length - 1]).toEqual({
      role: "user",
      content: "直前の回答が出力上限で途切れました。途切れた箇所から最後まで不足部分だけを続けてください。",
    });
    const complete = completeEvent(response.text);
    const artifacts = complete.artifacts as Array<Record<string, unknown>>;
    expect(Array.isArray(artifacts)).toBe(true);
    expect(artifacts).toHaveLength(1);
    // The recovered completion no longer reports the truncation.
    expect("truncated" in complete).toBe(false);
    expect(response.text).not.toContain("資料ファイルの作成はできませんでした");
  });

  it("truncated deck draft: when the continuation still cannot assemble, the failure shape is unchanged", async () => {
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta(TRUNCATED_DRAFT);
      return { ...result(TRUNCATED_DRAFT), truncated: true };
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: DECK_PROMPT }] });

    expect(response.status).toBe(200);
    // Exactly one continuation was attempted (two executions total).
    expect(streamExecute).toHaveBeenCalledTimes(2);
    expect(response.text).not.toContain('"artifacts"');
    expect(response.text).toContain("資料ファイルの作成はできませんでした");
    const complete = completeEvent(response.text);
    expect(complete.truncated).toBe(true);
  });

  it("a non-truncated deck failure never triggers a continuation", async () => {
    const streamExecute = vi.fn(async (_providerRequest, handlers) => {
      handlers.onDelta("構成案だけの自由文の回答です。");
      return result("構成案だけの自由文の回答です。");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: DECK_PROMPT }] });

    expect(response.status).toBe(200);
    expect(streamExecute).toHaveBeenCalledTimes(1);
    expect(response.text).toContain("資料ファイルの作成はできませんでした");
  });
});
