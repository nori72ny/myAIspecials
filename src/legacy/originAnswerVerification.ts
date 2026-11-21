import {
  buildOriginCloudflareRoutePlan,
  buildOriginGroqRoutePlan,
  type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  isOriginCloudflareFreeModelId,
  type OriginCloudflareFreeModelEvidence,
} from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import {
  isOriginGroqFreeModelId,
  type OriginGroqFreeModelEvidence,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import {
  OriginProviderError,
  type OriginFetch,
  type OriginProviderExecutionResult,
} from "./originProviderClient.js";
import {
  executeOriginCloudflareProvider,
  OriginCloudflarePreflightError,
} from "./originCloudflareProviderClient.js";
import {
  executeOriginGroqProvider,
  OriginGroqPreflightError,
} from "./originGroqProviderClient.js";
import { fetchCloudflareDailyNeuronsUsedV15 } from "../creative/cloudflareRasterFreeQuotaV15.js";
import { originCurrentDateInstruction } from "./originChatResponsePolicy.js";

/**
 * Cross-route answer verification (ANSWER_VERIFICATION_DESIGN_2026-11-21,
 * V-PR-1: the standalone module only — no router wiring, no mode switch;
 * those land in V-PR-2 and later).
 *
 * Coordinator adjudication behind the design: the verifier is always the
 * OTHER production route. When route 2 (Cloudflare gemma) served the
 * answer, route 3 (Groq gpt-oss) verifies it, and vice versa — different
 * provider, different model, so the generator never certifies itself.
 * The verification call deliberately bypasses the failover dispatcher
 * (which could pick the serving route itself) and invokes the target
 * route's own executor with that route's own plan, so each route's
 * preflight (evidence freshness, $0 proof, pool-exhaustion day stop,
 * capacity cooldown) applies exactly as it does for generation.
 *
 * Failure posture (design D5): fail open, always. Any verification
 * failure — rate limit, timeout, empty response, 503, route preflight
 * skip, unparseable verdict JSON — returns status "not-run" with the
 * failure kind, and the caller's original answer is delivered unchanged.
 * A failed verification is never reported as a passed one. The E-1..E-5
 * kinds follow the reliability specialist's error taxonomy.
 *
 * The verifier never rewrites the answer. Its only outputs are per-claim
 * verdicts; what may be done with them is decided by the pure correction
 * policy in this module (design section 4.3): patch only when the
 * corrected sentence is machine-checkable against the cited source
 * excerpt, then one annotated regeneration, then — class A only — a
 * hold. Nothing is ever corrected or held on uncertain / unsupported
 * verdicts alone.
 */

/** Verification has its own budget, separate from the 45s generation budget (design section 5.1). */
export const ORIGIN_ANSWER_VERIFICATION_TIMEOUT_MS = 12_000;

/** Claims judged per verification call; anything beyond is counted, never silently dropped (design section 3.2). */
export const ORIGIN_ANSWER_VERIFICATION_MAX_CLAIMS = 12;

/**
 * Payload caps. The design's sizing estimate (~2,400 tokens for the
 * whole verification input) assumed trimmed answers and excerpts; these
 * caps keep the worst case — instruction plus capped payload — under
 * the Groq executor's pre-send input gate (6,000 estimated tokens under
 * its characters/2 estimator) while leaving typical answers untouched.
 */
export const ORIGIN_ANSWER_VERIFICATION_QUESTION_MAX_CHARS = 1_500;
export const ORIGIN_ANSWER_VERIFICATION_ANSWER_MAX_CHARS = 3_000;
export const ORIGIN_ANSWER_VERIFICATION_EXCERPT_MAX_CHARS = 300;
export const ORIGIN_ANSWER_VERIFICATION_MAX_SOURCES = 6;

export type OriginAnswerRouteId = "cloudflare" | "groq";

export type OriginAnswerClaimVerdictKind =
  | "supported"
  | "unsupported"
  | "contradicted"
  | "uncertain";

export interface OriginAnswerClaimVerdict {
  /** 1-based claim number, in the order the verifier extracted the claims. */
  index: number;
  verdict: OriginAnswerClaimVerdictKind;
  /**
   * Replacement sentence for a contradicted claim. The protocol requires
   * it for "contradicted"; the parser downgrades a contradicted verdict
   * without one to "uncertain" (design section 4.2), so any contradicted
   * verdict that reaches callers always carries this field.
   */
  corrected?: string;
  /** 1-based index into the sources digest, when the verdict rests on a source. */
  sourceRef?: number;
  note?: string;
  /** The answer states two different values/dates/names for the same subject (design section 3.2 item 4). */
  internalConflict?: boolean;
}

export interface OriginAnswerVerificationSource {
  title: string;
  domain: string;
  retrievedAt?: string;
  excerpt?: string;
}

export type OriginAnswerVerificationFailureKind =
  /** E-1: the verifier route answered 429. */
  | "rate-limited"
  /** E-2: the verifier call exceeded its budget (its own timeout or the 12s verification cap). */
  | "timeout"
  /** E-3: the verifier route returned an empty body. */
  | "empty-response"
  /** E-4: the verifier route answered 503 (on Cloudflare, the usage-reconciliation failure class). */
  | "service-unavailable"
  /** E-5: the verifier route was never sent (preflight skip: pool exhausted, capacity cooldown, not configured, stale evidence, plan build failure). */
  | "route-unavailable"
  /** The verifier answered, but its output was not protocol-conforming verdict JSON. */
  | "verdict-parse-failure"
  /** The serving route could not be identified as one of the two production routes, so no cross-route verifier exists. */
  | "unknown-served-route"
  /** Any other provider-side failure. */
  | "provider-error";

export type OriginAnswerVerificationResult =
  | {
      status: "completed";
      servedRoute: OriginAnswerRouteId;
      verifierRoute: OriginAnswerRouteId;
      servedModel: string;
      verifierModel: string;
      claims: readonly OriginAnswerClaimVerdict[];
      /** Claims the verifier reported (or the parser had to drop) beyond the judged set. */
      unjudgedClaimCount: number;
      verdictCounts: Readonly<Record<OriginAnswerClaimVerdictKind, number>>;
      /** True when the answer text sent to the verifier was cut at the payload cap; the tail was not verified. */
      answerTruncated: boolean;
      durationMs: number;
      transportRequestCount: number;
      neurons?: number;
    }
  | {
      status: "not-run";
      failureKind: OriginAnswerVerificationFailureKind;
      servedRoute: OriginAnswerRouteId | null;
      verifierRoute: OriginAnswerRouteId | null;
      durationMs: number;
      transportRequestCount?: number;
    };

export interface OriginAnswerVerificationInput {
  question: string;
  answerText: string;
  /** Research path only: the sources the answer was built from (title/domain plus the excerpts actually used). */
  sources?: readonly OriginAnswerVerificationSource[];
  /** The generation result; the serving route is read from its routingEvidence, never from configured order. */
  generationResult: OriginProviderExecutionResult;
  /** The generation request's plan shell; the verifier route's plan is derived from it. */
  sourcePlan: OriginExecutionPlan;
}

export interface OriginAnswerVerificationOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: OriginFetch;
  nowMs?: number;
  /** Verification budget; defaults to ORIGIN_ANSWER_VERIFICATION_TIMEOUT_MS. */
  timeoutMs?: number;
  cloudflareExecute?: typeof executeOriginCloudflareProvider;
  groqExecute?: typeof executeOriginGroqProvider;
  cloudflareCatalog?: readonly OriginCloudflareFreeModelEvidence[];
  groqCatalog?: readonly OriginGroqFreeModelEvidence[];
}

