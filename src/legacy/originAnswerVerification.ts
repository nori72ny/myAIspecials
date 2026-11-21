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
