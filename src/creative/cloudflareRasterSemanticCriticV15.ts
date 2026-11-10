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
  /**
   * Non-semantic repairs applied while accepting the model's answer:
   * over-limit issue lists and an over-limit summary are truncated to the
   * parser's bounds instead of rejecting the whole verdict (the enumerated
   * text is evidence, not the verdict). The verdict itself — axis scores
   * and the safety judgment — is never altered by these repairs, and each
   * one is recorded here rather than silently dropped. An empty array
   * means the answer was accepted exactly as returned.
   */
  adjustments: readonly string[];
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

/**
 * A response-format validation failure. The message stays exactly the
 * public error code (callers surface it verbatim); `detail` names the one
 * validation condition that was hit and `answerChars` the answer length
 * when known. Both exist only for server-side diagnostics — the raw answer
 * body is never logged or returned.
 */
export class RasterSemanticCriticResponseInvalidError extends Error {
  readonly detail: string;
  readonly answerChars: number | null;
  constructor(detail: string, answerChars: number | null = null) {
    super('RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID');
    this.name = 'RasterSemanticCriticResponseInvalidError';
    this.detail = detail;
    this.answerChars = answerChars;
  }
}

function responseInvalid(detail: string, answerChars: number | null = null): RasterSemanticCriticResponseInvalidError {
  return new RasterSemanticCriticResponseInvalidError(detail, answerChars);
}

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
  if (start === -1 || end <= start) throw responseInvalid('json-no-object-span', answer.length);
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw responseInvalid('json-unparseable', answer.length);
  }
}

const MAX_ISSUE_ENTRIES = 8;
const MAX_SUMMARY_CHARS = 600;

/**
 * Clean one issue list. Malformed elements (non-strings, blanks) still
 * reject the whole payload — the list's contents cannot be trusted as
 * evidence if its shape is broken. A pure overflow of well-formed entries,
 * however, is truncated to the bound and recorded in `adjustments` instead
 * of rejecting: the entries are evidence text, and dropping the tail does
 * not change the verdict the model returned.
 */
function cleanIssueList(
  raw: unknown,
  field: 'safetyIssues' | 'criticalIssues',
  adjustments: string[],
  answerChars: number,
): string[] {
  const rawList = Array.isArray(raw) ? raw : [];
  const valid = rawList
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean);
  if (valid.length !== rawList.length) throw responseInvalid(`${field}-malformed-element`, answerChars);
  if (valid.length > MAX_ISSUE_ENTRIES) {
    adjustments.push(`${field}-truncated-from-${valid.length}-to-${MAX_ISSUE_ENTRIES}`);
    return valid.slice(0, MAX_ISSUE_ENTRIES);
  }
  return valid;
}

function parseSemanticPayload(answer: string): { scores: RasterSemanticScoresV15; safetyPassed: boolean; safetyIssues: string[]; issues: string[]; summary: string; adjustments: string[] } {
  if (!answer || answer.length > MAX_ANSWER_CHARS) throw responseInvalid('answer-empty-or-over-limit', answer.length);
  const parsed = parseSemanticJson(answer) as SemanticPayload;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw responseInvalid('payload-not-a-plain-object', answer.length);
  }

  const scores = {} as RasterSemanticScoresV15;
  for (const axis of RASTER_SEMANTIC_AXES_V15) {
    const score = axisScore(parsed[axis]);
    if (score === null) throw responseInvalid(`axis-score-invalid:${axis}`, answer.length);
    scores[axis] = score;
  }

  if (typeof parsed.safetyPassed !== 'boolean') throw responseInvalid('safety-flag-not-boolean', answer.length);
  const adjustments: string[] = [];
  const safetyIssues = cleanIssueList(parsed.safetyIssues, 'safetyIssues', adjustments, answer.length);
  // Safety consistency stays fail-closed exactly as before, evaluated on
  // the (possibly truncated) lists: a passing flag with any listed reason,
  // or a failing flag with no reason at all, is a contradiction the parser
  // must not guess its way past.
  if (parsed.safetyPassed && safetyIssues.length > 0) throw responseInvalid('safety-inconsistent:passed-with-issues', answer.length);
  if (!parsed.safetyPassed && safetyIssues.length === 0) throw responseInvalid('safety-inconsistent:failed-without-issues', answer.length);

  const issues = cleanIssueList(parsed.criticalIssues, 'criticalIssues', adjustments, answer.length);

  const rawSummary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (!rawSummary) throw responseInvalid('summary-missing-or-empty', answer.length);
  // The summary is display text the verdict never consumes; an over-limit
  // summary is truncated to the bound and recorded, not rejected.
  let summary = rawSummary;
  if (summary.length > MAX_SUMMARY_CHARS) {
    adjustments.push(`summary-truncated-from-${summary.length}-to-${MAX_SUMMARY_CHARS}`);
    summary = summary.slice(0, MAX_SUMMARY_CHARS);
  }
  return { scores, safetyPassed: parsed.safetyPassed, safetyIssues, issues, summary, adjustments };
}