/**
 * Identifies which production route actually served an answer, from the
 * execution result's served model. Rotation models inside the Groq route
 * (gpt-oss-20b, qwen3.8-27b) still count as the Groq route. Anything else
 * — the stopped OpenRouter route, an unknown model — returns null: there
 * is no "other route" to verify with, and the caller fails open.
 */
export function identifyOriginAnswerServedRoute(
  servedModel: string | undefined,
): OriginAnswerRouteId | null {
  if (isOriginCloudflareFreeModelId(servedModel)) return "cloudflare";
  if (isOriginGroqFreeModelId(servedModel)) return "groq";
  return null;
}

export function originAnswerVerifierRouteFor(
  servedRoute: OriginAnswerRouteId,
): OriginAnswerRouteId {
  return servedRoute === "cloudflare" ? "groq" : "cloudflare";
}

/**
 * The verification instruction: one shared text for both routes (design
 * section 8 item 1 — no per-route compressed variant; the verification
 * input is short by construction). The verifier inspects another AI's
 * answer; it never writes its own.
 */
export function buildOriginAnswerVerificationInstruction(nowMs: number): string {
  return [
    "あなたは、別のAIが書いた回答を検証する検査者です。自分自身の回答を書いてはいけません。渡された質問と回答を読み、回答に含まれる事実の断定（主張）を文単位で抽出し、それぞれを判定してください。",
    originCurrentDateInstruction(nowMs, "ja"),
    "判定は次の4値のいずれかです。supported=出典で支持される、または明白な事実と矛盾しない。unsupported=（出典が渡された場合のみ）対応する出典の裏付けがない。contradicted=出典、または明白な事実と矛盾する。uncertain=判定できない。確信が持てない場合は必ずuncertainに倒してください。",
    "規則：主張は最大12件まで。数値・日付・制度・固有名詞の主張を優先し、判定しきれなかった主張はunjudgedに件数だけを入れてください。留保表現（〜かもしれません、〜の可能性があります等）と意見・提案は主張として扱いません。",
    "contradictedの場合はcorrectedに、その主張の差し替え文だけを書いてください。新しい主張を足してはいけません。訂正文が書けない場合はuncertainにしてください。出典が渡された場合、判定の根拠にした出典の番号をsourceRefに入れてください。",
    "回答の中で同じ対象に2つの異なる値・日付・名称が述べられている主張にはinternalConflictをtrueにしてください。出典が渡されていない場合、あなたの知識で確認できないことはunsupportedではなくuncertainにしてください。",
    "出力は次の形式のJSONだけです。前置き・説明・コードフェンスは禁止です。",
    "{\"claims\":[{\"index\":1,\"verdict\":\"supported\"},{\"index\":2,\"verdict\":\"contradicted\",\"corrected\":\"差し替え後の主張文\",\"sourceRef\":1,\"note\":\"短い理由\"}],\"unjudged\":0}",
  ].join("\n");
}

/** Builds the single user message carrying the question, the answer, and (research path) the source digest. */
export function buildOriginAnswerVerificationPayload(input: {
  question: string;
  answerText: string;
  sources?: readonly OriginAnswerVerificationSource[];
}): { text: string; answerTruncated: boolean } {
  const question = input.question.slice(0, ORIGIN_ANSWER_VERIFICATION_QUESTION_MAX_CHARS);
  const answerTruncated = input.answerText.length > ORIGIN_ANSWER_VERIFICATION_ANSWER_MAX_CHARS;
  const answer = input.answerText.slice(0, ORIGIN_ANSWER_VERIFICATION_ANSWER_MAX_CHARS);
  const parts = ["【質問】", question, "", "【検証する回答】", answer];
  const sources = (input.sources ?? []).slice(0, ORIGIN_ANSWER_VERIFICATION_MAX_SOURCES);
  if (sources.length > 0) {
    parts.push("", "【出典】");
    sources.forEach((source, position) => {
      const heading = `[${position + 1}] ${source.title}（${source.domain}${source.retrievedAt ? `、取得日: ${source.retrievedAt}` : ""}）`;
      parts.push(heading);
      if (source.excerpt) {
        parts.push(`抜粋: ${source.excerpt.slice(0, ORIGIN_ANSWER_VERIFICATION_EXCERPT_MAX_CHARS)}`);
      }
    });
  }
  return { text: parts.join("\n"), answerTruncated };
}

