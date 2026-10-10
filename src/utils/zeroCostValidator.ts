export type ZeroCostValidationInput = {
  freeOnly: boolean; modelId?: string | null; provider?: string | null;
  costUsd?: number | null; fallbackRequested?: boolean;
};
export type ZeroCostValidationResult =
  | { ok: true; reason: "verified-zero-cost" }
  | { ok: false; reason: "free-only-disabled" | "paid-model" | "nonzero-cost" | "unknown-cost" | "paid-fallback-forbidden" };
/** Fail-closed validation: unknown costs and paid fallbacks are never considered free. */
export function validateZeroCost(input: ZeroCostValidationInput): ZeroCostValidationResult {
  if (!input.freeOnly) return { ok: false, reason: "free-only-disabled" };
  if (input.fallbackRequested) return { ok: false, reason: "paid-fallback-forbidden" };
  if (typeof input.costUsd !== "number" || !Number.isFinite(input.costUsd)) return { ok: false, reason: "unknown-cost" };
  if (input.costUsd > 0) return { ok: false, reason: "nonzero-cost" };
  const model = `${input.provider ?? ""}/${input.modelId ?? ""}`.toLowerCase();
  if (!model.trim() || /paid|premium|proprietary/.test(model)) return { ok: false, reason: "paid-model" };
  return { ok: true, reason: "verified-zero-cost" };
}
