/**
 * Single source of truth for the `provider` names the research API
 * (POST /api/research/v1.1/query) can return on a successful response.
 *
 * Why this module exists: #1130 (search grounding) widened the server-side
 * provider vocabulary, but the client kept accepting only the two legacy
 * names ('DuckDuckGo' | 'Wikipedia'). Every other successful, fully
 * grounded response (weather via Open-Meteo, news via GDELT, web via
 * Tavily, market via Stooq, composite via SearchGrounding) was discarded
 * by the client as "unverifiable" even though the server had completed
 * the research with sources. The vocabulary now lives here exactly once:
 *
 * - The server declares `OriginResearchResult.searchProvider` with the
 *   `ResearchProviderName` type from this module (type-only import, so
 *   no runtime coupling into the legacy server module).
 * - The client accepts exactly this set and still rejects anything else
 *   (fail-closed is preserved: unknown provider names are refused).
 *
 * Contract tests (researchProviderVocabulary.test.ts) pin the set and
 * verify that every label the search-grounding adapter can emit is a
 * member, so the two sides cannot silently drift apart again.
 */
export const RESEARCH_PROVIDER_NAMES = [
  'DuckDuckGo',
  'Bing',
  'Wikipedia',
  'Tavily',
  'GDELT',
  'Open-Meteo',
  'Stooq',
  'SearchGrounding',
] as const;

export type ResearchProviderName = (typeof RESEARCH_PROVIDER_NAMES)[number];

export function isResearchProviderName(value: unknown): value is ResearchProviderName {
  return typeof value === 'string'
    && (RESEARCH_PROVIDER_NAMES as readonly string[]).includes(value);
}