export type OriginAnswerVerdictParseResult =
  | {
      ok: true;
      claims: OriginAnswerClaimVerdict[];
      unjudgedClaimCount: number;
    }
  | { ok: false; reason: "empty-response" | "verdict-parse-failure" };

const VERDICT_KINDS: ReadonlySet<string> = new Set([
  "supported",
  "unsupported",
  "contradicted",
  "uncertain",
]);

function extractJsonValue(text: string): unknown {
  const start = text.search(/[{[]/);
  if (start < 0) return undefined;
  const closer = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(closer);
  if (end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

function parseClaimEntry(entry: unknown): OriginAnswerClaimVerdict | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const index = record.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1) return null;
  const verdict = record.verdict;
  if (typeof verdict !== "string" || !VERDICT_KINDS.has(verdict)) return null;
  const corrected =
    typeof record.corrected === "string" && record.corrected.trim().length > 0
      ? record.corrected.trim()
      : undefined;
  const sourceRef =
    typeof record.sourceRef === "number" && Number.isInteger(record.sourceRef) && record.sourceRef >= 1
      ? record.sourceRef
      : undefined;
  const note =
    typeof record.note === "string" && record.note.trim().length > 0
      ? record.note.trim()
      : undefined;
  return {
    index,
    // Protocol invariant (design section 4.2): a contradicted verdict
    // without a correction cannot act on the answer, so it is recorded
    // as uncertain — noted, never enforced.
    verdict: (verdict === "contradicted" && corrected === undefined
      ? "uncertain"
      : verdict) as OriginAnswerClaimVerdictKind,
    ...(corrected !== undefined ? { corrected } : {}),
    ...(sourceRef !== undefined ? { sourceRef } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(record.internalConflict === true ? { internalConflict: true } : {}),
  };
}

/**
 * Parses the verifier's verdict JSON. Liberal about framing (code fences,
 * surrounding prose) and strict about content: entries that do not follow
 * the protocol are dropped and counted as unjudged, duplicates keep the
 * first verdict, claims beyond the cap are counted as unjudged, and a
 * payload whose entries are all unusable is a parse failure, not an
 * empty verdict.
 */
export function parseOriginAnswerVerificationVerdicts(
  text: string,
): OriginAnswerVerdictParseResult {
  if (!text || text.trim().length === 0) return { ok: false, reason: "empty-response" };
  const root = extractJsonValue(text);
  if (root === undefined || root === null || typeof root !== "object") {
    return { ok: false, reason: "verdict-parse-failure" };
  }
  const rawClaims = Array.isArray(root)
    ? root
    : (root as Record<string, unknown>).claims;
  if (!Array.isArray(rawClaims)) return { ok: false, reason: "verdict-parse-failure" };
  const reportedUnjudgedRaw = Array.isArray(root)
    ? undefined
    : (root as Record<string, unknown>).unjudged;
  const reportedUnjudged =
    typeof reportedUnjudgedRaw === "number" &&
    Number.isInteger(reportedUnjudgedRaw) &&
    reportedUnjudgedRaw >= 0
      ? reportedUnjudgedRaw
      : 0;

  let dropped = 0;
  const seen = new Set<number>();
  const claims: OriginAnswerClaimVerdict[] = [];
  for (const entry of rawClaims) {
    const claim = parseClaimEntry(entry);
    if (!claim || seen.has(claim.index)) {
      dropped += 1;
      continue;
    }
    seen.add(claim.index);
    claims.push(claim);
  }
  if (rawClaims.length > 0 && claims.length === 0) {
    return { ok: false, reason: "verdict-parse-failure" };
  }
  claims.sort((a, b) => a.index - b.index);
  const overflow = Math.max(0, claims.length - ORIGIN_ANSWER_VERIFICATION_MAX_CLAIMS);
  return {
    ok: true,
    claims: claims.slice(0, ORIGIN_ANSWER_VERIFICATION_MAX_CLAIMS),
    unjudgedClaimCount: reportedUnjudged + dropped + overflow,
  };
}

/**
 * Whether a correction sentence may be applied as a mechanical patch:
 * every value it states (numbers, dates) must be present in the cited
 * source excerpt, or the sentence itself must appear there verbatim.
 * Normalization follows the recovery build PR-3 practice — NFKC, digit
 * separators removed, dates compared across their common written forms.
 * This is deliberately conservative: when in doubt, the correction is
 * not machine-checkable and the policy moves to regeneration instead.
 */
export function isOriginAnswerCorrectionMachineCheckable(
  corrected: string,
  excerpt: string | undefined,
): boolean {
  if (!corrected || corrected.trim().length === 0) return false;
  if (!excerpt || excerpt.trim().length === 0) return false;
  const normalizedExcerpt = normalizeForMachineCheck(excerpt);
  if (normalizedExcerpt.includes(normalizeForMachineCheck(corrected))) return true;
  const tokens = extractMachineCheckValueTokens(corrected);
  if (tokens.length === 0) return false;
  return tokens.every((candidates) =>
    candidates.some((candidate) => normalizedExcerpt.includes(candidate)),
  );
}

function normalizeForMachineCheck(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[,\s、。.・:：;；/／-]/g, "");
}

function extractMachineCheckValueTokens(text: string): string[][] {
  const normalized = text.normalize("NFKC");
  const tokens: string[][] = [];
  const datePattern = /(\d{4})年(\d{1,2})月(\d{1,2})日|(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})月(\d{1,2})日/g;
  for (const match of normalized.matchAll(datePattern)) {
    const year = match[1] ?? match[4];
    const month = match[2] ?? match[5] ?? match[7];
    const day = match[3] ?? match[6] ?? match[8];
    const candidates = [`${month}月${day}日`];
    if (year !== undefined) {
      candidates.push(`${year}年${month}月${day}日`, `${year}${month}${day}`);
    }
    tokens.push(candidates.map((candidate) => normalizeForMachineCheck(candidate)));
  }
  const withoutDates = normalized.replace(datePattern, " ");
  for (const match of withoutDates.matchAll(/\d[\d,]*\.?\d*/g)) {
    const core = match[0].replace(/,/g, "").replace(/\.$/, "");
    if (core.length > 0) tokens.push([core]);
  }
  return tokens;
}

export type OriginAnswerCorrectionAction =
  | "none"
  | "patch"
  | "regenerate"
  | "hold";

export interface OriginAnswerCorrectionContext {
  /** Class A (high-risk) or class B, per the design's verification classes. */
  answerClass: "A" | "B";
  path: "research" | "direct";
  sources?: readonly OriginAnswerVerificationSource[];
  /** True when this decision runs after the single allowed regeneration round and contradictions remain. */
  regenerationAttempted?: boolean;
}

export interface OriginAnswerCorrectionDecision {
  action: OriginAnswerCorrectionAction;
  /** Contradicted claims whose correction may be patched in mechanically (research path only). */
  patchClaims: OriginAnswerClaimVerdict[];
  /** Contradicted claims the decided action is about (regenerate / hold). */
  claimIndexes: number[];
  /** Contradictions left unresolved by the decision (class B after regeneration: recorded, never held). */
  unresolvedClaimIndexes: number[];
}

/**
 * The correction policy (design section 4.3) as a pure decision function.
 * It decides; it does not edit text. Priority: machine-checkable patch,
 * then one annotated regeneration, then — class A only — a hold.
 * Uncertain and unsupported verdicts never drive any action.
 */
export function decideOriginAnswerCorrection(
  claims: readonly OriginAnswerClaimVerdict[],
  context: OriginAnswerCorrectionContext,
): OriginAnswerCorrectionDecision {
  const actionable = claims.filter(
    (claim) => claim.verdict === "contradicted" && claim.corrected !== undefined,
  );
  if (actionable.length === 0) {
    return { action: "none", patchClaims: [], claimIndexes: [], unresolvedClaimIndexes: [] };
  }
  const patchClaims =
    context.path === "research"
      ? actionable.filter((claim) => {
          const source =
            claim.sourceRef !== undefined
              ? context.sources?.[claim.sourceRef - 1]
              : undefined;
          return isOriginAnswerCorrectionMachineCheckable(
            claim.corrected as string,
            source?.excerpt,
          );
        })
      : [];
  const unpatched = actionable.filter((claim) => !patchClaims.includes(claim));
  if (unpatched.length === 0) {
    return { action: "patch", patchClaims, claimIndexes: [], unresolvedClaimIndexes: [] };
  }
  if (!context.regenerationAttempted) {
    return {
      action: "regenerate",
      patchClaims,
      claimIndexes: unpatched.map((claim) => claim.index),
      unresolvedClaimIndexes: [],
    };
  }
  if (context.answerClass === "A") {
    return {
      action: "hold",
      patchClaims,
      claimIndexes: unpatched.map((claim) => claim.index),
      unresolvedClaimIndexes: [],
    };
  }
  return {
    action: "none",
    patchClaims,
    claimIndexes: [],
    unresolvedClaimIndexes: unpatched.map((claim) => claim.index),
  };
}

class OriginAnswerVerificationTimeoutError extends Error {
  constructor() {
    super("answer verification timed out");
    this.name = "OriginAnswerVerificationTimeoutError";
  }
}

async function withVerificationTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OriginAnswerVerificationTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function classifyVerificationError(
  error: unknown,
): OriginAnswerVerificationFailureKind {
  if (
    error instanceof OriginCloudflarePreflightError ||
    error instanceof OriginGroqPreflightError
  ) {
    return "route-unavailable";
  }
  if (error instanceof OriginProviderError) {
    if (error.code === "PROVIDER_RATE_LIMITED" || error.status === 429) return "rate-limited";
    if (
      error.code === "PROVIDER_TIMEOUT" ||
      error.status === 504 ||
      error.diagnostic?.transportFailure === "timeout"
    ) {
      return "timeout";
    }
    if (error.status === 503) return "service-unavailable";
    return "provider-error";
  }
  return "provider-error";
}

function countVerdicts(
  claims: readonly OriginAnswerClaimVerdict[],
): Record<OriginAnswerClaimVerdictKind, number> {
  const counts: Record<OriginAnswerClaimVerdictKind, number> = {
    supported: 0,
    unsupported: 0,
    contradicted: 0,
    uncertain: 0,
  };
  for (const claim of claims) counts[claim.verdict] += 1;
  return counts;
}

/**
 * Runs one cross-route verification. Never throws: every failure is a
 * "not-run" result with its kind, so wiring code can fail open by
 * construction. The verifier route is forced — the failover dispatcher
 * is not consulted, so the serving route can never be picked as its own
 * verifier.
 */
export async function verifyOriginAnswerCrossRoute(
  input: OriginAnswerVerificationInput,
  options: OriginAnswerVerificationOptions = {},
): Promise<OriginAnswerVerificationResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? ORIGIN_ANSWER_VERIFICATION_TIMEOUT_MS;
  const nowMs = options.nowMs ?? Date.now();
  const servedModel = input.generationResult.routingEvidence?.servedModel;
  const servedRoute = identifyOriginAnswerServedRoute(servedModel);
  if (!servedRoute) {
    return {
      status: "not-run",
      failureKind: "unknown-served-route",
      servedRoute: null,
      verifierRoute: null,
      durationMs: Date.now() - startedAt,
    };
  }
  const verifierRoute = originAnswerVerifierRouteFor(servedRoute);
  const notRun = (
    failureKind: OriginAnswerVerificationFailureKind,
    transportRequestCount?: number,
  ): OriginAnswerVerificationResult => ({
    status: "not-run",
    failureKind,
    servedRoute,
    verifierRoute,
    durationMs: Date.now() - startedAt,
    ...(transportRequestCount !== undefined ? { transportRequestCount } : {}),
  });

  const planSource: OriginExecutionPlan = { ...input.sourcePlan, timeoutMs };
  const instruction = buildOriginAnswerVerificationInstruction(nowMs);
  const payload = buildOriginAnswerVerificationPayload(input);
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    let result: OriginProviderExecutionResult;
    if (verifierRoute === "cloudflare") {
      const planResult = buildOriginCloudflareRoutePlan(planSource, {
        cloudflareFreeModelCatalog: options.cloudflareCatalog,
        nowMs,
      });
      if (planResult.ok === false) return notRun("route-unavailable", 0);
      const execute = options.cloudflareExecute ?? executeOriginCloudflareProvider;
      result = await withVerificationTimeout(
        execute(
          {
            plan: planResult.plan,
            messages: [{ role: "user", content: payload.text }],
            systemInstruction: instruction,
            cloudflareSystemInstruction: instruction,
          },
          env,
          fetchImpl,
          { catalog: options.cloudflareCatalog, nowMs },
        ),
        timeoutMs,
      );
    } else {
      const planResult = buildOriginGroqRoutePlan(planSource, {
        groqFreeModelCatalog: options.groqCatalog,
        nowMs,
      });
      if (planResult.ok === false) return notRun("route-unavailable", 0);
      const execute = options.groqExecute ?? executeOriginGroqProvider;
      result = await withVerificationTimeout(
        execute(
          {
            plan: planResult.plan,
            messages: [{ role: "user", content: payload.text }],
            systemInstruction: instruction,
            groqSystemInstruction: instruction,
          },
          env,
          fetchImpl,
          { catalog: options.groqCatalog, nowMs },
        ),
        timeoutMs,
      );
    }
    if (!result.text || result.text.trim().length === 0) {
      return notRun("empty-response", result.transportRequestCount);
    }
    const parsed = parseOriginAnswerVerificationVerdicts(result.text);
    if (parsed.ok === false) {
      return notRun(
        parsed.reason === "empty-response" ? "empty-response" : "verdict-parse-failure",
        result.transportRequestCount,
      );
    }
    return {
      status: "completed",
      servedRoute,
      verifierRoute,
      servedModel: servedModel as string,
      verifierModel: result.routingEvidence.servedModel,
      claims: parsed.claims,
      unjudgedClaimCount: parsed.unjudgedClaimCount,
      verdictCounts: countVerdicts(parsed.claims),
      answerTruncated: payload.answerTruncated,
      durationMs: Date.now() - startedAt,
      transportRequestCount: result.transportRequestCount,
      ...(result.routingEvidence.neurons !== undefined
        ? { neurons: result.routingEvidence.neurons }
        : {}),
    };
  } catch (error) {
    if (error instanceof OriginAnswerVerificationTimeoutError) return notRun("timeout");
    return notRun(classifyVerificationError(error));
  }
}

