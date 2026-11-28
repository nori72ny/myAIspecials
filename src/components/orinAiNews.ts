/**
 * オリンパネル「AIの最新情報」の見出し層のロジック（拡張設計
 * ORIN_PANEL_EXPANSION_DESIGN_2026-11-25 §8.3・§8.4）。
 *
 * 見出しはタブを開くたびに、パネル専用の取得口
 * （GET /api/orin/ai-news）から取る。サーバー側は固定クエリだけで
 * GDELT を引くため、利用者の会話・依頼・個人情報は一切送られない。
 * 結果はメモリ内だけに持ち（端末にもサーバーにも保存しない）、
 * 同一セッションで30分以内の再表示は前回分を使う。
 * 要約文はここでは作らない（見出しは見出しとして正直に出す、§8.5）。
 */

export interface OrinAiNewsHeadline {
  title: string;
  /**
   * 記事そのものの URL。サーバー側で中継 URL から解決できな
   * かった見出しは null で届き、画面はリンクにせず出典名だけ
   * を表示する（Q7-03：中継を記事リンクと偽らない）。
   */
  url: string | null;
  /** 出典ドメインの表示名（例：blog.google）。 */
  source: string;
  /** ISO 8601。取れない場合は undefined。 */
  publishedAt?: string;
}

export interface OrinAiNewsPayload {
  fetchedAt: string;
  items: OrinAiNewsHeadline[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 取得口の応答を検証して取り込む。形が合わないものは落とす／全体が合わなければ null。 */
export function parseOrinAiNewsPayload(raw: unknown): OrinAiNewsPayload | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  if (typeof raw.fetchedAt !== 'string' || Number.isNaN(new Date(raw.fetchedAt).getTime())) return null;
  if (!Array.isArray(raw.items)) return null;
  const items: OrinAiNewsHeadline[] = [];
  for (const entry of raw.items) {
    if (!isRecord(entry)) continue;
    if (typeof entry.title !== 'string' || !entry.title.trim()) continue;
    // url は「記事 URL の文字列」か「解決できなかったことを示す
    // null」のどちらか。それ以外の形は壊れた項目として落とす。
    let url: string | null = null;
    if (typeof entry.url === 'string') {
      if (!isSafeHttpsUrl(entry.url)) continue;
      url = entry.url;
    } else if (entry.url !== null && entry.url !== undefined) {
      continue;
    }
    if (typeof entry.source !== 'string' || !entry.source.trim()) continue;
    const publishedAt = typeof entry.publishedAt === 'string' && !Number.isNaN(new Date(entry.publishedAt).getTime())
      ? entry.publishedAt
      : undefined;
    items.push({ title: entry.title.trim(), url, source: entry.source.trim(), publishedAt });
    if (items.length >= 7) break;
  }
  return { fetchedAt: raw.fetchedAt, items };
}

/* ------------------------------------------------------------------ */
/* セッション内キャッシュ（メモリのみ、30分）                          */
/* ------------------------------------------------------------------ */

export const ORIN_AI_NEWS_CACHE_MS = 30 * 60 * 1000;

let headlineCache: OrinAiNewsPayload | null = null;

export function getOrinAiNewsCache(now: number): OrinAiNewsPayload | null {
  if (!headlineCache) return null;
  const fetched = new Date(headlineCache.fetchedAt).getTime();
  if (!Number.isFinite(fetched) || now - fetched > ORIN_AI_NEWS_CACHE_MS) return null;
  return headlineCache;
}

export function storeOrinAiNewsCache(payload: OrinAiNewsPayload): void {
  headlineCache = payload;
}

export function clearOrinAiNewsCache(): void {
  headlineCache = null;
}

/* ------------------------------------------------------------------ */
/* 表示用の時刻テキスト                                                */
/* ------------------------------------------------------------------ */

/** 見出しの相対時刻（「3時間前」形式）。日付が読めない場合は null。 */
export function orinAiNewsRelativeTime(iso: string | undefined, now: number, ja: boolean): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 5) return ja ? 'たった今' : 'just now';
  if (minutes < 60) return ja ? `${minutes}分前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ja ? `${hours}時間前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return ja ? `${days}日前` : `${days}d ago`;
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ダイジェストの更新日表示（「11月25日更新」）。 */
export function orinAiNewsDigestUpdatedText(updatedAt: string, ja: boolean): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(updatedAt);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return ja ? `${month}月${day}日更新` : `Updated ${EN_MONTHS[month - 1]} ${day}`;
}

/** 見出し層の取得時刻表示（「15:04 時点」）。 */
export function orinAiNewsFetchedAtText(fetchedAt: string, ja: boolean): string | null {
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return ja ? `${hh}:${mm} 時点` : `as of ${hh}:${mm}`;
}
