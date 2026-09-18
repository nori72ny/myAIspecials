import { createHash } from "node:crypto";

import { normalizeOriginPublicHttpsUrl } from "./OriginPublicSourceUrl.js";
import { containsSensitiveInput } from "./SensitiveInputDetector.js";

export interface OriginResearchSearchRequest {
  readonly query: string;
  readonly queryDigest: string;
  readonly maxResults: number;
  readonly executionPolicy: {
    readonly maxCostUsd: 0;
    readonly maxAttempts: 1;
  };
}

export interface OriginResearchSearchResultItem {
  readonly rank: number;
  readonly title: string;
  readonly sourceUrl: string;
}

export interface OriginResearchSearchRecord {
  readonly queryDigest: string;
  readonly results: readonly OriginResearchSearchResultItem[];
  readonly actualCostUsd: 0;
  readonly attempts: 1;
}

export interface OriginResearchSearchProvider {
  (request: OriginResearchSearchRequest): Promise<unknown>;
}

export type OriginResearchSearchResult =
  | { readonly ok: true; readonly record: OriginResearchSearchRecord }
  | {
      readonly ok: false;
      readonly code:
        | "INVALID_RESEARCH_SEARCH_REQUEST"
        | "RESEARCH_SEARCH_PROVIDER_NOT_AVAILABLE"
        | "RESEARCH_SEARCH_FAILED"
        | "RESEARCH_SEARCH_RECORD_MISMATCH"
        | "RESEARCH_SEARCH_COST_UNVERIFIED";
    };

const MAX_QUERY = 1_000;
const MAX_RESULTS = 8;
const MAX_TITLE = 300;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function isRecord(value: unknown): value is OriginResearchSearchRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OriginResearchSearchRecord>;
  return typeof record.queryDigest === "string"
    && Array.isArray(record.results)
    && typeof record.actualCostUsd === "number"
    && record.attempts === 1;
}

function isItem(value: unknown): value is OriginResearchSearchResultItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OriginResearchSearchResultItem>;
  return Number.isInteger(item.rank)
    && typeof item.title === "string"
    && typeof item.sourceUrl === "string";
}

export async function searchOriginResearchSources(
  rawQuery: string,
  provider?: OriginResearchSearchProvider,
): Promise<OriginResearchSearchResult> {
  const query = rawQuery.trim();
  if (
    query.length === 0
    || query.length > MAX_QUERY
    || containsSensitiveInput(query)
  ) {
    return { ok: false, code: "INVALID_RESEARCH_SEARCH_REQUEST" };
  }

  if (!provider) {
    return { ok: false, code: "RESEARCH_SEARCH_PROVIDER_NOT_AVAILABLE" };
  }

  const queryDigest = sha256(query);
  const request: OriginResearchSearchRequest = {
    query,
    queryDigest,
    maxResults: MAX_RESULTS,
    executionPolicy: {
      maxCostUsd: 0,
      maxAttempts: 1,
    },
  };

  let raw: unknown;
  try {
    raw = await provider(request);
  } catch {
    return { ok: false, code: "RESEARCH_SEARCH_FAILED" };
  }

  if (!isRecord(raw) || raw.queryDigest !== queryDigest || raw.attempts !== 1) {
    return { ok: false, code: "RESEARCH_SEARCH_RECORD_MISMATCH" };
  }

  if (raw.actualCostUsd !== 0 || !Number.isFinite(raw.actualCostUsd)) {
    return { ok: false, code: "RESEARCH_SEARCH_COST_UNVERIFIED" };
  }

  if (raw.results.length > MAX_RESULTS) {
    return { ok: false, code: "RESEARCH_SEARCH_RECORD_MISMATCH" };
  }

  const seenUrls = new Set<string>();
  const normalizedResults: OriginResearchSearchResultItem[] = [];

  for (let index = 0; index < raw.results.length; index += 1) {
    const item = raw.results[index];
    if (!isItem(item) || item.rank !== index + 1) {
      return { ok: false, code: "RESEARCH_SEARCH_RECORD_MISMATCH" };
    }

    const title = item.title.trim();
    const sourceUrl = normalizeOriginPublicHttpsUrl(item.sourceUrl);
    if (
      title.length === 0
      || title.length > MAX_TITLE
      || !sourceUrl
      || seenUrls.has(sourceUrl)
    ) {
      return { ok: false, code: "RESEARCH_SEARCH_RECORD_MISMATCH" };
    }

    seenUrls.add(sourceUrl);
    normalizedResults.push(Object.freeze({
      rank: item.rank,
      title,
      sourceUrl,
    }));
  }

  return {
    ok: true,
    record: Object.freeze({
      queryDigest,
      results: Object.freeze(normalizedResults),
      actualCostUsd: 0,
      attempts: 1,
    }),
  };
}