// ---------------------------------------------------------------------------
// V-PR-2: mode resolution, target classification, the daily Neuron
// sub-cap ledger, and the shadow runner the blocking router wires in.
//
// The mode switch is ORIGIN_ANSWER_VERIFICATION_MODE (design section
// 6.1): "off" is the default — unset or any other value reproduces the
// pre-feature behaviour exactly — "shadow" verifies and records
// without ever changing a delivered answer, and "enforce" is where
// corrections would apply. In V-PR-2 the enforce VALUE resolves but
// behaves as shadow in every respect: the correction machinery is
// V-PR-4's stage, and until then no mode value changes an answer.
// ---------------------------------------------------------------------------

export type OriginAnswerVerificationMode = "off" | "shadow" | "enforce";

export function resolveOriginAnswerVerificationMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginAnswerVerificationMode {
  const value = env?.ORIGIN_ANSWER_VERIFICATION_MODE;
  if (value === "shadow") return "shadow";
  if (value === "enforce") return "enforce";
  return "off";
}

/** The mode that actually governs behaviour in V-PR-2: enforce is shadow until V-PR-4. */
export function resolveOriginAnswerVerificationEffectiveMode(
  env: NodeJS.ProcessEnv | undefined,
): "off" | "shadow" {
  return resolveOriginAnswerVerificationMode(env) === "off" ? "off" : "shadow";
}

