/**
 * $0 evidence catalog and monthly budget guard for search providers
 * (design doc SEARCH_GROUNDING_DESIGN_2026-11-07 §2.6).
 *
 * Mirrors the free-model evidence catalog discipline: every provider carries
 * { termsUrl, freeCap, paymentMethodRequired, verifiedAt, reviewAfter } and a
 * route is enabled only while its evidence is current. Any doubt fails closed
 * for that route only; other routes and normal chat keep working.
 *
 * Operational rule for every provider in this catalog: no payment method is
 * ever registered and no auto-charge / auto-refill is ever enabled, so a
 * billing path does not exist even if free terms change.
 */

export type OriginSearchProviderId = "open-meteo" | "gdelt" | "wikipedia" | "tavily" | "stooq";

export interface OriginSearchProviderEvidence {
  providerId: OriginSearchProviderId;
  /** Official page where the free terms were verified. */
  termsUrl: string;
  /** Documented free cap; null when the provider publishes no numeric cap. */
  freeCap: { amount: number; unit: "credits" | "requests"; period: "month" | "day" } | null;
  freeCapNote: string;
  /** Must be false: a provider that requires a payment method is never adopted. */
  paymentMethodRequired: false;
  /** The route needs an API key from the environment (value is never stored here). */
  requiresApiKey: boolean;
  /**
   * Conservative self-imposed monthly stop, in the provider's cap units.
   * null means the monthly counter only observes usage for this provider and
   * the binding guard is the TTL cache / rate behaviour instead (keyless
   * routes cannot be charged because no payment method can exist).
   */
  monthlySelfCapUnits: number | null;
  verifiedAt: string;
  reviewAfter: string;
}

const SEARCH_EVIDENCE_VERIFIED_AT = "2026-11-07T00:00:00.000Z";
/** Re-verification deadline: 30 days after the 2026-11-07 primary-source check. */
const SEARCH_EVIDENCE_REVIEW_AFTER = "2026-12-07T00:00:00.000Z";

export const DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG: readonly OriginSearchProviderEvidence[] = [
  {
    providerId: "open-meteo",
    termsUrl: "https://open-meteo.com/en/terms",
    freeCap: { amount: 10_000, unit: "requests", period: "day" },
    freeCapNote: "Free for non-commercial use without an API key or registration (10,000/day, 5,000/hour, 600/minute, ~300,000/month; data CC BY 4.0). Verified 2026-11-07.",
    paymentMethodRequired: false,
    requiresApiKey: false,
    monthlySelfCapUnits: null,
    verifiedAt: SEARCH_EVIDENCE_VERIFIED_AT,
    reviewAfter: SEARCH_EVIDENCE_REVIEW_AFTER,
  },
  {
    providerId: "gdelt",
    termsUrl: "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/",
    freeCap: null,
    freeCapNote: "Free public data API without a key; no numeric cap is published. Formal terms/attribution requirements were not fully confirmed in the 2026-11-07 survey and must be re-checked by reviewAfter.",
    paymentMethodRequired: false,
    requiresApiKey: false,
    monthlySelfCapUnits: null,
    verifiedAt: SEARCH_EVIDENCE_VERIFIED_AT,
    reviewAfter: SEARCH_EVIDENCE_REVIEW_AFTER,
  },
  {
    providerId: "wikipedia",
    termsUrl: "https://foundation.wikimedia.org/wiki/Terms_of_Use",
    freeCap: null,
    freeCapNote: "Read APIs are free without a key; content is CC BY-SA with attribution and an identifying User-Agent is required by the API usage policy. Verified 2026-11-07.",
    paymentMethodRequired: false,
    requiresApiKey: false,
    monthlySelfCapUnits: null,
    verifiedAt: SEARCH_EVIDENCE_VERIFIED_AT,
    reviewAfter: SEARCH_EVIDENCE_REVIEW_AFTER,
  },
  {
    providerId: "tavily",
    termsUrl: "https://www.tavily.com/pricing",
    freeCap: { amount: 1_000, unit: "credits", period: "month" },
    freeCapNote: "Researcher plan: 1,000 API credits/month, no credit card required; the official pricing page states requests stop when credits are exhausted until reset or a paid upgrade, so no overage charge path exists. Basic search = 1 credit; extract = 1 credit per 5 successful URLs. Verified 2026-11-07. Data terms: query use is limited to service provision, but anonymized analytics may be used for improvement/R&D and fallback third-party indexes may record queries (MSA §3.6/§9.4); adoption was approved by the owner on 2026-11-07 with query minimization as a mandatory mitigation.",
    paymentMethodRequired: false,
    requiresApiKey: true,
    monthlySelfCapUnits: 800,
    verifiedAt: SEARCH_EVIDENCE_VERIFIED_AT,
    reviewAfter: SEARCH_EVIDENCE_REVIEW_AFTER,
  },
  {
    providerId: "stooq",
    termsUrl: "https://stooq.com/",
    freeCap: null,
    freeCapNote: "Keyless CSV quote snapshots; no numeric cap is published (an unpublished per-IP daily limit is reported, after which the endpoint returns an HTML page instead of CSV). Terms as published on Stooq's site and reported by multiple October-2026 third-party reviews: data is for personal use only, commercial use is prohibited, and redistribution requires Stooq's consent — ORIGIN is a personal, non-commercial single-user app that shows values only to its owner with attribution. Quotes are delayed. IMPORTANT: direct measurement of stooq.com from the build environment was blocked (egress denied), and 2026 third-party reports conflict on whether the CSV endpoints still answer keyless requests or demand an API key. The client therefore accepts only a strict CSV shape and fails closed on any HTML/key-demand response, and reviewAfter is set short (14 days) so this route self-disables unless a production measurement confirms keyless CSV access before then. Only fixed instrument symbols are ever sent; no user data leaves the device.",
    paymentMethodRequired: false,
    requiresApiKey: false,
    monthlySelfCapUnits: null,
    verifiedAt: "2026-11-08T00:00:00.000Z",
    reviewAfter: "2026-11-22T00:00:00.000Z",
  },
] as const;

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isValidOriginSearchProviderEvidence(entry: OriginSearchProviderEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt);
  const reviewAfter = parseTimestamp(entry.reviewAfter);
  if (!entry.termsUrl.startsWith("https://")) return false;
  if (entry.paymentMethodRequired !== false) return false;
  if (verifiedAt === null || reviewAfter === null || reviewAfter <= verifiedAt) return false;
  if (entry.freeCap !== null) {
    if (!Number.isFinite(entry.freeCap.amount) || entry.freeCap.amount <= 0) return false;
  }
  if (entry.monthlySelfCapUnits !== null) {
    if (!Number.isFinite(entry.monthlySelfCapUnits) || entry.monthlySelfCapUnits <= 0) return false;
    // A self cap above the documented free cap would defeat its purpose.
    if (entry.freeCap !== null && entry.freeCap.period === "month" && entry.monthlySelfCapUnits > entry.freeCap.amount) return false;
  }
  return true;
}

