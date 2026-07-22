import express, { type Express } from "express";

import { initMissionEngine } from "../../services/mission-engine/src/index";
import { createLegacyRouter } from "../legacy/legacyRoutes";
import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard";
import { createOriginChatRouter } from "../legacy/originChatRouter";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard";

export function createOriginApp(): Express {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: https: blob:; " +
      "font-src 'self' https://fonts.gstatic.com; " +
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

  // Legacy read-only routes remain available after the provider boundary.
  app.use(createLegacyRouter());

  // Provider-capable mission mutations are blocked by the first guard.
  app.use("/api/v1", initMissionEngine());

  return app;
}
