import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { OriginLanguage } from '../i18n';
import { ORIN_AI_NEWS_DIGEST } from './orinAiNewsDigest';
import {
  getOrinAiNewsCache,
  orinAiNewsDigestUpdatedText,
  orinAiNewsFetchedAtText,
  orinAiNewsRelativeTime,
  parseOrinAiNewsPayload,
  storeOrinAiNewsCache,
  type OrinAiNewsPayload,
} from './orinAiNews';

/**
 * 「AIニュース」ページ（オーナー指示 2026-11-25 17:14：
 * オリンパネルのタブから左サイドバーの項目＋専用ページへ移設。
 * 設計は ORIN_PANEL_EXPANSION_DESIGN_2026-11-25 §8 を適用）。
 *
 * 2層構成は設計どおり：(1) 週次ダイジェスト（水曜の外部動向
 * ウォッチと一緒に作る同梱データ。デプロイで差し替える静的
 * データで、表示のみ）、(2) 最新の見出しは取得口
 * （GET /api/orin/ai-news、サーバー側の固定クエリのみ・保存
 * なし・個人データなし）から開くたびに取る。開くたびの LLM
 * 要約はしない（枠・捏造・遅延のため）。取得結果はメモリ内
 * だけに持ち、同一セッション30分以内は再利用する。見出し層が
 * 取れない時はその層だけ畳み、ダイジェストは出し続ける。
 *
 * ページとして広く使えるため、要約は行数で切らず全文を出す。
 *
 * 見出し層の状態表示の是正（2026-11-27、診断
 * AI_NEWS_HEADLINES_DIAGNOSIS_2026-11-27 の案B）：取得に時間が
 * かかる時はその旨を出し、上限を超えたら失敗として扱って
 * 「もう一度試す」で取り直せるようにする。「読み込み中のまま
 * 無言」をなくし、遅いと失敗を必ず区別する。
 */
/** 取得が長引いた時に「時間がかかっています」を出すまでの時間。 */
const ORIN_AI_NEWS_SLOW_MS = 10_000;
/** 取得の上限。これを超えたら中断して失敗として扱う。 */
const ORIN_AI_NEWS_FETCH_LIMIT_MS = 30_000;

type NewsState =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: OrinAiNewsPayload }
  | { kind: 'error' };

export default function OrinAiNewsPage({ language }: { language: OriginLanguage }) {
  const ja = language !== 'en';
  const [newsState, setNewsState] = useState<NewsState>({ kind: 'loading' });
  const [slowLoad, setSlowLoad] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const cached = getOrinAiNewsCache(Date.now());
    if (cached) {
      setNewsState({ kind: 'ready', payload: cached });
      return;
    }
    let cancelled = false;
    setNewsState({ kind: 'loading' });
    setSlowLoad(false);
    const controller = new AbortController();
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlowLoad(true);
    }, ORIN_AI_NEWS_SLOW_MS);
    const limitTimer = setTimeout(() => {
      controller.abort();
    }, ORIN_AI_NEWS_FETCH_LIMIT_MS);
    void fetch('/api/orin/ai-news', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as unknown;
        if (cancelled) return;
        const payload = response.ok ? parseOrinAiNewsPayload(data) : null;
        if (!payload) {
          setNewsState({ kind: 'error' });
          return;
        }
        storeOrinAiNewsCache(payload);
        setNewsState({ kind: 'ready', payload });
      })
      .catch(() => {
        if (!cancelled) setNewsState({ kind: 'error' });
      })
      .finally(() => {
        clearTimeout(slowTimer);
        clearTimeout(limitTimer);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(slowTimer);
      clearTimeout(limitTimer);
    };
  }, [reloadKey]);

  const digestUpdatedText = orinAiNewsDigestUpdatedText(ORIN_AI_NEWS_DIGEST.updatedAt, ja);
  const fetchedAtText = newsState.kind === 'ready' ? orinAiNewsFetchedAtText(newsState.payload.fetchedAt, ja) : null;
  const now = Date.now();

  return (
    <div data-testid="origin-ai-news-page" className="origin-ai-news-page mx-auto w-full max-w-[var(--content-reading)] px-4 py-6 sm:px-6">
      <h1 className="m-0 text-xl font-bold">{ja ? 'AIの最新情報' : 'The latest in AI'}</h1>
      <p className="origin-muted m-0 mt-2 text-sm leading-[1.7]">
        {ja
          ? 'AIの大切な動きを、週に一度のまとめと最新の見出しでお伝えします。見出しは出典元でそのまま読めます。'
          : 'The important moves in AI, in a weekly digest and the latest headlines. Headlines open at their source.'}
      </p>

      <section className="origin-orin-panel__section">
        <h2 className="origin-orin-panel__section-title">{ja ? '今週のまとめ' : 'This week in AI'}</h2>
        <ul className="origin-orin-panel__rows">
          {ORIN_AI_NEWS_DIGEST.items.map((item) => (
            <li key={item.sourceUrl}>
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="origin-orin-panel__news-row">
                <span className="origin-orin-panel__news-title">{ja ? item.title.ja : item.title.en}</span>
                <span className="origin-orin-panel__news-summary origin-ai-news-page__summary">{ja ? item.summary.ja : item.summary.en}</span>
                <span className="origin-orin-panel__news-source">
                  {item.sourceName}
                  <ExternalLink aria-hidden="true" size={12} />
                </span>
              </a>
            </li>
          ))}
        </ul>
        {digestUpdatedText && <p className="origin-orin-panel__news-updated">{digestUpdatedText}</p>}
      </section>

      <section className="origin-orin-panel__section">
        <div className="origin-orin-panel__news-head">
          <h2 className="origin-orin-panel__section-title">{ja ? '最新の見出し' : 'Latest headlines'}</h2>
          {fetchedAtText && <span className="origin-orin-panel__row-meta">{fetchedAtText}</span>}
        </div>
        {newsState.kind === 'loading' ? (
          <div data-testid="origin-ai-news-loading" className="origin-orin-panel__news-loading">
            <span aria-hidden="true" className="origin-orin-panel__skeleton-bar" />
            <span aria-hidden="true" className="origin-orin-panel__skeleton-bar" />
            <span aria-hidden="true" className="origin-orin-panel__skeleton-bar" />
            <p className="origin-orin-panel__row-sub">
              {slowLoad
                ? (ja ? '読み込みに時間がかかっています' : 'Taking longer than usual…')
                : (ja ? '読み込んでいます' : 'Loading…')}
            </p>
          </div>
        ) : newsState.kind === 'error' ? (
          <>
            <p data-testid="origin-ai-news-error" className="origin-orin-panel__row-sub">
              {ja ? '最新の見出しを取得できませんでした' : 'Could not load the latest headlines.'}
            </p>
            <button
              type="button"
              data-testid="origin-ai-news-retry"
              onClick={() => setReloadKey((key) => key + 1)}
              className="origin-secondary-button mt-2 inline-flex min-h-11 items-center px-3 text-sm font-semibold"
            >
              {ja ? 'もう一度試す' : 'Try again'}
            </button>
          </>
        ) : (
          <ul className="origin-orin-panel__rows">
            {newsState.payload.items.map((headline) => {
              const relative = orinAiNewsRelativeTime(headline.publishedAt, now, ja);
              return (
                <li key={headline.url}>
                  <a href={headline.url} target="_blank" rel="noopener noreferrer" className="origin-orin-panel__news-row">
                    <span className="origin-orin-panel__news-title">{headline.title}</span>
                    <span className="origin-orin-panel__news-meta">
                      {headline.source}
                      {relative && <>{' ・ '}{relative}</>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