export type OriginAnswerVerificationPath = "direct" | "research";
export type OriginAnswerVerificationClass = "A" | "B";

export type OriginAnswerVerificationTargetReason =
  /** The publication gate held the answer: the delivered text is the deterministic hold, which is never verified. */
  | "gate-held"
  /** The delivered text is a deterministic app-generated text (template / conditional / terminal guard), not a model answer. */
  | "not-model-answer"
  /** A tier-T4 hold: it asserts nothing, so there is nothing to verify. */
  | "abstain"
  /** A tier-T3 partial answer whose source cards selected no N-2b claim sentences. */
  | "no-claim-sentences"
  /** No model execution ran for this request, so no cross-route pair exists to verify against. */
  | "no-generation-result";

export type OriginAnswerVerificationTargetDecision =
  | { targeted: true; answerClass: OriginAnswerVerificationClass }
  | { targeted: false; reason: OriginAnswerVerificationTargetReason };

/**
 * Direct-path targets (design section 3.1): class A is a review-policy
 * required answer or one the publication gate fired on (shadow firing
 * included); every other delivered model answer is class B. A held
 * answer is not a target at all — its delivered text is the gate's
 * deterministic hold.
 */
export function classifyDirectAnswerVerificationTarget(input: {
  reviewRequired: boolean;
  publicationGateFired: boolean;
  publicationGateHeld: boolean;
}): OriginAnswerVerificationTargetDecision {
  if (input.publicationGateHeld) return { targeted: false, reason: "gate-held" };
  if (input.reviewRequired || input.publicationGateFired) {
    return { targeted: true, answerClass: "A" };
  }
  return { targeted: true, answerClass: "B" };
}

