import { Router } from "express";
import { detectSensitiveConversation } from "../legacy/originChatValidation.js";
import { researchCurrentInformation, type OriginResearchResult } from "../legacy/originResearchSource.js";
import {
  createDefaultOriginResearchExecutor,
  type OriginSearchGroundingDeps,
} from "../search/originSearchGrounding.js";
import { buildGroundedResearchReport } from "./groundedResearchV11.js";

const MAX_QUERY_LENGTH = 1200;

export interface GroundedResearchV11RouterOptions {
  env?: NodeJS.ProcessEnv;
  research?: (query: string) => Promise<OriginResearchResult>;
  searchGrounding?: OriginSearchGroundingDeps;
}

export function createGroundedResearchV11Router(options: GroundedResearchV11RouterOptions = {}) {
  const router = Router();
  // Source-layer wiring (same composition as createOriginResearchRouter):
  // when the app supplies env / search-grounding options (production does,
  // via createOriginApp), queries are served by the search-grounding pipeline
  // (GDELT / Tavily / Wikipedia / Open-Meteo under the $0 evidence catalog) in
  // front of the legacy research function, which remains the fallback for
  // questions with no enabled grounding route. With no options the router
  // keeps its historical direct use of the legacy research function. Either
  // way the fail-closed contract below is unchanged: no verified sources ->
  // 503 RESEARCH_SOURCE_UNAVAILABLE, never a model completion.
  const research = options.research ?? (options.env || options.searchGrounding
    ? createDefaultOriginResearchExecutor(
        { env: options.env ?? process.env, ...(options.searchGrounding ?? {}) },
        researchCurrentInformation,
      )
    : researchCurrentInformation);

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

    const result = await research(query.trim());
    if (!result.ok || result.sources.length === 0) {
      const sourceConstraintUnmet = result.failure?.code === "SOURCE_CONSTRAINT_UNMET";
      return res.status(503).json({
        ok: false,
        code: sourceConstraintUnmet ? "RESEARCH_SOURCE_CONSTRAINT_UNMET" : "RESEARCH_SOURCE_UNAVAILABLE",
        failure: result.failure,
        fallback: result.fallback,
        ...(result.groundingFailure ? { groundingFailure: result.groundingFailure } : {}),
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      });
    }

    const grounded = buildGroundedResearchReport(query.trim(), result.sources);
    return res.status(200).json({
      ok: true,
      version: "1.1",
      status: "grounded",
      provider: result.searchProvider,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      ...grounded,
      ...(result.grounding ? { grounding: result.grounding } : {}),
    });
  });

  return router;
}
