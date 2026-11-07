import { verifyCloudflareRasterFreeModelV15 } from './cloudflareRasterImageProviderV15.js';
import { classifyCloudflareWorkersAiFailureV15 } from './cloudflareWorkersAiErrorV15.js';
import type { RasterImageResultV15 } from './rasterImageProviderV15.js';

const API_ORIGIN = 'https://api.cloudflare.com';
export const CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15 = '@cf/moondream/moondream3.1-9B-A2B' as const;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_ANSWER_CHARS = 12_000;

export const RASTER_SEMANTIC_AXES_V15 = [
  'promptAdherence',
  'composition',
  'subjectIntegrity',
  'styleExecution',
  'textHandling',
  'artifactControl',
  'professionalUsefulness',
] as const;

export type RasterSemanticAxisV15 = (typeof RASTER_SEMANTIC_AXES_V15)[number];
export type RasterSemanticScoresV15 = Record<RasterSemanticAxisV15, number>;

export type RasterSemanticCriticInputV15 = {
  originalRequest: string;
  exactText?: readonly string[];
  bytes: Buffer;
  mimeType: RasterImageResultV15['mimeType'];
};

export type RasterSemanticCriticResultV15 = {
  version: 'raster-semantic-critic-v1';
  passed: boolean;
  safetyPassed: boolean;
  safetyIssues: readonly string[];
  score: number;
  model: typeof CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15;
  scores: RasterSemanticScoresV15;
  checks: readonly string[];
  issues: readonly string[];
  summary: string;
  freeOnly: true;
  costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified' | 'post-generation-usage-zero-confirmed';
  paidFallbackEnabled: false;
  secretDelivery: 'server-only';
  externalNetworkRequests: number;
  /**
   * Neurons this call's own run response reported for itself
   * (result.usage.neurons in the live-verified envelope; the
   * cf-ai-neurons response header when the envelope has no usage block),
   * or null when neither carried a usable value. Evidence for the caller's
   * post-generation reconciliation fallback only; never a gate by itself
   * and never a substitute for the plan proof or the quota pre-check.
   */
  reportedNeurons: number | null;
};

type CloudflareEnvelope = {
  success?: unknown;
  result?: unknown;
};

type SemanticPayload = {
  promptAdherence?: unknown;
  composition?: unknown;
  subjectIntegrity?: unknown;
  styleExecution?: unknown;
  textHandling?: unknown;
  artifactControl?: unknown;
  professionalUsefulness?: unknown;
  safetyPassed?: unknown;
  safetyIssues?: unknown;
  criticalIssues?: unknown;
  summary?: unknown;
};

function credentials(env: NodeJS.ProcessEnv) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || apiToken.length > 4096) return null;
  return { accountId, apiToken };
}

async function timedFetch(url: string, init: RequestInit, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error', cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

function axisScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 4 ? value : null;
}

function usageNeurons(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const neurons = (value as Record<string, unknown>).neurons;
  return typeof neurons === 'number' && Number.isFinite(neurons) && neurons >= 0 ? neurons : null;
}

/**
 * Fallback usage source, used only when the run response's envelope
 * carries no usage block: the API also reports the call's Neurons in the
 * cf-ai-neurons response header as a decimal string (live-measured
 * 2026-11-07 on the generation model). Adopt it only when it parses to a
 * finite, positive number — anything else stays null, never invented.
 */
function neuronsFromResponseHeader(headers: Headers): number | null {
  const raw = headers.get('cf-ai-neurons');
  if (raw === null) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseSemanticJson(answer: string): unknown {
  try {
    return JSON.parse(answer);
  } catch {
    // Fall through to the bounded extraction retry below.
  }
  // The critic model intermittently wraps its JSON in a markdown code fence
  // or prefixes it with prose (observed in production as intermittent
  // RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID). Only when the direct parse
  // fails, retry with the outermost { ... } span. The extracted value still
  // faces the full strict validation in parseSemanticPayload, and anything
  // that cannot be extracted or validated fails closed exactly as before.
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  }
}

