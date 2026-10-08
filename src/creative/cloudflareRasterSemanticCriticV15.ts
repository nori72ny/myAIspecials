import { getCloudflareRasterStatusV15 } from './cloudflareRasterImageProviderV15.js';
import { classifyCloudflareWorkersAiFailureV15 } from './cloudflareWorkersAiErrorV15.js';
import { readBoundedCloudflareRasterJsonV15 } from './cloudflareRasterResponseLimitV15.js';
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
  costUsd: 0;
  paidFallbackEnabled: false;
  secretDelivery: 'server-only';
  externalNetworkRequests: number;
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
  // Keep the deadline active through the JSON body's streamed read, not just
  // until the upstream AI endpoint returns HTTP headers.
  return fetchImpl(url, {
    ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error', cache: 'no-store',
  });
}

function axisScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 4 ? value : null;
}

function parseSemanticPayload(answer: string): { scores: RasterSemanticScoresV15; safetyPassed: boolean; safetyIssues: string[]; issues: string[]; summary: string } {
  if (!answer || answer.length > MAX_ANSWER_CHARS) throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  let parsed: SemanticPayload;
  try {
    parsed = JSON.parse(answer) as SemanticPayload;
  } catch {
    throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  }
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
    'For textHandling, score unwanted/garbled text as a defect even when no exact text was requested.',
    'Independently inspect visible output safety. Set safetyPassed=false if the image visibly contains sexualized minors, explicit sexual content, graphic gore, hateful/extremist propaganda, actionable self-harm depiction, or clearly dangerous instructional imagery. Otherwise set safetyPassed=true.',
    'When safetyPassed=false, safetyIssues must list concise concrete visible safety reasons. When safetyPassed=true, safetyIssues must be an empty array.',
    exactText.length
      ? `Exact requested text, if visibly rendered, must be correct: ${JSON.stringify(exactText)}`
      : 'No exact text is mandatory unless the user request itself clearly asks for it.',
    `User request: ${input.originalRequest.trim().slice(0, 1800)}`,
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

  const status = await getCloudflareRasterStatusV15(env, fetchImpl);
  if (!status.ready || !status.zeroCostVerified || status.paymentMethodRequired || status.paidFallbackEnabled) {
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
        max_tokens: 700,
        stream: false,
      }),
    },
    fetchImpl,
  );

  if (!response.ok) {
    const failure = await classifyCloudflareWorkersAiFailureV15(response, 'CLOUDFLARE_SEMANTIC_CRITIC_HTTP');
    throw new Error(failure.code);
  }

  const body = await readBoundedCloudflareRasterJsonV15(response, 64 * 1024)
    .catch(() => null) as CloudflareEnvelope | null;
  if (!body || body.success !== true || !body.result || typeof body.result !== 'object' || Array.isArray(body.result)) {
    throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
  }
  const answer = (body.result as Record<string, unknown>).answer;
  if (typeof answer !== 'string') throw new Error('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');

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
    costUsd: 0,
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
    externalNetworkRequests: 4,
  };
}
