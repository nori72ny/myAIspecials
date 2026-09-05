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

function sourceLabel(source: { domain?: string; sourceType?: string; url: string }): string {
  if (source.domain) return source.domain;
  try { return new URL(source.url).hostname; } catch { return source.sourceType === "encyclopedia" ? "Wikipedia" : "Web search"; }
}

function envelope(content: string, language: "ja" | "en", status: "passed" | "not-run", summary: string, evidence: ReturnType<typeof extractProvidedOriginEvidence>): OriginAnswerEnvelope {
  const result = createOriginAnswerEnvelope({
    language,
    conclusion: content.split("\n\n")[0].slice(0, 500),
    answer: content,
    evidence,
    verification: { status, independentReviewPerformed: status === "passed", summary },
    limitations: [language === "ja" ? "検索結果は無料の公開Web検索から取得したスニペットです。検索結果の掲載順・内容は変動するため、重要な価格・契約・公式発表などは原典を開いて最終確認してください。" : "Results are snippets from a free public web search. Rankings and content can change, so verify important prices, contracts, and official announcements against the original source."],
    nextActions: [language === "ja" ? "必要なら取得した出典を基に、複数ソースの一致点・相違点を整理できます。" : "If needed, the retrieved sources can be compared for agreement and disagreement."],
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
      ? `無料の公開Web検索を実行しました。検索結果は複数の公開Webソースから取得しています。\n\n${result.sources.map((source) => `### ${source.title}\n${source.excerpt}\n\n〔出典: [${sourceLabel(source)}](${source.url})〕${source.rank ? `\n検索順位: ${source.rank}` : ""}${source.revisionTimestamp ? `\n最終更新: ${source.revisionTimestamp}` : ""}`).join("\n\n")}`
      : `I ran a free public web search and retrieved multiple public web sources.\n\n${result.sources.map((source) => `### ${source.title}\n${source.excerpt}\n\n〔Source: [${sourceLabel(source)}](${source.url})〕${source.rank ? `\nSearch rank: ${source.rank}` : ""}${source.revisionTimestamp ? `\nLatest revision: ${source.revisionTimestamp}` : ""}`).join("\n\n")}`;
    const evidence = extractProvidedOriginEvidence(content);
    const reason = language === "ja" ? "無料公開Web検索が実行され、取得した複数ソースを回答に添付しました。独立AIレビューは実行していません。" : "The free public web search executed and attached multiple retrieved sources. No independent AI review was performed.";
    return res.status(200).json({ status: 200, content, answer: envelope(content, language, "not-run", reason, evidence), routing: { model: "ORIGIN 無料公開Web検索", provider: result.searchProvider ?? "DuckDuckGo", cost: 0, actualCostUsd: 0, freeOnly: true, verificationStatus: "not-run" }, research: { source: result.searchProvider ?? "DuckDuckGo", sources: result.sources, limitation: result.limitation } });
  });
  return router;
}
