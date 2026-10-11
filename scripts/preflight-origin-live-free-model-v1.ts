/**
 * Safe, read-only, credential-free catalog preflight.
 * Run: npx tsx scripts/preflight-origin-live-free-model-v1.ts
 * To examine a candidate (never switches Production):
 *   ORIGIN_FREE_MODEL_CANDIDATE=google/gemma-4-31b-it:free npx tsx scripts/preflight-origin-live-free-model-v1.ts
 */
import { ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL } from "../src/lib/orchestration/OriginFreeModelCatalog.js";
import {
  auditOriginLiveFreeModelCatalogV1,
  type OriginFreeCatalogPayloadV1,
} from "../src/lib/orchestration/OriginFreeModelCatalogLivePreflightV1.js";

const ORIGIN_API = "https://openrouter.ai/api/v1/models";
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
async function readCatalog(url: string): Promise<OriginFreeCatalogPayloadV1> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error(`AQ_FREE_MODEL_UPSTREAM_HTTP_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_CATALOG_BYTES) {
    throw Error("AQ_FREE_MODEL_RESPONSE_TOO_LARGE");
  }
  const chunks: Uint8Array[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw Error("AQ_FREE_MODEL_EMPTY_CATALOG_BODY");
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_CATALOG_BYTES) throw Error("AQ_FREE_MODEL_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as OriginFreeCatalogPayloadV1;
  } catch {
    throw Error("AQ_FREE_MODEL_INVALID_CATALOG_JSON");
  }
}
async function main() {
  const modelId = process.env.ORIGIN_FREE_MODEL_CANDIDATE ?? ORIGIN_DEFAULT_OPENROUTER_FREE_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*:free$/i.test(modelId)) {
    throw Error("AQ_FREE_MODEL_ID_NOT_EXPLICIT_FREE");
  }
  const [search, zdrZeroPrice] = await Promise.all([
    readCatalog(`${ORIGIN_API}?q=${encodeURIComponent(modelId.slice(0, -5))}`),
    readCatalog(`${ORIGIN_API}?zdr=true&max_price=0`),
  ]);
  const verdict = auditOriginLiveFreeModelCatalogV1({ modelId, search, zdrZeroPrice });
  process.stdout.write(JSON.stringify({
    event: "origin-aq-free-model-catalog-preflight",
    checkedAt: new Date().toISOString(),
    source: "https://openrouter.ai/api/v1/models",
    ...verdict,
  }) + "\n");
  // Runtime validation, actual free inference + billing receipts, AQ-40
  // and Owner/independent release gates MUST remain separate.
  if (!verdict.catalogEligible) process.exitCode = 2;
}
main().catch(() => {
  process.stderr.write(JSON.stringify({
    event: "origin-aq-free-model-catalog-preflight",
    status: "BLOCKED",
    code: "AQ_FREE_MODEL_CATALOG_CHECK_FAILED",
    productionPromotionAllowed: false,
  }) + "\n");
  process.exitCode = 3;
});
