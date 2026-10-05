import { secureFetch } from "../../services/mission-engine/src/application/agent/ToolExecutor.js";

export interface OriginResearchSource {
  title: string;
  url: string;
  excerpt: string;
  revisionTimestamp?: string;
  sourceType?: "web-search" | "encyclopedia";
  sourceAuthority?: "official-domain-match" | "secondary-reference" | "unclassified";
  domain?: string;
  rank?: number;
  evidenceLevel: "snippet" | "page-verified";
  retrievedAt: string;
  freshness: "recent" | "older" | "unknown";
}

export type OriginResearchFailureCode =
  | "NO_RESULTS"
  | "IRRELEVANT_RESULTS"
  | "SOURCE_CONSTRAINT_UNMET"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_HTTP_ERROR"
  | "DNS_FAILURE"
  | "RESPONSE_REJECTED"
  | "INVALID_RESPONSE"
  | "NETWORK_FAILURE";

export type OriginResearchFailure = {
  stage: "web-search" | "encyclopedia-search";
  code: OriginResearchFailureCode;
};

export interface OriginResearchResult {
  ok: boolean;
  sources: OriginResearchSource[];
  failure?: OriginResearchFailure;
  fallback?: OriginResearchFailure;
  searchProvider?: "DuckDuckGo" | "Bing" | "Wikipedia";
}

type WikipediaSearchResponse = {
  pages?: Array<{ key?: string; title?: string; excerpt?: string; description?: string }>;
};

type WikipediaPageResponse = {
  html_url?: string;
  latest?: { timestamp?: string };
};

type ResearchIntent = {
  officialRequested: boolean;
  requiredHostSuffixes: string[];
  searchQuery: string;
  terms: string[];
  minimumDistinctDomains: number;
};

const WIKI_ORIGINS = {
  ja: "https://ja.wikipedia.org",
  en: "https://en.wikipedia.org",
} as const;

const SEARCH_ORIGINS = {
  duckduckgoHtml: "https://html.duckduckgo.com/html/",
  duckduckgoLite: "https://lite.duckduckgo.com/lite/",
  bingRss: "https://www.bing.com/search",
} as const;

const OFFICIAL_SOURCE_RULES: readonly {
  pattern: RegExp;
  hostSuffixes: readonly string[];
}[] = [
  { pattern: /(?:google.{0,18}(?:公式.{0,8})?(?:ヘルプ|サポート)|(?:official|google).{0,18}(?:help|support).{0,12}google)/i, hostSuffixes: ["support.google.com"] },
  { pattern: /(?:google.{0,12}公式|公式.{0,12}google|official.{0,12}google)/i, hostSuffixes: ["google.com"] },
  { pattern: /(?:openai.{0,12}公式|公式.{0,12}openai|official.{0,12}openai)/i, hostSuffixes: ["openai.com"] },
  { pattern: /(?:microsoft.{0,12}公式|公式.{0,12}microsoft|official.{0,12}microsoft)/i, hostSuffixes: ["microsoft.com"] },
  { pattern: /(?:apple.{0,12}公式|公式.{0,12}apple|official.{0,12}apple)/i, hostSuffixes: ["apple.com"] },
  { pattern: /(?:github.{0,12}公式|公式.{0,12}github|official.{0,12}github)/i, hostSuffixes: ["github.com"] },
  { pattern: /(?:vercel.{0,12}公式|公式.{0,12}vercel|official.{0,12}vercel)/i, hostSuffixes: ["vercel.com"] },
  { pattern: /(?:supabase.{0,12}公式|公式.{0,12}supabase|official.{0,12}supabase)/i, hostSuffixes: ["supabase.com"] },
  { pattern: /(?:anthropic.{0,12}公式|公式.{0,12}anthropic|official.{0,12}anthropic)/i, hostSuffixes: ["anthropic.com"] },
];

const GENERIC_LATIN_TERMS = new Set([
  "the", "and", "for", "from", "with", "about", "please", "explain", "summary", "summarize",
  "research", "source", "sources", "official", "help", "support", "latest", "recent", "current",
  "information", "news", "updates", "short", "brief", "using", "based", "method", "how", "news",
]);

const GENERIC_JAPANESE_TERMS = new Set([
  "公式", "ヘルプ", "サポート", "出典", "情報", "公開情報", "最新", "現在", "説明", "方法", "確認",
  "調査", "要約", "短く", "簡単", "詳しく",
]);

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
    const parsed = new URL(decoded, SEARCH_ORIGINS.duckduckgoHtml);
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

function freshnessOf(revisionTimestamp: string | undefined, retrievedAt: string): OriginResearchSource["freshness"] {
  if (!revisionTimestamp) return "unknown";
  const revisionTime = Date.parse(revisionTimestamp);
  const retrievalTime = Date.parse(retrievedAt);
  if (!Number.isFinite(revisionTime) || !Number.isFinite(retrievalTime) || revisionTime > retrievalTime) return "unknown";
  return retrievalTime - revisionTime <= 30 * 24 * 60 * 60 * 1000 ? "recent" : "older";
}

