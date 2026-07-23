import express, { type Express } from "express";

import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard";
import { createOriginChatRouter } from "../legacy/originChatRouter";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard";

export function createOriginApp(): Express {
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

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "acos-2" });
  });

  // Only the authoritative ORIGIN chat router may handle POST /api/chat.
  app.use(createOriginChatRouter());
  app.all("/api/chat", originChatBoundaryGuard);

  // The Personal release intentionally does not import or mount the legacy
  // dashboard API or Mission Engine. Known provider-capable paths still reach
  // the fail-closed guard above; every other retired route remains unavailable.

  return app;
}
