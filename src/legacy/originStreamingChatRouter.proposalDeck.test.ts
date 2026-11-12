import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter";
import { originGroqRouteSystemInstruction } from "./originChatResponsePolicy";
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
    // The skeleton instruction rides only on the standard instruction; the
    // compact Groq instruction keeps its hard character budget untouched.
    expect(seenInstruction).toContain("提案資料の作成形式（この依頼専用の追加ルール）");
    expect(seenGroqInstruction).toBe(originGroqRouteSystemInstruction());
    expect(seenGroqInstruction!.length).toBeLessThanOrEqual(3_000);

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

  it("leaves ordinary chat completely unchanged (no skeleton instruction, no artifacts key)", async () => {
    let seenInstruction = "";
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenInstruction = providerRequest.systemInstruction;
      handlers.onDelta("短い案内文です。");
      return result("短い案内文です。");
    }) as unknown as OriginProviderStreamExecutor;

    const response = await request(appWith(streamExecute))
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send({ messages: [{ role: "user", content: "短い案内文を作ってください" }] });

    expect(response.status).toBe(200);
    expect(seenInstruction).not.toContain("提案資料の作成形式");
    expect(response.text).not.toContain('"artifacts"');
    expect(response.text).not.toContain("資料ファイルの作成はできませんでした");
    expect(response.text).toContain(`data: {"type":"complete","modelId":"${evidence.modelId}","servedModel":"${evidence.modelId}","costEvidenceStatus":"NOT_MEASURED","fallbackUsed":false}`);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);
  });
});
