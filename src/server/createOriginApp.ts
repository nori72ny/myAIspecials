import express, { type ErrorRequestHandler, type Express } from "express";
import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard.js";
import { createOriginChatRouter } from "../legacy/originChatRouter.js";
import { createOriginResearchRouter } from "../legacy/originResearchRouter.js";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard.js";
import { applyOriginSecurityHeaders, createOriginChatRateLimiter, requireSafeOriginChatRequest } from "./originSecurity.js";
import { createAgentOrchestratorRouter } from "../agent/agentOrchestrator.js";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
export function resolveOriginReleaseSha(env: NodeJS.ProcessEnv = process.env): string { const candidate = env.VERCEL_GIT_COMMIT_SHA ?? env.ORIGIN_RELEASE_SHA; return candidate && FULL_GIT_SHA.test(candidate) ? candidate.toLowerCase() : "unknown"; }

export function createOriginApp(env: NodeJS.ProcessEnv = process.env): Express {
  const app = express();
  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(applyOriginSecurityHeaders(env));
  app.use("/api/chat", requireSafeOriginChatRequest(env), createOriginChatRateLimiter());
  app.use(express.json({ limit: "64kb", strict: true, type: ["application/json", "application/*+json"] }));

  const invalidJsonHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SyntaxError && "body" in error) { res.status(400).json({ code: "INVALID_JSON_BODY", message: "JSONリクエストの形式が正しくありません。", retryable: false, requestId: "UNKNOWN" }); return; }
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") { res.status(413).json({ code: "REQUEST_BODY_TOO_LARGE", message: "リクエストの容量が上限を超えています。", retryable: false, requestId: "UNKNOWN" }); return; }
    next(error);
  };
  app.use(invalidJsonHandler);

  // Image generation is not implemented in the current $0 release. Keep the route
  // explicit and fail closed rather than returning an optimized prompt as if an image
  // had actually been generated.
  app.all("/api/generate-image", (_req, res) => res.status(503).json({ code: "ORIGIN_PROVIDER_PATH_DISABLED", message: "このAI実行経路はORIGINの安全・無料実行ポリシーへ未移行のため停止しています。", retryable: false, requestId: "UNKNOWN" }));

  app.use(createAgentOrchestratorRouter());
  app.use(createOriginLegacyProviderBoundaryRouter());
  app.get(["/health", "/api/health"], (_req, res) => res.status(200).json({ status: "ok", service: "acos-2", releaseSha: resolveOriginReleaseSha(env) }));
  app.use(createOriginResearchRouter());
  app.use(createOriginChatRouter({ env }));
  app.all("/api/chat", originChatBoundaryGuard);
  app.all(["/api", "/api/{*splat}"], (_req, res) => res.status(404).json({ code: "ORIGIN_API_ROUTE_NOT_FOUND", message: "指定されたAPIは利用できません。", retryable: false, requestId: "UNKNOWN" }));
  return app;
}