/** Returns the evidence only while it is current; null fails the route closed. */
export function selectCurrentOriginSearchProviderEvidence(
  catalog: readonly OriginSearchProviderEvidence[],
  providerId: OriginSearchProviderId,
  nowMs: number,
): OriginSearchProviderEvidence | null {
  if (!Number.isFinite(nowMs)) return null;
  const entry = catalog.find((candidate) => candidate.providerId === providerId);
  if (!entry || !isValidOriginSearchProviderEvidence(entry)) return null;
  const verifiedAt = parseTimestamp(entry.verifiedAt);
  const reviewAfter = parseTimestamp(entry.reviewAfter);
  if (verifiedAt === null || reviewAfter === null) return null;
  return nowMs >= verifiedAt && nowMs <= reviewAfter ? entry : null;
}

export function originSearchMonthKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/**
 * In-memory monthly usage counter. Serverless processes may lose it at any
 * time; that is safe because the provider-side free plan itself hard-stops
 * (Tavily stops at exhaustion) and no payment method exists. The counter is a
 * conservative early stop, not the only protection.
 */
export class OriginSearchUsageCounter {
  private readonly usageByProviderMonth = new Map<string, number>();

  usage(providerId: OriginSearchProviderId, nowMs: number): number {
    return this.usageByProviderMonth.get(`${providerId}:${originSearchMonthKey(nowMs)}`) ?? 0;
  }

  record(providerId: OriginSearchProviderId, units: number, nowMs: number): number {
    if (!Number.isFinite(units) || units <= 0) return this.usage(providerId, nowMs);
    const key = `${providerId}:${originSearchMonthKey(nowMs)}`;
    const next = (this.usageByProviderMonth.get(key) ?? 0) + units;
    this.usageByProviderMonth.set(key, next);
    return next;
  }

  canAfford(providerId: OriginSearchProviderId, units: number, selfCapUnits: number | null, nowMs: number): boolean {
    if (selfCapUnits === null) return true;
    return this.usage(providerId, nowMs) + units <= selfCapUnits;
  }

  clear(): void {
    this.usageByProviderMonth.clear();
  }
}

export const defaultOriginSearchUsageCounter = new OriginSearchUsageCounter();

export function resetOriginSearchUsageForTests(): void {
  defaultOriginSearchUsageCounter.clear();
}

export type OriginSearchProviderAccess =
  | { enabled: true; evidence: OriginSearchProviderEvidence }
  | {
      enabled: false;
      reason: "evidence-missing" | "evidence-stale" | "api-key-missing" | "monthly-cap-reached";
    };

export interface OriginSearchProviderAccessOptions {
  env?: NodeJS.ProcessEnv;
  nowMs: number;
  catalog?: readonly OriginSearchProviderEvidence[];
  counter?: OriginSearchUsageCounter;
  /** Units the caller is about to spend; checked against the monthly self cap. */
  units?: number;
}

export function evaluateOriginSearchProviderAccess(
  providerId: OriginSearchProviderId,
  options: OriginSearchProviderAccessOptions,
): OriginSearchProviderAccess {
  const catalog = options.catalog ?? DEFAULT_ORIGIN_SEARCH_PROVIDER_CATALOG;
  const entry = catalog.find((candidate) => candidate.providerId === providerId);
  if (!entry || !isValidOriginSearchProviderEvidence(entry)) return { enabled: false, reason: "evidence-missing" };
  const evidence = selectCurrentOriginSearchProviderEvidence(catalog, providerId, options.nowMs);
  if (!evidence) return { enabled: false, reason: "evidence-stale" };
  if (evidence.requiresApiKey) {
    const env = options.env ?? process.env;
    const key = typeof env.TAVILY_API_KEY === "string" ? env.TAVILY_API_KEY.trim() : "";
    if (!key) return { enabled: false, reason: "api-key-missing" };
  }
  const counter = options.counter ?? defaultOriginSearchUsageCounter;
  if (!counter.canAfford(providerId, options.units ?? 0, evidence.monthlySelfCapUnits, options.nowMs)) {
    return { enabled: false, reason: "monthly-cap-reached" };
  }
  return { enabled: true, evidence };
}
