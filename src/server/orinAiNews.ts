/**
 * 「AIの最新情報」見出し層のサーバー側取得係（拡張設計
 * ORIN_PANEL_EXPANSION_DESIGN_2026-11-25 §8.4 の是正、2026-11-25）。
 *
 * 本番で見出しが常に取得できなかった原因は、3つ重なっていた：
 * 1. タイムアウトが検索基盤の既定（5秒）のままだった。GDELT の
 *    DOC API は共有出口 IP からだと応答まで10秒以上かかるのが
 *    常で（2026-11-25 に統括環境から実測：成功時12秒、429 の
 *    応答自体も10〜18秒）、5秒ではほぼ必ず時間切れになる。
 * 2. GDELT は IP あたり5秒に1回の制限があり、共有出口では
 *    429 が頻発する。キャッシュも再試行も無く、ページを開く
 *    たびの要求がそのまま衝突していた。
 * 3. エンドポイントが失敗を握りつぶし、理由が記録に残らなかった。
 *
 * 対策（原則は従来どおり：サーバー側の固定クエリのみ・保存
 * なし・費用 $0）：
 * - 取得口専用のタイムアウト（20秒）を使う。
 * - 429 の時だけ、GDELT の公表ルール（5秒に1回）に沿って
 *   少し待って1回だけ引き直す。それ以外の失敗は引き直さない
 *   （時間切れや到達不能は数秒では回復しないため）。
 * - 成功した見出しはメモリ内だけに10分持ち、同時に来た要求は
 *   1回の取得に束ねる。プロセスが落ちれば消える（保存ではない）。
 * - 取得に失敗しても前回分（24時間以内）が残っていれば、取得
 *   時刻つきでそれを返す。画面は fetchedAt を「時点」として
 *   出すため、古い見出しを新しいものと偽ることにはならない。
 * - 失敗は理由（種別と上流の状態コード）を呼び出し側へ渡し、
 *   エンドポイントが記録と応答に残せるようにする。
 *
 * 2026-11-25 夜の本番再発と、その対策（代替ソース）：
 * 上記の対策を入れても本番ではなお全滅した（統括の実測：2回とも
 * 502、理由は network と invalid-response で揺れた）。統括環境
 * から GDELT を直接引いた実測では、5秒以上空けた3回すべてが
 * 約12秒をかけて 429（本文はテキストの制限告知）。つまり GDELT
 * の IP あたり制限は、共有出口 IP の他利用者の通信だけで常時
 * 埋まっており、自前の間隔調整や1回の再試行では届かない。
 * 200 でテキスト本文を返すこともあり、その場合は理由が
 * invalid-response になる。そこで、GDELT が失敗した時だけ、
 * 鍵不要・固定クエリの公開 RSS（Google ニュース検索 RSS）を
 * 代替ソースとして引く。実測では同じ共有出口から 200・約1.5秒
 * で取れた。原則は同じ（サーバー側の固定クエリのみ・保存なし・
 * 費用 $0・メモリ内キャッシュのみ）。GDELT が復調すれば従来
 * どおり GDELT が主系に戻る（代替は失敗時にだけ使う）。
 */
import {
  defaultOriginSearchFetch,
  OriginSearchProviderError,
  searchGdeltHeadlines,
  type OriginSearchFetch,
} from "../search/originSearchProviders.js";

/** 固定クエリ（利用者の情報は一切含まない。従来のエンドポイントから移設）。 */
export const ORIN_AI_NEWS_QUERY = "人工知能 OR 生成AI OR 大規模言語モデル OR \"artificial intelligence\" OR \"large language model\"";
/** 代替ソース（公開 RSS、鍵不要・固定クエリのみ）。 */
export const ORIN_AI_NEWS_RSS_URL = "https://news.google.com/rss/search"
  + `?q=${encodeURIComponent("人工知能 OR 生成AI OR 大規模言語モデル")}&hl=ja&gl=JP&ceid=JP:ja`;
