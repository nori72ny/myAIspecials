/**
 * D-PR-6: ORIGIN_DECK_RECORDS_ENABLED=ON のとき、資料リクエストが
 * レコード経路（起草／配置／決定的組立）を通ること。OFF の間は
 * 現行経路が無変更であることは originStreamingChatRouter.proposalDeck
 * .test.ts が証明し、本ファイルは ON の配線だけを固定する。
 */
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createOriginStreamingChatRouter } from "./originStreamingChatRouter.js";
import { DEFAULT_ORIGIN_FREE_MODEL_CATALOG } from "../lib/orchestration/OriginFreeModelCatalog.js";
import type { OriginProviderExecutionResult } from "./originProviderClient.js";
import type { OriginProviderStreamExecutor } from "./originProviderStreamClient.js";

const evidence = DEFAULT_ORIGIN_FREE_MODEL_CATALOG[0]!;
const catalogNow = () => Date.parse(evidence.verifiedAt) + 1;

function makeResult(text: string): OriginProviderExecutionResult {
  return {
    text,
    actualCostUsd: 0,
    providerDataPolicy: {
      allowProviderFallbacks: false,
      dataCollection: "deny",
      requireZeroDataRetention: true,
    },
    routingEvidence: {
      requestedModel: evidence.modelId,
      servedModel: evidence.modelId,
      strategy: "adaptive-primary",
      provider: "OpenRouter",
      attempt: 1,
      fallbackUsed: false,
    },
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costUsd: 0 },
  };
}

function appWith(
  env: Record<string, string | undefined>,
  answerText: string,
  onInstruction?: (systemInstruction: string) => void,
) {
  const streamExecute = vi.fn(async (providerRequest, handlers) => {
    onInstruction?.(providerRequest.systemInstruction);
    handlers.onDelta(answerText);
    return makeResult(answerText);
  }) as unknown as OriginProviderStreamExecutor;
  const app = express();
  app.use(express.json());
  app.use(
    createOriginStreamingChatRouter({
      env,
      streamExecute,
      catalogNow,
      createRequestId: () => "origin-stream-test",
    }),
  );
  app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
  return app;
}

function chatBody(content: string) {
  return { messages: [{ role: "user", content }] };
}

function completeEvent(text: string): Record<string, unknown> {
  const line = text
    .split("\n")
    .find((entry) => entry.includes('"type":"complete"'));
  expect(line).toBeDefined();
  return JSON.parse(line!.replace(/^data: /, "")) as Record<string, unknown>;
}

/** SSE の delta イベントを連結してチャット本文を復元する。 */
function chatTextOf(sseText: string): string {
  let text = "";
  for (const line of sseText.split("\n")) {
    if (!line.startsWith("data: {")) continue;
    const event = JSON.parse(line.slice("data: ".length)) as {
      type?: string;
      text?: string;
    };
    if (event.type === "delta" && typeof event.text === "string") {
      text += event.text;
    }
  }
  return text;
}

const ENV_ON = {
  OPENROUTER_API_KEY: "synthetic-key",
  ORIGIN_DECK_RECORDS_ENABLED: "true",
} as const;

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
  "月末に業務が集中する構造を変えられます。紙の領収書の管理に時間を取られます。仕訳の転記作業をなくせます。",
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

