import { secureFetch } from "../../services/mission-engine/src/application/agent/ToolExecutor.js";

export interface OriginResearchSource {
  title: string;
  url: string;
  excerpt: string;
  revisionTimestamp?: string;
}

export interface OriginResearchResult {
  ok: boolean;
  sources: OriginResearchSource[];
  limitation?: string;
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

function languageForQuery(query: string): keyof typeof WIKI_ORIGINS {
  return /[ぁ-んァ-ヶ一-龠]/.test(query) ? "ja" : "en";
}

function cleanExcerpt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900);
}

export async function researchCurrentInformation(query: string): Promise<OriginResearchResult> {
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
        sources.push({ title, url, excerpt, revisionTimestamp: metadata.latest?.timestamp });
      } catch {
        const excerpt = cleanExcerpt(page.excerpt) || cleanExcerpt(page.description);
        if (excerpt) sources.push({ title, url: `${origin}/wiki/${encodeURIComponent(key).replace(/%2F/g, "/")}`, excerpt });
      }
    }

    if (sources.length === 0) {
      return { ok: false, sources: [], limitation: "許可された無料の公開情報源で該当する記事を取得できませんでした。" };
    }
    return { ok: true, sources };
  } catch (error) {
    return { ok: false, sources: [], limitation: error instanceof Error ? `無料公開情報源への接続に失敗しました: ${error.message}` : "無料公開情報源への接続に失敗しました。" };
  }
}