function classifyFailure(error: unknown): OriginResearchFailureCode {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timed out") || message.includes("timeout")) return "UPSTREAM_TIMEOUT";
  if (message.includes("dns lookup") || message.includes("dns resolution")) return "DNS_FAILURE";
  if (message.includes("http status")) return "UPSTREAM_HTTP_ERROR";
  if (message.includes("redirects are prohibited") || message.includes("payload size exceeds")) return "RESPONSE_REJECTED";
  if (error instanceof SyntaxError) return "INVALID_RESPONSE";
  return "NETWORK_FAILURE";
}

function htmlAttribute(attributes: string, name: string): string | null {
  const escapedName = name.replace(/[^a-z0-9_-]/gi, "");
  if (!escapedName) return null;
  return attributes.match(new RegExp(`\\b${escapedName}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? null;
}

function parseDuckDuckGoResults(html: string, retrievedAt: string, limit = 6): OriginResearchSource[] {
  const sources: OriginResearchSource[] = [];
  const resultPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultPattern.exec(html)) && sources.length < limit) {
    const attributes = match[1] ?? "";
    const className = htmlAttribute(attributes, "class") ?? "";
    if (!/(?:^|\s)(?:result__a|result-link)(?:\s|$)/i.test(className)) continue;
    const rawHref = htmlAttribute(attributes, "href");
    if (!rawHref) continue;
    const url = safeResultUrl(rawHref);
    const title = cleanExcerpt(match[2]);
    if (!url || !title) continue;
    const start = match.index + match[0].length;
    const tail = html.slice(start, start + 6000);
    const snippetMatch = tail.match(/class=["'][^"']*(?:result__snippet|result-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    const excerpt = cleanExcerpt(snippetMatch?.[1] ?? "");
    if (!excerpt) continue;
    const domain = new URL(url).hostname.replace(/^www\./i, "");
    if (sources.some((source) => source.url === url)) continue;
    sources.push({ title, url, excerpt, sourceType: "web-search", domain, rank: sources.length + 1, evidenceLevel: "snippet", retrievedAt, freshness: "unknown" });
  }
  return sources;
}

function safeHttpsResultUrl(rawHref: string): string | null {
  const decoded = decodeHtml(rawHref).replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
  try {
    const parsed = new URL(decoded);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (parsed.hostname.toLowerCase() === "localhost") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function xmlItemValue(item: string, tag: string): string {
  const safeTag = tag.replace(/[^a-z0-9_-]/gi, "");
  if (!safeTag) return "";
  const value = item.match(new RegExp(`<${safeTag}>([\\s\\S]*?)<\\/${safeTag}>`, "i"))?.[1] ?? "";
  return value.replace(/^<!\[CDATA\[|\]\]>$/g, "");
}

function parseBingRssResults(xml: string, retrievedAt: string, limit = 8): OriginResearchSource[] {
  const sources: OriginResearchSource[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (sources.length >= limit) break;
    const item = match[1] ?? "";
    const title = cleanExcerpt(xmlItemValue(item, "title"));
    const excerpt = cleanExcerpt(xmlItemValue(item, "description"));
    const url = safeHttpsResultUrl(xmlItemValue(item, "link"));
    if (!title || !excerpt || !url) continue;
    const domain = new URL(url).hostname.replace(/^www\./i, "");
    if (domain.endsWith("bing.com") || sources.some((source) => source.url === url)) continue;
    sources.push({
      title,
      url,
      excerpt,
      sourceType: "web-search",
      domain,
      rank: sources.length + 1,
      evidenceLevel: "snippet",
      retrievedAt,
      freshness: "unknown",
    });
  }
  return sources;
}

function distinctDomainCount(sources: OriginResearchSource[]): number {
  return new Set(sources.map(sourceHost).filter(Boolean)).size;
}

function mergeSources(...groups: readonly OriginResearchSource[][]): OriginResearchSource[] {
  const seen = new Set<string>();
  const merged: OriginResearchSource[] = [];
  for (const source of groups.flat()) {
    const key = `${sourceHost(source)}|${source.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...source, rank: merged.length + 1 });
    if (merged.length >= 8) break;
  }
  return merged;
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const normalizedSuffix = suffix.toLowerCase().replace(/^www\./, "");
  return host === normalizedSuffix || host.endsWith(`.${normalizedSuffix}`);
}

