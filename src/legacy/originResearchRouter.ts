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

type ResearchEvidenceSource = {
  domain?: string;
  sourceType?: string;
  url: string;
  excerpt: string;
  evidenceLevel: "snippet" | "page-verified";
  freshness: "recent" | "older" | "unknown";
};

type SourceAssessment = {
  domain: string;
  publisherKind: "encyclopedia-reference" | "public-web";
  officialStatus: "not-assessed";
  officialityBasis: "none";
  independenceBasis: "domain-only";
  domainOccurrenceCount: number;
  independenceStatus: "domain-distinct" | "same-domain";
  evidenceStrength: "strong" | "moderate" | "limited";
  confidenceBasis: string[];
};

type EvidenceComparison = {
  sourceCount: number;
  distinctDomainCount: number;
  encyclopediaReferenceCount: number;
  publicWebCount: number;
  officialSourceCount: null;
  officialStatus: "not-assessed";
  distinctSourceCount: number;
  repeatedDomainSourceCount: number;
  strongEvidenceCount: number;
  moderateEvidenceCount: number;
  limitedEvidenceCount: number;
  confidenceLevel: "strong" | "moderate" | "limited";
  confidenceScope: "retrieval-evidence-only";
  pageVerifiedCount: number;
  snippetCount: number;
  recentCount: number;
  olderCount: number;
  unknownFreshnessCount: number;
  duplicateTextGroupCount: number;
  semanticAgreement: "not-assessed";
  semanticConflict: "not-assessed";
};

function assessSources(sources: ResearchEvidenceSource[]): SourceAssessment[] {
  const domains = sources.map((source) => sourceLabel(source).toLocaleLowerCase());
  const domainCounts = new Map<string, number>();
  for (const domain of domains) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  return sources.map((source, index) => {
    const domainOccurrenceCount = domainCounts.get(domains[index]) ?? 1;
    const evidenceStrength = source.evidenceLevel === "page-verified"
      ? source.freshness === "recent" ? "strong" : "moderate"
      : source.freshness === "recent" ? "moderate" : "limited";
    return {
      domain: domains[index],
      publisherKind: source.sourceType === "encyclopedia" ? "encyclopedia-reference" : "public-web",
      officialStatus: "not-assessed",
      officialityBasis: "none",
      independenceBasis: "domain-only",
      domainOccurrenceCount,
      independenceStatus: domainOccurrenceCount === 1 ? "domain-distinct" : "same-domain",
      evidenceStrength,
      confidenceBasis: [source.evidenceLevel, source.freshness, domainOccurrenceCount === 1 ? "unique-domain" : "repeated-domain"],
    };
  });
}

function sourceNatureLabel(assessment: SourceAssessment, language: "ja" | "en"): string {
  if (language === "ja") {
    return `媒体区分: ${assessment.publisherKind === "encyclopedia-reference" ? "百科事典型の参考情報" : "公開Web"}\n公式性: 未判定（確認根拠なし）\n独立性: ${assessment.independenceStatus === "domain-distinct" ? "他ソースと異なるドメイン" : "同一ドメインの別ソースあり"}（ドメイン単位のみ）\n取得証拠の強さ: ${assessment.evidenceStrength}`;
  }
  return `Publisher type: ${assessment.publisherKind === "encyclopedia-reference" ? "Encyclopedia reference" : "Public web"}\nOfficial status: not assessed (no verification basis)\nIndependence: ${assessment.independenceStatus === "domain-distinct" ? "distinct domain" : "same domain as another source"} (domain-level only)\nRetrieval evidence strength: ${assessment.evidenceStrength}`;
}

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function buildEvidenceComparison(sources: ResearchEvidenceSource[]): EvidenceComparison {
  const normalizedTextCounts = new Map<string, number>();
  const assessments = assessSources(sources);
  const distinctDomainCount = new Set(assessments.map((assessment) => assessment.domain)).size;
  const pageVerifiedCount = sources.filter((source) => source.evidenceLevel === "page-verified").length;
  const recentCount = sources.filter((source) => source.freshness === "recent").length;
  const confidenceLevel = distinctDomainCount >= 2 && pageVerifiedCount >= 2 && recentCount >= 1
    ? "strong"
    : distinctDomainCount >= 2 && (pageVerifiedCount >= 1 || recentCount >= 1)
      ? "moderate"
      : "limited";
  for (const source of sources) {
    const normalized = normalizeEvidenceText(source.excerpt);
    if (normalized) normalizedTextCounts.set(normalized, (normalizedTextCounts.get(normalized) ?? 0) + 1);
  }
  return {
    sourceCount: sources.length,
    distinctDomainCount,
    encyclopediaReferenceCount: assessments.filter((assessment) => assessment.publisherKind === "encyclopedia-reference").length,
    publicWebCount: assessments.filter((assessment) => assessment.publisherKind === "public-web").length,
    officialSourceCount: null,
    officialStatus: "not-assessed",
    distinctSourceCount: assessments.filter((assessment) => assessment.independenceStatus === "domain-distinct").length,
    repeatedDomainSourceCount: assessments.filter((assessment) => assessment.independenceStatus === "same-domain").length,
    strongEvidenceCount: assessments.filter((assessment) => assessment.evidenceStrength === "strong").length,
    moderateEvidenceCount: assessments.filter((assessment) => assessment.evidenceStrength === "moderate").length,
    limitedEvidenceCount: assessments.filter((assessment) => assessment.evidenceStrength === "limited").length,
    confidenceLevel,
    confidenceScope: "retrieval-evidence-only",
    pageVerifiedCount,
    snippetCount: sources.filter((source) => source.evidenceLevel === "snippet").length,
    recentCount,
    olderCount: sources.filter((source) => source.freshness === "older").length,
    unknownFreshnessCount: sources.filter((source) => source.freshness === "unknown").length,
    duplicateTextGroupCount: [...normalizedTextCounts.values()].filter((count) => count > 1).length,
    semanticAgreement: "not-assessed",
    semanticConflict: "not-assessed",
  };
}