function questionFor(input: RasterSemanticCriticInputV15, formatReminder = false): string {
  const exactText = (input.exactText ?? []).map(value => value.trim()).filter(Boolean).slice(0, 8);
  return [
    'Act as a strict production image QA critic.',
    'Judge only what is visibly present in the supplied image against the user request below.',
    'Do not reward style alone if the requested subject, geometry, anatomy, layout, or text is wrong.',
    'Score each axis from 0 to 4, where 4 means professional production quality and 0 means unusable.',
    'Every axis is a quality score, never a defect count: the absence of a problem is a high score, not a zero.',
    'For textHandling: score 4 when the image contains no text and no text was requested, and score high when every visible character is rendered correctly and legibly. Score low only when text is garbled, unwanted, or incorrect.',
    'For artifactControl: score 4 when no artifacts, distortions, warped geometry, or malformed details are visible anywhere in the image. Score low only for artifacts that are actually visible.',
    // The output contract is stated up front as well as at the end: the
    // defect-hunting instructions push the model toward long enumerations,
    // and answers that overflow these bounds cannot be accepted verbatim.
    'Output limits that bind your answer: the summary must be at most 400 characters (one or two sentences); criticalIssues must contain at most 8 entries — if you find more defects, list only the 8 most severe; whenever safetyPassed is true, safetyIssues must be exactly an empty array.',
    'Before scoring, actively hunt for defects. Do not grade from a general impression: inspect the image region by region and score only what you actually observed.',
    'Anatomy check: whenever hands or fingers are visible, count them — a natural hand has exactly five fingers — and inspect every joint, knuckle, and nail. Look for fused, missing, extra, duplicated, or unnaturally bent fingers, and for hands that merge into objects or other hands. Check faces the same way: both eyes present and aligned, facial features symmetric and coherent, no duplicated or melted features. Report every anomaly you find in criticalIssues with its location.',
    'Counting check: whenever the image contains a structure with countable repeated elements — roof tiers, floors, windows, columns, stairs, wheels, people — actually count them and compare against what the request and the real-world object require (for example, a five-story pagoda has exactly five roof tiers). A wrong count is a concrete defect: name it in criticalIssues with the counted and expected numbers.',
    'Reflection check: whenever a mirror, water surface, glass, or other reflective surface is visible, compare the reflection against its source: left-right reversal must hold, the same person or object must be present and corresponding, with consistent position and scale. Any contradiction is a concrete defect for criticalIssues.',
    'Text check: read every piece of visible text in the image — signs, labels, book spines, screens, logos. Misspelled, garbled, or meaningless character strings are concrete defects: quote them in criticalIssues and score textHandling accordingly.',
    'Calibration: a score of 4 on an axis is allowed only when your hunt found nothing wrong on that axis. If you found any concrete defect on an axis, score that axis 3 or lower and list the defect in criticalIssues — never mention a defect in the summary while still scoring its axis 4. Score from observed facts, not from how good the image feels overall.',
    'Independently inspect visible output safety. Set safetyPassed=false if the image visibly contains sexualized minors, explicit sexual content, graphic gore, hateful/extremist propaganda, actionable self-harm depiction, or clearly dangerous instructional imagery. Otherwise set safetyPassed=true.',
    'When safetyPassed=false, safetyIssues must list concise concrete visible safety reasons. When safetyPassed=true, safetyIssues must be an empty array.',
    exactText.length
      ? `Exact requested text, if visibly rendered, must be correct: ${JSON.stringify(exactText)}`
      : 'No exact text is mandatory unless the user request itself clearly asks for it.',
    `User request: ${input.originalRequest.normalize('NFKC').trim().slice(0, 1800)}`,
    'criticalIssues must list every concrete visible defect found in the hunt above, each described with what is wrong and where (maximum 8 entries; if there are more, list the 8 most severe). List only defects you actually observed; do not invent defects that are not visible.',
    'The summary must be at most 400 characters — one or two sentences that state the verdict.',
    'Return ONLY valid compact JSON with exactly these keys:',
    '{"promptAdherence":0,"composition":0,"subjectIntegrity":0,"styleExecution":0,"textHandling":0,"artifactControl":0,"professionalUsefulness":0,"safetyPassed":true,"safetyIssues":[],"criticalIssues":[],"summary":"..."}',
    // Restated as the very last instruction: the answer must be the JSON
    // object and nothing else, so no inspection narrative may precede or
    // follow it.
    'Answer with the JSON object only: no prose, no markdown code fences, and no text before or after the JSON.',
    ...(formatReminder
      ? ['FORMAT REMINDER: your previous answer could not be read as the required JSON. Answer with the JSON object only — no prose, no markdown code fences, no text before or after it. Keep the summary at or below 400 characters, criticalIssues at or below 8 entries, and safetyIssues exactly [] when safetyPassed is true.']
      : []),
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

  const runCriticOnce = async (question: string) => {
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
          question,
          reasoning: false,
          temperature: 0,
          // 1100 (raised from 900): the defect-hunting instructions ask the
          // model to enumerate every concrete defect it finds, which needs
          // more output room; a truncated mid-JSON answer was one source of
          // intermittent RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID in production.
          // Reserve check against RASTER_SEMANTIC_CRITIC_RESERVED_NEURONS_V15
          // (256): at the published output rate (90,909 Neurons per 1M output
          // tokens) 1,100 output tokens ~= 100 Neurons, and production calls
          // measured 836-887 input tokens (~24 Neurons at the implied input
          // rate); even a 3,000-token input (~82 Neurons) keeps the worst-case
          // total near 182 Neurons, inside the reserve.
          max_tokens: 1100,
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
    if (!body) throw responseInvalid('envelope-body-not-json');
    if (body.success !== true) throw responseInvalid('envelope-success-not-true');
    if (!body.result || typeof body.result !== 'object' || Array.isArray(body.result)) {
      throw responseInvalid('envelope-result-missing-or-not-object');
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
    if (typeof answer !== 'string') throw responseInvalid('answer-not-a-string');

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

    return { parsed: parseSemanticPayload(answer.trim()), reportedNeurons };
  };

  // One bounded retry, only for response-format failures: when the model's
  // answer cannot be validated as the contracted JSON, the critic call alone
  // is repeated once with a format reminder appended (measured ~40 Neurons
  // per call, far cheaper than regenerating the image). Provider/HTTP
  // failures carry different codes and are never retried here; a second
  // format failure fails closed exactly as a single failure did before.
  let attemptsUsed = 0;
  let outcome: Awaited<ReturnType<typeof runCriticOnce>> | null = null;
  for (;;) {
    attemptsUsed += 1;
    try {
      outcome = await runCriticOnce(questionFor(input, attemptsUsed > 1));
      break;
    } catch (error) {
      if (error instanceof RasterSemanticCriticResponseInvalidError) {
        // Server-side diagnostics only: which validation condition was hit,
        // the answer length, and the extraction outcome are recorded so a
        // production failure can be triaged without a probe. The raw answer
        // body is never logged, and nothing here reaches the client.
        console.error('[raster-semantic-critic] response failed validation', {
          detail: error.detail,
          answerChars: error.answerChars,
          attempt: attemptsUsed,
        });
        if (attemptsUsed === 1) continue;
      }
      throw error;
    }
  }
  const { parsed, reportedNeurons } = outcome;
  // Quality gate, realigned with the question's scoring scale (diag16,
  // 2026-11-10, §7 A+D). The verdict is decided by substance only:
  //   passed = safetyPassed && average >= 3.5 && every axis >= 3.
  // The axis floor is 3 — the same boundary the question's calibration
  // rule uses ("a found defect caps its axis at 3"). The previous gate
  // additionally required the model's criticalIssues list to be empty and
  // used per-axis thresholds of 3.4 / 3.3; combined with the defect-hunting
  // question (enumerate every defect found), any candidate whose critic
  // did its job was structurally unpassable, and with the integer scores
  // the model actually returns, 3.4 / 3.3 meant "every axis must be 4".
  // criticalIssues are still returned in `issues` as diagnostic evidence
  // and as the retry feedback source — they no longer veto the verdict by
  // their mere presence. Severity reaches the gate through the scores
  // themselves: under the (unchanged) calibration rule a defect pulls its
  // axis to 3 or lower, so a serious defect drops the axis below the floor
  // or the mean below 3.5, and any safety failure still fails closed via
  // safetyPassed. The question's calibration rule is deliberately NOT
  // relaxed (diag16 §7: option B rejected) so the critic keeps
  // discriminating.
  const AXIS_FLOOR = 3;
  const checks: string[] = [];
  for (const axis of RASTER_SEMANTIC_AXES_V15) {
    if (parsed.scores[axis] >= AXIS_FLOOR) checks.push(`${axis}-gte-3`);
  }

  const average = RASTER_SEMANTIC_AXES_V15.reduce((sum, axis) => sum + parsed.scores[axis], 0) / RASTER_SEMANTIC_AXES_V15.length;
  const issues = [...parsed.issues];
  for (const axis of RASTER_SEMANTIC_AXES_V15) {
    if (parsed.scores[axis] < AXIS_FLOOR) issues.push(`${axis}-below-3`);
  }

  if (!parsed.safetyPassed) issues.push('visible-output-safety-failed');
  const uniqueIssues = [...new Set(issues)];
  const everyAxisAtOrAboveFloor = RASTER_SEMANTIC_AXES_V15.every(axis => parsed.scores[axis] >= AXIS_FLOOR);
  return {
    version: 'raster-semantic-critic-v1',
    passed: parsed.safetyPassed && everyAxisAtOrAboveFloor && average >= 3.5,
    safetyPassed: parsed.safetyPassed,
    safetyIssues: parsed.safetyIssues,
    score: Math.round((average / 4) * 100),
    model: CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15,
    scores: parsed.scores,
    checks,
    issues: uniqueIssues,
    adjustments: parsed.adjustments,
    summary: parsed.summary,
    freeOnly: true,
    costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified',
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
    // 3 free-plan proof reads plus one run call per attempt actually made.
    externalNetworkRequests: 3 + attemptsUsed,
    reportedNeurons,
  };
}
