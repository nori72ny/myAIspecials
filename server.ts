import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

// Legacy imports
import { createLegacyRouter } from "./src/legacy/legacyRoutes";
import { originChatBoundaryGuard } from "./src/legacy/originChatBoundaryGuard";
import { createOriginChatRouter } from "./src/legacy/originChatRouter";
import { createOriginLegacyProviderBoundaryRouter } from "./src/legacy/originLegacyProviderBoundaryGuard";

// New architecture imports (Mission Engine)
import { initMissionEngine } from "./services/mission-engine/src/index";

function resolvePort(): number {
  const rawPort = process.env.TEST_PORT || process.env.PORT || "3000";
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid server port: ${rawPort}`);
  }

  return port;
}

async function startServer() {
  const app = express();
  const PORT = resolvePort();

  // Set Content Security Policy (CSP) for security hardening
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: https: blob:; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "connect-src 'self' ws: wss: https:;"
    );
    next();
  });

  app.use(express.json());

  // Fail closed before any legacy route can transmit user content to a provider.
  // Dormant direct Gemini validation and analyze handlers are intentionally not
  // mounted in this entrypoint; disabled routes remain explicit 503 responses.
  app.use(createOriginLegacyProviderBoundaryRouter());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "acos-2" });
  });

  // Route normal chat through the explicit ORIGIN safety and free-only policy first.
  app.use(createOriginChatRouter());

  // Never allow the authoritative chat path to fall through to historical legacy code.
  app.all("/api/chat", originChatBoundaryGuard);

  // Mount remaining non-provider legacy endpoints after the protected boundaries.
  app.use(createLegacyRouter());

  // Mount Mission Engine API. Provider-capable mutation routes are blocked by
  // createOriginLegacyProviderBoundaryRouter until they are migrated.
  app.use("/api/v1", initMissionEngine());

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