export const ORIN_AI_NEWS_RSS_TIMEOUT_MS = 10_000;
export const ORIN_AI_NEWS_TIMEOUT_MS = 20_000;
export const ORIN_AI_NEWS_CACHE_TTL_MS = 10 * 60 * 1000;
export const ORIN_AI_NEWS_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
export const ORIN_AI_NEWS_RATE_LIMIT_WAIT_MS = 5_500;

export interface OrinAiNewsHeadlineItem {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
}

export interface OrinAiNewsResult {
  fetchedAt: string;
  items: OrinAiNewsHeadlineItem[];
  /** 前回分の使い回し（取得に失敗したため）かどうか。 */
  stale: boolean;
}

/** 失敗の理由（記録と応答に残すための、範囲を絞った診断情報）。 */
export interface OrinAiNewsFailure {
  code: string;
  status?: number;
}

export class OrinAiNewsUnavailableError extends Error {
  readonly failure: OrinAiNewsFailure;

  constructor(failure: OrinAiNewsFailure) {
    super(`ai news headlines unavailable: ${failure.code}${failure.status ? ` (HTTP ${failure.status})` : ""}`);
    this.name = "OrinAiNewsUnavailableError";
    this.failure = failure;
  }
}

export interface OrinAiNewsServiceDeps {
  fetchImpl?: OriginSearchFetch;
  timeoutMs?: number;
  rssTimeoutMs?: number;
  cacheTtlMs?: number;
  staleLimitMs?: number;
  rateLimitWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** 失敗のたびに理由を受け取る（エンドポイントが記録に残す）。 */
  onFailure?: (failure: OrinAiNewsFailure) => void;
}

export interface OrinAiNewsService {
  getHeadlines(): Promise<OrinAiNewsResult>;
}

function toFailure(error: unknown): OrinAiNewsFailure {
  if (error instanceof OriginSearchProviderError) {
    return { code: error.code, ...(error.status ? { status: error.status } : {}) };
  }
  return { code: "unknown" };
}

/* ------------------------------------------------------------------ */
/* 代替ソース：Google ニュース検索 RSS（公開・鍵不要・固定クエリ）     */
/* ------------------------------------------------------------------ */

const XML_ENTITY_MAP: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
};

function unescapeXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITY_MAP[entity] ?? entity)
    .trim();
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Google ニュース検索 RSS の item を見出しに写す。タイトルは
 * 「見出し - 出典名」の形で届くため、出典（source 要素）が
 * 取れた時は末尾の出典名を取り除き、出典は source として別に
 * 持つ。リンク・タイトルの重複は GDELT 側と同じ基準で落とす。
 */
export function parseOrinAiNewsRss(xml: string): OrinAiNewsHeadlineItem[] {
  const items: OrinAiNewsHeadlineItem[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const pick = (tag: string): string => {
      const found = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
      return found ? unescapeXmlText(found[1]) : "";
    };
    const url = pick("link");
    let title = pick("title");
    const sourceName = pick("source");
    if (!url || !title || !isSafeHttpsUrl(url)) continue;
    if (sourceName && title.endsWith(` - ${sourceName}`)) {
      title = title.slice(0, title.length - sourceName.length - 3).trim();
    }
    if (!title) continue;
    const titleKey = title.toLowerCase().replace(/[\s\p{P}]+/gu, "");
    if (seenUrls.has(url) || seenTitles.has(titleKey)) continue;
    seenUrls.add(url);
    seenTitles.add(titleKey);
    let source = sourceName;
    if (!source) {
      try {
        source = new URL(url).hostname;
      } catch {
        source = "";
      }
    }
    if (!source) continue;
    const publishedRaw = pick("pubDate");
    const publishedMs = publishedRaw ? Date.parse(publishedRaw) : Number.NaN;
    items.push({
      title,
      url,
      source,
      ...(Number.isFinite(publishedMs) ? { publishedAt: new Date(publishedMs).toISOString() } : {}),
    });
    if (items.length >= 7) break;
  }
  return items;
}

