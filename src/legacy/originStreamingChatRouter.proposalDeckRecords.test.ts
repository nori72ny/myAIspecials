/**
 * D-PR-6: ORIGIN_DECK_RECORDS_ENABLED=ON のとき、資料リクエストが
 * レコード経路（起草／配置／決定的組立）を通ること。本ファイルは
 * 主として ON の配線を固定する。OFF の間の旧骨格経路は
 * originStreamingChatRouter.proposalDeck.test.ts が固定するが、
 * 資料第1波（2026-11-25）で OFF でも変わった到達性（資料リクエスト
 * 判定の文面拡張・調査経路への振り分け回避・経路3への骨格指示の
 * 同席）については、本ファイル末尾の第1波テストが固定する。
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

/** DG-1 固定フィクスチャ（documentInspectionFixturesV1 と同一文面・同一組成）。 */
const S1_MESSAGE =
  "経費精算ツール SeisanPro の導入提案資料を作ってください。素材は別途渡した試用結果と価格表のとおりです。\n\n" +
  "製品名: クラウド経費精算ツール SeisanPro。価格: 月額480円/人、初期費用0円、対象は従業員120人で月額の合計は57,600円。現状: 経費精算の作業に月90時間かかり、申請ミスが月25件ある。試用の結果（2週間）: 作業は月36時間まで減り（60%の削減）、申請ミスは月5件まで減った（80%の削減）。人件費の削減は月18万円の見込み。計画: 試用2週間、操作研修1回、本稼働まで6週間。";
const S1_PLACEMENT =
  '{"title_ref":"M15","summary_refs":["M9","M11","M12"],"sections":[' +
  '{"topic_ref":"M5","headline_ref":"M7","body_refs":["M6"]},' +
  '{"topic_ref":"M3","headline_ref":"M4","body_refs":["M2"]},' +
  '{"topic_ref":"M13","headline_ref":"M14","body_refs":["M10"]}],' +
  '"next_step_refs":["M8"],"missing":[]}';
const S3_MESSAGE =
  "物流コストの削減提案資料を作ってください。素材は現在の配送費と集約案の数値のとおりです。\n\n" +
  "現行: 配送費は年4,800万円、配送は月12,000件、拠点は5か所、配送便は週5回。集約案: 拠点を3か所に集約し、配送便を週3回にする。削減の見込み: 年1,200万円（削減率25%）。移行: 期間は4か月、移行費用は300万円、効果は本稼働の翌月から。";
const S3_PLACEMENT =
  '{"title_ref":"M16","summary_refs":["M4","M11","M13"],"sections":[' +
  '{"topic_ref":"M3","headline_ref":"M7","body_refs":["M5","M6"]},' +
  '{"topic_ref":"M8","headline_ref":"M9","body_refs":["M14"]},' +
  '{"topic_ref":"M10","headline_ref":"M15","body_refs":["M2"]}],' +
  '"next_step_refs":["M12"],"missing":[]}';
const S6_MESSAGE =
  "四半期の経営レポート資料を作ってください。素材は四半期の実績と案件の進捗のとおりです。\n\n" +
  "四半期の実績: 売上は3.2億円（前年同期比8%増）、営業利益は2,400万円。案件の進捗: 案件Aは完了、案件Bは3週間の遅れ、案件Cは予定どおり。来期の見込み: 売上3.5億円。判断事項: 採用5人の実施可否。";
