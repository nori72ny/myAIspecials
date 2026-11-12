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
  /**
   * Axis scores derived deterministically on the server from the model's
   * per-axis defect lists (see deriveAxisScore in the parser): the model
   * itself returns no numbers, only the defects it observed per axis and
   * the safety judgment.
   */
  scores: RasterSemanticScoresV15;
  checks: readonly string[];
  issues: readonly string[];
  /**
   * Non-semantic repairs applied while accepting the model's answer:
   * over-limit defect/safety lists and an over-limit summary are
   * truncated to the parser's bounds instead of rejecting the whole
   * verdict (the enumerated text is evidence, not the verdict). The
   * verdict itself — the derived axis scores and the safety judgment —
   * is never altered by these repairs (list truncation happens past the
   * point where the derived score has already saturated), and each one
   * is recorded here rather than silently dropped. An empty array means
   * the answer was accepted exactly as returned.
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
   * When the bounded format retry ran, this is the final call's report;
   * reportedCallsNeurons carries every call's.
   */
  reportedNeurons: number | null;
  /**
   * The usage report of every critic call actually made, in call order:
   * the initial call and, when the bounded format retry ran, the retry
   * call as well. The retry's first call consumed Neurons too, so
   * post-generation reconciliation must account for all of them — reading
   * only reportedNeurons (the final call) would understate the request's
   * consumption. An entry is null where that call reported nothing
   * usable, which keeps the caller's evidence set incomplete exactly as
   * a missing report should.
   */
  reportedCallsNeurons: readonly (number | null)[];
};

type CloudflareEnvelope = {
  success?: unknown;
  result?: unknown;
};

/**
 * Structural features of an answer that failed format validation. Pure
 * shape classification — counts, offsets, and booleans computed from the
 * answer string without retaining any of it — so a production failure can
 * be told apart by kind: (i) prose with no JSON attempted at all
 * (hasOpeningBrace false), (ii) a JSON object that starts but is cut off
 * before it closes, e.g. at the output-token limit (braceClosed false
 * with firstBraceOffset >= 0), or (iii) a complete object span whose
 * contents still do not parse (braceClosed true with a json-unparseable
 * detail). The answer text itself is never stored here or logged.
 */
export type RasterSemanticAnswerStructureV15 = {
  hasOpeningBrace: boolean;
  firstBraceOffset: number;
  braceClosed: boolean;
  maxBraceDepth: number;
  startsWithProse: boolean;
  hasCodeFence: boolean;
};

/**
 * Envelope-side diagnostics for a failed critic call, taken only from the
 * run response's own metadata: the model's finish reason (an identifier,
 * adopted only when it is a short identifier-shaped string) and the usage
 * numbers the envelope itself reported. Fields the envelope did not carry
 * stay null — never invented, and the cf-ai-neurons header fallback is
 * deliberately not folded in here, so the record shows only what the
 * envelope itself stated.
 */
export type RasterSemanticEnvelopeDiagnosticsV15 = {
  finishReason: string | null;
  usageNeurons: number | null;
  usagePromptTokens: number | null;
  usageCompletionTokens: number | null;
  usageTotalTokens: number | null;
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
  /**
   * Structural features of the answer that failed validation, attached by
   * parseSemanticPayload when the failure is answer-shaped. Null for
   * envelope-level failures, where no answer string exists to classify.
   * Diagnostics only — never part of the public error surface.
   */
  structure: RasterSemanticAnswerStructureV15 | null = null;
  /**
   * Envelope metadata of the run call whose answer failed validation,
   * attached by the call site that owns the envelope. Null when the
   * failure happened before an envelope existed. Diagnostics only.
   */
  envelope: RasterSemanticEnvelopeDiagnosticsV15 | null = null;
  /**
   * The Neurons the failed call reported for itself, attached by the run
   * call site that read the envelope before the answer failed validation.
   * The bounded format retry consumes this so the failed first call's
   * consumption stays inside the caller's usage accounting instead of
   * being dropped with the failed answer. Null when the failure happened
   * before an envelope existed or the envelope reported nothing usable.
   * Evidence only — never part of the public error surface.
   */
  reportedNeurons: number | null = null;
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

/**
 * Classify the shape of a failed answer without keeping any of its text.
 * The brace scan starts at the first '{' and is string-aware, so braces
 * inside JSON string values do not distort the depth or the closure
 * verdict; the scan stops at the point the outermost object closes,
 * because anything after a complete object is prose by definition here.
 * Depth figures are a diagnostic heuristic for triage, not a parse — the
 * strict validation path is unchanged.
 */
function answerStructure(answer: string): RasterSemanticAnswerStructureV15 {
  const firstBraceOffset = answer.indexOf('{');
  let braceClosed = false;
  let maxBraceDepth = 0;
  if (firstBraceOffset !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = firstBraceOffset; index < answer.length; index += 1) {
      const char = answer[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
        if (depth > maxBraceDepth) maxBraceDepth = depth;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          braceClosed = true;
          break;
        }
      }
    }
  }
  const head = answer.trimStart();
  return {
    hasOpeningBrace: firstBraceOffset !== -1,
    firstBraceOffset,
    braceClosed,
    maxBraceDepth,
    startsWithProse: head.length > 0 && head[0] !== '{',
    hasCodeFence: answer.includes('```'),
  };
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

