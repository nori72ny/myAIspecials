import { Router } from "express";
import { createOriginAnswerEnvelope, type OriginAnswerEnvelope } from "../lib/orchestration/OriginAnswerEnvelope.js";
import { extractProvidedOriginEvidence } from "../lib/orchestration/OriginAnswerEvidence.js";
import { detectSensitiveConversation, type OriginChatBody, validateOriginChatMessages } from "./originChatValidation.js";
import { researchCurrentInformation } from "./originResearchSource.js";

function isFreshnessRequest(message: string): boolean {
  return /最新(?:の)?(?:情報|ニュース|料金|価格|株価|相場|仕様|バージョン|モデル|状況|結果)|今日の(?:ニュース|料金|価格|株価|相場|結果)|現在の(?:ニュース|料金|価格|株価|相場|仕様|バージョン|状況)|リアルタイム/.test(message)
    || /\b(?:news|pricing|prices?|real[- ]time)\b/i.test(message)
    || /\b(?:latest|current|today'?s?)\s+(?:information|news|pricing|prices?|rates?|status|results?|version|model)\b/i.test(message);
}

function isWeatherRequest(message: string): boolean {
  return message.includes("天気") || message.includes("傘は必要") || message.includes("傘いる") || message.includes("雨降る") || message.includes("雨？") || /\bweather\b/i.test(message);
}

function languageOf(message: string): "ja" | "en" { return /[ぁ-んァ-ヶ一-龠]/.test(message) ? "ja" : "en"; }

function envelope(content: string, language: "ja" | "en", status: "passed" | "not-run", summary: string, evidence: ReturnType<typeof extractProvidedOriginEvidence>): OriginAnswerEnvelope {
  const result = createOriginAnswerEnvelope({
    language,
    conclusion: content.split("\n\n")[0].slice(0, 500),
    answer: content,
    evidence,
    verification: { status, independentReviewPerformed: status === "passed", summary },
    limitations: [language === "ja" ? "この研究経路は現在、無料の公開Wikipedia情報源のみを使用します。一次情報ではないため、価格・契約・公式発表などの最終確認には公式情報源が必要です。" : "This research path currently uses only the free public Wikipedia source. It is not a primary source, so prices, contracts, and official announcements require confirmation from the official source."],
    nextActions: [language === "ja" ? "公式情報源を貼り付ければ、その内容との照合・整理を続けられます。" : "If you provide an official source, ORIGIN can continue by comparing and organizing that supplied material."],
  });
  if (result.ok === false) throw new Error(result.code);
  return result.value;
}

export function createOriginResearchRouter() {
  const router = Router();
  router.post("/api/chat", async (req, res, next) => {
    const body = (req.body ?? {}) as OriginChatBody;
    const messages = validateOriginChatMessages(body.messages);
    if (!messages || messages[messages.length - 1].role !== "user") return next();
    const query = messages[messages.length - 1].content;
    if (!isFreshnessRequest(query) || isWeatherRequest(query)) return next();
    const sensitiveKinds = detectSensitiveConversation(messages);
    if (sensitiveKinds.length > 0) return res.status(422).json({ code: "SENSITIVE_INPUT_BLOCKED", message: "秘密情報の可能性がある内容を検出したため、外部情報源への送信を停止しました。", retryable: false, sensitiveKinds });

    const language = languageOf(query);
    const result = await researchCurrentInformation(query);
    if (!result.ok) return next();

    const content = language === "ja"
      ? `無料の公開情報源を検索しました。以下は取得できた内容です。\n\n${result.sources.map((source) => `### ${source.title}\n${source.excerpt}\n\n〔出典: [Wikipedia](https://${new URL(source.url).hostname}${new URL(source.url).pathname})〕${source.revisionTimestamp ? `\n最終更新: ${source.revisionTimestamp}` : ""}`).join("\n\n")}`
      : `I searched a free public source. Here is the retrieved material.\n\n${result.sources.map((source) => `### ${source.title}\n${source.excerpt}\n\n〔Source: [Wikipedia](https://${new URL(source.url).hostname}${new URL(source.url).pathname})〕${source.revisionTimestamp ? `\nLatest revision: ${source.revisionTimestamp}` : ""}`).join("\n\n")}`;
    const evidence = extractProvidedOriginEvidence(content);
    const reason = language === "ja" ? "無料公開情報源の研究コネクタが実行され、取得した出典を回答に添付しました。独立AIレビューは実行していません。" : "The free public research connector executed and attached the retrieved sources. No independent AI review was performed.";
    return res.status(200).json({ status: 200, content, answer: envelope(content, language, "not-run", reason, evidence), routing: { model: "ORIGIN 無料公開情報源", provider: "Wikipedia", cost: 0, actualCostUsd: 0, freeOnly: true, verificationStatus: "not-run" }, research: { source: "Wikipedia", sources: result.sources } });
  });
  return router;
}