const S6_PLACEMENT =
  '{"title_ref":"M15","summary_refs":["M4","M5","M6"],"sections":[' +
  '{"topic_ref":"M7","headline_ref":"M10","body_refs":["M8"]},' +
  '{"topic_ref":null,"headline_ref":"M12","body_refs":["M9"]},' +
  '{"topic_ref":"M13","headline_ref":"M14","body_refs":["M3"]}],' +
  '"next_step_refs":["M11"],"missing":[]}';

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

  it("DG-1 cause 1: route 3 (Groq) instruction also carries the placement instruction when ON", async () => {
    let seenGroqInstruction = "";
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenGroqInstruction = providerRequest.groqSystemInstruction;
      handlers.onDelta(S1_PLACEMENT);
      return makeResult(S1_PLACEMENT);
    }) as unknown as OriginProviderStreamExecutor;
    const app = express();
    app.use(express.json());
    app.use(
      createOriginStreamingChatRouter({
        env: { ...ENV_ON },
        streamExecute,
        catalogNow,
        createRequestId: () => "origin-stream-test",
      }),
    );
    app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody(S1_MESSAGE));

    expect(response.status).toBe(200);
    // 経路3の固定コンパクト指示の後ろに、配置指示＋材料一覧が動的付加として乗る。
    expect(seenGroqInstruction).toContain("提案資料の配置計画");
    expect(seenGroqInstruction).toContain("M15: 経費精算ツール SeisanPro の導入");
    const complete = completeEvent(response.text) as {
      artifacts?: Array<Record<string, unknown>>;
    };
    expect(complete.artifacts).toHaveLength(1);
  });

  it("DG-1 cause 1: mode B draft instruction is also carried to route 3 when ON", async () => {
    let seenGroqInstruction = "";
    const streamExecute = vi.fn(async (providerRequest, handlers) => {
      seenGroqInstruction = providerRequest.groqSystemInstruction;
      handlers.onDelta(VALID_DRAFT);
      return makeResult(VALID_DRAFT);
    }) as unknown as OriginProviderStreamExecutor;
    const app = express();
    app.use(express.json());
    app.use(
      createOriginStreamingChatRouter({
        env: { ...ENV_ON },
        streamExecute,
        catalogNow,
        createRequestId: () => "origin-stream-test",
      }),
    );
    app.post("/api/chat", (_req, res) => res.status(418).json({ delegated: true }));
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody("経費精算ツールの提案資料を作ってください"));

    expect(response.status).toBe(200);
    expect(seenGroqInstruction).toContain("提案資料の起草形式");
  });

  it("DG-1 cause 3: a materials-carrying deck request is not diverted to the research route when ON", async () => {
    const app = appWith({ ...ENV_ON }, S3_PLACEMENT);
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody(S3_MESSAGE));

    expect(response.status).toBe(200);
    const complete = completeEvent(response.text) as {
      artifacts?: Array<Record<string, unknown>>;
    };
    expect(complete.artifacts).toHaveLength(1);
  });

  it("資料第1波: the same request no longer delegates when the switch is OFF (skeleton path)", async () => {
    let seenInstruction = "";
    const app = appWith({ OPENROUTER_API_KEY: "synthetic-key" }, S3_PLACEMENT, (instruction) => {
      seenInstruction = instruction;
    });
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody(S3_MESSAGE));

    // DG-1 では OFF の間は調査経路へ委譲され（418）、素材つき資料化
    // 依頼は棄権で止まった。資料第1波（2026-11-25）以降は OFF でも
    // 資料経路（旧骨格経路）で処理する。配置計画の文面は骨格として
    // 読めないため成果物は付かず、旧経路の失敗注記が出る。
    expect(response.status).toBe(200);
    expect(seenInstruction).toContain("提案資料の作成形式");
    expect(seenInstruction).not.toContain("提案資料の配置計画");
    const complete = completeEvent(response.text) as { artifacts?: unknown };
    expect(complete.artifacts).toBeUndefined();
    expect(chatTextOf(response.text)).toContain("（資料ファイルの作成はできませんでした");
  });

  it("資料第1波: a report-material request reaches the deck path when the switch is OFF (DG-1 S-6)", async () => {
    let seenInstruction = "";
    const app = appWith({ OPENROUTER_API_KEY: "synthetic-key" }, S6_PLACEMENT, (instruction) => {
      seenInstruction = instruction;
    });
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody(S6_MESSAGE));

    expect(response.status).toBe(200);
    expect(seenInstruction).toContain("提案資料の作成形式");
    expect(seenInstruction).not.toContain("提案資料の配置計画");
  });

  it("DG-1 cause 4: a report-material request without 提案/企画 wording reaches the records path", async () => {
    const app = appWith({ ...ENV_ON }, S6_PLACEMENT);
    const response = await request(app)
      .post("/api/chat")
      .set("Accept", "text/event-stream")
      .send(chatBody(S6_MESSAGE));

    expect(response.status).toBe(200);
    const complete = completeEvent(response.text) as {
      artifacts?: Array<Record<string, unknown>>;
    };
    expect(complete.artifacts).toHaveLength(1);
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
