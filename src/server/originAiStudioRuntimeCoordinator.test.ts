import { describe, expect, it, vi } from "vitest";

import type { OriginAiStudioFreeModelEvidence } from "../lib/orchestration/OriginAiStudioRuntimePolicy";
import { ORIGIN_AI_STUDIO_API_KEY_ENV } from "./originAiStudioInteractionsAdapter";
import { createOriginAiStudioRuntimeCoordinator } from "./originAiStudioRuntimeCoordinator";

const nowMs = Date.parse("2030-01-15T00:00:00.000Z");
const syntheticEvidence: OriginAiStudioFreeModelEvidence = {
  providerId: "google-ai-studio-free",
  providerLabel: "ORIGIN AI Studio 無料AI",
  modelId: "gemini-9.9-flash",
  billingTier: "free",
  inputCostUsd: 0,
  outputCostUsd: 0,
  apiFamily: "interactions",
  store: false,
  verifiedAt: "2030-01-01T00:00:00.000Z",
  reviewAfter: "2030-01-31T23:59:59.999Z",
  pricingSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  modelSourceUrl: "https://ai.google.dev/gemini-api/docs/models",
};

function completedResponse(text = "安全な応答"): Response {
  return new Response(JSON.stringify({
    status: "completed",
    steps: [{
      type: "model_output",
      content: [{ type: "text", text }],
    }],
  }), { status: 200 });
}

const enabledEnv = {
  ORIGIN_AI_STUDIO_RUNTIME_ENABLED: "true",
  [ORIGIN_AI_STUDIO_API_KEY_ENV]: "test-value",
};

describe("originAiStudioRuntimeCoordinator", () => {
  it("denies execution by default even when flag, credential, and evidence exist", async () => {
    const fetchImpl = vi.fn(async () => completedResponse());
    const coordinator = createOriginAiStudioRuntimeCoordinator({
      env: enabledEnv,
      catalog: [syntheticEvidence],
      fetchImpl,
      now: () => nowMs,
    });

    await expect(coordinator.execute("入力")).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_OWNER_APPROVAL_REQUIRED",
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not infer approval from environment variables", async () => {
    const fetchImpl = vi.fn(async () => completedResponse());
    const coordinator = createOriginAiStudioRuntimeCoordinator({
      env: {
        ...enabledEnv,
        ORIGIN_AI_STUDIO_OWNER_APPROVED: "true",
        OWNER_APPROVED: "true",
      },
      catalog: [syntheticEvidence],
      fetchImpl,
      now: () => nowMs,
    });

    await expect(coordinator.execute("入力")).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_OWNER_APPROVAL_REQUIRED",
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", {}, [syntheticEvidence], "AI_STUDIO_RUNTIME_DISABLED"],
    ["missing credential", { ORIGIN_AI_STUDIO_RUNTIME_ENABLED: "true" }, [syntheticEvidence], "AI_STUDIO_API_KEY_NOT_CONFIGURED"],
    ["empty catalog", enabledEnv, [], "AI_STUDIO_FREE_CATALOG_INVALID"],
  ] as const)("does not consume approval when preflight is %s", async (_label, env, catalog, code) => {
    const approvalGate = { consumeApproval: vi.fn(() => true) };
    const fetchImpl = vi.fn(async () => completedResponse());
    const coordinator = createOriginAiStudioRuntimeCoordinator({
      env,
      catalog,
      approvalGate,
      fetchImpl,
      now: () => nowMs,
    });

    await expect(coordinator.execute("入力")).resolves.toEqual(expect.objectContaining({
      ok: false,
      code,
    }));
    expect(approvalGate.consumeApproval).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the approval gate throws", async () => {
    const fetchImpl = vi.fn(async () => completedResponse());
    const coordinator = createOriginAiStudioRuntimeCoordinator({
      env: enabledEnv,
      catalog: [syntheticEvidence],
      approvalGate: { consumeApproval: () => { throw new Error("gate failure"); } },
      fetchImpl,
      now: () => nowMs,
    });

    await expect(coordinator.execute("入力")).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_OWNER_APPROVAL_REQUIRED",
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("consumes an injected approval once and cannot reuse it", async () => {
    const approvalGate = { consumeApproval: vi.fn(() => true) };
    const fetchImpl = vi.fn(async () => completedResponse());
    const coordinator = createOriginAiStudioRuntimeCoordinator({
      env: enabledEnv,
      catalog: [syntheticEvidence],
      approvalGate,
      fetchImpl,
      now: () => nowMs,
    });

    await expect(coordinator.execute("一度だけ")).resolves.toEqual({
      ok: true,
      text: "安全な応答",
      verificationStatus: "policy-verified",
    });
    await expect(coordinator.execute("再利用しない")).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "AI_STUDIO_OWNER_APPROVAL_REQUIRED",
    }));
    expect(approvalGate.consumeApproval).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