function sourceHost(source: OriginResearchSource): string {
  if (source.domain) return source.domain.toLowerCase().replace(/^www\./, "");
  try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function meaningfulQueryTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLowerCase();
  const terms: string[] = [];
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9._-]{1,}/g)) {
    const value = match[0].replace(/^www\./, "");
    if (!GENERIC_LATIN_TERMS.has(value) && !terms.includes(value)) terms.push(value);
  }
  for (const match of normalized.matchAll(/[ァ-ヶー一-龠]{2,}/g)) {
    const value = match[0];
    if (!GENERIC_JAPANESE_TERMS.has(value) && !terms.includes(value)) terms.push(value);
  }
  return terms.slice(0, 18);
}

function explicitHttpsHosts(query: string): string[] {
  const hosts: string[] = [];
  for (const match of query.matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)) {
    const host = match[1]?.toLowerCase().replace(/^www\./, "");
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

function researchIntent(query: string): ResearchIntent {
  const normalized = query.normalize("NFKC").trim();
  const officialRequested = /(?:公式|official|一次情報|primary\s+source)/i.test(normalized);
  const rule = OFFICIAL_SOURCE_RULES.find((candidate) => candidate.pattern.test(normalized));
  const explicitHosts = officialRequested ? explicitHttpsHosts(normalized) : [];
  const requiredHostSuffixes = rule ? [...rule.hostSuffixes] : explicitHosts;
  const siteConstraint = requiredHostSuffixes[0] ? ` site:${requiredHostSuffixes[0]}` : "";
  const terms = meaningfulQueryTerms(normalized);
  const latinTerms = terms.filter((term) => /^[a-z0-9][a-z0-9._-]*$/i.test(term));
  const compactMixedQuery = latinTerms.length >= 2
    ? latinTerms.slice(0, 8).join(" ")
    : normalized;
  const multiSourceRequested = /複数(?:の)?(?:ソース|出典)|複数[^\n]{0,12}(?:ソース|出典)|multiple\s+(?:independent\s+)?sources|compare\s+sources/i.test(normalized);
  return {
    officialRequested,
    requiredHostSuffixes,
    searchQuery: `${compactMixedQuery}${siteConstraint}`.slice(0, 1400),
    terms,
    minimumDistinctDomains: multiSourceRequested && requiredHostSuffixes.length === 0 ? 2 : 1,
  };
}

function sourceMatchesIntent(source: OriginResearchSource, intent: ResearchIntent): boolean {
  const host = sourceHost(source);
  if (intent.requiredHostSuffixes.length > 0
    && !intent.requiredHostSuffixes.some((suffix) => hostMatchesSuffix(host, suffix))) return false;

  const domainTokens = new Set(intent.requiredHostSuffixes.flatMap((suffix) => suffix.split(".").filter((part) => part.length >= 3)));
  const topicTerms = intent.terms.filter((term) => !domainTokens.has(term));
  if (topicTerms.length === 0) return intent.requiredHostSuffixes.length > 0 || intent.terms.length === 0;

  const haystack = `${source.title} ${source.excerpt} ${source.url} ${host}`.normalize("NFKC").toLowerCase();
  const compactLatinHaystack = haystack.replace(/[^a-z0-9]/g, "");
  const matched = topicTerms.filter((term) => {
    if (haystack.includes(term)) return true;
    return /^[a-z0-9]{2,5}$/.test(term) && compactLatinHaystack.includes(term);
  }).length;
  const requiredMatches = Math.min(2, topicTerms.length);
  return matched >= requiredMatches;
}

function sourceAuthorityFor(source: OriginResearchSource, intent: ResearchIntent): NonNullable<OriginResearchSource["sourceAuthority"]> {
  if (
    intent.officialRequested
    && intent.requiredHostSuffixes.length > 0
    && intent.requiredHostSuffixes.some((suffix) => hostMatchesSuffix(sourceHost(source), suffix))
  ) return "official-domain-match";
  if (source.sourceType === "encyclopedia") return "secondary-reference";
  return "unclassified";
}

function filterRelevantSources(sources: OriginResearchSource[], intent: ResearchIntent): OriginResearchSource[] {
  return sources
    .filter((source) => sourceMatchesIntent(source, intent))
    .map((source) => ({ ...source, sourceAuthority: sourceAuthorityFor(source, intent) }));
}

async function searchWeb(intent: ResearchIntent, retrievedAt: string): Promise<OriginResearchResult> {
  const locale = languageForQuery(intent.searchQuery) === "ja" ? "jp-jp" : "us-en";
  const query = encodeURIComponent(intent.searchQuery);
  const duckEndpoints = [
    `${SEARCH_ORIGINS.duckduckgoHtml}?q=${query}&kl=${locale}&num=6`,
    `${SEARCH_ORIGINS.duckduckgoLite}?q=${query}&kl=${locale}`,
  ];
  let firstTransportFailure: OriginResearchFailureCode | null = null;
  let receivedSearchResponse = false;
  let sources: OriginResearchSource[] = [];
  let provider: "DuckDuckGo" | "Bing" = "DuckDuckGo";

  for (const endpoint of duckEndpoints) {
    try {
      const html = await secureFetch(endpoint);
      receivedSearchResponse = true;
      const parsed = filterRelevantSources(parseDuckDuckGoResults(html, retrievedAt, 6), intent);
      sources = mergeSources(sources, parsed);
      if (distinctDomainCount(sources) >= intent.minimumDistinctDomains) {
        return { ok: true, sources, searchProvider: "DuckDuckGo" };
      }
    } catch (error) {
      firstTransportFailure ??= classifyFailure(error);
    }
  }

  try {
    const rss = await secureFetch(`${SEARCH_ORIGINS.bingRss}?format=rss&count=8&q=${query}`);
    receivedSearchResponse = true;
    provider = "Bing";
    const parsed = filterRelevantSources(parseBingRssResults(rss, retrievedAt, 8), intent);
    sources = mergeSources(sources, parsed);
    if (distinctDomainCount(sources) >= intent.minimumDistinctDomains) {
      return { ok: true, sources, searchProvider: "Bing" };
    }
  } catch (error) {
    firstTransportFailure ??= classifyFailure(error);
  }

  return {
    ok: false,
    sources,
    failure: {
      stage: "web-search",
      code: sources.length > 0 && distinctDomainCount(sources) < intent.minimumDistinctDomains
        ? "SOURCE_CONSTRAINT_UNMET"
        : receivedSearchResponse
          ? (intent.requiredHostSuffixes.length > 0 ? "SOURCE_CONSTRAINT_UNMET" : "IRRELEVANT_RESULTS")
          : (firstTransportFailure ?? "NO_RESULTS"),
    },
    searchProvider: provider,
  };
}

export async function retrieveResearchPages(sources: OriginResearchSource[]): Promise<OriginResearchSource[]> {
  return Promise.all(sources.map(async (source, index) => {
    if (index >= 4) return { ...source, evidenceLevel: "snippet" as const };
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.username || url.password) return { ...source, evidenceLevel: "snippet" as const };
      const html = await secureFetch(url.href);
      const article = html.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2];
      if (!article) return { ...source, evidenceLevel: "snippet" as const };
      const text = cleanExcerpt(article.replace(/<(script|style|nav|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " "));
      if (text.length < 80) return { ...source, evidenceLevel: "snippet" as const };
      return { ...source, excerpt: text, evidenceLevel: "page-verified" as const };
    } catch {
      return { ...source, evidenceLevel: "snippet" as const };
    }
  }));
}

