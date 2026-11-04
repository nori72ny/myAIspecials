import express, { type ErrorRequestHandler, type Express, type Router } from "express";
import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard.js";
import { createOriginChatRouter } from "../legacy/originChatRouter.js";
import { createOriginStreamingChatRouter } from "../legacy/originStreamingChatRouter.js";
import { createOriginResearchRouter } from "../legacy/originResearchRouter.js";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard.js";
import { applyOriginSecurityHeaders, createOriginChatRateLimiter, requireSafeOriginChatRequest } from "./originSecurity.js";
import { createAgentOrchestratorRouter } from "../agent/agentOrchestrator.js";
import { createAgentOrchestratorV3Router } from "../agent/agentOrchestratorV3.js";
import { createAgentRunConsumptionStoreFromEnv } from "../agent/supabaseRunConsumptionStore.js";
import { createCodingDatabaseStoresFromEnvV14 } from "../agent/codingDatabaseStoresV14.js";
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
import { createMcpManagementRouter, type McpManagementDependencies } from "../mcp/mcpManagementRouter.js";

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

  // Release 1 exposes only the canonical chat API and health identity. Keep every
  // later-generation API unreachable in production until its own release gate passes.
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    app.use((req, res, next) => {
      // Express routing is case-insensitive by default. Normalize before enforcing
      // the production allowlist so mixed-case paths cannot reach mounted routers.
      const requestPath = req.path.toLowerCase();
      if (req.method === "GET" && (requestPath === "/health" || requestPath === "/api/health")) return next();
      if (requestPath === "/api/chat" && req.method === "POST") return next();
      if (requestPath === "/api/chat") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ code: "METHOD_NOT_ALLOWED", message: "このAPIで許可されていないHTTPメソッドです。", retryable: false, requestId: "UNKNOWN" });
      }
      if (requestPath === "/api" || requestPath.startsWith("/api/") || requestPath === "/sites" || requestPath.startsWith("/sites/")) {
        return res.status(404).json({ code: "ORIGIN_RELEASE_ROUTE_NOT_ENABLED", message: "この機能はORIGIN Personalの一次公開では提供していません。", retryable: false, requestId: "UNKNOWN" });
      }
      return next();
    });
  }
  app.use("/api/chat", requireSafeOriginChatRequest(env), createOriginChatRateLimiter());
  app.use("/api/research/v1.1", createOriginChatRateLimiter());
  app.use("/api/artifacts/v1.2", createOriginChatRateLimiter());
  app.use("/api/builder", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST", "DELETE"]));
  app.use("/api/coding/v1.4", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST", "DELETE"]));
  app.use("/api/creative/v1.5", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["GET", "POST"]));
  app.use("/api/creative/v1.6", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST"]));
  app.use("/api/generate-image", requireSafeOriginChatRequest(env), createOriginChatRateLimiter(Date.now, ["POST"]));
  // Reference-image edits are explicitly isolated from the normal 64kb JSON boundary.
  // The router applies stricter decoded-image count/size/dimension checks before provider execution.
  app.use("/api/creative/v1.5/raster/edit", express.json({ limit: "3mb", strict: true, type: ["application/json", "application/*+json"] }));
  app.use("/api/creative/v1.6/world-class/edit", express.json({ limit: "3mb", strict: true, type: ["application/json", "application/*+json"] }));
  app.use(express.json({ limit: "64kb", strict: true, type: ["application/json", "application/*+json"] }));

  const invalidJsonHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SyntaxError && "body" in error) { res.status(400).json({ code: "INVALID_JSON_BODY", message: "JSONリクエストの形式が正しくありません。", retryable: false, requestId: "UNKNOWN" }); return; }
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") { res.status(413).json({ code: "REQUEST_BODY_TOO_LARGE", message: "リクエストの容量が上限を超えています。", retryable: false, requestId: "UNKNOWN" }); return; }
    next(error);
  };
  app.use(invalidJsonHandler);


  const agentRunConsumptionStore = createAgentRunConsumptionStoreFromEnv(env);
  const webPublicationStore = createWebPublicationStoreFromEnv(env);
  const codingStores = createCodingDatabaseStoresFromEnvV14(env);
  app.use(createAgentOrchestratorV3Router(env, agentRunConsumptionStore));
  app.use(createAgentOrchestratorRouter());
  app.use(createOriginLegacyProviderBoundaryRouter());
  app.get(["/health", "/api/health"], (_req, res) => res.status(200).json({
    status: "ok",
    service: "acos-2",
    releaseSha: resolveOriginReleaseSha(env),
    freeOnly: true,
    paidFallbackEnabled: false,
    secretDelivery: "server-only",
  }));
  if (integrations.mcpSession) app.use(integrations.mcpSession);
  if (integrations.mcpAgent) app.use(integrations.mcpAgent);
  app.use(createMcpManagementRouter(integrations.mcp));
  app.use(createGroundedResearchV11Router());
  app.use(createArtifactV12Router());
  app.use(createWebAppBuilderV13Router());
  app.use(createWebPublicationV131Router(env, webPublicationStore));
  app.use(createCodingJobSmokeV14Router(env));
  app.use(createCodingJobV14Router(env, codingStores.jobStore, undefined, codingStores.resultStore));
  app.use(createVisualArtifactV15Router(env));
  app.use(createRasterImageV15Router(env));
  app.use(createWorldClassImageV16Router(env));
  app.use(createOriginResearchRouter());
  // Browser clients request text/event-stream. The provider client buffers upstream
  // SSE privately until terminal model and billing evidence pass, then releases the
  // verified response through this SSE route. This is SSE transport, not progressive
  // token delivery. The legacy router remains the fail-closed JSON/local-answer path.
  app.use(createOriginStreamingChatRouter({ env }));
  app.use(createOriginChatRouter({ env }));
  app.all("/api/chat", originChatBoundaryGuard);
  app.all(["/api", "/api/{*splat}"], (_req, res) => res.status(404).json({ code: "ORIGIN_API_ROUTE_NOT_FOUND", message: "指定されたAPIは利用できません。", retryable: false, requestId: "UNKNOWN" }));
  return app;
}