function comparisonContent(comparison: EvidenceComparison, language: "ja" | "en"): string {
  if (language === "ja") {
    return `## 証拠比較
- 情報源: ${comparison.sourceCount}件（独立ドメイン ${comparison.distinctDomainCount}、ドメイン単位のみ）
- 媒体区分: 百科事典型 ${comparison.encyclopediaReferenceCount}件 / 公開Web ${comparison.publicWebCount}件
- 公式情報源: 未判定（確認根拠がない限り推測しません）
- 独立性: 異なるドメインのソース ${comparison.distinctSourceCount}件 / 同一ドメイン重複 ${comparison.repeatedDomainSourceCount}件
- 取得証拠の強さ: ${comparison.confidenceLevel}（取得証拠のみ。内容の真偽や媒体の信頼性は未評価）
- 証拠: ページ確認済み ${comparison.pageVerifiedCount}件 / 検索スニペット ${comparison.snippetCount}件
- 鮮度: 30日以内 ${comparison.recentCount}件 / 30日超 ${comparison.olderCount}件 / 不明 ${comparison.unknownFreshnessCount}件
- 重複テキスト: ${comparison.duplicateTextGroupCount}グループ
- 意味上の一致・矛盾: 未判定（取得テキストだけから推測しません）`;
  }
  return `## Evidence comparison
- Sources: ${comparison.sourceCount} (distinct domains: ${comparison.distinctDomainCount}; domain-level only)
- Publisher types: ${comparison.encyclopediaReferenceCount} encyclopedia reference / ${comparison.publicWebCount} public web
- Official sources: not assessed (ORIGIN requires explicit verification evidence)
- Independence: ${comparison.distinctSourceCount} distinct-domain source(s) / ${comparison.repeatedDomainSourceCount} repeated-domain source(s)
- Retrieval evidence confidence: ${comparison.confidenceLevel} (retrieval evidence only; factual accuracy and publisher trust are not assessed)
- Evidence: ${comparison.pageVerifiedCount} page verified / ${comparison.snippetCount} search snippets
- Freshness: ${comparison.recentCount} within 30 days / ${comparison.olderCount} older / ${comparison.unknownFreshnessCount} unknown
- Duplicate text: ${comparison.duplicateTextGroupCount} group(s)
- Semantic agreement or conflict: not assessed (ORIGIN does not infer this from retrieved text alone)`;
}

function freshnessLabel(freshness: "recent" | "older" | "unknown", language: "ja" | "en"): string {
  if (language === "ja") {
    if (freshness === "recent") return "更新確認: 取得時点から30日以内";
    if (freshness === "older") return "更新確認: 取得時点から30日超";
    return "更新日時不明";
  }
  if (freshness === "recent") return "Update recency: within 30 days of retrieval";
  if (freshness === "older") return "Update recency: more than 30 days before retrieval";
  return "Update date unknown";
}

