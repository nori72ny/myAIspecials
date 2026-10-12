/**
 * Read-only OpenRouter ZDR endpoint diagnostics.
 *
 * IMPORTANT: This script performs GET requests only. It never sends prompts,
 * calls /chat/completions, reserves provider inference quota, or changes production.
 * OPENROUTER_API_KEY is used only to authorize GET /endpoints/zdr.
 */
import { auditOriginLiveFreeZdrEndpointsV1 } from "../src/lib/orchestration/OriginFreeModelCatalogLivePreflightV1.js";

const API = "https://openrouter.ai/api/v1";
const MAX_BODY = 2 * 1024 * 1024;
const FREE_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("AQ_ZDR_DIAGNOSTIC_REQUIRED_" + name + "_MISSING");
  return value;
}

async function getJson(path: string, key?: string): Promise<Record<string, unknown>> {
  const response = await fetch(API + path, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/json",
      ...(key ? { Authorization: "Bearer " + key } : {}),
    },
  });
  if (!response.ok) throw new Error("AQ_ZDR_DIAGNOSTIC_UPSTREAM_" + response.status);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY) {
    throw new Error("AQ_ZDR_DIAGNOSTIC_RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AQ_ZDR_DIAGNOSTIC_RESPONSE_INVALID");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY) throw new Error("AQ_ZDR_DIAGNOSTIC_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error("AQ_ZDR_DIAGNOSTIC_RESPONSE_INVALID");
  }
}

function modelIds(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.data)) return [];
  return payload.data
    .filter((row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && !Array.isArray(row))
    .map(row => row.id)
    .filter((id): id is string => typeof id === "string" && FREE_ID.test(id));
}

async function main(): Promise<void> {
  const key = required("OPENROUTER_API_KEY");
  // These are catalog GETs only; they do not submit inference prompts.
  const [freeCatalog, gemmaCatalog, nemotronCatalog] = await Promise.all([
    getJson("/models?zdr=true&max_price=0"),
    getJson("/models?q=gemma-4"),
    getJson("/models?q=nemotron-3-super"),
  ]);

  const allFreeIds = modelIds(freeCatalog);
  const namedIds = [...new Set([
    ...modelIds(gemmaCatalog).filter(id => /gemma-4/i.test(id)),
    ...modelIds(nemotronCatalog).filter(id => /nemotron-3-super/i.test(id)),
  ])];
  // Keep the requested named families first, then inspect a deterministic
  // sample of other :free catalog IDs to keep Actions logs bounded.
  const namedSet = new Set(namedIds);
  const otherIds = [...new Set(allFreeIds)]
    .filter(id => !namedSet.has(id))
    .sort()
    .slice(0, 64);
  const candidates = [...new Set([...namedIds, ...otherIds])];

  const endpoints = await getJson("/endpoints/zdr", key);
  const data = endpoints.data;
  if (!Array.isArray(data) || data.length > 4096
      || !data.every(row => !!row && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("AQ_ZDR_DIAGNOSTIC_ENDPOINT_PAYLOAD_INVALID");
  }

  const summary: Array<Record<string, unknown>> = [];
  for (const modelId of candidates) {
    const verdict = auditOriginLiveFreeZdrEndpointsV1({ modelId, endpoints });
    summary.push({
      modelId,
      family: /gemma-4/i.test(modelId) ? "gemma-4"
        : /nemotron-3-super/i.test(modelId) ? "nemotron-3-super" : "other-free",
      eligibleForPublicCalibration: verdict.eligibleForPublicCalibration,
      qualifyingEndpointCount: verdict.qualifyingEndpointCount,
      blockers: verdict.blockers,
      realInferenceVerified: false,
      independentBillingVerified: false,
      productionPromotionAllowed: false,
    });
  }
  process.stdout.write(JSON.stringify({
    status: "GET_ONLY_DIAGNOSTIC_COMPLETE",
    checkedAt: new Date().toISOString(),
    requestMethods: ["GET"],
    inferenceCalls: 0,
    promptSubmissions: 0,
    quotaReservationCreated: false,
    endpointRecordCount: data.length,
    freeCatalogModelCount: allFreeIds.length,
    candidateCount: candidates.length,
    namedFamiliesFound: {
      gemma4FreeIds: namedIds.filter(id => /gemma-4/i.test(id)),
      nemotron3SuperFreeIds: namedIds.filter(id => /nemotron-3-super/i.test(id)),
    },
    inspectedOtherFreeModelLimit: 64,
    results: summary,
    productionPromotionAllowed: false,
  }, null, 2) + "\n");
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "";
  const code = /^AQ_ZDR_DIAGNOSTIC_[A-Z0-9_]+$/.test(message)
    ? message : "AQ_ZDR_DIAGNOSTIC_FAILED";
  process.stderr.write(JSON.stringify({
    status: "BLOCKED",
    code,
    inferenceCalls: 0,
    productionPromotionAllowed: false,
  }) + "\n");
  process.exitCode = 2;
});
