import {
buildOriginCloudflareRoutePlan,
buildOriginGroqRoutePlan,
type OriginExecutionPlan,
} from "../lib/orchestration/OriginExecutionPolicy.js";
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
import type {
OriginCloudflareFreeModelEvidence,
} from "../lib/orchestration/OriginCloudflareFreeModelCatalog.js";
import type {
OriginGroqFreeModelEvidence,
} from "../lib/orchestration/OriginGroqFreeModelCatalog.js";
import { originCurrentDateInstruction, isSelfContainedCodeTaskRequest} from "./originChatResponsePolicy.js";
import {
identifyOriginAnswerServedRoute,
originAnswerVerifierRouteFor,
type OriginAnswerRouteId,
type OriginAnswerVerificationFailureKind,
} from "./originAnswerVerification.js";

/**
* Code-equivalence verification for review/rewrite answers (案B,
* CODE_CB7_CONFIRM_DIAGNOSIS_2026-11-27 sections 4.3 and 6 item
* B-1). The CB-7 confirmation run's E-05 defect recurred for the
* third time in the same shape: the answer's MAIN replacement code
* dropped the rows the original keeps (an inner-join aggregation
* replacing an outer-join one), the equivalent knowledge sat unused
* in a table or a conditional fragment, and the prose asserted the
* results were the same. Every existing check verifies the plan
* against itself, so nothing ever compared the delivered main code
* against the original. This module is that comparison, run by the
* OTHER production route — the same cross-route posture as the
* answer verification (originAnswerVerification.ts), whose plumbing
* (route identification, failure taxonomy, fail-open runner shape)
* it deliberately mirrors.
*
* Stage 1 is shadow only. The mode switch is
* ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE: "off" is the default —
* unset or any other value reproduces the pre-feature behaviour
* exactly — "shadow" verifies and records, and "enforce" resolves
* but behaves as shadow in every respect: no enforcement stage
* exists yet, and no mode value ever changes a delivered answer.
* The shadow record carries what the next measurement run needs to
* compute the detection rate and the false-detection rate: whether
* the request was a target, the verdict, which answer block the
* verifier identified as the main replacement, how many differing
* cases it named, whether the answer claimed the results were the
* same, and the E-series failure kind when the check did not run.
*
* Scope is deliberately narrow (coordinator adjudication on the
* diagnosis): review/rewrite tasks only — the user supplied code in
* fences and asked for a review or a rewrite of THAT code, and the
* answer presents replacement code in fences. Explanation-only
* tasks are out: they present no main replacement to compare. At
* most one verification call is made per answer.
*
* Failure posture: fail open, always — the same D5 posture as the
* answer verification. Any failure returns status "not-run" with
* its kind; the delivered answer is never touched, delayed beyond
* the completion event, or reported as checked when it was not.
*/

/** The check's own budget, separate from the generation budget (mirrors the answer verification's 12s). */
export const ORIGIN_CODE_EQUIVALENCE_VERIFICATION_TIMEOUT_MS = 12_000;

/**
* Payload caps. Together with the instruction (~1,200 characters)
* they keep the worst case — instruction plus capped payload —
* under the Groq executor's pre-send input gate (6,000 estimated
* tokens under its characters/2 estimator). Typical review/rewrite
* exchanges are far smaller; anything cut by a cap is flagged in
* the result so the measurement can discount it.
*/
export const ORIGIN_CODE_EQUIVALENCE_ORIGINAL_MAX_CHARS = 3_500;
export const ORIGIN_CODE_EQUIVALENCE_BLOCKS_MAX_CHARS = 5_000;
export const ORIGIN_CODE_EQUIVALENCE_PROSE_MAX_CHARS = 1_500;
export const ORIGIN_CODE_EQUIVALENCE_MAX_BLOCKS = 6;
/** Differing cases recorded per verdict; anything beyond is dropped by the parser. */
export const ORIGIN_CODE_EQUIVALENCE_MAX_DIFFERING_CASES = 5;

