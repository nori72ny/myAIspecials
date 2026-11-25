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
 */
import {
  OriginSearchProviderError,
  searchGdeltHeadlines,
  type OriginSearchFetch,
} from "../search/originSearchProviders.js";

/** 固定クエリ（利用者の情報は一切含まない。従来のエンドポイントから移設）。 */
export const ORIN_AI_NEWS_QUERY = "人工知能 OR 生成AI OR 大規模言語モデル OR \"artificial intelligence\" OR \"large language model\"";
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

export function createOrinAiNewsService(deps: OrinAiNewsServiceDeps = {}): OrinAiNewsService {
  const timeoutMs = deps.timeoutMs ?? ORIN_AI_NEWS_TIMEOUT_MS;
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
