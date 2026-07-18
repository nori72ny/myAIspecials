import express from "express";
import "dotenv/config";

// Legacy imports
import { createLegacyRouter } from "../src/legacy/legacyRoutes";
import { originChatBoundaryGuard } from "../src/legacy/originChatBoundaryGuard";
import { createOriginChatRouter } from "../src/legacy/originChatRouter";

// New architecture imports (Mission Engine)
import { initMissionEngine } from "../services/mission-engine/src/index";

const app = express();
app.use(express.json());

// The serverless entrypoint must use the same authoritative chat path as server.ts.
app.use(createOriginChatRouter());
app.all("/api/chat", originChatBoundaryGuard);

// Mount remaining legacy endpoints only after the protected chat boundary.
app.use(createLegacyRouter());

// Mount New Mission Engine API (/api/v1/...)
app.use("/api/v1", initMissionEngine());

// Export the Express app as a serverless function
export default app;
