import { secureFetch } from "../../services/mission-engine/src/application/agent/ToolExecutor.js";

export interface OriginResearchSource {
  title: string;
  url: string;
  excerpt: string;
  revisionTimestamp?: string;
  sourceType?: "web-search" | "encyclopedia";
  domain?: string;
  rank?: number;
}

export interface OriginResearchResult {
  ok: boolean;
  sources: OriginResearchSource[];
  limitation?: string;
  searchProvider?: "DuckDuckGo";
}

type WikipediaSearchResponse = {
  pages?: Array<{ key?: string; title?: string; excerpt?: string; description?: string }>;
};

type WikipediaPageResponse = {
  html_url?: string;
  latest?: { timestamp?: string };
};

const WIKI_ORIGINS = {
  ja: "https://ja.wikipedia.org",
  en: "https://en.wikipedia.org",
} as const;

const SEARCH_ORIGINS = {
  duckduckgo: "https://html.duckduckgo.com/html/",
} as const;

function languageForQuery(query: string): keyof typeof WIKI_ORIGINS {
  return /[ぁ-んァ-ヶ一-龠]/.test(query) ? "ja" : "en";
}

function cleanExcerpt(value: unknown): string {
  if (typeof value !== "string") return "";
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;|&#47;/g, "/")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function safeResultUrl(rawHref: string): string | null {
  const decoded = decodeHtml(rawHref).trim();
  try {
    const parsed = new URL(decoded, SEARCH_ORIGINS.duckduckgo);
    if (parsed.hostname === "duckduckgo.com" && parsed.pathname === "/l/") {
      const target = parsed.searchParams.get("uddg");
      if (target) {
        const targetUrl = new URL(target);
        if (targetUrl.protocol === "https:") return targetUrl.toString();
      }
    }
    if (parsed.protocol === "https:" && !parsed.hostname.endsWith("duckduckgo.com")) return parsed.toString();
  } catch {
    return null;
  }
  return null;
}

function parseDuckDuckGoResults(html: string, limit = 6): OriginResearchSource[] {
  const sources: OriginResearchSource[] = [];
  const resultPattern = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) && sources.length < limit) {
    const url = safeResultUrl(match[1]);
    const title = cleanExcerpt(match[2]);
    if (!url || !title) continue;
    const start = match.index + match[0].length;
    const tail = html.slice(start, start + 6000);
    const snippetMatch = tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    const excerpt = cleanExcerpt(snippetMatch?.[1] ?? "");
    if (!excerpt) continue;
    const domain = new URL(url).hostname.replace(/^www\./i, "");
    if (sources.some((source) => source.url === url)) continue;
    sources.push({ title, url, excerpt, sourceType: "web-search", domain, rank: sources.length + 1 });
  }
  return sources;
}

async function searchWeb(query: string): Promise<OriginResearchResult> {
  const endpoint = `${SEARCH_ORIGINS.duckduckgo}?q=${encodeURIComponent(query)}&kl=${languageForQuery(query) === "ja" ? "jp-jp" : "us-en"}&num=6`;
  try {
    const html = await secureFetch(endpoint);
    const sources = parseDuckDuckGoResults(html, 6);
    if (sources.length === 0) return { ok: false, sources: [], limitation: "無料公開Web検索で検索結果を取得できませんでした。", searchProvider: "DuckDuckGo" };
    return { ok: true, sources, searchProvider: "DuckDuckGo" };
  } catch (error) {
    return { ok: false, sources: [], limitation: error instanceof Error ? `無料公開Web検索への接続に失敗しました: ${error.message}` : "無料公開Web検索への接続に失敗しました。", searchProvider: "DuckDuckGo" };
  }
}

export async function researchCurrentInformation(query: string): Promise<OriginResearchResult> {
  const webResult = await searchWeb(query);
  if (webResult.ok) return webResult;

  // Keep Wikipedia as a bounded secondary public source when search is unavailable.
  const language = languageForQuery(query);
  const origin = WIKI_ORIGINS[language];
  const searchUrl = `${origin}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=3`;
  try {
    const searchPayload = JSON.parse(await secureFetch(searchUrl)) as WikipediaSearchResponse;
    const pages = Array.isArray(searchPayload.pages) ? searchPayload.pages.slice(0, 3) : [];
    const sources: OriginResearchSource[] = [];
    for (const page of pages) {
      const key = typeof page.key === "string" ? page.key : "";
      const title = typeof page.title === "string" ? page.title : key;
      if (!key || !title) continue;
      const bareUrl = `${origin}/w/rest.php/v1/page/${encodeURIComponent(key)}/bare`;
      try {
        const metadata = JSON.parse(await secureFetch(bareUrl)) as WikipediaPageResponse;
        const url = typeof metadata.html_url === "string" && metadata.html_url.startsWith(origin)
          ? metadata.html_url
          : `${origin}/wiki/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
        const excerpt = cleanExcerpt(page.excerpt) || cleanExcerpt(page.description);
        if (!excerpt) continue;
        sources.push({ title, url, excerpt, revisionTimestamp: metadata.latest?.timestamp, sourceType: "encyclopedia", domain: new URL(url).hostname, rank: sources.length + 1 });
      } catch {
        const excerpt = cleanExcerpt(page.excerpt) || cleanExcerpt(page.description);
        if (excerpt) sources.push({ title, url: `${origin}/wiki/${encodeURIComponent(key).replace(/%2F/g, "/")}`, excerpt, sourceType: "encyclopedia", domain: new URL(origin).hostname, rank: sources.length + 1 });
      }
    }
    if (sources.length === 0) return { ok: false, sources: [], limitation: webResult.limitation ?? "無料公開情報源で該当する情報を取得できませんでした。", searchProvider: "DuckDuckGo" };
    return { ok: true, sources, limitation: webResult.limitation, searchProvider: "DuckDuckGo" };
  } catch {
    return { ok: false, sources: [], limitation: webResult.limitation ?? "無料公開情報源で該当する情報を取得できませんでした。", searchProvider: "DuckDuckGo" };
  }
}