export async function researchCurrentInformation(query: string, now = new Date()): Promise<OriginResearchResult> {
  const retrievedAt = now.toISOString();
  const intent = researchIntent(query);

  if (intent.officialRequested && intent.requiredHostSuffixes.length === 0) {
    return {
      ok: false,
      sources: [],
      failure: { stage: "web-search", code: "SOURCE_CONSTRAINT_UNMET" },
      searchProvider: "DuckDuckGo",
    };
  }

  const webResult = await searchWeb(intent, retrievedAt);
  if (webResult.ok) return { ...webResult, sources: await retrieveResearchPages(webResult.sources) };

  if (intent.officialRequested || intent.requiredHostSuffixes.length > 0) return webResult;

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
        sources.push({ title, url, excerpt, revisionTimestamp: metadata.latest?.timestamp, sourceType: "encyclopedia", sourceAuthority: "secondary-reference", domain: new URL(url).hostname, rank: sources.length + 1, evidenceLevel: "snippet", retrievedAt, freshness: freshnessOf(metadata.latest?.timestamp, retrievedAt) });
      } catch {
        const excerpt = cleanExcerpt(page.excerpt) || cleanExcerpt(page.description);
        if (excerpt) sources.push({ title, url: `${origin}/wiki/${encodeURIComponent(key).replace(/%2F/g, "/")}`, excerpt, sourceType: "encyclopedia", sourceAuthority: "secondary-reference", domain: new URL(origin).hostname, rank: sources.length + 1, evidenceLevel: "snippet", retrievedAt, freshness: "unknown" });
      }
    }

    const relevant = filterRelevantSources(sources, intent);
    if (relevant.length === 0) {
      return {
        ok: false,
        sources: [],
        failure: { stage: "encyclopedia-search", code: sources.length === 0 ? "NO_RESULTS" : "IRRELEVANT_RESULTS" },
        fallback: webResult.failure,
        searchProvider: "Wikipedia",
      };
    }
    return { ok: true, sources: relevant, fallback: webResult.failure, searchProvider: "Wikipedia" };
  } catch (error) {
    return { ok: false, sources: [], failure: { stage: "encyclopedia-search", code: classifyFailure(error) }, fallback: webResult.failure, searchProvider: "Wikipedia" };
  }
}