export function createOrinAiNewsService(deps: OrinAiNewsServiceDeps = {}): OrinAiNewsService {
  const timeoutMs = deps.timeoutMs ?? ORIN_AI_NEWS_TIMEOUT_MS;
  const rssTimeoutMs = deps.rssTimeoutMs ?? ORIN_AI_NEWS_RSS_TIMEOUT_MS;
  const cacheTtlMs = deps.cacheTtlMs ?? ORIN_AI_NEWS_CACHE_TTL_MS;
  const staleLimitMs = deps.staleLimitMs ?? ORIN_AI_NEWS_STALE_LIMIT_MS;
  const rateLimitWaitMs = deps.rateLimitWaitMs ?? ORIN_AI_NEWS_RATE_LIMIT_WAIT_MS;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

  let cache: { fetchedAtMs: number; result: OrinAiNewsResult } | null = null;
  let inflight: Promise<OrinAiNewsResult> | null = null;

  const fetchOnce = async (): Promise<OrinAiNewsResult> => {
    const sources = await searchGdeltHeadlines(ORIN_AI_NEWS_QUERY, {
      fetchImpl: deps.fetchImpl,
      timeoutMs,
    });
    return {
      fetchedAt: new Date(now()).toISOString(),
      stale: false,
      items: sources.slice(0, 7).map((source) => ({
        title: source.title,
        url: source.url,
        source: source.domain,
        ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      })),
    };
  };

  const fetchWithRateLimitRetry = async (): Promise<OrinAiNewsResult> => {
    try {
      return await fetchOnce();
    } catch (error) {
      const failure = toFailure(error);
      if (failure.code === "http" && failure.status === 429) {
        await sleep(rateLimitWaitMs);
        return fetchOnce();
      }
      throw error;
    }
  };

  /** 代替ソース（公開 RSS）の取得。失敗は rss- 接頭辞の理由で分ける。 */
  const fetchRssHeadlines = async (): Promise<OrinAiNewsResult> => {
    const fetchImpl = deps.fetchImpl ?? defaultOriginSearchFetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), rssTimeoutMs);
    let text: string;
    try {
      const response = await fetchImpl(ORIN_AI_NEWS_RSS_URL, {
        headers: { "User-Agent": "ORIGIN-Personal/1.0 (https://origin-personal.vercel.app; ai-news)" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OrinAiNewsUnavailableError({ code: "rss-http", status: response.status });
      }
      text = await response.text();
    } catch (error) {
      if (error instanceof OrinAiNewsUnavailableError) throw error;
      if (controller.signal.aborted) throw new OrinAiNewsUnavailableError({ code: "rss-timeout" });
      throw new OrinAiNewsUnavailableError({ code: "rss-network" });
    } finally {
      clearTimeout(timer);
    }
    const items = parseOrinAiNewsRss(text);
    if (items.length === 0) {
      throw new OrinAiNewsUnavailableError({ code: "rss-invalid" });
    }
    return { fetchedAt: new Date(now()).toISOString(), stale: false, items };
  };

  return {
    getHeadlines(): Promise<OrinAiNewsResult> {
      if (cache && now() - cache.fetchedAtMs <= cacheTtlMs) {
        return Promise.resolve(cache.result);
      }
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const result = await fetchWithRateLimitRetry();
          cache = { fetchedAtMs: now(), result };
          return result;
        } catch (error) {
          const failure = toFailure(error);
          deps.onFailure?.(failure);
          // 代替ソース（公開 RSS）の受け皿。GDELT の IP 制限が
          // 共有出口の都合で埋まっている間も見出しを届ける。
          // ここも失敗したら、その理由も記録に残してから、
          // 前回分（stale）→ 主系の理由での失敗、の順に倒す。
          try {
            const fallback = await fetchRssHeadlines();
            cache = { fetchedAtMs: now(), result: fallback };
            return fallback;
          } catch (fallbackError) {
            deps.onFailure?.(
              fallbackError instanceof OrinAiNewsUnavailableError ? fallbackError.failure : { code: "rss-unknown" },
            );
          }
          if (cache && now() - cache.fetchedAtMs <= staleLimitMs) {
            return { ...cache.result, stale: true };
          }
          throw new OrinAiNewsUnavailableError(failure);
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
  };
}
