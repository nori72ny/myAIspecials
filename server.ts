import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

import { createOriginApp } from "./src/server/createOriginApp";

function resolvePort(): number {
  const rawPort = process.env.TEST_PORT || process.env.PORT || "3000";
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid server port: ${rawPort}`);
  }

  return port;
}

async function startServer() {
  const app = createOriginApp();
  const PORT = resolvePort();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
