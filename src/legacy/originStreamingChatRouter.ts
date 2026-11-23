import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { DEFAULT_ORIGIN_CONTEXT_POLICY, minimizeOriginContext, type OriginContextPolicy } from "../lib/orchestration/OriginContextPolicy.js";
import { buildOriginExecutionPlan } from "../lib/orchestration/OriginExecutionPolicy.js";
import type { OriginFreeModelEvidence } from "../lib/orchestration/OriginFreeModelCatalog.js";
import { decideOriginReviewForMessage } from "../lib/orchestration/OriginReviewPolicy.js";
import { classifyOriginRequestIntent, originIntentInputFromContext, type OriginRequestIntent } from "../lib/orchestration/OriginRequestIntent.js";
import { buildOriginAgentWorkPlan, type OriginAgentWorkPlan } from "../lib/orchestration/OriginAgentWorkPlan.js";
import { isOriginCapabilityQuestion } from "../lib/orchestration/OriginCapabilityGuide.js";
import { originAnswerQualityInstruction, resolveOriginAnswerQualityPolicy } from "../lib/orchestration/OriginAnswerQualityPolicy.js";
import {
  applyOriginBusinessPlanningAuditGate,
  logOriginBusinessPlanningAuditShadow,
  resolveOriginBusinessPlanningAuditMode,
  type OriginBusinessPlanningAuditGateOutcome,
} from "../lib/orchestration/OriginBusinessPlanningAudit.js";
import { resolveOriginAgentWorkPlan, type OriginResolvedWorkPlan } from "../lib/orchestration/OriginServiceRegistry.js";
import {
  applyOriginPublicationGate,
  logOriginPublicationGateShadow,
  publicationGateFiringKinds,
  resolveOriginPublicationGateMode,
  type OriginPublicationGateOutcome,
  type OriginPublicationGateSummary,
} from "../lib/orchestration/OriginPublicationGate.js";
import {
  applyOriginDateWeekdayVerificationGate,
  logOriginDateWeekdayVerificationShadow,
  originDateWeekdayVerificationMayApply,
  resolveOriginDateWeekdayVerificationMode,
  type OriginDateWeekdayVerificationOutcome,
} from "../lib/orchestration/OriginDateWeekdayVerification.js";
import { buildOriginProviderFailureDiagnostic, OriginProviderError, type OriginProviderExecutionRequest } from "./originProviderClient.js";
import { type OriginProviderStreamExecutor, type OriginProviderStreamHandlers } from "./originProviderStreamClient.js";
import {
  analyzeRefusalLikeOutput,
  resolveRecoveryRefusalValidationMode,
  RECOVERY_REFUSAL_RETRY_INSTRUCTION,
} from "../research/groundedResearchRefusalValidation.js";
import { executeOriginProviderStreamWithFailover } from "./originProviderFailover.js";
import {
  classifyDirectAnswerVerificationTarget,
  resolveOriginAnswerVerificationEffectiveMode,
  runOriginAnswerVerificationShadow,
  verifyOriginAnswerCrossRoute,
  type OriginAnswerVerificationDailyUsageReader,
} from "./originAnswerVerification.js";
import {
  planOriginPremiseGuard,
  resolveOriginIntentPremiseGuardEffectiveMode,
  runOriginIntentPremiseGuardShadow,
} from "./originIntentPremiseGuard.js";
import { applyOriginUngroundedAssertionGate, originAnswerNeedsAssertionGate, originChatSystemInstruction, originCloudflareRouteSystemInstruction, originCurrentDateInstruction, originGroqRouteSystemInstruction, requiresOriginGroundedResearchRouted } from "./originChatResponsePolicy.js";
import {
  buildProposalDeckChatArtifact,
  isProposalDeckChatRequest,
  PROPOSAL_DECK_FAILURE_NOTE,
  PROPOSAL_DECK_SKELETON_INSTRUCTION,
} from "./originProposalDeckChat.js";
import {
  buildDeckRecordsChatArtifact,
  isDeckRecordsEnabled,
  isProposalDeckRecordsChatRequest,
  matchesDeckRecordsRequestText,
  planDeckRecordsRequest,
  type DeckRecordsRequestPlan,
  type DeckRecordsStageMetrics,
} from "./originProposalDeckRecordsChat.js";
import type { ProposalDeckAnswerShape } from "../artifacts/proposalDeckFailureShapeV1.js";
import type { OriginSupervisorArtifactPayloadV2 } from "../lib/orchestration/OriginSupervisorV2.js";
import {
  isOriginWeatherRequest,
  originClientPolicy,
  screenConversationForSend,
  type OriginChatBody,
  validateOriginChatMessages,
} from "./originChatValidation.js";

export interface OriginStreamingChatRouterOptions {
  env?: NodeJS.ProcessEnv;
  streamExecute?: OriginProviderStreamExecutor;
  answerVerification?: { verify?: typeof verifyOriginAnswerCrossRoute; readDailyNeuronsUsed?: OriginAnswerVerificationDailyUsageReader };
  now?: () => number;
  catalogNow?: () => number;
  freeModelCatalog?: readonly OriginFreeModelEvidence[];
  contextPolicy?: OriginContextPolicy;
  createRequestId?: () => string;
}