export type OriginCodeEquivalenceVerdictKind =
| "equivalent"
| "non-equivalent"
| "uncertain";

export type OriginCodeEquivalenceVerificationResult =
| {
status: "completed";
servedRoute: OriginAnswerRouteId;
verifierRoute: OriginAnswerRouteId;
servedModel: string;
verifierModel: string;
verdict: OriginCodeEquivalenceVerdictKind;
/** 1-based index of the answer block the verifier identified as the main replacement, or null when it could not identify one. */
mainBlockIndex: number | null;
/** The differing cases the verifier named (capped); text stays inside this module — metadata records only the count. */
differingCases: readonly string[];
/** The answer's prose claimed the replacement gives the same results as the original. */
sameResultClaimed: boolean;
/** True when the original code sent to the verifier was cut at the payload cap. */
originalTruncated: boolean;
/** True when the answer's blocks sent to the verifier were cut (count or characters) at the payload caps. */
blocksTruncated: boolean;
/** Fenced blocks present in the delivered answer. */
answerBlockCount: number;
/** Blocks actually sent to the verifier (after the caps). */
includedBlockCount: number;
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

export interface OriginCodeEquivalenceVerificationInput {
/** The user's message carrying the original code (the last user message, as the routers hold it). */
message: string;
/** The delivered answer text (post-gate), carrying the replacement code. */
answerText: string;
/** The generation result; the serving route is read from its routingEvidence. */
generationResult: OriginProviderExecutionResult;
/** The generation request's plan shell; the verifier route's plan is derived from it. */
sourcePlan: OriginExecutionPlan;
}

export interface OriginCodeEquivalenceVerificationOptions {
env?: NodeJS.ProcessEnv;
fetchImpl?: OriginFetch;
nowMs?: number;
/** Verification budget; defaults to ORIGIN_CODE_EQUIVALENCE_VERIFICATION_TIMEOUT_MS. */
timeoutMs?: number;
cloudflareExecute?: typeof executeOriginCloudflareProvider;
groqExecute?: typeof executeOriginGroqProvider;
cloudflareCatalog?: readonly OriginCloudflareFreeModelEvidence[];
groqCatalog?: readonly OriginGroqFreeModelEvidence[];
}

// ---------------------------------------------------------------------------
// Mode resolution. "enforce" resolves as a configured value but the
// effective mode maps it to shadow: no enforcement stage exists.
// ---------------------------------------------------------------------------

export type OriginCodeEquivalenceVerificationMode = "off" | "shadow" | "enforce";

export function resolveOriginCodeEquivalenceVerificationMode(
env: NodeJS.ProcessEnv | undefined,
): OriginCodeEquivalenceVerificationMode {
const value = env?.ORIGIN_CODE_EQUIVALENCE_VERIFICATION_MODE;
if (value === "shadow") return "shadow";
if (value === "enforce") return "enforce";
return "off";
}

/** The mode that actually governs behaviour in stage 1: enforce is shadow until an enforcement stage is designed. */
export function resolveOriginCodeEquivalenceVerificationEffectiveMode(
env: NodeJS.ProcessEnv | undefined,
): "off" | "shadow" {
return resolveOriginCodeEquivalenceVerificationMode(env) === "off"? "off": "shadow";
}

// ---------------------------------------------------------------------------
// Fence extraction and target classification.
// ---------------------------------------------------------------------------

/**
* Splits a text into its complete fenced code blocks and the prose
* around them. Only complete fence pairs count — the same rule the
* policy's splitter uses for the CB-1 predicate — so a stray ```
* can never manufacture a block.
*/
export function extractOriginCodeFences(text: string): {
blocks: string[];
prose: string;
} {
const blocks: string[] = [];
const fencePattern = /```[^\n]*\n?([\s\S]*?)```/g;
for (const match of text.matchAll(fencePattern)) {
blocks.push(match[1]);
}
const prose = blocks.length === 0? text: text.replace(/```[\s\S]*?```/g, "\n");
return { blocks, prose};
}

/**
* The review/rewrite operation subset of the CB-1 operation
* vocabulary: an operation that produces a replacement for the
* supplied code. Explanation （説明 / explain) is deliberately NOT
* in this set — an explanation presents no main replacement whose
* equivalence could be judged.
*/
const CODE_EQUIVALENCE_OPERATION_PATTERNS: readonly RegExp[] = [
/(?:修正|直し|直す|リファクタ|レビュー|改善|書き換|書き直|最適化|高速化|デバッグ|バグ)/,
/\b(?:fix|refactor|review|improve|rewrite|optimize|debug|bug)\b/i,
];

export type OriginCodeEquivalenceTargetReason =
/** The publication gate held the answer: the delivered text is the deterministic hold, which carries no replacement code to check. */
| "gate-held"
/** The user's message carries no complete fenced code block, so there is no original to compare against. */
| "no-original-code"
/** The prose asks for no review/rewrite operation on the supplied code (explanation-only included). */
| "not-review-rewrite"
/** The CB-1 self-contained predicate does not hold (no prose reference to the code, or an explicit external-freshness intent the grounded path owns). */
| "not-self-contained"
/** The delivered answer carries no fenced block, so there is no replacement to compare. */
| "no-replacement-code";

export type OriginCodeEquivalenceTargetDecision =
| { targeted: true}
| { targeted: false; reason: OriginCodeEquivalenceTargetReason};

/**
* Whether an exchange is a B-1 target. Deterministic, no model
* call. Known limitation, recorded for the measurement: only the
* last user message is examined, so an original supplied in an
* earlier turn of a multi-turn conversation classifies as
* "no-original-code" even when the answer rewrites it.
*/
export function classifyOriginCodeEquivalenceTarget(input: {
message: string;
answerText: string;
publicationGateHeld: boolean;
}): OriginCodeEquivalenceTargetDecision {
if (input.publicationGateHeld) return { targeted: false, reason: "gate-held"};
const original = extractOriginCodeFences(input.message);
if (original.blocks.length === 0) {
return { targeted: false, reason: "no-original-code"};
}
if (
!CODE_EQUIVALENCE_OPERATION_PATTERNS.some((pattern) => pattern.test(original.prose))
) {
return { targeted: false, reason: "not-review-rewrite"};
}
if (!isSelfContainedCodeTaskRequest(input.message)) {
return { targeted: false, reason: "not-self-contained"};
}
if (extractOriginCodeFences(input.answerText).blocks.length === 0) {
return { targeted: false, reason: "no-replacement-code"};
}
return { targeted: true};
}

// ---------------------------------------------------------------------------
// The verification call: instruction, payload, verdict protocol.
// ---------------------------------------------------------------------------

/**
* The verifier instruction: one shared text for both routes, like
* the answer verification's. The verifier's central discipline is
* identifying the MAIN replacement block — the block presented as
* the replacement for the whole original — rather than judging a
* conditional alternative or a partial fragment: the E-05 defect
* lives exactly in the gap between the two (the equivalent form
* existed in the answer, but not in the main code).
*/
export function buildOriginCodeEquivalenceVerificationInstruction(nowMs: number): string {
return [
"あなたは、別のAIが書いたコードの書き換えを検証する検査者です。自分自身の回答を書いてはいけません。元のコードと、書き換えを含む回答（文章と番号付きコードブロック）が渡されます。",
originCurrentDateInstruction(nowMs, "ja"),
"手順：まず元のコードの実際の振る舞いを、空・欠落・ゼロのケースを含めて追跡してください。次に、回答の中で主たる置き換えとして提示されているコードブロックを特定してください。条件付きの代替案や部分的な断片ではなく、元のコード全体の置き換えとして提示されたブロックです。そのブロックの番号をmainBlockに入れてください（1始まり。特定できなければnull）。",
"主ブロックと元のコードを比較し、あらゆる入力に対する振る舞い（返り値・副作用・例外）が一致するかを判定してください。特に、元のコードが処理している境界ケース（対応する明細行のない行、空のコレクション、null、件数ゼロ）で、置き換えが元のコードと同じ結果を返すかを必ず確認してください。",
"判定は次の3値のいずれかです。equivalent=全てのケースで振る舞いが一致する。non-equivalent=一致しないケースがある。uncertain=判定できない。確信が持てない場合は必ずuncertainに倒してください。",
"non-equivalentの場合は、振る舞いが異なるケースをdifferingCasesに具体的に書いてください（最大5件）。異なるケースを具体的に書けない場合はuncertainにしてください。",
"回答の文章が、置き換えは元のコードと結果が同じだと主張している場合（「結果は同じ」「同一の結果が得られます」等）は、sameResultClaimedをtrueにしてください。",
"出力は次の形式のJSONだけです。前置き・説明・コードフェンスは禁止です。",
"{\"verdict\":\"equivalent\",\"mainBlock\":1,\"differingCases\":[],\"sameResultClaimed\":false}",
].join("\n");
}

/** Builds the single user message carrying the original code and the answer's numbered blocks and prose. */
export function buildOriginCodeEquivalenceVerificationPayload(input: {
message: string;
answerText: string;
}): {
text: string;
originalTruncated: boolean;
blocksTruncated: boolean;
answerBlockCount: number;
includedBlockCount: number;
} {
const originalBlocks = extractOriginCodeFences(input.message).blocks;
const originalJoined = originalBlocks.join("\n");
const originalTruncated = originalJoined.length > ORIGIN_CODE_EQUIVALENCE_ORIGINAL_MAX_CHARS;
const original = originalJoined.slice(0, ORIGIN_CODE_EQUIVALENCE_ORIGINAL_MAX_CHARS);

const answer = extractOriginCodeFences(input.answerText);
const included: string[] = [];
let usedChars = 0;
let blocksTruncated = false;
for (const block of answer.blocks) {
if (included.length >= ORIGIN_CODE_EQUIVALENCE_MAX_BLOCKS) {
blocksTruncated = true;
break;
}
const remaining = ORIGIN_CODE_EQUIVALENCE_BLOCKS_MAX_CHARS - usedChars;
if (remaining <= 0) {
blocksTruncated = true;
break;
}
if (block.length > remaining) {
included.push(block.slice(0, remaining));
usedChars += remaining;
blocksTruncated = true;
break;
}
included.push(block);
usedChars += block.length;
}
if (answer.blocks.length > included.length) blocksTruncated = true;

const prose = answer.prose.trim().slice(0, ORIGIN_CODE_EQUIVALENCE_PROSE_MAX_CHARS);
const parts = ["", original, "", ""];
if (prose.length > 0) parts.push("文章:", prose);
included.forEach((block, position) => {
parts.push("", `[ブロック${position + 1}]`, block);
});
return {
text: parts.join("\n"),
originalTruncated,
blocksTruncated,
answerBlockCount: answer.blocks.length,
includedBlockCount: included.length,
};
}

export type OriginCodeEquivalenceVerdictParseResult =
| {
ok: true;
verdict: OriginCodeEquivalenceVerdictKind;
mainBlockIndex: number | null;
differingCases: string[];
sameResultClaimed: boolean;
}
| { ok: false; reason: "empty-response" | "verdict-parse-failure"};

const EQUIVALENCE_VERDICT_KINDS: ReadonlySet<string> = new Set([
"equivalent",
"non-equivalent",
"uncertain",
]);

function extractJsonValue(text: string): unknown {
const start = text.search(/[{[]/);
if (start < 0) return undefined;
const closer = text[start] === "{"? "}": "]";
const end = text.lastIndexOf(closer);
if (end <= start) return undefined;
try {
return JSON.parse(text.slice(start, end + 1)) as unknown;
} catch {
return undefined;
}
}

/**
* Parses the verifier's verdict JSON. Liberal about framing (code
* fences, surrounding prose) and strict about content, mirroring
* the answer verification's parser. Protocol invariant: a
* "non-equivalent" verdict that names no differing case cannot be
* acted on or measured, so it is recorded as "uncertain" — noted,
* never enforced (the same downgrade the answer verification
* applies to a contradicted verdict without a correction).
*/
export function parseOriginCodeEquivalenceVerdict(
text: string,
): OriginCodeEquivalenceVerdictParseResult {
if (!text || text.trim().length === 0) return { ok: false, reason: "empty-response"};
const root = extractJsonValue(text);
if (root === undefined || root === null || typeof root!== "object" || Array.isArray(root)) {
return { ok: false, reason: "verdict-parse-failure"};
}
const record = root as Record<string, unknown>;
const verdict = record.verdict;
if (typeof verdict!== "string" ||!EQUIVALENCE_VERDICT_KINDS.has(verdict)) {
return { ok: false, reason: "verdict-parse-failure"};
}
const mainBlockRaw = record.mainBlock;
const mainBlockIndex =
typeof mainBlockRaw === "number" && Number.isInteger(mainBlockRaw) && mainBlockRaw >= 1
? mainBlockRaw
: null;
const differingCases: string[] = [];
if (Array.isArray(record.differingCases)) {
for (const entry of record.differingCases) {
if (differingCases.length >= ORIGIN_CODE_EQUIVALENCE_MAX_DIFFERING_CASES) break;
if (typeof entry!== "string") continue;
const trimmed = entry.trim().slice(0, 200);
if (trimmed.length > 0) differingCases.push(trimmed);
}
}
return {
ok: true,
verdict: (verdict === "non-equivalent" && differingCases.length === 0
? "uncertain"
: verdict) as OriginCodeEquivalenceVerdictKind,
mainBlockIndex,
differingCases,
sameResultClaimed: record.sameResultClaimed === true,
};
}

// ---------------------------------------------------------------------------
// The cross-route call.
// ---------------------------------------------------------------------------

class OriginCodeEquivalenceVerificationTimeoutError extends Error {
constructor() {
super("code equivalence verification timed out");
this.name = "OriginCodeEquivalenceVerificationTimeoutError";
}
}

async function withCodeEquivalenceTimeout<T>(
promise: Promise<T>,
timeoutMs: number,
): Promise<T> {
let timer: ReturnType<typeof setTimeout> | undefined;
const timeout = new Promise<never>((_resolve, reject) => {
timer = setTimeout(
() => reject(new OriginCodeEquivalenceVerificationTimeoutError()),
timeoutMs,
);
});
try {
return await Promise.race([promise, timeout]);
} finally {
if (timer!== undefined) clearTimeout(timer);
}
}

function classifyCodeEquivalenceError(
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

/**
* Runs one cross-route equivalence verification. Never throws:
* every failure is a "not-run" result with its kind, so wiring code
* fails open by construction. The verifier route is forced — the
* failover dispatcher is not consulted, so the serving route can
* never be picked as its own verifier. At most one call is made.
*/
export async function verifyOriginCodeEquivalenceCrossRoute(
input: OriginCodeEquivalenceVerificationInput,
options: OriginCodeEquivalenceVerificationOptions = {},
): Promise<OriginCodeEquivalenceVerificationResult> {
const startedAt = Date.now();
const timeoutMs = options.timeoutMs?? ORIGIN_CODE_EQUIVALENCE_VERIFICATION_TIMEOUT_MS;
const nowMs = options.nowMs?? Date.now();
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
): OriginCodeEquivalenceVerificationResult => ({
status: "not-run",
failureKind,
servedRoute,
verifierRoute,
durationMs: Date.now() - startedAt,
...(transportRequestCount!== undefined? { transportRequestCount}: {}),
});

const planSource: OriginExecutionPlan = {...input.sourcePlan, timeoutMs};
const instruction = buildOriginCodeEquivalenceVerificationInstruction(nowMs);
const payload = buildOriginCodeEquivalenceVerificationPayload(input);
const env = options.env?? process.env;
const fetchImpl = options.fetchImpl?? fetch;

try {
let result: OriginProviderExecutionResult;
if (verifierRoute === "cloudflare") {
const planResult = buildOriginCloudflareRoutePlan(planSource, {
cloudflareFreeModelCatalog: options.cloudflareCatalog,
nowMs,
});
if (planResult.ok === false) return notRun("route-unavailable", 0);
const execute = options.cloudflareExecute?? executeOriginCloudflareProvider;
result = await withCodeEquivalenceTimeout(
execute(
{
plan: planResult.plan,
messages: [{ role: "user", content: payload.text}],
systemInstruction: instruction,
cloudflareSystemInstruction: instruction,
},
env,
fetchImpl,
{ catalog: options.cloudflareCatalog, nowMs},
),
timeoutMs,
);
} else {
const planResult = buildOriginGroqRoutePlan(planSource, {
groqFreeModelCatalog: options.groqCatalog,
nowMs,
});
if (planResult.ok === false) return notRun("route-unavailable", 0);
const execute = options.groqExecute?? executeOriginGroqProvider;
result = await withCodeEquivalenceTimeout(
execute(
{
plan: planResult.plan,
messages: [{ role: "user", content: payload.text}],
systemInstruction: instruction,
groqSystemInstruction: instruction,
},
env,
fetchImpl,
{ catalog: options.groqCatalog, nowMs},
),
timeoutMs,
);
}
if (!result.text || result.text.trim().length === 0) {
return notRun("empty-response", result.transportRequestCount);
}
const parsed = parseOriginCodeEquivalenceVerdict(result.text);
if (parsed.ok === false) {
return notRun(
parsed.reason === "empty-response"? "empty-response": "verdict-parse-failure",
result.transportRequestCount,
);
}
return {
status: "completed",
servedRoute,
verifierRoute,
servedModel: servedModel as string,
verifierModel: result.routingEvidence.servedModel,
verdict: parsed.verdict,
mainBlockIndex: parsed.mainBlockIndex,
differingCases: parsed.differingCases,
sameResultClaimed: parsed.sameResultClaimed,
originalTruncated: payload.originalTruncated,
blocksTruncated: payload.blocksTruncated,
answerBlockCount: payload.answerBlockCount,
includedBlockCount: payload.includedBlockCount,
durationMs: Date.now() - startedAt,
transportRequestCount: result.transportRequestCount,
...(result.routingEvidence.neurons!== undefined
? { neurons: result.routingEvidence.neurons}
: {}),
};
} catch (error) {
if (error instanceof OriginCodeEquivalenceVerificationTimeoutError) {
return notRun("timeout");
}
return notRun(classifyCodeEquivalenceError(error));
}
}

// ---------------------------------------------------------------------------
// The shadow runner the routers wire in.
// ---------------------------------------------------------------------------

export interface OriginCodeEquivalenceVerificationShadowInput {
requestId: string;
message: string;
answerText: string;
generationResult: OriginProviderExecutionResult;
sourcePlan: OriginExecutionPlan;
}

export interface OriginCodeEquivalenceVerificationShadowOptions {
env?: NodeJS.ProcessEnv;
nowMs?: number;
/** The verification call itself; injectable for tests. */
verify?: typeof verifyOriginCodeEquivalenceCrossRoute;
/** Extra options forwarded to the verification call (executors, catalogs). */
verifyOptions?: OriginCodeEquivalenceVerificationOptions;
logger?: (message: string, fields: Record<string, unknown>) => void;
}

export interface OriginCodeEquivalenceVerificationShadowOutcome {
configuredMode: OriginCodeEquivalenceVerificationMode;
effectiveMode: "shadow";
status: "completed" | "not-run";
failureKind?: OriginAnswerVerificationFailureKind;
/** The routing-metadata block: kinds and counts only, never code or case text. */
metadata: Record<string, unknown>;
}

/**
* Runs one shadow equivalence verification for a targeted answer
* and records it: the structured log line and the routing metadata
* block carry the same fields — mode, routes, the verdict, the
* main-block index, the differing-case count, the same-result
* claim flag, truncation flags, duration, and the E-series failure
* kind. The delivered answer is never touched. It never throws — a
* plumbing failure degrades to a not-run outcome, because the check
* must never break an answer.
*
* No daily Neuron sub-cap gates this stage (unlike the answer
* verification's class B): the classifier's target slice — fenced
* original plus a review/rewrite operation plus a fenced
* replacement — is narrow by construction, and the reported Neuron
* figure is recorded whenever the verifier route reports one. If
* the CB-8 measurement shows volume or cost pressure, a cap lands
* with the enforcement-stage design.
*/
export async function runOriginCodeEquivalenceVerificationShadow(
input: OriginCodeEquivalenceVerificationShadowInput,
options: OriginCodeEquivalenceVerificationShadowOptions = {},
): Promise<OriginCodeEquivalenceVerificationShadowOutcome> {
const env = options.env?? process.env;
const nowMs = options.nowMs?? Date.now();
const configuredMode = resolveOriginCodeEquivalenceVerificationMode(env);
const logger =
options.logger?? ((message, fields) => console.info(message, fields));
const verify = options.verify?? verifyOriginCodeEquivalenceCrossRoute;
const servedRoute = identifyOriginAnswerServedRoute(
input.generationResult.routingEvidence?.servedModel,
);
const verifierRoute = servedRoute
? originAnswerVerifierRouteFor(servedRoute)
: null;

let result: OriginCodeEquivalenceVerificationResult;
try {
result = await verify(
{
message: input.message,
answerText: input.answerText,
generationResult: input.generationResult,
sourcePlan: input.sourcePlan,
},
{
...options.verifyOptions,
env: options.verifyOptions?.env?? env,
nowMs: options.verifyOptions?.nowMs?? nowMs,
},
);
} catch {
// verifyOriginCodeEquivalenceCrossRoute never throws by
// contract; this is belt-and-braces so shadow plumbing can
// never break an answer.
result = {
status: "not-run",
failureKind: "provider-error",
servedRoute,
verifierRoute,
durationMs: 0,
};
}

const completed = result.status === "completed"? result: null;
const metadata: Record<string, unknown> = {
verificationMode: "shadow",
verificationConfiguredMode: configuredMode,
verificationStatus: result.status,
...(result.status === "not-run"
? { verificationFailureKind: result.failureKind}
: {}),
servedRoute,
verifierRoute,
...(completed
? {
servedModel: completed.servedModel,
verifierModel: completed.verifierModel,
verdict: completed.verdict,
mainBlockIndex: completed.mainBlockIndex,
differingCaseCount: completed.differingCases.length,
sameResultClaimed: completed.sameResultClaimed,
answerBlockCount: completed.answerBlockCount,
includedBlockCount: completed.includedBlockCount,
originalTruncated: completed.originalTruncated,
blocksTruncated: completed.blocksTruncated,
...(completed.neurons!== undefined
? { verifierNeurons: completed.neurons}
: {}),
}
: {}),
appliedAction: "none",
verificationDurationMs: result.durationMs,
...(result.transportRequestCount!== undefined
? { verifierTransportRequests: result.transportRequestCount}
: {}),
};
try {
logger("[origin-chat] code equivalence verification", {
requestId: input.requestId,
...metadata,
});
} catch {
// A failing logger must never break or delay the answer.
}
return {
configuredMode,
effectiveMode: "shadow",
status: result.status,
...(result.status === "not-run"? { failureKind: result.failureKind}: {}),
metadata,
};
}
