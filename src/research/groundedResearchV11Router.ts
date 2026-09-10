import { Router } from "express";
import { detectSensitiveConversation } from "../legacy/originChatValidation.js";
import { researchCurrentInformation } from "../legacy/originResearchSource.js";
import { buildGroundedResearchReport } from "./groundedResearchV11.js";

const MAX_QUERY_LENGTH = 1200;

export function createGroundedResearchV11Router() {
  const router = Router();

  router.get("/api/research/v1.1/status", (_req, res) => res.status(200).json({
    ok: true,
    version: "1.1",
    capability: "grounded-research",
    retrieval: "free-public-web",
    maxSources: 8,
    semanticConflictDetection: "conservative-structured-only",
    freeOnly: true,
    costUsd: 0,
    paidFallbackEnabled: false,
    secretDelivery: "server-only",
  }));

  router.post("/api/research/v1.1/query", async (req, res) => {
    const query = req.body?.query;
    if (typeof query !== "string" || !query.trim() || query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ ok: false, code: "INVALID_RESEARCH_QUERY" });
    }

    const sensitiveKinds = detectSensitiveConversation([{ role: "user", content: query }]);
    if (sensitiveKinds.length > 0) {
      return res.status(422).json({
        ok: false,
        code: "SENSITIVE_INPUT_BLOCKED",
        message: "Potentially sensitive input was detected, so ORIGIN did not send the query to an external source.",
        sensitiveKinds,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    }

    const result = await researchCurrentInformation(query.trim());
    if (!result.ok || result.sources.length === 0) {
      return res.status(503).json({
        ok: false,
        code: "RESEARCH_SOURCE_UNAVAILABLE",
        failure: result.failure,
        fallback: result.fallback,
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    }

    const grounded = buildGroundedResearchReport(result.sources);
    return res.status(200).json({
      ok: true,
      version: "1.1",
      status: "grounded",
      provider: result.searchProvider,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      ...grounded,
    });
  });

  return router;
}
