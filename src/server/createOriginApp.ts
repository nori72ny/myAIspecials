import express, { type ErrorRequestHandler, type Express } from "express";

import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard";
import { createOriginChatRouter } from "../legacy/originChatRouter";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard";
import {
  applyOriginSecurityHeaders,
  createOriginChatRateLimiter,
  requireSafeOriginChatRequest,
} from "./originSecurity";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export function resolveOriginReleaseSha(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidate = env.VERCEL_GIT_COMMIT_SHA ?? env.ORIGIN_RELEASE_SHA;
  return candidate && FULL_GIT_SHA.test(candidate)
    ? candidate.toLowerCase()
    : "unknown";
}

export function createOriginApp(env: NodeJS.ProcessEnv = process.env): Express {
  const app = express();

  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(applyOriginSecurityHeaders(env));

  app.use(
    "/api/chat",
    requireSafeOriginChatRequest(env),
    createOriginChatRateLimiter(),
  );

  app.use(express.json({
    limit: "64kb",
    strict: true,
    type: ["application/json", "application/*+json"],
  }));

  const invalidJsonHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({
        code: "INVALID_JSON_BODY",
        message: "JSONリクエストの形式が正しくありません。",
        retryable: false,
        requestId: "UNKNOWN",
      });
      return;
    }

    if (
      error
      && typeof error === "object"
      && "type" in error
      && error.type === "entity.too.large"
    ) {
      res.status(413).json({
        code: "REQUEST_BODY_TOO_LARGE",
        message: "リクエストの容量が上限を超えています。",
        retryable: false,
        requestId: "UNKNOWN",
      });
      return;
    }

    next(error);
  };
  app.use(invalidJsonHandler);

  // This guard must remain first among provider-capable routes. It blocks every
  // retired provider and mission mutation path before input can be transmitted.
  app.use(createOriginLegacyProviderBoundaryRouter());

  app.get(["/health", "/api/health"], (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "acos-2",
      releaseSha: resolveOriginReleaseSha(env),
    });
  });

  // Only the authoritative ORIGIN chat router may handle POST /api/chat.
  app.use(createOriginChatRouter({ env }));
  app.all("/api/chat", originChatBoundaryGuard);

  // Never allow an unknown API request to fall through to an HTML SPA shell.
  // Clients can therefore fail closed without parsing or displaying HTML.
  app.all(["/api", "/api/{*splat}"], (_req, res) => {
    res.status(404).json({
      code: "ORIGIN_API_ROUTE_NOT_FOUND",
      message: "指定されたAPIは利用できません。",
      retryable: false,
      requestId: "UNKNOWN",
    });
  });

  // The Personal release intentionally does not import or mount the legacy
  // dashboard API or Mission Engine. Known provider-capable paths still reach
  // the fail-closed guard above; every other retired route remains unavailable.

  return app;
}