/**
 * Research-path targets (design section 3.1): an adopted grounded
 * synthesis (tier T0) is always class A. At the fallback assembly, only
 * the tier-T3 extractive partial answer qualifies — when it carries
 * N-2b claim sentences and a synthesis execution actually ran (the
 * cross-route pair is identified from that execution). Tier-T4 holds
 * and the deterministic template / conditional landings are excluded.
 */
export function classifyResearchAnswerVerificationTarget(
  input:
    | { site: "t0" }
    | {
        site: "final";
        tier: string | null;
        deterministicLanding: boolean;
        hasClaimSentences: boolean;
        hasGenerationResult: boolean;
      },
): OriginAnswerVerificationTargetDecision {
  if (input.site === "t0") return { targeted: true, answerClass: "A" };
  if (input.deterministicLanding) return { targeted: false, reason: "not-model-answer" };
  if (input.tier !== "T3") return { targeted: false, reason: "abstain" };
  if (!input.hasClaimSentences) return { targeted: false, reason: "no-claim-sentences" };
  if (!input.hasGenerationResult) return { targeted: false, reason: "no-generation-result" };
  return { targeted: true, answerClass: "A" };
}

/**
 * The daily Neuron sub-cap for verification (design sections 5.2 and
 * D10): a code constant, not an env value — the switch carries the
 * mode only, numbers live in code, exactly like the failover budgets.
 * The cap gates class B (the volume class); class A always runs,
 * because class A is the enforcement candidate whose shadow record
 * must stay complete — the design's measurement protocol reads
 * "everything before the cap, class A only after it". Consumption is
 * counted from the account usage counter's deltas (see the runner),
 * never estimated from success counts (W-1: a 503 reconciliation
 * failure consumes Neurons invisibly, and only the counter sees it).
 */
export const ORIGIN_ANSWER_VERIFICATION_DAILY_NEURON_SUBCAP = 1_500;

export interface OriginAnswerVerificationNeuronLedger {
  usedToday(nowMs: number): number;
  capReached(nowMs: number): boolean;
  add(neurons: number, nowMs: number): number;
}

export function createOriginAnswerVerificationNeuronLedger(
  subcap: number = ORIGIN_ANSWER_VERIFICATION_DAILY_NEURON_SUBCAP,
): OriginAnswerVerificationNeuronLedger {
  // The Neuron day is the UTC day: the free allocation resets at
  // 00:00 UTC (09:00 JST), and the usage counter is read per UTC date.
  let date = "";
  let neurons = 0;
  const roll = (nowMs: number) => {
    const today = new Date(nowMs).toISOString().slice(0, 10);
    if (date !== today) {
      date = today;
      neurons = 0;
    }
  };
  return {
    usedToday(nowMs) {
      roll(nowMs);
      return neurons;
    },
    capReached(nowMs) {
      roll(nowMs);
      return neurons >= subcap;
    },
    add(delta, nowMs) {
      roll(nowMs);
      if (delta > 0) neurons += delta;
      return neurons;
    },
  };
}

/**
 * Process-wide ledger. Serverless instances do not share it — the same
 * best-effort posture as the failover circuit breakers; losing the
 * state only ever weakens the cap, never an answer.
 */
export const originAnswerVerificationNeuronLedger =
  createOriginAnswerVerificationNeuronLedger();

/**
 * Reads the account's used-Neurons counter for today (UTC) through the
 * shared daily-usage reader (the same counter the image and voice
 * paths reconcile against). Returns null when the counter cannot be
 * read — credentials absent or the read unverifiable — and callers
 * treat null as "unknown", never as zero.
 */
export type OriginAnswerVerificationDailyUsageReader = (
  env: NodeJS.ProcessEnv,
  nowMs: number,
) => Promise<number | null>;

export const readOriginAnswerVerificationDailyNeuronsUsed: OriginAnswerVerificationDailyUsageReader =
  async (env, nowMs) => {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
    const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
    if (
      !/^[a-f0-9]{32}$/i.test(accountId) ||
      apiToken.length < 20 ||
      apiToken.length > 4096
    ) {
      return null;
    }
    try {
      const usage = await fetchCloudflareDailyNeuronsUsedV15(
        { accountId, apiToken },
        fetch,
        nowMs,
      );
      return usage.usedNeurons;
    } catch {
      return null;
    }
  };

export interface OriginAnswerVerificationShadowInput {
  requestId: string;
  path: OriginAnswerVerificationPath;
  answerClass: OriginAnswerVerificationClass;
  question: string;
  answerText: string;
  /** Research path only: the sources the answer was built from. */
  sources?: readonly OriginAnswerVerificationSource[];
  generationResult: OriginProviderExecutionResult;
  sourcePlan: OriginExecutionPlan;
  language: "ja" | "en";
}

export interface OriginAnswerVerificationShadowOptions {
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  /** The verification call itself (V-PR-1); injectable for tests. */
  verify?: typeof verifyOriginAnswerCrossRoute;
  /** Extra options forwarded to the verification call (executors, catalogs). */
  verifyOptions?: OriginAnswerVerificationOptions;
  readDailyNeuronsUsed?: OriginAnswerVerificationDailyUsageReader;
  neuronLedger?: OriginAnswerVerificationNeuronLedger;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}