const MAX_PROVIDER_ATTEMPT_TIMEOUT_MS = 52_000;

function requiresGroundedResearch(message: string, env?: NodeJS.ProcessEnv): boolean { return requiresOriginGroundedResearchRouted(message, { env }); }

function systemInstruction(
  intent?: OriginRequestIntent,
  workPlan?: OriginAgentWorkPlan,
  resolvedPlan?: OriginResolvedWorkPlan,
  qualityInstruction?: string,
): string {
  return originChatSystemInstruction(intent, workPlan, resolvedPlan, qualityInstruction);
}

function wantsUpstreamStreaming(req: Request): boolean {
  return String(req.headers.accept ?? "").toLowerCase().includes("text/event-stream");
}

function sendSafeProviderFailure(res: Response, error: OriginProviderError, requestId: string) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(error.status).json({
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    retryAfterSeconds: error.retryAfterSeconds,
    requestId,
    retryAttempted: false,
    diagnostic: buildOriginProviderFailureDiagnostic(error),
  });
}

export function createOriginStreamingChatRouter(options: OriginStreamingChatRouterOptions = {}) {
  const router = Router();
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const catalogNow = options.catalogNow ?? Date.now;
  const contextPolicy = options.contextPolicy ?? DEFAULT_ORIGIN_CONTEXT_POLICY;
  const createRequestId = options.createRequestId ?? (() => `origin-stream-${now()}-${randomUUID()}`);
  const streamExecute = options.streamExecute ?? ((request, handlers) => executeOriginProviderStreamWithFailover(request, handlers, env));

  router.post("/api/chat", async (req, res, next: NextFunction) => {
    if (!wantsUpstreamStreaming(req)) return next();

    const body = (req.body ?? {}) as OriginChatBody;
    const messages = validateOriginChatMessages(body.messages);
    if (!messages || messages.at(-1)?.role !== "user") return next();

    const lastUserMessage = messages.at(-1)?.content ?? "";
    // S-1b: the shared structured screen decides. A blocked screen keeps
    // delegating to the non-streaming router, which answers the same 422;
    // a sanitized screen continues here on the single redacted copy.
    const screenResult = screenConversationForSend(messages);
    // DG-1 修正（原因3）: 資料レコード経路が ON のとき、資料化依頼は
    // 鮮度要求として調査経路へ振り分けず、本ルーターの資料経路で
    // 処理する（DG-1 の S-3・S-4 は素材つき資料化依頼が調査経路に
    // 振り分けられて棄権した）。OFF の間は判定自体を行わず、現行の
    // 振り分けと完全に同一に保つ。
    const deckRecordsRequest = isDeckRecordsEnabled(env)
      && matchesDeckRecordsRequestText(lastUserMessage);
    if (isOriginWeatherRequest(lastUserMessage)
      || isOriginCapabilityQuestion(lastUserMessage)
      || (requiresGroundedResearch(lastUserMessage, env) && !deckRecordsRequest)
      || screenResult.outcome === "blocked") {
      return next();
    }

    const contextResult = minimizeOriginContext(screenResult.messages, contextPolicy);
    if (contextResult.ok === false) return next();

    const planningResult = buildOriginExecutionPlan(
      {
        goal: lastUserMessage.trim(),
        requiresCodeChanges: /実装|修正|コード|implement|fix/i.test(lastUserMessage),
        requiresFreshResearch: false,
        containsSecrets: false,
      },
      { openRouterConfigured: Boolean(env.OPENROUTER_API_KEY) },
      originClientPolicy(body),
      { freeModelCatalog: options.freeModelCatalog, nowMs: catalogNow() },
    );
    if (planningResult.ok === false) return next();

    const requestId = createRequestId();
    const startedAt = now();
    if (screenResult.outcome === "sanitized") console.info("[origin-chat] sensitive input redacted from assistant history", { requestId, sensitiveKinds: screenResult.redactedKinds, redactionCount: screenResult.redactionCount, attribution: "assistant" });
    let downstreamStarted = false;
    let providerDeltaCount = 0;
    // Stage timing (speed measurement 2026-11-16): when the first answer
    // text actually reached the client. Buffered paths (assertion gate,
    // deck records) release text only at completion, so this is the
    // perceived wait; it is logged as a number only, never the text.
    let firstDeltaAtMs: number | null = null;

    try {
      const intentInput = originIntentInputFromContext(contextResult.window.messages);
      const requestIntent = classifyOriginRequestIntent(intentInput, planningResult.plan.taskType);
      // PR-3a: proposal/presentation requests additionally carry the fixed
      // deck skeleton in the (routes 1-2) system instruction so the single
      // ordinary generation can be converted into a deck afterwards. The
      // compact Groq instruction is deliberately left untouched (its
      // 2,000-4,800 character budget is a hard contract); a route-3 answer
      // simply will not match the skeleton and produces no file.
      // DG-1 修正（原因4）: 資料レコード経路が ON のときは、判定に
      // レコード経路専用の拡張（資料の種別語＋作成依頼の動詞句）を
      // 重ねる。OFF の間は現行判定だけであり、挙動は変わらない。
      const deckRequested = isDeckRecordsEnabled(env)
        ? isProposalDeckRecordsChatRequest(requestIntent, intentInput, lastUserMessage)
        : isProposalDeckChatRequest(requestIntent, intentInput);
      // D-PR-6: with the deck-records kill switch ON, a proposal-deck
      // request takes the records path instead of the skeleton path.
      // The plan is computed before generation (mode detection; for
      // mode A the deterministic placement is already attempted) and
      // decides which instruction the generation carries: the draft
      // instruction (mode B), the placement instruction plus the
      // material list (mode A, deterministic placement insufficient),
      // or none (mode A, deterministic placement already satisfied —
      // the generated text is then not used for the deck at all).
      // With the switch OFF the plan is null and everything below is
      // byte-identical to the pre-D-PR-6 behavior.
      const deckRecordsPlan: DeckRecordsRequestPlan | null =
        deckRequested && isDeckRecordsEnabled(env)
          ? planDeckRecordsRequest(lastUserMessage)
          : null;
      const deckInstruction = deckRecordsPlan
        ? deckRecordsPlan.instruction
        : PROPOSAL_DECK_SKELETON_INSTRUCTION;
      const workPlan = buildOriginAgentWorkPlan(requestIntent);
      const resolvedPlan = resolveOriginAgentWorkPlan(workPlan);
      const reviewDecision = decideOriginReviewForMessage(planningResult.plan.taskType, lastUserMessage);
      const answerQualityPolicy = resolveOriginAnswerQualityPolicy({
        intent: requestIntent,
        taskType: planningResult.plan.taskType,
        independentReviewRequired: reviewDecision.required,
        promptText: intentInput,
      });
      const fullSystemInstruction = systemInstruction(
        requestIntent,
        workPlan,
        resolvedPlan,
        originAnswerQualityInstruction(answerQualityPolicy),
      )
        + `\n\n${originCurrentDateInstruction(now(), /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en")}`
        + (deckRequested && deckInstruction ? `\n\n${deckInstruction}` : "");
      // Intent premise guard (I5-PR2, shadow; design sections
      // 3.2-3.3): the premise ledger block — the conversation's
      // operative premises restated as a structured addendum — is
      // appended to every route's instruction (full, route-2 and
      // route-3 compact alike; the block is a dynamic addendum under
      // its own caps in the guard module, not part of the compact
      // base's character contract). Deck paths stay out of scope,
      // exactly as they are for the guard's checks below. Mode off
      // (the default) computes no plan and the instructions are
      // exactly as before; an empty ledger appends nothing.
      const premiseGuardPlan = resolveOriginIntentPremiseGuardEffectiveMode(env) === "shadow" && !deckRequested
        ? planOriginPremiseGuard({ messages, nowMs: now() })
        : null;
      const premiseGuardBlockSuffix = premiseGuardPlan?.block ? `\n\n${premiseGuardPlan.block.text}` : "";
      // DG-1 修正（原因1）: 資料レコード経路の配置・起草指示は、
      // 経路1・2の指示（fullSystemInstruction）には従来どおり乗り
      // るが、経路3（Groq）の固定コンパクト指示には乗らず、DG-1 で
      // 経路3が応答した S-1・S-2 が配置も起草もできないまま
      // insufficient になった。ここではレコード経路の計画がある
      // ときだけ、その指示を動的付加としてコンパクト基底の後ろに
      // 足す（前提ガードのブロックと同じ運搬方式。固定基底の文字数
      // 契約には触れない）。計画が無い（スイッチ OFF・通常依頼・
      // 旧骨格経路）ときは空文字列であり、経路3の指示は従来と
      // バイト単位で同一になる。
      const deckRecordsGroqSuffix = deckRecordsPlan?.instruction
        ? `\n\n${deckRecordsPlan.instruction}`
        : "";
      const providerRequest: OriginProviderExecutionRequest = {
        plan: {
          ...planningResult.plan,
          timeoutMs: Math.min(planningResult.plan.timeoutMs, MAX_PROVIDER_ATTEMPT_TIMEOUT_MS),
        },
        messages: contextResult.window.messages,
        systemInstruction: fullSystemInstruction + premiseGuardBlockSuffix,
        cloudflareSystemInstruction: originCloudflareRouteSystemInstruction(fullSystemInstruction) + premiseGuardBlockSuffix,
        groqSystemInstruction: originGroqRouteSystemInstruction(answerQualityPolicy.businessPlanning) + premiseGuardBlockSuffix + deckRecordsGroqSuffix,
        // Progressive display for responses that need no verification: the
        // upstream executor forwards each fragment as it is generated (after
        // that fragment's own routing/billing checks), so the first characters
        // appear within seconds instead of after the full generation. Requests
        // the review policy flags keep the original behavior — no text is
        // released until the stream terminates and every check has passed.
        // Admission is unchanged either way: the client still accepts the
        // answer only on the verified completion event below.
        streamRelease: reviewDecision.required ? "hold-until-verified" : "incremental",
      };

      // Assertion gate arming (S-PR-1 output side): when the question
      // touches a volatile fact, streamed deltas are buffered instead of
      // forwarded, so the deterministic gate can reject an ungrounded
      // current-form assertion before any of it reaches the client. A
      // passing answer is flushed in order once the stream completes;
      // questions outside the volatile set keep the original progressive
      // forwarding untouched.
      const assertionGateArmed = originAnswerNeedsAssertionGate(lastUserMessage);
      // Numeric audit gate, stage 2 (enforcement): with
      // ORIGIN_BUSINESS_PLANNING_AUDIT_MODE=enforce, a planning/marketing
      // answer is buffered like an assertion-gated one so the
      // deterministic audit can correct figures and append its
      // disclosure note before anything is released; the enforced text
      // is emitted once at completion (the trade-off is that planning
      // answers lose progressive display while the mode is on). In
      // shadow mode (the default) nothing is buffered here and the
      // audit stays the log-only hook below. Deck paths are outside the
      // audit's scope, exactly as in shadow mode.
      const auditGateArmed =
        resolveOriginBusinessPlanningAuditMode(env) === "enforce" &&
        Boolean(answerQualityPolicy.businessPlanning) &&
        !deckRequested &&
        !deckRecordsPlan;
      // Publication gate, stage 2 (enforcement connection, N-5b): with
      // ORIGIN_PUBLICATION_GATE_MODE=enforce, every non-deck direct
      // answer is buffered like an assertion-gated one so the
      // deterministic gate can hold an answer carrying an
      // evidence-required claim (an unverified statute name, an
      // enforcement date, a statutory capacity, an age condition, a
      // position/status assertion — never an amount alone) before any
      // of it reaches the client; the held answer is replaced by the
      // tier-T4 hold text. In shadow mode (the default) nothing is
      // buffered here and the gate stays the log-only hook below.
      // Deck paths stay out of scope, exactly as in shadow mode.
      const publicationGateArmed =
        resolveOriginPublicationGateMode(env) === "enforce" &&
        !deckRequested &&
        !deckRecordsPlan;
      // Date/weekday verification, enforcement: with
      // ORIGIN_DATE_WEEKDAY_VERIFICATION_MODE=enforce, an answer to a
      // date-bearing question (a date expression, an N日後/日前
      // offset, or a weekday question) is buffered like an
      // assertion-gated one so the deterministic verifier can correct
      // date/weekday errors before anything is released. Questions
      // without date material keep progressive streaming; their
      // answers are still detection-logged by the shadow hook below.
      // In shadow mode (the default) nothing is buffered here.
      const dateGateArmed =
        resolveOriginDateWeekdayVerificationMode(env) === "enforce" &&
        !deckRequested &&
        !deckRecordsPlan &&
        originDateWeekdayVerificationMayApply(lastUserMessage);
      // Answer verification, shadow (V-PR-3; design sections 3-5):
      // the class-A core — an answer the review policy requires an
      // independent check for — joins the buffer-armed set, so the
      // completion-time cross-route check below runs on text that has
      // not been released yet, under exactly the trade-off the
      // existing gates already make (a buffered answer loses
      // progressive display; the delivered bytes never change).
      // Class-B answers are not armed: they keep incremental display
      // and only their completion event waits for the check (design
      // section 5.1). Mode off (the default) arms nothing and the
      // router behaves exactly as before; the enforce value resolves
      // to shadow until V-PR-4, exactly as in the blocking router.
      const answerVerificationArmed =
        resolveOriginAnswerVerificationEffectiveMode(env) === "shadow" &&
        reviewDecision.required &&
        !deckRequested &&
        !deckRecordsPlan;
      // Intent premise guard arming (I5-PR2, shadow; design section
      // 3.3): a turn the deterministic arming decision flags — the
      // conversation carries a correction, or the latest user turn
      // asserts a rate for a stable-fact registry concept — joins
      // the buffer-armed set below, under the same trade-off the
      // existing gates make (a buffered answer loses progressive
      // display; the delivered bytes never change). This is what
      // lets a later enforce step (I5-PR3) intervene before release
      // on exactly these turns. The refusal-retry buffered set is
      // the recovery track's own scope and is deliberately not
      // extended here.
      const premiseGuardArmed =
        premiseGuardPlan !== null &&
        premiseGuardPlan.arming.armed &&
        !deckRequested &&
        !deckRecordsPlan;
      const bufferedDeltas: string[] = [];
      const emitDelta = (delta: string) => {
        if (!downstreamStarted) {
          downstreamStarted = true;
          res.status(200);
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-store, no-transform");
          res.setHeader("X-Accel-Buffering", "no");
          res.setHeader("X-Origin-Free-Only", "true");
          res.setHeader("X-Origin-Cost-Evidence", "NOT_MEASURED");
          res.setHeader("X-Origin-Model-Id", planningResult.plan.modelId);
          res.setHeader("X-Origin-Stream-Source", "upstream");
          res.setHeader("X-Origin-Stream-Protocol", "origin-verified-sse-v1");
          res.flushHeaders?.();
        }
        if (firstDeltaAtMs === null) firstDeltaAtMs = now();
        providerDeltaCount += 1;
        res.write(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`);
      };

      const streamHandlers: OriginProviderStreamHandlers = {
        onDelta: (delta) => {
          if (!delta) return;
          // D-PR-6: on the records path the raw generation (a tag
          // draft or a placement plan) is never shown as-is; deltas
          // are buffered like the assertion-gate ones and replaced
          // after completion by the deterministic chat rendering
          // (design §5, §13-5 (a): hold until complete).
          if (assertionGateArmed || deckRecordsPlan || auditGateArmed || publicationGateArmed || dateGateArmed || answerVerificationArmed || premiseGuardArmed) {
            bufferedDeltas.push(delta);
            return;
          }
          emitDelta(delta);
        },
      };
      const result = await streamExecute(providerRequest, streamHandlers);

      if (!result.text.trim()) {
        throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
      }
      // PR-5: the result the gates and the delivery below consume.
      // It stays the first execution's result unless the bounded
      // refusal retry adopts its re-execution (see below); the
      // canonical first call above keeps its shape deliberately.
      let adoptedResult = result;

      // Recovery build Stage 1, PR-5: refusal output validation
      // with ONE bounded re-execution (J-05). A streamed answer can
      // be re-executed only when nothing has reached the client yet
      // — i.e. when one of the gates armed the buffered delivery
      // above (in production the publication gate's enforce mode
      // buffers every non-deck direct answer). On an incrementally
      // released stream the refusal is already on the user's
      // screen and the retry does not apply, exactly as the design
      // bounds it. The retry carries the design's fixed minimal
      // instruction (the compact route-3 instruction is left
      // untouched, as in the non-streaming router); its output
      // replaces the original only when it is not itself
      // refusal-like, and a failed or refused retry restores the
      // original text AND its buffered deltas, so the gates below
      // see exactly the first answer (never worse). Deck paths are
      // out of scope: their raw generation is a draft/placement,
      // not an answer. Switch ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE:
      // off (default) does nothing; shadow logs the detection only;
      // enforce runs the single retry.
      const refusalValidationMode = resolveRecoveryRefusalValidationMode(env);
      const refusalRetryBuffered = assertionGateArmed || auditGateArmed || publicationGateArmed || dateGateArmed;
      if (refusalValidationMode !== "off" && refusalRetryBuffered && !deckRequested && !deckRecordsPlan) {
        const streamLanguage = /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en";
        const refusalAnalysis = analyzeRefusalLikeOutput(result.text, streamLanguage);
        if (refusalAnalysis.isRefusal) {
          console.info("[origin-chat] recovery refusal validation", {
            requestId,
            recoveryRefusalSite: "direct-stream",
            recoveryRefusalMode: refusalValidationMode,
            recoveryRefusalKind: "direct-retry",
            recoveryRefusalTooShort: refusalAnalysis.signals.tooShort,
            recoveryRefusalLanguageMismatch: refusalAnalysis.signals.languageMismatch,
            recoveryRefusalFired: refusalValidationMode === "enforce",
          });
          if (refusalValidationMode === "enforce") {
            const firstAttemptDeltas = bufferedDeltas.slice();
            try {
              bufferedDeltas.length = 0;
              const retryResult = await streamExecute(
                {
                  ...providerRequest,
                  systemInstruction: `${providerRequest.systemInstruction}\n\n${RECOVERY_REFUSAL_RETRY_INSTRUCTION}`,
                  cloudflareSystemInstruction: providerRequest.cloudflareSystemInstruction
                    ? `${providerRequest.cloudflareSystemInstruction}\n\n${RECOVERY_REFUSAL_RETRY_INSTRUCTION}`
                    : providerRequest.cloudflareSystemInstruction,
                },
                streamHandlers,
              );
              if (retryResult.text.trim() && !analyzeRefusalLikeOutput(retryResult.text, streamLanguage).isRefusal) {
                adoptedResult = retryResult;
                console.info("[origin-chat] recovery refusal retry adopted", { requestId });
              } else {
                bufferedDeltas.length = 0;
                bufferedDeltas.push(...firstAttemptDeltas);
                console.info("[origin-chat] recovery refusal retry also refusal-like; original kept", { requestId });
              }
            } catch {
              bufferedDeltas.length = 0;
              bufferedDeltas.push(...firstAttemptDeltas);
              console.warn("[origin-chat] recovery refusal retry failed; original kept", { requestId });
            }
          }
        }
      }
      let assertionGateReplaced = false;
      let auditGateOutcome: OriginBusinessPlanningAuditGateOutcome | null = null;
      let publicationGateOutcome: OriginPublicationGateOutcome | null = null;
      let dateGateOutcome: OriginDateWeekdayVerificationOutcome | null = null;
      // Publication gate, stage 1 shadow (EXTERNAL_CONSULT_STALE_ADOPTION
      // _2026-11-17 adoptions 1–2): the exact text this branch delivers
      // as the answer body, captured for the log-only detector below.
      // Deck paths replace the body with their own deterministic
      // rendering and stay out of scope (null), exactly as they are for
      // the numeric audit gate.
      let publicationGateAnswerText: string | null = null;
      // The publication gate's shadow summary for the delivered text,
      // captured from the log-only hook below so the answer
      // verification targeting can tell whether the gate fired on
      // this answer (a class-A signal) without re-running detection.
      let publicationGateShadowSummary: OriginPublicationGateSummary | null = null;
      // PR-3a / D-PR-6 deck outcomes, filled by whichever deck path
      // runs below and consumed by the completion log and event.
      let deckArtifact: OriginSupervisorArtifactPayloadV2 | undefined;
      let deckFailureCode: string | undefined;
      let deckViolationCodes: readonly string[] | undefined;
      let deckFailureShape: ProposalDeckAnswerShape | undefined;
      let deckRecordsMetrics: DeckRecordsStageMetrics | undefined;
      if (deckRecordsPlan) {
        // D-PR-6 records path: assemble → convert → render from the
        // finished generation (mode B draft / mode A placement) or
        // from the pre-generation deterministic assembly (mode A).
        // The chat body is the deterministic rendering of the
        // assembled document (or the insufficiency / failure text),
        // emitted as a single delta in place of the buffered raw
        // generation. On failure of the new path there is no fallback
        // to the skeleton path (fail-closed, adjudication §13-2 (a)).
        const outcome = buildDeckRecordsChatArtifact({
          requestText: lastUserMessage,
          answerText: adoptedResult.text,
          plan: deckRecordsPlan,
          durationMs: Math.max(0, now() - startedAt),
        });
        deckRecordsMetrics = outcome.metrics;
        if (outcome.status === "created") {
          deckArtifact = outcome.artifact;
        } else if (outcome.status === "failed") {
          deckFailureCode = outcome.failureCode;
          deckViolationCodes = outcome.violationCodes;
        }
        emitDelta(outcome.chatText);
      } else if (assertionGateArmed || auditGateArmed || publicationGateArmed || dateGateArmed || answerVerificationArmed || premiseGuardArmed) {
        const assertionGate = assertionGateArmed
          ? applyOriginUngroundedAssertionGate(lastUserMessage, adoptedResult.text, false)
          : { replaced: false, text: adoptedResult.text };
        assertionGateReplaced = assertionGate.replaced;
        // The text the earlier gates leave for delivery, and whether
        // delivering it means flushing the buffered deltas in order
        // (no earlier gate rewrote the text) or emitting it once.
        let gatedText: string;
        let flushBuffered = false;
        if (assertionGate.replaced) {
          gatedText = assertionGate.text;
        } else if (auditGateArmed) {
          auditGateOutcome = applyOriginBusinessPlanningAuditGate({
            requestId,
            profile: answerQualityPolicy.businessPlanning,
            answerText: adoptedResult.text,
            requestText: lastUserMessage,
            env,
            now: new Date(now()),
            language: /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
          });
          gatedText = auditGateOutcome.answerText;
        } else {
          gatedText = adoptedResult.text;
          flushBuffered = true;
        }
        // Date/weekday verification runs on the text the earlier
        // gates decided to deliver (or on the raw answer when none of
        // them fired), before the publication gate sees it — the same
        // relative order as the non-streaming router, where the
        // publication gate scans the date-verified text. The gate's
        // answer text is emitted once by the delivery logic below
        // (never flushed from the buffered deltas), exactly as the
        // pre-merge branch delivered a date-gated answer.
        if (dateGateArmed) {
          dateGateOutcome = applyOriginDateWeekdayVerificationGate({
            requestId,
            answerText: gatedText,
            requestText: lastUserMessage,
            env,
            now: new Date(now()),
          });
          gatedText = dateGateOutcome.answerText;
          flushBuffered = false;
        }
        if (publicationGateArmed) {
          // Stage-2 enforcement runs on the exact text that would be
          // delivered: a firing gate replaces it with the tier-T4 hold
          // before anything is emitted; a passing answer is delivered
          // exactly as the earlier gates left it.
          publicationGateOutcome = applyOriginPublicationGate({
            requestId,
            answerText: gatedText,
            query: lastUserMessage,
            language: /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
            env,
          });
          publicationGateAnswerText = publicationGateOutcome.answerText;
          if (publicationGateOutcome.held) {
            emitDelta(publicationGateOutcome.answerText);
          } else if (flushBuffered) {
            for (const buffered of bufferedDeltas) emitDelta(buffered);
          } else {
            emitDelta(publicationGateOutcome.answerText);
          }
        } else {
          publicationGateAnswerText = gatedText;
          if (flushBuffered) {
            for (const buffered of bufferedDeltas) emitDelta(buffered);
          } else {
            emitDelta(gatedText);
          }
        }
      } else if (!deckRequested) {
        // Plain incremental streaming: the delivered body is the model
        // answer itself, already forwarded delta by delta above.
        publicationGateAnswerText = adoptedResult.text;
      }
      if (!downstreamStarted) {
        throw new OriginProviderError("PROVIDER_INVALID_RESPONSE", "無料AIから有効な応答を取得できません。", 502, true);
      }
      // A truncated result (PKG-2) is a completed exchange with an incomplete
      // answer: the log records the fact so the measurement track (PKG-9) can
      // count truncation rates, and the completion event carries the flag so
      // the client keeps the displayed partial text and appends the explicit
      // incomplete notice instead of treating the answer as finished.
      // PR-3a: for a proposal-deck request, convert the finished answer into
      // a PPTX artifact deterministically (skeleton parse → build → self-check
      // → render; no extra model call, $0). On any failure no file is attached
      // and a short note rides as a final delta instead, so the user can tell
      // the file was not produced. The artifact payload matches the
      // Supervisor/parseOriginArtifacts contract verbatim and is added as the
      // last key of the completion event; non-deck completions stay
      // byte-identical to before. D-PR-6: this skeleton path runs only
      // when the deck-records kill switch is OFF; the records path
      // above already filled the same outcome fields when it is ON.
      if (deckRequested && !deckRecordsPlan) {
        const outcome = buildProposalDeckChatArtifact(adoptedResult.text);
        if (outcome.status === "created") {
          deckArtifact = outcome.artifact;
        } else {
          deckFailureCode = outcome.failureCode;
          deckViolationCodes = outcome.violationCodes;
          deckFailureShape = outcome.failureShape;
        }
      }
      // Numeric audit gate: when the delivered chat text is exactly the
      // model answer (no deck path replaced it and the assertion gate
      // did not rewrite it), a planning/marketing answer is re-checked
      // deterministically. In shadow mode (default) the outcome is only
      // logged — delivery is never altered by the audit. In enforce
      // mode the gate already ran in the buffered branch above and the
      // enforced text was emitted there, so this log-only hook is
      // skipped to avoid counting the same answer twice.
      if (!deckRecordsPlan && !deckRequested && !assertionGateReplaced && !auditGateArmed) {
        logOriginBusinessPlanningAuditShadow({ requestId, profile: answerQualityPolicy.businessPlanning, answerText: adoptedResult.text, requestText: lastUserMessage });
      }
      // Publication gate, stage 1 shadow: scan the delivered direct
      // answer for evidence-required claim shapes and check its statute
      // names against the bundled e-Gov list. Log-only — kinds and
      // counts, never text — and the delivered stream above is never
      // altered by it. Runs on every non-deck direct answer (including
      // assertion-gate and audit-gate deliveries, whose final text is
      // what the user actually receives), so the shadow counts measure
      // the delivered surface, not the raw model output. In enforce
      // mode the gate already ran (and logged) in the buffered branch
      // above, so this hook is skipped to avoid counting the same
      // answer twice — the same treatment as the audit gate's hook.
      if (publicationGateAnswerText !== null && !deckRequested && publicationGateOutcome === null) {
        publicationGateShadowSummary = logOriginPublicationGateShadow({ requestId, answerText: publicationGateAnswerText });
      }
      // Date/weekday verification, log-only hook: when the enforce
      // gate in the buffered branch already processed this answer it
      // logged its own summary, so this detection runs only for
      // deliveries the gate did not touch (shadow mode generally, or
      // enforce mode on a question the arming heuristic left
      // streaming). Counts and codes only, never text; the delivered
      // stream above is never altered by it.
      if (publicationGateAnswerText !== null && !deckRequested && dateGateOutcome === null) {
        logOriginDateWeekdayVerificationShadow({
          requestId,
          answerText: publicationGateAnswerText,
          questionText: lastUserMessage,
          env,
          now: new Date(now()),
        });
      }
      // Answer verification (V-PR-3, shadow; design sections 3-5):
      // after every deterministic gate has settled the delivered
      // text, the OTHER production route cross-checks the answer and
      // the outcome is recorded — the structured log the runner emits
      // and the metadata block on the completion log and event below.
      // Shadow never changes the delivered stream: the delta events
      // above are exactly what mode off would have sent, and only the
      // completion event waits for the check. Targeting mirrors the
      // blocking router (V-PR-2): class A is a review-required answer
      // or one the publication gate fired on (the enforce outcome's
      // summary, or the shadow summary captured above); a gate-held
      // answer is not a target, and deck paths stay out of scope —
      // their delivered text is a deterministic rendering, not the
      // model answer. The runner never throws, so a broken check
      // degrades to a recorded not-run and the stream completes
      // exactly as before (fail open, design D5).
      let answerVerification: Record<string, unknown> | null = null;
      if (
        resolveOriginAnswerVerificationEffectiveMode(env) === "shadow" &&
        publicationGateAnswerText !== null &&
        !deckRequested &&
        !deckRecordsPlan
      ) {
        const publicationGateSummary = publicationGateOutcome
          ? publicationGateOutcome.summary
          : publicationGateShadowSummary;
        const publicationGateFired = publicationGateSummary !== null
          && (publicationGateFiringKinds(publicationGateSummary).length > 0
            || publicationGateSummary.counts["official-price"] > 0);
        const verificationTarget = classifyDirectAnswerVerificationTarget({
          reviewRequired: reviewDecision.required,
          publicationGateFired,
          publicationGateHeld: publicationGateOutcome?.held === true,
        });
        if (verificationTarget.targeted) {
          const verificationOutcome = await runOriginAnswerVerificationShadow({
            requestId,
            path: "direct",
            answerClass: verificationTarget.answerClass,
            question: lastUserMessage,
            answerText: publicationGateAnswerText,
            generationResult: adoptedResult,
            sourcePlan: providerRequest.plan,
            language: /[ぁ-んァ-ヶ一-龠]/.test(lastUserMessage) ? "ja" : "en",
          }, { env, nowMs: now(), verify: options.answerVerification?.verify, readDailyNeuronsUsed: options.answerVerification?.readDailyNeuronsUsed });
          answerVerification = verificationOutcome.metadata;
        }
      }
      // Intent premise guard (I5-PR1/PR2, shadow; design
      // INTENT_I5_DESIGN sections 3-4): the same deterministic
      // ledger checks as the blocking router — C-1 old-value reuse,
      // C-2 stable-fact applied value, C-4 fabricated-citation form
      // — over the delivered text. The I-1 measurement runner uses
      // this streaming path, so this wiring is what makes the guard
      // observable in R4. Shadow only logs and never alters the
      // text; on an armed turn (PR2) the stream above was buffered
      // before release, but the delivered bytes are exactly what
      // mode off would have sent. Gate-held answers and deck paths
      // stay out of scope, mirroring the verification block above.
      if (
        resolveOriginIntentPremiseGuardEffectiveMode(env) === "shadow" &&
        publicationGateAnswerText !== null &&
        publicationGateOutcome?.held !== true &&
        !deckRequested &&
        !deckRecordsPlan
      ) {
        runOriginIntentPremiseGuardShadow({
          requestId,
          messages,
          answerText: publicationGateAnswerText,
          nowMs: now(),
          ...(premiseGuardPlan ? { plan: premiseGuardPlan } : {}),
        });
      }
      console.info("[origin-chat] upstream stream completed", {
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        // Stage timing (speed measurement 2026-11-16): first delivered
        // text, which route actually served, and how long each executed
        // route attempt took. Numbers and fixed codes only; no text.
        firstDeltaMs: firstDeltaAtMs === null ? null : Math.max(0, firstDeltaAtMs - startedAt),
        servedModel: adoptedResult.routingEvidence.servedModel,
        fallbackUsed: adoptedResult.routingEvidence.fallbackUsed,
        routeAttempts: (adoptedResult.attempts ?? []).map((attempt) => ({
          providerId: attempt.providerId,
          outcome: attempt.outcome,
          ...(attempt.durationMs !== undefined ? { durationMs: attempt.durationMs } : {}),
        })),
        modelId: planningResult.plan.modelId,
        costEvidenceStatus: "NOT_MEASURED",
        providerDeltaCount,
        truncated: adoptedResult.truncated === true,
        ...(assertionGateArmed ? { ungroundedAssertionGate: assertionGateReplaced ? "replaced" : "passed" } : {}),
        ...(assertionGateReplaced ? { failClosedReasonCode: "GATE_REPLACED" } : {}),
        ...(auditGateOutcome ? { businessPlanningAuditMode: "enforce" as const, businessPlanningAuditFixedCount: auditGateOutcome.fixedCount, businessPlanningAuditNotedCodes: auditGateOutcome.notedCodes } : {}),
        ...(dateGateOutcome ? { dateWeekdayVerificationMode: "enforce" as const, dateWeekdayVerificationCorrectedCount: dateGateOutcome.summary?.correctedCount ?? 0 } : {}),
        ...(answerVerification ? { answerVerification } : {}),
        ...(publicationGateOutcome ? { publicationGateMode: publicationGateOutcome.mode, publicationGateHeld: publicationGateOutcome.held, ...(publicationGateOutcome.landing ? { researchTier: publicationGateOutcome.landing.tier, researchOutcome: publicationGateOutcome.landing.outcome, researchAbstainReason: publicationGateOutcome.landing.abstainReason } : {}) } : {}),
        proposalDeck: deckRequested ? (deckRecordsMetrics ? deckRecordsMetrics.finalForm : deckArtifact ? "created" : "failed") : "not-requested",
        ...(deckFailureCode ? { proposalDeckFailureCode: deckFailureCode } : {}),
        ...(deckViolationCodes ? { proposalDeckViolationCodes: deckViolationCodes } : {}),
        ...(deckFailureShape ? { proposalDeckFailureShape: deckFailureShape } : {}),
        ...(deckRecordsMetrics ? { proposalDeckRecords: deckRecordsMetrics } : {}),
      });
      if (deckRequested && !deckArtifact && !deckRecordsPlan) {
        res.write(`data: ${JSON.stringify({ type: "delta", text: PROPOSAL_DECK_FAILURE_NOTE })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        type: "complete",
        modelId: planningResult.plan.modelId,
        servedModel: adoptedResult.routingEvidence.servedModel,
        costEvidenceStatus: "NOT_MEASURED",
        fallbackUsed: adoptedResult.routingEvidence.fallbackUsed,
        ...(adoptedResult.truncated === true && !assertionGateReplaced && publicationGateOutcome?.held !== true ? { truncated: true } : {}),
        ...(deckArtifact ? { artifacts: [deckArtifact] } : {}),
        ...(answerVerification ? { answerVerification } : {}),
      })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    } catch (error) {
      const safeError = error instanceof OriginProviderError
        ? error
        : new OriginProviderError("PROVIDER_INTERNAL_ERROR", "無料AIとの通信に失敗しました。", 503, true);
      console.warn("[origin-chat] upstream stream failed", {
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        firstDeltaMs: firstDeltaAtMs === null ? null : Math.max(0, firstDeltaAtMs - startedAt),
        code: safeError.code,
        status: safeError.status,
        retryable: safeError.retryable,
        diagnostic: JSON.stringify(buildOriginProviderFailureDiagnostic(safeError)),
        downstreamStarted,
        providerDeltaCount,
      });
      if (!downstreamStarted && !res.headersSent) return sendSafeProviderFailure(res, safeError, requestId);
      res.end(`data: ${JSON.stringify({ type: "error" })}\n\n`);
      return;
    }
  });

  return router;
}
