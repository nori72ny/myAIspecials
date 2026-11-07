/**
 * Fail-soft prompt enhancement for raster generation.
 *
 * A plain user prompt ("静かな湖と朝焼け") underspecifies composition,
 * texture, and lighting, which is where a small distilled image model loses
 * the most quality. This module rewrites the prompt once with ORIGIN's
 * existing free chat model (OpenRouter `:free`, ZDR-strict routing policy,
 * the same free-model evidence catalog the chat path uses) before the image
 * request is planned.
 *
 * Fail-soft contract: ANY problem — no OpenRouter key configured, stale
 * free-model evidence, HTTP error, timeout, malformed or oversized output —
 * returns the original prompt unchanged. Enhancement must never block or
 * break image generation. It consumes the OpenRouter account's shared free
 * daily quota (the same pool as chat), so it is deliberately a single short
 * call, and it can be disabled with ORIGIN_RASTER_PROMPT_ENHANCEMENT=false.
 * It never touches the Cloudflare Neuron budget.
 *
 * Routing mirrors the chat path (originProviderClient): OpenRouter answers
 * "no endpoint matches the routing policy" with 403/404, so the zero-cost
 * provider policy stages are tried in order and only the ZDR filter relaxes
 * between stages — cost, fallback, and data-collection restrictions never
 * relax. Any other failure stops immediately. The failure reason names the
 * actual failure mode so production telemetry stays diagnosable:
 * PROMPT_ENHANCEMENT_NO_ENDPOINT (every stage 403/404),
 * PROMPT_ENHANCEMENT_RATE_LIMITED (429), PROMPT_ENHANCEMENT_HTTP_ERROR
 * (any other non-OK status), PROMPT_ENHANCEMENT_TIMEOUT (local abort), and
 * PROMPT_ENHANCEMENT_UNAVAILABLE (transport-level failure).
 */
import { selectCurrentOriginFreeModel } from '../lib/orchestration/OriginFreeModelCatalog.js';
import { ORIGIN_ZERO_COST_OPENROUTER_POLICY_STAGES } from '../legacy/zeroCostRoutingPolicy.js';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ENHANCEMENT_TIMEOUT_MS = 10_000;
const MAX_ENHANCED_CHARS = 1_500;
const MIN_ENHANCED_CHARS = 8;

export type RasterPromptEnhancementV15 = {
  prompt: string;
  applied: boolean;
  model: string | null;
  reason: string | null;
  externalNetworkRequests: number;
};

const SYSTEM_INSTRUCTION = [
  'You rewrite short image-generation requests into one production-ready image prompt.',
  'Preserve the user\'s subject and intent exactly; do not add new subjects, people, brands, or text.',
  'Make composition, camera/viewpoint, materials and texture, lighting, color palette, and background concrete and specific.',
  'Write the result as a single English prompt of at most 110 words, with no quotes, no preamble, and no explanation.',
  'If the request asks for visible text, keep that exact text quoted in the prompt.',
].join(' ');

function sanitizeEnhanced(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim().replace(/^["「]|["」]$/g, '').trim();
  if (cleaned.length < MIN_ENHANCED_CHARS || cleaned.length > MAX_ENHANCED_CHARS) return null;
  return cleaned;
}

export async function enhanceRasterPromptV15(
  prompt: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<RasterPromptEnhancementV15> {
  const original = { prompt, applied: false, model: null, externalNetworkRequests: 0 } as const;
  if (env.ORIGIN_RASTER_PROMPT_ENHANCEMENT?.trim().toLowerCase() === 'false') {
    return { ...original, reason: 'PROMPT_ENHANCEMENT_DISABLED' };
  }
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? '';
  if (!apiKey) return { ...original, reason: 'PROMPT_ENHANCEMENT_NOT_CONFIGURED' };

  const catalog = selectCurrentOriginFreeModel(undefined, nowMs);
  if (!catalog.ok) return { ...original, reason: 'PROMPT_ENHANCEMENT_EVIDENCE_UNAVAILABLE' };
  const model = catalog.model.modelId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENHANCEMENT_TIMEOUT_MS);
  let requests = 0;
  try {
    // One shared timeout budget covers every stage attempt: enhancement is
    // an optional pre-step and must stay a short call even when the policy
    // stages progress.
    let response: Response | null = null;
    for (const policy of ORIGIN_ZERO_COST_OPENROUTER_POLICY_STAGES) {
      requests += 1;
      response = await fetchImpl(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'ORIGIN-Personal/1.5',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 300,
          provider: policy,
        }),
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store',
      });
      // Only "no endpoint matches this policy stage" (403/404) advances to
      // the next stage, exactly as on the chat path. Rate limits and server
      // errors are not endpoint-matching problems and stop here.
      if (!response || ![403, 404].includes(response.status)) break;
    }
    if (!response || !response.ok) {
      const reason = !response
        ? 'PROMPT_ENHANCEMENT_UNAVAILABLE'
        : response.status === 429
          ? 'PROMPT_ENHANCEMENT_RATE_LIMITED'
          : [403, 404].includes(response.status)
            ? 'PROMPT_ENHANCEMENT_NO_ENDPOINT'
            : 'PROMPT_ENHANCEMENT_HTTP_ERROR';
      return { prompt, applied: false, model, reason, externalNetworkRequests: requests };
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const choices = Array.isArray(body?.choices) ? body.choices : [];
    const first = choices[0] && typeof choices[0] === 'object' && !Array.isArray(choices[0])
      ? choices[0] as Record<string, unknown>
      : null;
    const message = first?.message && typeof first.message === 'object' && !Array.isArray(first.message)
      ? first.message as Record<string, unknown>
      : null;
    const enhanced = sanitizeEnhanced(message?.content);
    if (!enhanced) {
      return { prompt, applied: false, model, reason: 'PROMPT_ENHANCEMENT_INVALID_OUTPUT', externalNetworkRequests: requests };
    }
    return { prompt: enhanced, applied: true, model, reason: null, externalNetworkRequests: requests };
  } catch (error) {
    const timedOut = controller.signal.aborted
      || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError');
    return {
      prompt,
      applied: false,
      model,
      reason: timedOut ? 'PROMPT_ENHANCEMENT_TIMEOUT' : 'PROMPT_ENHANCEMENT_UNAVAILABLE',
      externalNetworkRequests: requests,
    };
  } finally {
    clearTimeout(timer);
  }
}