/**
 * What the shadow outcome means for the answer envelope. "pass" is the
 * only outcome that may upgrade an envelope: the check genuinely ran
 * and no actionable contradiction remained. Everything else is
 * "hold-not-run" — the answer must not be marked verified, and callers
 * whose standing not-run wording would become false (the direct path's
 * review-required reason) substitute the runner's truthful wording.
 */
export type OriginAnswerVerificationEnvelopeEffect = "pass" | "hold-not-run";

export interface OriginAnswerVerificationShadowOutcome {
  configuredMode: OriginAnswerVerificationMode;
  effectiveMode: "shadow";
  status: "completed" | "not-run" | "skipped";
  skipReason?: "daily-neuron-cap";
  failureKind?: OriginAnswerVerificationFailureKind;
  /** The correction the verdicts WOULD drive under enforcement (shadow records it, never applies it). */
  wouldBeAction: OriginAnswerCorrectionAction;
  wouldBePatchCount: number;
  /** Contradicted claims carrying a correction — the count that decides the envelope effect. */
  actionableContradictionCount: number;
  envelopeEffect: OriginAnswerVerificationEnvelopeEffect;
  /** Truthful not-run wording (summary + limitation) for the direct path's review-required envelope. */
  notRunSummary: string;
  notRunLimitation: string;
  /** The routing-metadata verification block (design section 4.5): kinds and counts only, never answer or claim text. */
  metadata: Record<string, unknown>;
}

function shadowNotRunWording(input: {
  language: "ja" | "en";
  status: "completed" | "not-run" | "skipped";
  failureKind?: OriginAnswerVerificationFailureKind;
}): { summary: string; limitation: string } {
  const ja = input.language === "ja";
  const incompleteLimitation = ja
    ? "独立した別AIによる確認を完了できていないため、重要な判断にはそのまま使用しないでください。"
    : "An independent check by a different AI has not been completed, so do not use this answer as-is for an important decision.";
  if (input.status === "completed") {
    return {
      summary: ja
        ? "別のAIが内容を確認しましたが、見解が一致しない点が残ったため、確認済みとはしていません。"
        : "A different AI checked this answer, but points of disagreement remained, so it is not treated as verified.",
      limitation: ja
        ? "別のAIによる確認で見解の一致しない点が残っているため、重要な判断にはそのまま使用しないでください。"
        : "A check by a different AI left points of disagreement unresolved, so do not use this answer as-is for an important decision.",
    };
  }
  if (input.status === "skipped") {
    return {
      summary: ja
        ? "独立確認が必要な依頼ですが、本日の確認枠の上限に達したため、確認を実施できませんでした。"
        : "This request requires an independent check, but today's verification budget has been reached, so the check could not be performed.",
      limitation: incompleteLimitation,
    };
  }
  const unavailable =
    input.failureKind === "route-unavailable" ||
    input.failureKind === "unknown-served-route";
  return {
    summary: unavailable
      ? ja
        ? "独立確認が必要な依頼ですが、確認を行う別のAIを利用できなかったため、確認を実施できませんでした。"
        : "This request requires an independent check, but the other AI needed for the check was unavailable, so the check could not be performed."
      : ja
        ? "独立確認が必要な依頼ですが、確認を行う別のAIが応答しなかったため、確認を実施できませんでした。"
        : "This request requires an independent check, but the other AI needed for the check did not respond, so the check could not be performed.",
    limitation: incompleteLimitation,
  };
}

/**
 * Runs one shadow verification for a targeted answer and records it:
 * the structured log line (design section 6.2) and the routing
 * metadata block carry the same fields — mode, routes, claim count,
 * per-verdict counts, the would-be action, duration, the E-series
 * failure kind, and the usedBefore counter delta. The delivered
 * answer is never touched: this runner returns verdicts and wording,
 * not text. It never throws — a plumbing failure degrades to a
 * not-run outcome, because verification must never break an answer
 * (design D5).
 */