describe("streaming router deck records path (D-PR-6)", () => {
  it("mode B: sends the draft instruction and returns the PPTX plus a tag-free rendering", async () => {
    let seenInstruction = "";
    const app = appWith({ ...ENV_ON }, VALID_DRAFT, (instruction) => {
      seenInstruction = instruction;
    });
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody("中小企業向けのクラウド会計サービスの販促提案資料を作ってください"));

    expect(response.status).toBe(200);
    expect(seenInstruction).toContain("提案資料の起草形式");
    expect(seenInstruction).not.toContain("提案資料の作成形式");

    const complete = completeEvent(response.text) as {
      artifacts?: Array<Record<string, unknown>>;
    };
    expect(complete.artifacts).toHaveLength(1);
    expect(complete.artifacts?.[0]?.artifactType).toBe("pptx");
    expect(complete.artifacts?.[0]?.verified).toBe(true);
    // チャット本文は起草タグではなく、組立文書の決定的描画。
    const chatText = chatTextOf(response.text);
    expect(chatText).toContain("# 経理の手間を減らす仕組みのご提案");
    expect(chatText).toContain("### 現状の課題");
    expect(chatText).not.toContain("[資料タイトル]");
    expect(chatText).not.toContain("[節1_主張]");
  });

  it("mode B: an insufficient draft yields the insufficiency questions and no artifact", async () => {
    const draft = VALID_DRAFT.replace(
      "[次の一手]\nまずは無料相談をお申し込みください\n",
      "",
    );
    const app = appWith({ ...ENV_ON }, draft);
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody("中小企業向けのクラウド会計サービスの販促提案資料を作ってください"));

    expect(response.status).toBe(200);
    const complete = completeEvent(response.text) as { artifacts?: unknown };
    expect(complete.artifacts).toBeUndefined();
    const chatText = chatTextOf(response.text);
    expect(chatText).toContain("資料の作成には、次の情報が不足しています。");
    expect(chatText).toContain("提案したい次の行動");
    // 旧経路の失敗注記は新経路では出ない。
    expect(chatText).not.toContain("上記の構成案をご覧ください");
  });

  it("mode A: deterministic placement creates the deck without a deck instruction", async () => {
    let seenInstruction = "";
    const app = appWith({ ...ENV_ON }, "通常の回答文です。", (instruction) => {
      seenInstruction = instruction;
    });
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody(`次の素材で提案資料を作ってください。\n\n${STRUCTURED_MATERIAL}`));

    expect(response.status).toBe(200);
    expect(seenInstruction).not.toContain("提案資料の作成形式");
    expect(seenInstruction).not.toContain("提案資料の起草形式");
    expect(seenInstruction).not.toContain("提案資料の配置計画");

    const complete = completeEvent(response.text) as {
      artifacts?: Array<Record<string, unknown>>;
    };
    expect(complete.artifacts).toHaveLength(1);
    const chatText = chatTextOf(response.text);
    expect(chatText).toContain("# クラウド会計サービスのご提案");
    expect(chatText).toContain("経理の手間を月40時間削減できます");
    expect(chatText).not.toContain("通常の回答文です");
  });

  it("mode A: insufficient material asks for the missing pieces specifically", async () => {
    const thinMaterial = [
      "クラウド会計サービスのご提案",
      "",
      "要点",
      "",
      "- 経理の手間を月40時間削減できます",
      "- 初期費用を3か月で回収できます",
      "- 来月から段階的に導入できます",
    ].join("\n");
    const app = appWith({ ...ENV_ON }, "配置計画として解釈できない文章です。");
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody(`次の素材で提案資料を作ってください。\n\n${thinMaterial}`));

    expect(response.status).toBe(200);
    const complete = completeEvent(response.text) as { artifacts?: unknown };
    expect(complete.artifacts).toBeUndefined();
    expect(chatTextOf(response.text)).toContain("資料の作成には、次の情報が不足しています。");
  });

  it("OFF: a draft-format answer still goes through the skeleton path (no new-path rescue)", async () => {
    let seenInstruction = "";
    const app = appWith(
      { OPENROUTER_API_KEY: "synthetic-key" },
      VALID_DRAFT,
      (instruction) => {
        seenInstruction = instruction;
      },
    );
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody("中小企業向けのクラウド会計サービスの販促提案資料を作ってください"));

    expect(response.status).toBe(200);
    expect(seenInstruction).toContain("提案資料の作成形式");
    const complete = completeEvent(response.text) as { artifacts?: unknown };
    expect(complete.artifacts).toBeUndefined();
    expect(chatTextOf(response.text)).toContain("（資料ファイルの作成はできませんでした");
  });
});
