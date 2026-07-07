import express from "express";
import "dotenv/config";

// Legacy imports
import { createLegacyRouter } from "../src/legacy/legacyRoutes";

// New architecture imports (Mission Engine)
import { initMissionEngine } from "../services/mission-engine/src/index";

const app = express();
app.use(express.json());

// 1. Mount Legacy Endpoints (/api/generate-image, /api/analyze)
app.use(createLegacyRouter());

// 2. Mount New Mission Engine API (/api/v1/...)
app.use("/api/v1", initMissionEngine());

// Export the Express app as a serverless function
export default app;
