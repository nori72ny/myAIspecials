import express, { type Express } from "express";

import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard";
import { createOriginChatRouter } from "../legacy/originChatRouter";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export function resolveOriginReleaseSha(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicitSha = env.ORIGIN_RELEASE_SHA;
  const providerSha = env.VERCEL_GIT_COMMIT_SHA;

  if (
    explicitSha
    && providerSha
    && explicitSha.toLowerCase() !== providerSha.toLowerCase()
  ) {
    return "unknown";
  }

  const candidate = explicitSha ?? providerSha;
  return candidate && FULL_GIT_SHA.test(candidate)
    ? candidate.toLowerCase()
    : "unknown";
}

export function createOriginApp(env: NodeJS.ProcessEnv = process.env): Express {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' ws: wss: https:;",
    );
    next();
  });

  app.use(express.json());

  // This guard must remain first. It blocks every provider-capable legacy and
  // mission mutation route before a later router can inspect or transmit input.
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

  // The Personal release intentionally does not import or mount the legacy
  // dashboard API or Mission Engine. Known provider-capable paths still reach
  // the fail-closed guard above; every other retired route remains unavailable.

  return app;
}