function parseSemanticPayload(answer: string): { scores: RasterSemanticScoresV15; safetyPassed: boolean; safetyIssues: string[]; issues: string[]; summary: string } {
  if (!answer || answer.length > MAX_ANSWER_CHARS) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  const parsed = parseSemanticJson(answer) as SemanticPayload;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  }

  const scores = {} as RasterSemanticScoresV15;
  for (const axis of RASTER_SEMANTIC_AXES_V15) {
    const score = axisScore(parsed[axis]);
    if (score === null) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
    scores[axis] = score;
  }

  if (typeof parsed.safetyPassed !== 'boolean') throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  const rawSafetyIssues = Array.isArray(parsed.safetyIssues) ? parsed.safetyIssues : [];
  const safetyIssues = rawSafetyIssues
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (rawSafetyIssues.length !== safetyIssues.length) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  if (parsed.safetyPassed && safetyIssues.length > 0) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  if (!parsed.safetyPassed && safetyIssues.length === 0) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

  const rawIssues = Array.isArray(parsed.criticalIssues) ? parsed.criticalIssues : [];
  const issues = rawIssues
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (rawIssues.length !== issues.length) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (!summary || summary.length > 600) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  return { scores, safetyPassed: parsed.safetyPassed, safetyIssues, issues, summary };
}

function questionFor(input: RasterSemanticCriticInputV15): string {
  const exactText = (input.exactText ?? []).map(value => value.trim()).filter(Boolean).slice(0, 8);
  return [
    'Act as a strict production image QA critic.',
    'Judge only what is visibly present in the supplied image against the user request below.',
    'Do not reward style alone if the requested subject, geometry, anatomy, layout, or text is wrong.',
    'Score each axis from 0 to 4, where 4 means professional production quality and 0 means unusable.',
    'Every axis is a quality score, never a defect count: the absence of a problem is a high score, not a zero.',
    'For textHandling: score 4 when the image contains no text and no text was requested, and score high when every visible character is rendered correctly and legibly. Score low only when text is garbled, unwanted, or incorrect.',
    'For artifactControl: score 4 when no artifacts, distortions, warped geometry, or malformed details are visible anywhere in the image. Score low only for artifacts that are actually visible.',
    'Independently inspect visible output safety. Set safetyPassed=false if the image visibly contains sexualized minors, explicit sexual content, graphic gore, hateful/extremist propaganda, actionable self-harm depiction, or clearly dangerous instructional imagery. Otherwise set safetyPassed=true.',
    'When safetyPassed=false, safetyIssues must list concise concrete visible safety reasons. When safetyPassed=true, safetyIssues must be an empty array.',
    exactText.length
      ? `Exact requested text, if visibly rendered, must be correct: ${JSON.stringify(exactText)}`
      : 'No exact text is mandatory unless the user request itself clearly asks for it.',
    `User request: ${input.originalRequest.normalize('NFKC').trim().slice(0, 1800)}`,
    'Return ONLY valid compact JSON with exactly these keys:',
    '{"promptAdherence":0,"composition":0,"subjectIntegrity":0,"styleExecution":0,"textHandling":0,"artifactControl":0,"professionalUsefulness":0,"safetyPassed":true,"safetyIssues":[],"criticalIssues":[],"summary":"..."}',
    'criticalIssues must contain only concrete visible defects that make the image materially unfit for the request.',
  ].join('\n');
}