export async function runOriginAnswerVerificationShadow(
  input: OriginAnswerVerificationShadowInput,
  options: OriginAnswerVerificationShadowOptions = {},
): Promise<OriginAnswerVerificationShadowOutcome> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const configuredMode = resolveOriginAnswerVerificationMode(env);
  const ledger = options.neuronLedger ?? originAnswerVerificationNeuronLedger;
  const logger =
    options.logger ?? ((message, fields) => console.info(message, fields));
  const verify = options.verify ?? verifyOriginAnswerCrossRoute;
  const servedRoute = identifyOriginAnswerServedRoute(
    input.generationResult.routingEvidence?.servedModel,
  );
  const verifierRoute = servedRoute
    ? originAnswerVerifierRouteFor(servedRoute)
    : null;

  const finish = (partial: {
    status: "completed" | "not-run" | "skipped";
    skipReason?: "daily-neuron-cap";
    failureKind?: OriginAnswerVerificationFailureKind;
    result?: OriginAnswerVerificationResult;
    durationMs: number;
    neuronsDelta: number;
    neuronsCountSource: "counter-delta" | "reported" | "unavailable" | "not-applicable";
  }): OriginAnswerVerificationShadowOutcome => {
    const result = partial.result;
    const completed = result?.status === "completed" ? result : null;
    let wouldBeAction: OriginAnswerCorrectionAction = "none";
    let wouldBePatchCount = 0;
    let actionableContradictionCount = 0;
    if (completed) {
      actionableContradictionCount = completed.claims.filter(
        (claim) => claim.verdict === "contradicted" && claim.corrected !== undefined,
      ).length;
      const decision = decideOriginAnswerCorrection(completed.claims, {
        answerClass: input.answerClass,
        path: input.path,
        sources: input.sources,
        regenerationAttempted: false,
      });
      wouldBeAction = decision.action;
      wouldBePatchCount = decision.patchClaims.length;
    }
    const envelopeEffect: OriginAnswerVerificationEnvelopeEffect =
      completed && actionableContradictionCount === 0 ? "pass" : "hold-not-run";
    const wording = shadowNotRunWording({
      language: input.language,
      status: partial.status,
      failureKind: partial.failureKind,
    });
    const metadata: Record<string, unknown> = {
      verificationMode: "shadow",
      verificationConfiguredMode: configuredMode,
      verificationClass: input.answerClass,
      verificationPath: input.path,
      verificationStatus: partial.status,
      ...(partial.skipReason ? { verificationSkipReason: partial.skipReason } : {}),
      ...(partial.failureKind ? { verificationFailureKind: partial.failureKind } : {}),
      servedRoute,
      verifierRoute,
      ...(completed
        ? {
            servedModel: completed.servedModel,
            verifierModel: completed.verifierModel,
            claimCount: completed.claims.length,
            unjudgedClaimCount: completed.unjudgedClaimCount,
            verdictSupported: completed.verdictCounts.supported,
            verdictUnsupported: completed.verdictCounts.unsupported,
            verdictContradicted: completed.verdictCounts.contradicted,
            verdictUncertain: completed.verdictCounts.uncertain,
            internalConflictCount: completed.claims.filter(
              (claim) => claim.internalConflict === true,
            ).length,
            answerTruncated: completed.answerTruncated,
          }
        : {}),
      wouldBeAction,
      wouldBePatchCount,
      appliedAction: "none",
      verificationDurationMs: partial.durationMs,
      ...(result && result.transportRequestCount !== undefined
        ? { verifierTransportRequests: result.transportRequestCount }
        : {}),
      neuronsDelta: partial.neuronsDelta,
      verificationNeuronsToday: ledger.usedToday(nowMs),
      neuronCapReached: ledger.capReached(nowMs),
      neuronsCountSource: partial.neuronsCountSource,
    };
    try {
      logger("[origin-chat] answer verification", {
        requestId: input.requestId,
        ...metadata,
      });
    } catch {
      // A failing logger must never break or delay the answer.
    }
    return {
      configuredMode,
      effectiveMode: "shadow",
      status: partial.status,
      ...(partial.skipReason ? { skipReason: partial.skipReason } : {}),
      ...(partial.failureKind ? { failureKind: partial.failureKind } : {}),
      wouldBeAction,
      wouldBePatchCount,
      actionableContradictionCount,
      envelopeEffect,
      notRunSummary: wording.summary,
      notRunLimitation: wording.limitation,
      metadata,
    };
  };

  // The daily sub-cap gates class B only (see the cap constant). A
  // capped class-B answer is recorded as skipped and delivered
  // unchanged — the cap stops verification, never answers.
  if (
    input.answerClass === "B" &&
    verifierRoute === "cloudflare" &&
    ledger.capReached(nowMs)
  ) {
    return finish({
      status: "skipped",
      skipReason: "daily-neuron-cap",
      durationMs: 0,
      neuronsDelta: 0,
      neuronsCountSource: "not-applicable",
    });
  }

  const countNeurons = verifierRoute === "cloudflare";
  const readUsage =
    options.readDailyNeuronsUsed ?? readOriginAnswerVerificationDailyNeuronsUsed;
  const before = countNeurons
    ? await readUsage(env, nowMs).catch(() => null)
    : null;
  let result: OriginAnswerVerificationResult;
  try {
    result = await verify(
      {
        question: input.question,
        answerText: input.answerText,
        sources: input.sources,
        generationResult: input.generationResult,
        sourcePlan: input.sourcePlan,
      },
      {
        ...options.verifyOptions,
        env: options.verifyOptions?.env ?? env,
        nowMs: options.verifyOptions?.nowMs ?? nowMs,
      },
    );
  } catch {
    // verifyOriginAnswerCrossRoute never throws by contract; this is
    // belt-and-braces so shadow plumbing can never break an answer.
    result = {
      status: "not-run",
      failureKind: "provider-error",
      servedRoute,
      verifierRoute,
      durationMs: Date.now() - startedAt,
    };
  }

  // Neuron counting from the usage counter's delta around the call
  // (W-1): the delta is the only figure that sees a 503's invisible
  // consumption. When the counter is timely its delta already covers
  // the call's reported usage, so the larger of the two is the
  // conservative count; when the counter cannot be read, the completed
  // result's reported usage is the fallback and is labelled as such.
  let neuronsDelta = 0;
  let neuronsCountSource:
    | "counter-delta"
    | "reported"
    | "unavailable"
    | "not-applicable" = "not-applicable";
  if (countNeurons) {
    const after = await readUsage(env, nowMs).catch(() => null);
    const counterDelta =
      before !== null && after !== null ? Math.max(0, after - before) : null;
    const reported =
      result.status === "completed" && typeof result.neurons === "number"
        ? result.neurons
        : null;
    if (counterDelta !== null && reported !== null) {
      neuronsDelta = Math.max(counterDelta, reported);
      neuronsCountSource = "counter-delta";
    } else if (counterDelta !== null) {
      neuronsDelta = counterDelta;
      neuronsCountSource = "counter-delta";
    } else if (reported !== null) {
      neuronsDelta = reported;
      neuronsCountSource = "reported";
    } else {
      neuronsCountSource = "unavailable";
    }
    ledger.add(neuronsDelta, nowMs);
  }

  if (result.status === "completed") {
    return finish({
      status: "completed",
      result,
      durationMs: result.durationMs,
      neuronsDelta,
      neuronsCountSource,
    });
  }
  return finish({
    status: "not-run",
    failureKind: result.failureKind,
    result,
    durationMs: result.durationMs,
    neuronsDelta,
    neuronsCountSource,
  });
}
