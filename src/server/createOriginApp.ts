import express, { type ErrorRequestHandler, type Express, type Router } from "express";
import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard.js";
import { createOriginChatRouter } from "../legacy/originChatRouter.js";
import { createOriginStreamingChatRouter } from "../legacy/originStreamingChatRouter.js";
import { createOriginResearchRouter } from "../legacy/originResearchRouter.js";
import { executeOriginSynthesisWithFailover } from "../legacy/originProviderFailover.js";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard.js";
import { resolveOriginCodeTaskRoutingMode } from "../legacy/originChatResponsePolicy.js";
import { applyOriginSecurityHeaders, createOriginChatRateLimiter, requireSafeOriginChatRequest } from "./originSecurity.js";
import { createAgentOrchestratorRouter } from "../agent/agentOrchestrator.js";
import { createAgentOrchestratorV3Router } from "../agent/agentOrchestratorV3.js";
import { createAgentRunConsumptionStoreFromEnv } from "../agent/supabaseRunConsumptionStore.js";
import { createAgentRunStoreFromEnv } from "../agent/supabaseAgentRunStore.js";
import { createAgentAttachmentStoreFromEnv } from "../agent/supabaseAgentAttachmentStore.js";
import { createAgentRunWriteLockStoreFromEnv } from "../agent/supabaseAgentRunWriteLockStore.js";
import { createCodingDatabaseStoresFromEnvV14 } from "../agent/codingDatabaseStoresV14.js";
import { createAgentCodingDelegationV14 } from "../agent/agentCodingDelegationV14.js";
import { createCodingJobV14Router } from "../agent/codingJobRouterV14.js";
import { createCodingJobSmokeV14Router } from "../agent/codingJobSmokeRouterV14.js";
import { createGroundedResearchV11Router } from "../research/groundedResearchV11Router.js";
import { createArtifactV12Router } from "../artifacts/artifactV12Router.js";
import { createWebAppBuilderV13Router } from "../builder/webAppBuilderV13Router.js";
import { createWebPublicationStoreFromEnv } from "../builder/webPublicationStoreV131.js";
import { createWebPublicationV131Router } from "../builder/webPublicationV131Router.js";
import { createVisualArtifactV15Router } from "../creative/visualArtifactV15Router.js";
import { createRasterImageV15Router } from "../creative/rasterImageV15Router.js";
import { createWorldClassImageV16Router } from "../creative/worldClassImageV16Router.js";
import { createImageGatewayEvalPreflightRouter } from "../creative/imageGatewayEvalPreflightRouter.js";
import { createMcpManagementRouter, type McpManagementDependencies } from "../mcp/mcpManagementRouter.js";
import { createOriginVoiceTranscribeRouter } from "../voice/originVoiceTranscribeRouter.js";
import { voiceOutputEnabled } from "../voice/voiceOutputSwitch.js";
import { createOrinAiNewsService, OrinAiNewsUnavailableError, type OrinAiNewsFailure } from "./orinAiNews.js";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
export function resolveOriginReleaseSha(env: NodeJS.ProcessEnv = process.env): string { const candidate = env.VERCEL_GIT_COMMIT_SHA ?? env.ORIGIN_RELEASE_SHA; return candidate && FULL_GIT_SHA.test(candidate) ? candidate.toLowerCase() : "unknown"; }