export async function critiqueCloudflareRasterSemanticV15(
  input: RasterSemanticCriticInputV15,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RasterSemanticCriticResultV15> {
  const auth = credentials(env);
  if (!auth) throw new Error('CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED');
  if (!input.originalRequest.trim() || input.originalRequest.length > 2048) throw new Error('RASTER_SEMANTIC_CRITIC_INPUT_INVALID');
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 64 || input.bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('RASTER_SEMANTIC_CRITIC_INPUT_INVALID');
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType)) throw new Error('RASTER_SEMANTIC_CRITIC_INPUT_INVALID');

  // Verify the exact vision-critic model, not merely the separately configured image model.
  const status = await verifyCloudflareRasterFreeModelV15(CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15, env, fetchImpl);
  if (!status.ready || !(status.zeroCostVerified || status.freeAllocationEligible === true)
    || status.paymentMethodRequired || status.paidFallbackEnabled) {
    throw new Error(status.reason ?? 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED');
  }

  const response = await timedFetch(
    `${API_ORIGIN}/client/v4/accounts/${auth.accountId}/ai/run/${CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'ORIGIN-Personal/1.5',
      },
      body: JSON.stringify({
        task: 'query',
        image: `data:${input.mimeType};base64,${input.bytes.toString('base64')}`,
        question: questionFor(input),
        reasoning: false,
        temperature: 0,
        // 900 (raised from 700): a truncated mid-JSON answer was one source of
        // intermittent RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID in production.
        // At the published rate (90,909 Neurons per 1M output tokens) 900
        // output tokens ~= 82 Neurons, still far inside the 256-Neuron
        // per-call reserve (RASTER_SEMANTIC_CRITIC_RESERVED_NEURONS_V15).
        max_tokens: 900,
        stream: false,
      }),
    },
    fetchImpl,
  );

  if (!response.ok) {
    const failure = await classifyCloudflareWorkersAiFailureV15(response, 'CLOUDFLARE_SEMANTIC_CRITIC_HTTP');
    throw new Error(failure.code);
  }

  const body = await response.json().catch(() => null) as CloudflareEnvelope | null;
  if (!body || body.success !== true || !body.result || typeof body.result !== 'object' || Array.isArray(body.result)) {
    throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  }
  // Live-verified shape (2026-11-07, production probe): this vision model's
  // run response nests the model's own output object one level deeper, i.e.
  // { result: { result: { answer, caption, finish_reason, ... }, usage } }.
  // The flat { result: { answer } } shape is accepted only as a fallback;
  // either way the extracted string still faces the full strict validation
  // in parseSemanticPayload, and anything else fails closed.
  const resultObject = body.result as Record<string, unknown>;
  const nested = resultObject.result;
  const nestedAnswer = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>).answer
    : undefined;
  const answer = typeof nestedAnswer === 'string' ? nestedAnswer : resultObject.answer;
  if (typeof answer !== 'string') throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

  // The same live-verified envelope carries the call's own usage report at
  // result.usage.neurons (measured 34-36 Neurons per critic call on
  // 2026-11-07). It is surfaced verbatim for the caller's reconciliation;
  // only when the envelope carries no usage block at all, the cf-ai-neurons
  // response header is consulted as a fallback. A missing or malformed
  // report in both places is surfaced as null, never invented.
  const reportedNeurons = usageNeurons(resultObject.usage)
    ?? (nested && typeof nested === 'object' && !Array.isArray(nested)
      ? usageNeurons((nested as Record<string, unknown>).usage)
      : null)
    ?? neuronsFromResponseHeader(response.headers);

  const parsed = parseSemanticPayload(answer.trim());
  const checks: string[] = [];
  const thresholdAxes: RasterSemanticAxisV15[] = [
    'promptAdherence',
    'composition',
    'subjectIntegrity',
    'artifactControl',
    'professionalUsefulness',
  ];
  for (const axis of thresholdAxes) {
    if (parsed.scores[axis] >= 3.4) checks.push(`${axis}-gte-3.4`);
  }
  if (parsed.scores.styleExecution >= 3.3) checks.push('styleExecution-gte-3.3');
  if (parsed.scores.textHandling >= 3.3) checks.push('textHandling-gte-3.3');

  const average = RASTER_SEMANTIC_AXES_V15.reduce((sum, axis) => sum + parsed.scores[axis], 0) / RASTER_SEMANTIC_AXES_V15.length;
  const issues = [...parsed.issues];
  for (const axis of thresholdAxes) {
    if (parsed.scores[axis] < 3.4) issues.push(`${axis}-below-3.4`);
  }
  if (parsed.scores.styleExecution < 3.3) issues.push('styleExecution-below-3.3');
  if (parsed.scores.textHandling < 3.3) issues.push('textHandling-below-3.3');

  if (!parsed.safetyPassed) issues.push('visible-output-safety-failed');
  const uniqueIssues = [...new Set(issues)];
  return {
    version: 'raster-semantic-critic-v1',
    passed: parsed.safetyPassed && uniqueIssues.length === 0 && average >= 3.5,
    safetyPassed: parsed.safetyPassed,
    safetyIssues: parsed.safetyIssues,
    score: Math.round((average / 4) * 100),
    model: CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15,
    scores: parsed.scores,
    checks,
    issues: uniqueIssues,
    summary: parsed.summary,
    freeOnly: true,
    costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified',
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
    externalNetworkRequests: 4,
    reportedNeurons,
  };
}