function usageNeurons(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const neurons = (value as Record<string, unknown>).neurons;
  return typeof neurons === 'number' && Number.isFinite(neurons) && neurons >= 0 ? neurons : null;
}

function usageTokenCount(usage: unknown, field: 'prompt_tokens' | 'completion_tokens' | 'total_tokens'): number | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const value = (usage as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Envelope metadata for the failure record, from the run response's own
 * result object: the nested model's finish_reason (live-verified shape
 * carries it alongside the answer) and the usage block that sits next to
 * it (or inside the nested object). Only identifier-shaped finish reasons
 * and finite non-negative numbers are adopted; anything else stays null.
 */
function envelopeDiagnostics(
  resultObject: Record<string, unknown>,
  nested: unknown,
): RasterSemanticEnvelopeDiagnosticsV15 {
  const nestedObject = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : null;
  const usage = resultObject.usage ?? nestedObject?.usage;
  const finishRaw = nestedObject?.finish_reason ?? resultObject.finish_reason;
  return {
    finishReason: typeof finishRaw === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(finishRaw) ? finishRaw : null,
    usageNeurons: usageNeurons(usage),
    usagePromptTokens: usageTokenCount(usage, 'prompt_tokens'),
    usageCompletionTokens: usageTokenCount(usage, 'completion_tokens'),
    usageTotalTokens: usageTokenCount(usage, 'total_tokens'),
  };
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
 * The format template's one placeholder defect entry, matched
 * case-insensitively as a substring. The template shows it as a type
 * label, not content — and this model has echoed template material
 * verbatim as its answer before (the #1185 numeric examples were
 * returned as the verdict for different images), so an axis entry
 * still carrying this phrase is a copied placeholder, not an observed
 * defect. The payload is rejected as a format error so the
 * format-reminder retry runs; a placeholder on both attempts fails
 * closed like any other repeated format failure.
 */
const AXIS_DEFECT_PLACEHOLDER_PHRASE = 'defect you actually observed';

/**
 * Clean one defect/safety list. Malformed elements (non-strings, blanks)
 * still reject the whole payload — the list's contents cannot be trusted
 * as evidence if its shape is broken. A pure overflow of well-formed
 * entries, however, is truncated to the bound and recorded in
 * `adjustments` instead of rejecting: the entries are evidence text, and
 * dropping the tail does not change the verdict the model returned.
 * `field` names the list in the failure detail and the adjustment
 * identifier: 'safetyIssues' or one of the seven axis names.
 */
function cleanIssueList(
  raw: unknown,
  field: string,
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

/**
 * Deterministic server-side score derivation. The critic model returns
 * no numbers at all — only, per axis, the list of defects it observed —
 * so each axis score is a fixed function of that axis's defect count:
 * 0 defects -> 4, 1-2 -> 3, 3-4 -> 2, 5-6 -> 1, 7 or more -> 0. The
 * mapping is deliberately coarse and monotone: the model's enumeration
 * is evidence of what it saw, and the count is the only part of it that
 * becomes a number, by a rule the model cannot shape beyond what it
 * lists. (Defect lists are truncated at MAX_ISSUE_ENTRIES = 8 before
 * derivation, and the score has already saturated at 0 from 7 on, so
 * truncation never moves a derived score.)
 *
 * The numeric channel this replaces was retired on production evidence
 * (2026-11-10): with a concrete example vector in the question, the
 * model echoed that vector verbatim as its verdict for different images
 * (#1185, both the all-zero and the mixed-score examples); with the
 * vector removed and only a type template left (#1187), its attempts
 * either collapsed at the format layer or returned listed defects
 * alongside uniform maximum scores. The defect enumeration itself was
 * the one channel that varied per image (defect counts 3/6/3 across
 * candidates whose "scores" were identical), so it is now the only
 * quality signal the model is asked for.
 */
function deriveAxisScore(defectCount: number): number {
  return Math.max(0, 4 - Math.ceil(defectCount / 2));
}

function parseSemanticPayloadChecked(answer: string): { scores: RasterSemanticScoresV15; defectCounts: Record<RasterSemanticAxisV15, number>; safetyPassed: boolean; safetyIssues: string[]; issues: string[]; summary: string; adjustments: string[] } {
  if (!answer || answer.length > MAX_ANSWER_CHARS) throw responseInvalid('answer-empty-or-over-limit', answer.length);
  const parsed = parseSemanticJson(answer) as SemanticPayload;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw responseInvalid('payload-not-a-plain-object', answer.length);
  }

  // Each axis value must be the list of defects the model observed on
  // that axis. Anything else — a number (the retired contract), a
  // string, a missing key — is a format failure that rides the
  // format-reminder retry; there is no numeric field left to guess from.
  const adjustments: string[] = [];
  const axisDefects = {} as Record<RasterSemanticAxisV15, string[]>;
  for (const axis of RASTER_SEMANTIC_AXES_V15) {
    if (!Array.isArray(parsed[axis])) throw responseInvalid(`axis-defects-not-a-list:${axis}`, answer.length);
    axisDefects[axis] = cleanIssueList(parsed[axis], axis, adjustments, answer.length);
    // A verbatim copy of the template's placeholder entry is not an
    // observed defect: accepting it would hand the model a defect (and
    // a derived score) it never had to look at the image to produce.
    if (axisDefects[axis].some(defect => defect.toLowerCase().includes(AXIS_DEFECT_PLACEHOLDER_PHRASE))) {
      throw responseInvalid(`axis-defect-placeholder:${axis}`, answer.length);
    }
  }

  if (typeof parsed.safetyPassed !== 'boolean') throw responseInvalid('safety-flag-not-boolean', answer.length);
  const safetyIssues = cleanIssueList(parsed.safetyIssues, 'safetyIssues', adjustments, answer.length);
  // Safety consistency stays fail-closed exactly as before, evaluated on
  // the (possibly truncated) lists: a passing flag with any listed reason,
  // or a failing flag with no reason at all, is a contradiction the parser
  // must not guess its way past.
  if (parsed.safetyPassed && safetyIssues.length > 0) throw responseInvalid('safety-inconsistent:passed-with-issues', answer.length);
  if (!parsed.safetyPassed && safetyIssues.length === 0) throw responseInvalid('safety-inconsistent:failed-without-issues', answer.length);

  // The summary is optional display text the verdict never consumes: a
  // missing, empty, or non-string summary is accepted as an empty
  // summary, and an over-limit one is truncated to the bound and
  // recorded, not rejected.
  let summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (summary.length > MAX_SUMMARY_CHARS) {
    adjustments.push(`summary-truncated-from-${summary.length}-to-${MAX_SUMMARY_CHARS}`);
    summary = summary.slice(0, MAX_SUMMARY_CHARS);
  }

  // Derive the axis scores from the defect counts and flatten the
  // per-axis lists into the single issues list the result carries, each
  // entry prefixed with its axis so the finding stays attributable.
  const scores = {} as RasterSemanticScoresV15;
  const defectCounts = {} as Record<RasterSemanticAxisV15, number>;
  const issues: string[] = [];
  for (const axis of RASTER_SEMANTIC_AXES_V15) {
    defectCounts[axis] = axisDefects[axis].length;
    scores[axis] = deriveAxisScore(axisDefects[axis].length);
    for (const defect of axisDefects[axis]) issues.push(`${axis}: ${defect}`);
  }
  return { scores, defectCounts, safetyPassed: parsed.safetyPassed, safetyIssues, issues, summary, adjustments };
}

/**
 * Validation entry point. Identical accept/reject behavior to the checked
 * parser; the only addition is that a format failure leaves the wrapper
 * carrying the answer's structural features (shape classification only —
 * the answer text itself is discarded with the frame) so the caller's
 * server-side failure record can say which kind of malformed answer it
 * was, instead of only which condition it tripped.
 */
function parseSemanticPayload(answer: string): ReturnType<typeof parseSemanticPayloadChecked> {
  try {
    return parseSemanticPayloadChecked(answer);
  } catch (error) {
    if (error instanceof RasterSemanticCriticResponseInvalidError && error.structure === null) {
      error.structure = answerStructure(answer);
    }
    throw error;
  }
}

function questionFor(input: RasterSemanticCriticInputV15, formatReminder = false): string {
  const exactText = (input.exactText ?? []).map(value => value.trim()).filter(Boolean).slice(0, 8);
  return [
    'Act as a strict production image QA critic.',
    'Judge only what is visibly present in the supplied image against the user request below.',
    'Do not reward style alone if the requested subject, geometry, anatomy, layout, or text is wrong.',
    'You never return numeric scores. For each of the seven axes, return the list of concrete defects you actually observed on that axis: promptAdherence (the image delivers what the request asked for), composition (framing, layout, and balance), subjectIntegrity (the subject\'s geometry, anatomy, and coherence), styleExecution (the requested style, medium, and finish), textHandling (the correctness of visible text), artifactControl (generation artifacts and distortions), professionalUsefulness (fitness for professional use as requested).',
    'An empty list for an axis is a definite claim: your hunt found no defect on that axis. A defect you observed always belongs in its axis list — never in the summary alone.',
    'For textHandling: list a defect only when visible text is garbled, unwanted, misspelled, or incorrect. When the image contains no text and no text was requested, or when every visible character is rendered correctly and legibly, the textHandling list stays empty.',
    'For artifactControl: list every artifact, distortion, warped geometry, or malformed detail that is actually visible. When none is visible anywhere in the image, the artifactControl list stays empty.',
    // The output contract is stated up front as well as at the end: the
    // defect-hunting instructions push the model toward long enumerations,
    // and answers that overflow these bounds cannot be accepted verbatim.
    'Output limits that bind your answer: each axis list must contain at most 8 entries — if you find more defects on an axis, list only the 8 most severe; the summary is optional and, when written, must be at most 400 characters (one or two sentences); whenever safetyPassed is true, safetyIssues must be exactly an empty array.',
    'Before answering, actively hunt for defects. Do not grade from a general impression: inspect the image region by region and report only what you actually observed.',
    'Anatomy check: whenever hands or fingers are visible, count them — a natural hand has exactly five fingers — and inspect every joint, knuckle, and nail. Look for fused, missing, extra, duplicated, or unnaturally bent fingers, and for hands that merge into objects or other hands. Check faces the same way: both eyes present and aligned, facial features symmetric and coherent, no duplicated or melted features. Report every anomaly you find in the subjectIntegrity list, with its location.',
    'Counting check: whenever the image contains a structure with countable repeated elements — roof tiers, floors, windows, columns, stairs, wheels, people — actually count them and compare against what the request and the real-world object require (for example, a five-story pagoda has exactly five roof tiers). A wrong count is a concrete defect: name it in the list of the axis it belongs to, with the counted and expected numbers.',
    'Reflection check: whenever a mirror, water surface, glass, or other reflective surface is visible, compare the reflection against its source: left-right reversal must hold, the same person or object must be present and corresponding, with consistent position and scale. Any contradiction is a concrete defect for the list of the axis it belongs to.',
    'Text check: read every piece of visible text in the image — signs, labels, book spines, screens, logos. Misspelled, garbled, or meaningless character strings are concrete defects: quote them in the textHandling list.',
    'Calibration: each axis list is the complete record of what your hunt found on that axis. If you found a concrete defect on an axis, it must appear in that axis\'s list, phrased as what is wrong and where — never mention a defect in the summary while leaving its axis list empty. Report observed facts only, not how good the image feels overall.',
    'Independently inspect visible output safety. Set safetyPassed=false if the image visibly contains sexualized minors, explicit sexual content, graphic gore, hateful/extremist propaganda, actionable self-harm depiction, or clearly dangerous instructional imagery. Otherwise set safetyPassed=true.',
    'When safetyPassed=false, safetyIssues must list concise concrete visible safety reasons. When safetyPassed=true, safetyIssues must be an empty array.',
    exactText.length
      ? `Exact requested text, if visibly rendered, must be correct: ${JSON.stringify(exactText)}`
      : 'No exact text is mandatory unless the user request itself clearly asks for it.',
    `User request: ${input.originalRequest.normalize('NFKC').trim().slice(0, 1800)}`,
    'Each axis list must contain every concrete visible defect found in the hunt above for that axis, each described with what is wrong and where (maximum 8 entries per axis; if there are more, list the 8 most severe). List only defects you actually observed; do not invent defects that are not visible.',
    'The summary is optional: you may omit it or leave it empty. If you write one, keep it to at most 400 characters — one or two sentences that state the verdict.',
    // The template below shows types only — no numeric score vector
    // appears anywhere in this question, because the model is no longer
    // asked for numbers at all. Production evidence forced the whole
    // redesign (2026-11-10): a concrete example vector in the question
    // was echoed verbatim as the verdict for different images (#1185,
    // both the all-zero and the mixed-score examples), and with the
    // vector removed (#1187) the model's numeric attempts either
    // collapsed at the format layer or paired listed defects with
    // uniform maximum scores. The defect lists were the one channel
    // that varied per image, so the axes now carry defect lists and the
    // scores are derived from their lengths on the server. The template
    // keeps the two list shapes visible — one axis shows a single
    // placeholder entry, the rest show the empty list. A verbatim copy
    // of that placeholder is copyable text exactly like the retired
    // numeric examples were, so the parser rejects it as a format
    // error (axis-defect-placeholder) instead of accepting it as an
    // observed defect.
    'Return ONLY valid compact JSON with exactly these keys, following the type template below. There is no sample answer: the template shows the required types only — every axis value must be an array of the defect strings you observed on that axis (empty when you observed none), never a number, and every placeholder must be replaced with your own words:',
    '{"promptAdherence":["<defect you actually observed on this axis>"],"composition":[],"subjectIntegrity":[],"styleExecution":[],"textHandling":[],"artifactControl":[],"professionalUsefulness":[],"safetyPassed":true,"safetyIssues":[],"summary":"<FORMAT TEMPLATE ONLY: your own one-sentence verdict, or an empty string>"}',
    'Judge this image alone: these instructions contain no sample verdict, and the placeholders above are type labels, not content. Returning a number for any axis is a format error.',
    // Restated as the very last instruction: the answer must be the JSON
    // object and nothing else, so no inspection narrative may precede or
    // follow it.
    'Answer with the JSON object only: no prose, no markdown code fences, and no text before or after the JSON.',
    ...(formatReminder
      ? ['FORMAT REMINDER: your previous answer could not be read as the required JSON. Answer with the JSON object only — no prose, no markdown code fences, no text before or after it. Every axis value must be an array of the defects you actually observed on that axis — never a number: a numeric axis value is a format error, and so is returning a placeholder string as an axis value. Keep each axis list at or below 8 entries, the summary (optional) at or below 400 characters, and safetyIssues exactly [] when safetyPassed is true. An empty array is a complete answer for an axis: it states that your hunt found no defect there. Do not invent defects that are not visible, and do not copy the template placeholders as defect entries: copying the placeholder text "<defect you actually observed on this axis>" into an axis list is itself a format error — replace every placeholder with a defect you actually observed, or with an empty list.']
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

    // A format failure here is rethrown with the envelope's own metadata
    // attached (finish reason and reported usage numbers), so the failure
    // record can show e.g. a length finish alongside an unclosed object
    // span. The call's own usage report rides along as well: the bounded
    // retry below counts the failed call's consumption in the request's
    // reconciliation evidence instead of dropping it with the answer.
    // The parse outcome itself is unchanged.
    try {
      return { parsed: parseSemanticPayload(answer.trim()), reportedNeurons };
    } catch (error) {
      if (error instanceof RasterSemanticCriticResponseInvalidError) {
        if (error.envelope === null) {
          error.envelope = envelopeDiagnostics(resultObject, nested);
        }
        error.reportedNeurons = reportedNeurons;
      }
      throw error;
    }
  };

  // One bounded retry, only for response-format failures: when the model's
  // answer cannot be validated as the contracted JSON, the critic call alone
  // is repeated once with a format reminder appended (measured ~40 Neurons
  // per call, far cheaper than regenerating the image). Provider/HTTP
  // failures carry different codes and are never retried here; a second
  // format failure fails closed exactly as a single failure did before.
  let attemptsUsed = 0;
  let outcome: Awaited<ReturnType<typeof runCriticOnce>> | null = null;
  // Every call's own usage report, in call order. A format-failed first
  // call still consumed its Neurons, so its report (attached to the
  // validation error by the call site) is kept for the caller's
  // post-generation reconciliation instead of being silently dropped;
  // a call that reported nothing usable keeps a null entry.
  const callReports: (number | null)[] = [];
  for (;;) {
    attemptsUsed += 1;
    try {
      outcome = await runCriticOnce(questionFor(input, attemptsUsed > 1));
      callReports.push(outcome.reportedNeurons);
      break;
    } catch (error) {
      if (error instanceof RasterSemanticCriticResponseInvalidError) {
        // Server-side diagnostics only: which validation condition was hit,
        // the answer length, and the extraction outcome are recorded so a
        // production failure can be triaged without a probe. When the
        // failure is answer-shaped, the record also carries the answer's
        // structural features (brace presence/offset/closure/depth, prose
        // or code-fence lead-in — classification only) and the envelope's
        // finish reason and usage numbers, so prose-only answers, answers
        // truncated mid-object, and complete-but-unparseable objects can
        // be told apart from the logs alone. The raw answer body is never
        // logged, and nothing here reaches the client.
        console.error('[raster-semantic-critic] response failed validation', {
          detail: error.detail,
          answerChars: error.answerChars,
          attempt: attemptsUsed,
          ...(error.structure ? { structure: error.structure } : {}),
          ...(error.envelope ? {
            finishReason: error.envelope.finishReason,
            usageNeurons: error.envelope.usageNeurons,
            usagePromptTokens: error.envelope.usagePromptTokens,
            usageCompletionTokens: error.envelope.usageCompletionTokens,
            usageTotalTokens: error.envelope.usageTotalTokens,
          } : {}),
        });
        if (attemptsUsed === 1) {
          callReports.push(error.reportedNeurons);
          continue;
        }
      }
      throw error;
    }
  }
  const { parsed, reportedNeurons } = outcome;
  // Quality gate — the predicate is unchanged from the diag16 realignment
  // (2026-11-10, §7 A+D), but it now reads derived scores:
  //   passed = safetyPassed && average >= 3.5 && every axis >= 3,
  // where each axis score is derived on the server from that axis's
  // defect count (see deriveAxisScore: 0 defects -> 4, 1-2 -> 3,
  // 3-4 -> 2, 5-6 -> 1, 7+ -> 0). In defect terms, a candidate passes
  // when its safety judgment passes, no axis carries 3 or more listed
  // defects (which would derive below the floor of 3), and the derived
  // mean reaches 3.5 — for example three axes with one defect each and
  // the rest clean (derived 3,3,3,4,4,4,4; mean 25/7). The listed
  // defects are returned in `issues` as diagnostic evidence and as the
  // retry feedback source — they veto the verdict only through the
  // derived scores, never by their mere presence, and any safety failure
  // still fails closed via safetyPassed.
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
  const passed = parsed.safetyPassed && everyAxisAtOrAboveFloor && average >= 3.5;
  if (!passed) {
    // Server-side diagnostics only, same discipline as the format-failure
    // record above: when a verdict exists but rejects the candidate, the
    // caller surfaces only RASTER_SEMANTIC_CRITIC_REJECTED, so which gate
    // conditions failed — safety, the mean, or which axes fell below the
    // floor — is recorded here with the numbers behind it, and a
    // production rejection can be triaged from the logs alone. Only
    // numbers, axis names, booleans, counts, parser-made adjustment
    // identifiers, and condition identifiers are recorded — never the
    // prompt, the image, the model's raw answer, its summary, or the text
    // of any listed issue. Nothing here reaches the client, and the
    // verdict itself is unchanged.
    const failedConditions: string[] = [];
    if (!parsed.safetyPassed) failedConditions.push('safety');
    if (average < 3.5) failedConditions.push('average-below-3.5');
    for (const axis of RASTER_SEMANTIC_AXES_V15) {
      if (parsed.scores[axis] < AXIS_FLOOR) failedConditions.push(`axis-below-3:${axis}`);
    }
    console.error('[raster-semantic-critic] verdict rejected', {
      passed: false,
      safetyPassed: parsed.safetyPassed,
      safetyIssuesCount: parsed.safetyIssues.length,
      average,
      scores: { ...parsed.scores },
      failedConditions,
      // The evidence behind the derived scores, as counts only — the
      // defect texts themselves are never logged, here or anywhere.
      defectCounts: { ...parsed.defectCounts },
      defectsTotal: parsed.issues.length,
      adjustments: parsed.adjustments,
    });
  }
  return {
    version: 'raster-semantic-critic-v1',
    passed,
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
    reportedCallsNeurons: callReports,
  };
}
