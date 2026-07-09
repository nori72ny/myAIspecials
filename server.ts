import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

// Legacy imports
import { createLegacyRouter } from "./src/legacy/legacyRoutes";
import { createAnalyzeRouter } from "./src/legacy/analyzeRoute";

// New architecture imports (Mission Engine)
import { initMissionEngine } from "./services/mission-engine/src/index";

async function startServer() {
  const app = express();
  const PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : 3000;

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

  // Intercept analyze with streaming router first
  app.use(createAnalyzeRouter());

  // 1. Mount Legacy Endpoints (/api/generate-image, /api/analyze)
  app.use(createLegacyRouter());

  // 2. Mount New Mission Engine API (/api/v1/...)
  app.use("/api/v1", initMissionEngine());

  // 3. Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
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
