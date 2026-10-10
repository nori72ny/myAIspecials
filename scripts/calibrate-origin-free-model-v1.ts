/**
 * Trusted operator-only two-request provider calibration for a *candidate*
 * model. Do not execute against an unreviewed PR with real credentials.
 *
 * Requires ORIGIN_FREE_MODEL_CANDIDATE=<explicit :free ID> and a securely
 * injected OPENROUTER_API_KEY. Never logs credentials or full model replies.
 * Passing is calibration evidence only: NOT official AQ-40 or release approval.
 */
import { auditOriginLiveFreeModelCatalogV1 } from "../src/lib/orchestration/OriginFreeModelCatalogLivePreflightV1.js";
import {
  evaluateOriginFreeModelCalibrationV1,
  type OriginFreeCalibrationProbeV1,
} from "../src/lib/orchestration/OriginFreeModelLiveCalibrationV1.js";
import { ORIGIN_ZERO_COST_OPENROUTER_PROVIDER_POLICY as POLICY } from "../src/legacy/zeroCostRoutingPolicy.js";

const API = "https://openrouter.ai/api/v1";
const MODEL = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i;
const MAX_BODY = 256 * 1024;
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw Error("AQ_FREE_CALIBRATION_REQUIRED_" + name + "_MISSING");
  return v;
}
async function fixedEndpointJson(path: string, init: RequestInit): Promise<Record<string, any>> {
  // All caller paths are fixed to OpenRouter's API; never fetch candidate-
  // specified URLs or follow redirects to a different service.
  const response = await fetch(API + path, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  if (!response.ok) throw Error("AQ_FREE_CALIBRATION_UPSTREAM_" + response.status);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY) throw Error("AQ_FREE_CALIBRATION_RESPONSE_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) throw Error("AQ_FREE_CALIBRATION_RESPONSE_INVALID");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY) throw Error("AQ_FREE_CALIBRATION_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw Error("AQ_FREE_CALIBRATION_RESPONSE_INVALID");
    }
    return parsed as Record<string, any>;
  } catch {
    throw Error("AQ_FREE_CALIBRATION_RESPONSE_INVALID");
  }
}
async function runProbe(
  modelId: string, key: string, probeId: "identity" | "arithmetic",
): Promise<OriginFreeCalibrationProbeV1> {
  const prompt = probeId === "identity"
    ? "Public compatibility probe. Reply with exactly: ORIGIN_FREE_CALIBRATION_OK"
    : "Public compatibility probe. Compute 17 * 23. Reply with only the integer.";
  const response = await fixedEndpointJson("/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://origin-personal.vercel.app/",
      "X-OpenRouter-Title": "ORIGIN Trusted Public Calibration",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: "Answer exactly, without explanation. Public synthetic test only." },
        { role: "user", content: prompt },
      ],
      max_tokens: 64,
      temperature: 0,
      usage: { include: true },
      provider: POLICY,
    }),
  });
  const answer = response.choices?.[0]?.message?.content;
  const servedModel = response.model;
  const served = typeof servedModel === "string" ? servedModel.trim() : "";
  const answerText = typeof answer === "string" ? answer.trim() : "";
  const expected = probeId === "identity" ? "ORIGIN_FREE_CALIBRATION_OK" : "391";
  const actualCost = response.usage?.cost;
  const upstreamCost = response.usage?.cost_details?.upstream_inference_cost;
  const serverToolCost = response.usage?.cost_details?.server_tool_cost;
  const byok = response.usage?.is_byok;
  const zero = (v: unknown) => v === 0 || (typeof v === "string" && /^(?:0|0\.0+)$/.test(v));
  // Fail closed BEFORE consuming the next provider request.
  if (served !== modelId) {
    throw Error("AQ_FREE_CALIBRATION_SERVED_MODEL_MISMATCH");
  }
  // Missing BYOK evidence cannot establish the strict no-BYOK condition.
  // Reject it before the next inference call; self-reported 0 alone is insufficient.
  // OpenRouter reports null upstream cost for ordinary non-BYOK inference.
  // Never accept that as $0 proof unless usage.is_byok is explicitly false.
  if (!zero(actualCost) || (upstreamCost != null && !zero(upstreamCost))
      || (serverToolCost != null && !zero(serverToolCost))
      || byok !== false) {
    throw Error("AQ_FREE_CALIBRATION_COST_NOT_VERIFIED_ZERO");
  }
  if (answerText !== expected || response.choices?.[0]?.error || response.error) {
    throw Error("AQ_FREE_CALIBRATION_INCORRECT_ANSWER");
  }
  return {
    probeId,
    requestedModel: modelId,
    servedModel: typeof servedModel === "string" ? servedModel.trim() : "",
    answer: typeof answer === "string" ? answer.trim() : "",
    usageCostUsd: response.usage?.cost,
    upstreamCostUsd: response.usage?.cost_details?.upstream_inference_cost,
    serverToolCostUsd: response.usage?.cost_details?.server_tool_cost,
    isByok: response.usage?.is_byok,
    providerPolicy: POLICY,
  };
}
async function main(): Promise<void> {
  const modelId = required("ORIGIN_FREE_MODEL_CANDIDATE");
  if (!MODEL.test(modelId)) throw Error("AQ_FREE_CALIBRATION_MODEL_NOT_EXPLICIT_FREE");
  const key = required("OPENROUTER_API_KEY");
  // Credential is used for two strictly-free public probes only.
  // Catalog GET is intentionally unauthenticated and runs first.
  const [search, zdrZeroPrice] = await Promise.all([
    fixedEndpointJson("/models?q=" + encodeURIComponent(modelId.slice(0, -5)), {
      method: "GET", headers: { Accept: "application/json" },
    }),
    fixedEndpointJson("/models?zdr=true&max_price=0", {
      method: "GET", headers: { Accept: "application/json" },
    }),
  ]);
  const preflight = auditOriginLiveFreeModelCatalogV1({ modelId, search, zdrZeroPrice });
  if (!preflight.catalogEligible) {
    process.stdout.write(JSON.stringify({
      status: "BLOCKED", modelId, blockers: preflight.blockers,
      modelCalls: 0, productionPromotionAllowed: false,
    }) + "\n");
    process.exitCode = 2;
    return;
  }
  const probes = [
    await runProbe(modelId, key, "identity"),
    await runProbe(modelId, key, "arithmetic"),
  ];
  const report = evaluateOriginFreeModelCalibrationV1({
    modelId, checkedAt: new Date().toISOString(), probes,
  });
  // No full responses, prompts, credentials or provider receipts in public logs.
  process.stdout.write(JSON.stringify({
    ...report,
    modelCalls: probes.length,
    catalogRequestPriceKnownZero: preflight.catalogRequestPriceKnownZero,
  }) + "\n");
  if (!report.eligibleForIndependentProviderReview) process.exitCode = 3;
}
main().catch(error => {
  // Never print upstream response text or the injected credential.
  const message = error instanceof Error ? error.message : "";
  const known = /^AQ_FREE_CALIBRATION_[A-Z0-9_]+$/.test(message) ? message : "AQ_FREE_CALIBRATION_FAILED";
  process.stderr.write(JSON.stringify({
    status: "BLOCKED", code: known, productionPromotionAllowed: false,
  }) + "\n");
  process.exitCode = 4;
});