function envelope(content: string, language: "ja" | "en", status: "passed" | "not-run", summary: string, evidence: ReturnType<typeof extractProvidedOriginEvidence>): OriginAnswerEnvelope {
  const result = createOriginAnswerEnvelope({
    language,
    conclusion: content.split("\n\n")[0].slice(0, 500),
    answer: content,
    evidence,
    verification: { status, independentReviewPerformed: status === "passed", summary },
    limitations: [language === "ja" ? "検索結果は無料の公開Web検索から取得したスニペットです。検索結果の掲載順・内容は変動するため、重要な価格・契約・公式発表などは原典を開いて最終確認してください。" : "Results are snippets from a free public web search. Rankings and content can change, so verify important prices, contracts, and official announcements against the original source."],
    nextActions: [language === "ja" ? "重要な事実の一致・矛盾は、各原典を開いて確認してください。" : "Open each original source to verify agreement or conflict on important facts."],
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
    if (!result.ok) {
      const message = language === "ja"
        ? "現在、無料の公開情報源から最新情報を取得できませんでした。未確認の内容を通常AIで補完せず、安全に停止しました。時間をおいて手動で再度お試しください。"
        : "Current information could not be retrieved from the free public sources. ORIGIN stopped safely instead of filling the gap with an unverified model answer. Please try again manually later.";
      return res.status(503).json({
        code: "RESEARCH_SOURCE_UNAVAILABLE",
        message,
        retryable: true,
        retryAttempted: false,
        costUsd: 0,
        freeOnly: true,
        paidFallbackUsed: false,
        research: { sources: [], status: "unavailable" },
      });
    }

    const comparison = buildEvidenceComparison(result.sources);
    const sourceAssessments = assessSources(result.sources);
    const content = language === "ja"
      ? `無料の公開Web検索を実行しました。検索結果は複数の公開Webソースから取得しています。\n\n${comparisonContent(comparison, "ja")}\n\n${result.sources.map((source, index) => `### ${source.title}\n${source.excerpt}\n\n〔出典: [${sourceLabel(source)}](${source.url})〕\n証拠レベル: ${source.evidenceLevel === "page-verified" ? "ページ確認済み" : "検索スニペットのみ"}\n取得日時: ${source.retrievedAt}\n鮮度: ${freshnessLabel(source.freshness, "ja")}\n${sourceNatureLabel(sourceAssessments[index], "ja")}${source.rank ? `\n検索順位: ${source.rank}` : ""}${source.revisionTimestamp ? `\n最終更新: ${source.revisionTimestamp}` : ""}`).join("\n\n")}`
      : `I ran a free public web search and retrieved multiple public web sources.\n\n${comparisonContent(comparison, "en")}\n\n${result.sources.map((source, index) => `### ${source.title}\n${source.excerpt}\n\n〔Source: [${sourceLabel(source)}](${source.url})〕\nEvidence level: ${source.evidenceLevel === "page-verified" ? "Page verified" : "Search snippet only"}\nRetrieved at: ${source.retrievedAt}\nFreshness: ${freshnessLabel(source.freshness, "en")}\n${sourceNatureLabel(sourceAssessments[index], "en")}${source.rank ? `\nSearch rank: ${source.rank}` : ""}${source.revisionTimestamp ? `\nLatest revision: ${source.revisionTimestamp}` : ""}`).join("\n\n")}`;
    const evidence = extractProvidedOriginEvidence(content);
    const reason = language === "ja" ? "無料公開Web検索が実行され、取得した複数ソースを回答に添付しました。証拠レベルを各ソースに明示しています。独立AIレビューは実行していません。" : "The free public web search executed and attached multiple retrieved sources. Evidence level is explicit for each source. No independent AI review was performed.";
    return res.status(200).json({ status: 200, content, answer: envelope(content, language, "not-run", reason, evidence), routing: { model: "ORIGIN 無料公開Web検索", provider: result.searchProvider ?? "DuckDuckGo", cost: 0, actualCostUsd: 0, freeOnly: true, verificationStatus: "not-run" }, research: { source: result.searchProvider ?? "DuckDuckGo", sources: result.sources, sourceAssessments, comparison, limitation: result.limitation } });
  });
  return router;
}
