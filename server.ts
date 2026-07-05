import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

// Legacy imports
import { createLegacyRouter } from "./src/legacy/legacyRoutes";

// New architecture imports (Mission Engine)
import { initMissionEngine } from "./services/mission-engine/src/index";

async function startServer() {
  const app = express();
  const PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : 3000;

  app.use(express.json());

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
