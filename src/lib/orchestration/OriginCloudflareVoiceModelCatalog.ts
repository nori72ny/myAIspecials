export const ORIGIN_CLOUDFLARE_VOICE_MODEL = "@cf/openai/whisper-large-v3-turbo" as const;
/**
 * Voice transcription evidence catalog (PR-V1, design:
 * VOICE_INPUT_RECON_2026-11-12). This is a SEPARATE catalog from the chat
 * free-model catalog on purpose: speech models are priced in Neurons per
 * audio minute, not Neurons per million tokens, so they cannot share the
 * chat catalog's rate table or its closed model-id set.
 *
 * HONEST SCOPE: this catalog only records evidence. NOTHING in the current
 * code selects or calls this model: there is no transcription runtime, no
 * server endpoint and no client recording UI yet (later PRs), and the chat
 * and image routes are untouched. Recording the evidence is the prerequisite
 * step that lets a later runtime fail closed against it.
 */
export type OriginCloudflareVoiceModelId = typeof ORIGIN_CLOUDFLARE_VOICE_MODEL;

export const ORIGIN_CLOUDFLARE_VOICE_MODEL_IDS: readonly OriginCloudflareVoiceModelId[] = [
  ORIGIN_CLOUDFLARE_VOICE_MODEL,
] as const;

export function isOriginCloudflareVoiceModelId(value: unknown): value is OriginCloudflareVoiceModelId {
  return value === ORIGIN_CLOUDFLARE_VOICE_MODEL;
}

/**
 * Published Workers AI rate (Neurons per audio minute), rechecked on
 * 2026-11-12 against the official pricing page. Evidence for consumption
 * estimates and quota budgeting only; never a charge.
 */
export const ORIGIN_CLOUDFLARE_VOICE_MODEL_NEURONS_PER_AUDIO_MINUTE: Readonly<Record<OriginCloudflareVoiceModelId, number>> = {
  [ORIGIN_CLOUDFLARE_VOICE_MODEL]: 46.63,
} as const;

export interface OriginCloudflareVoiceModelEvidence {
  providerId: "cloudflare-workers-ai-free";
  providerLabel: string;
  modelId: OriginCloudflareVoiceModelId;
  verifiedAt: string;
  reviewAfter: string;
  sourceUrl: string;
  sourceDescription: string;
}

const ORIGIN_CLOUDFLARE_VOICE_MODEL_SOURCE =
  "https://developers.cloudflare.com/workers-ai/platform/data-usage/" as const;

export const DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG: readonly OriginCloudflareVoiceModelEvidence[] = [
  {
    providerId: "cloudflare-workers-ai-free",
    providerLabel: "ORIGIN 無料AI",
    modelId: ORIGIN_CLOUDFLARE_VOICE_MODEL,
    verifiedAt: "2026-11-12T00:00:00.000Z",
    reviewAfter: "2026-12-12T00:00:00.000Z",
    sourceUrl: ORIGIN_CLOUDFLARE_VOICE_MODEL_SOURCE,
    sourceDescription: "Cloudflare official documentation rechecked on 2026-11-12. Pricing: the Workers AI pricing page (updated 2026-10-20, https://developers.cloudflare.com/workers-ai/platform/pricing/) lists @cf/openai/whisper-large-v3-turbo in its audio model pricing at $0.0005 per audio minute (46.63 Neurons per audio minute), inside the account-wide free allocation of 10,000 Neurons per day (limits reset at 00:00 UTC); on the Workers Free plan the free-allocation price is 'N/A - Upgrade to Workers Paid', exceeding a limit fails with an error instead of charging, and ORIGIN's account is on Workers Free with no payment method registered, so usage stays strictly $0. Retention and training: 'Your Data and Workers AI' (updated 2026-10-16) names audio explicitly as an example input ('for example, text prompts, images, and audio') treated as Customer Content, states zero data retention for standard inference requests that do not invoke a stateful feature ('Cloudflare does not retain inputs or outputs after they are no longer needed to process the request'), and states that Cloudflare does not use Customer Content processed by Workers AI to train AI models; the planned runtime calls the REST API directly and never routes through AI Gateway, whose logging/caching is a documented exception. HONEST LIMITS: the model page for @cf/openai/whisper-large-v3-turbo (https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) was fetched on 2026-11-12, but its per-model 'Zero data retention: Yes' tag could NOT be confirmed from the fetched page text, so the retention and no-training evidence for this model rests on the platform-level data-usage statement above, which explicitly covers audio inputs; a live-browser re-check of the model-page tag remains outstanding. Cloudflare does not officially list the accepted audio container formats, so real-device checks (Android webm/opus, iPhone mp4/aac) are prerequisites before any activation. This catalog check does not by itself prove a live account is on Workers Free, and NOTHING in the current code selects or calls this model: there is no transcription runtime yet, and activation additionally requires live account-plan verification, the device and Japanese-quality checks, and the owner's explicit approval. The evidence window is deliberately bounded (reviewAfter 2026-12-12): resolution fails closed when it passes without a fresh documentation re-check.",
  },
] as const;

export type OriginCloudflareVoiceModelCatalogFailureCode = "VOICE_MODEL_CATALOG_INVALID" | "VOICE_MODEL_EVIDENCE_STALE";
export type OriginCloudflareVoiceModelCatalogResult = { ok: true; model: OriginCloudflareVoiceModelEvidence } | { ok: false; code: OriginCloudflareVoiceModelCatalogFailureCode; message: string };

function parseTimestamp(value: string): number | null { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? timestamp : null; }
function isValidEvidence(entry: OriginCloudflareVoiceModelEvidence): boolean {
  const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter);
  return entry.providerId === "cloudflare-workers-ai-free" && isOriginCloudflareVoiceModelId(entry.modelId) && entry.sourceUrl.startsWith("https://developers.cloudflare.com/") && verifiedAt !== null && reviewAfter !== null && reviewAfter > verifiedAt;
}
export function selectCurrentOriginCloudflareVoiceModelById(catalog: readonly OriginCloudflareVoiceModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG, modelId: OriginCloudflareVoiceModelId, nowMs: number = Date.now()): OriginCloudflareVoiceModelCatalogResult {
  if (!Number.isFinite(nowMs) || catalog.length === 0 || catalog.some((entry) => !isValidEvidence(entry))) return { ok: false, code: "VOICE_MODEL_CATALOG_INVALID", message: "音声モデルの証拠カタログが正しくありません。" };
  const current = catalog.find((entry) => { const verifiedAt = parseTimestamp(entry.verifiedAt); const reviewAfter = parseTimestamp(entry.reviewAfter); return entry.modelId === modelId && verifiedAt !== null && reviewAfter !== null && nowMs >= verifiedAt && nowMs <= reviewAfter; });
  if (!current) return { ok: false, code: "VOICE_MODEL_EVIDENCE_STALE", message: "音声モデルの利用可能性を示す証拠が期限切れです。カタログを再確認するまで実行を停止します。" };
  return { ok: true, model: current };
}
export function selectCurrentOriginCloudflareVoiceModel(catalog: readonly OriginCloudflareVoiceModelEvidence[] = DEFAULT_ORIGIN_CLOUDFLARE_VOICE_MODEL_CATALOG, nowMs: number = Date.now()): OriginCloudflareVoiceModelCatalogResult {
  return selectCurrentOriginCloudflareVoiceModelById(catalog, ORIGIN_CLOUDFLARE_VOICE_MODEL, nowMs);
}