export function createOriginApp(
  env: NodeJS.ProcessEnv = process.env,
  integrations: { mcp?: McpManagementDependencies; mcpSession?: Router; mcpAgent?: Router } = {},
): Express {
  const app = express();
  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(applyOriginSecurityHeaders(env));
  app.use("/api/chat", requireSafeOriginChatRequest(env), createOriginChatRateLimiter());
  // The research route consumes the same external search quota as chat, so it
  // gets the same Origin gate as every other provider-consuming route
  // (security audit 2026-11-08: it was the only one without it).
  app.use("/api/research/v1.1", requireSafeOriginChatRequest(env), createOriginChatRateLimiter());
  app.use("/api/artifacts/v1.2", createOriginChatRateLimiter());
  app.use("/api/builder", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST", "DELETE"]));
  app.use("/api/coding/v1.4", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST", "DELETE"]));
  app.use("/api/creative/v1.5", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["GET", "POST"]));
  app.use("/api/creative/v1.6", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST"]));
  app.use("/api/generate-image", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST"]));
  // Voice transcription takes a raw audio body, not JSON, so the JSON-only
  // Origin gate cannot front it; the router enforces the same same-origin
  // rule itself. It still gets the shared chat rate limiter, and its raw
  // body parser (2 MB cap) is isolated from the 64kb JSON boundary below,
  // in the same style as the reference-image edit mounts.
  app.use("/api/voice", createOriginChatRateLimiter(Date.now, ["POST"]));
  app.use("/api/voice/transcribe", express.raw({ limit: "2mb", type: ["audio/*", "application/octet-stream"] }));
  const voiceBodyErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
      res.status(413).json({ ok: false, code: "VOICE_AUDIO_TOO_LARGE", message: "音声が大きすぎます。60秒以内で録音してください。", retryable: false, freeOnly: true, paidFallbackUsed: false, secretDelivery: "server-only" });
      return;
    }
    next(error);
  };
  app.use("/api/voice/transcribe", voiceBodyErrorHandler);
  // /api/agent/v3 is rate limited inside createAgentOrchestratorV3Router
  // itself, so the limiter sits in the same file as the route definitions.
  // Reference-image edits are explicitly isolated from the normal 64kb JSON boundary.
  // The router applies stricter decoded-image count/size/dimension checks before provider execution.
  app.use("/api/creative/v1.5/raster/edit", express.json({ limit: "3mb", strict: true, type: ["application/json", "application/*+json"] }));
  app.use("/api/creative/v1.6/world-class/edit", express.json({ limit: "3mb", strict: true, type: ["application/json", "application/*+json"] }));
  // Agent attachment uploads carry extracted file text (up to 200k
  // characters per file, several files per request in stage 2's base64
  // form), so the attachment-set routes get an 8mb JSON boundary in the
  // same isolated style as the reference-image edits above. The global
  // 64kb boundary below is unchanged for every other route; the router
  // applies the stricter per-file and per-set checks itself.
  app.use("/api/agent/v3/attachment-sets", express.json({ limit: "8mb", strict: true, type: ["application/json", "application/*+json"] }));
  app.use(express.json({ limit: "64kb", strict: true, type: ["application/json", "application/*+json"] }));

  const invalidJsonHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SyntaxError && "body" in error) { res.status(400).json({ code: "INVALID_JSON_BODY", message: "JSONリクエストの形式が正しくありません。", retryable: false, requestId: "UNKNOWN" }); return; }
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") { res.status(413).json({ code: "REQUEST_BODY_TOO_LARGE", message: "リクエストの容量が上限を超えています。", retryable: false, requestId: "UNKNOWN" }); return; }
    next(error);
  };
  app.use(invalidJsonHandler);


  const agentRunConsumptionStore = createAgentRunConsumptionStoreFromEnv(env);
  const agentRunStore = createAgentRunStoreFromEnv(env);
  const agentAttachmentStore = createAgentAttachmentStoreFromEnv(env);
  const agentWriteLockStore = createAgentRunWriteLockStoreFromEnv(env);
  const webPublicationStore = createWebPublicationStoreFromEnv(env);
  const codingStores = createCodingDatabaseStoresFromEnvV14(env);
  // The voice router is mounted before the agent routers on purpose: the
  // legacy agent router applies the JSON-only Origin gate router-wide, so
  // any router mounted after it would never see a raw-audio POST (it is
  // rejected 415 first). The voice route is a single exact path and the
  // router enforces the same-origin rule itself.
  app.use(createOriginVoiceTranscribeRouter(env));
  app.use(createAgentOrchestratorV3Router(env, agentRunConsumptionStore, {
    codeDelegation: createAgentCodingDelegationV14({ env, jobStore: codingStores.jobStore }),
    runStore: agentRunStore,
    writeLockStore: agentWriteLockStore,
    attachmentStore: agentAttachmentStore,
  }));
  app.use(createAgentOrchestratorRouter());
  app.use(createOriginLegacyProviderBoundaryRouter());
  app.get(["/health", "/api/health"], (_req, res) => res.status(200).json({
    status: "ok",
    service: "acos-2",
    releaseSha: resolveOriginReleaseSha(env),
    // Voice output (VC-1): the read-aloud surface renders only when
    // this reads true — the same fail-closed status shape as the
    // agent status' attachmentsEnabled (F3).
    voiceOutputEnabled: voiceOutputEnabled(env),
    // CB-1 observability: the resolved code-task routing mode, so
    // an observation window can confirm from outside that the
    // switch value reached this instance exactly (anything other
    // than the exact "shadow" / "enforce" resolves to "off").
    codeTaskRoutingMode: resolveOriginCodeTaskRoutingMode(env),
    freeOnly: true,
    paidFallbackEnabled: false,
    secretDelivery: "server-only",
    costUsd: 0,
  }));
  // Orin panel "AIの最新情報" headline layer (expansion design
  // ORIN_PANEL_EXPANSION_DESIGN_2026-11-25 §8.4): a thin read-only
  // outlet that asks GDELT (free, no key, already adopted by the
  // research route) for the latest AI headlines. The query is a
  // fixed server-side string — nothing about the user (conversation,
  // requests, identity) is ever sent — and the response carries
  // only {title, url, source, publishedAt}. Nothing is stored on
  // either side; the client keeps the result in memory only. No
  // generation quota is consumed. On failure the panel collapses
  // just this layer and keeps showing the weekly digest.
  //
  // The fetch goes through the ai-news service (orinAiNews.ts),
  // which exists because the direct call failed every time in
  // production: the search layer's 5-second default timeout is far
  // below GDELT's real response time from shared egress IPs, its
  // per-IP rate limit (one request per 5 seconds) answers 429
  // under that same sharing, and the old handler swallowed every
  // failure without a trace. The service uses a longer timeout,
  // one rate-limit-aware retry, an in-memory-only cache with
  // request coalescing, and reports the failure reason so it is
  // logged here (bounded fields only, the same discipline as the
  // function-init failure log in api/index.ts) and returned to the
  // client in the 502 body. The keyless public RSS feed (fixed
  // query) is the primary route and GDELT is the fallback: every
  // successful production response was already coming from RSS,
  // while GDELT's per-IP rate limit stays saturated by other
  // tenants on shared egress IPs, so leading with GDELT only made
  // each fresh fetch wait for its failure first (order reversed
  // 2026-11-27, see orinAiNews.ts).
  const aiNewsService = createOrinAiNewsService({
    onFailure: (failure) => {
      console.error("[origin-ai-news] headline fetch failed", failure);
    },
  });
  app.get("/api/orin/ai-news", async (_req, res) => {
    try {
      const result = await aiNewsService.getHeadlines();
      res.status(200).json({
        ok: true,
        fetchedAt: result.fetchedAt,
        items: result.items,
        ...(result.stale ? { stale: true } : {}),
        freeOnly: true,
        costUsd: 0,
      });
    } catch (error) {
      const failure: OrinAiNewsFailure = error instanceof OrinAiNewsUnavailableError ? error.failure : { code: "unknown" };
      res.status(502).json({
        ok: false,
        code: "AI_NEWS_UNAVAILABLE",
        reason: failure.code,
        ...(failure.status ? { upstreamStatus: failure.status } : {}),
        freeOnly: true,
        costUsd: 0,
      });
    }
  });
  if (integrations.mcpSession) app.use(integrations.mcpSession);
  if (integrations.mcpAgent) app.use(integrations.mcpAgent);
  app.use(createMcpManagementRouter(integrations.mcp));
  app.use(createGroundedResearchV11Router({ env }));
  app.use(createArtifactV12Router());
  app.use(createWebAppBuilderV13Router());
  app.use(createWebPublicationV131Router(env, webPublicationStore));
  app.use(createCodingJobSmokeV14Router(env));
  app.use(createCodingJobV14Router(env, codingStores.jobStore, undefined, codingStores.resultStore));
  app.use(createVisualArtifactV15Router(env));
  app.use(createRasterImageV15Router(env));
  app.use(createWorldClassImageV16Router(env));
  app.use(createImageGatewayEvalPreflightRouter(env));
  // The research router gets the same verified zero-cost failover executor as
  // the chat router so freshness queries it intercepts are answered with the
  // citation-validated synthesis instead of a raw extractive dump; synthesis
  // failure degrades safely back to that extractive report inside the router.
  app.use(createOriginResearchRouter({ env, researchSynthesis: (request) => executeOriginSynthesisWithFailover(request, env) }));
  // Browser clients request text/event-stream. Handle provider-eligible requests here
  // so deltas come directly from OpenRouter's upstream SSE stream. The legacy router
  // remains the fail-closed JSON/local-answer path and is never used to fake provider
  // streaming for eligible requests.
  app.use(createOriginStreamingChatRouter({ env }));
  app.use(createOriginChatRouter({ env }));
  app.all("/api/chat", originChatBoundaryGuard);
  app.all(["/api", "/api/{*splat}"], (_req, res) => res.status(404).json({ code: "ORIGIN_API_ROUTE_NOT_FOUND", message: "指定されたAPIは利用できません。", retryable: false, requestId: "UNKNOWN" }));
  return app;
}