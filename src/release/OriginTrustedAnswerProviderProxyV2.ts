import { timingSafeEqual } from "node:crypto";

import {
  ORIGIN_OPENROUTER_FREE_MODEL,
  type OriginProviderDataPolicy,
} from "../lib/orchestration/OriginExecutionPolicy.js";
import type { AITaskType } from "../lib/orchestration/MultiAIOrchestrator.js";
import type {
  OriginProviderExecutionRequest,
  OriginProviderExecutionResult,
} from "../legacy/originProviderClient.js";

export const TRUSTED_ANSWER_PROVIDER_REQUEST_LIMIT_V2 = 1 as const;
export const TRUSTED_ANSWER_PROVIDER_MAX_REQUEST_BYTES_V2 = 128 * 1024;

const ALLOWED_TASK_TYPES = new Set<AITaskType>([
  "implementation",
  "review",
  "security",
  "ux",
  "research",
  "test",
  "documentation",
  "operations",
  "architecture",
  "current-information",
]);

export class TrustedAnswerProviderBoundaryErrorV2 extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "TrustedAnswerProviderBoundaryErrorV2";
  }
}

function fail(code: string, status = 400): never {
  throw new TrustedAnswerProviderBoundaryErrorV2(code, status);
}

function exactDataPolicy(value: OriginProviderDataPolicy): boolean {
  return value?.allowProviderFallbacks === false
    && value?.dataCollection === "deny"
    && value?.requireZeroDataRetention === true;
}

function tokenMatches(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(actual, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateTrustedAnswerProviderRequestV2(
  value: unknown,
): OriginProviderExecutionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("TRUSTED_ANSWER_PROVIDER_REQUEST_INVALID");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("TRUSTED_ANSWER_PROVIDER_REQUEST_INVALID");
  }
  if (Buffer.byteLength(serialized, "utf8") > TRUSTED_ANSWER_PROVIDER_MAX_REQUEST_BYTES_V2) {
    fail("TRUSTED_ANSWER_PROVIDER_REQUEST_TOO_LARGE", 413);
  }

  const request = value as OriginProviderExecutionRequest;
  const plan = request.plan;
  if (
    !plan
    || plan.providerId !== "openrouter-free"
    || plan.modelId !== ORIGIN_OPENROUTER_FREE_MODEL
    || !ALLOWED_TASK_TYPES.has(plan.taskType)
    || plan.freeOnly !== true
    || plan.estimatedCostUsd !== 0
    || plan.requiresOwnerApproval !== false
    || !Number.isInteger(plan.timeoutMs)
    || plan.timeoutMs < 1_000
    || plan.timeoutMs > 52_000
    || !exactDataPolicy(plan.providerDataPolicy)
  ) {
    fail("TRUSTED_ANSWER_PROVIDER_POLICY_VIOLATION");
  }

  if (request.requiredTool !== undefined) {
    fail("TRUSTED_ANSWER_PROVIDER_TOOL_BLOCKED");
  }
  if (
    typeof request.systemInstruction !== "string"
    || request.systemInstruction.length < 1
    || request.systemInstruction.length > 32_000
  ) {
    fail("TRUSTED_ANSWER_PROVIDER_SYSTEM_INVALID");
  }
  if (!Array.isArray(request.messages) || request.messages.length < 1 || request.messages.length > 8) {
    fail("TRUSTED_ANSWER_PROVIDER_MESSAGES_INVALID");
  }
  for (const message of request.messages) {
    if (!message || typeof message !== "object") fail("TRUSTED_ANSWER_PROVIDER_MESSAGES_INVALID");
    if (!["user", "ai", "assistant", "model"].includes(message.role)) {
      fail("TRUSTED_ANSWER_PROVIDER_MESSAGES_INVALID");
    }
    if (
      typeof message.content !== "string"
      || message.content.length < 1
      || message.content.length > 32_000
    ) {
      fail("TRUSTED_ANSWER_PROVIDER_MESSAGES_INVALID");
    }
  }

  return request;
}

export function createTrustedAnswerProviderBoundaryV2(options: {
  token: string;
  execute: (request: OriginProviderExecutionRequest) => Promise<OriginProviderExecutionResult>;
}) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error("TRUSTED_ANSWER_PROVIDER_TOKEN_INVALID");

  let used = 0;
  return Object.freeze({
    used: () => used,
    remaining: () => TRUSTED_ANSWER_PROVIDER_REQUEST_LIMIT_V2 - used,
    async execute(presentedToken: string, rawRequest: unknown): Promise<OriginProviderExecutionResult> {
      if (!tokenMatches(options.token, presentedToken)) {
        fail("TRUSTED_ANSWER_PROVIDER_UNAUTHORIZED", 401);
      }
      if (used >= TRUSTED_ANSWER_PROVIDER_REQUEST_LIMIT_V2) {
        fail("TRUSTED_ANSWER_PROVIDER_BUDGET_EXHAUSTED", 429);
      }
      used += 1;

      let serialized: string;
      try {
        serialized = JSON.stringify(rawRequest);
      } catch {
        fail("TRUSTED_ANSWER_PROVIDER_REQUEST_INVALID");
      }
      if (serialized.includes(options.token)) {
        fail("TRUSTED_ANSWER_PROVIDER_CAPABILITY_TOKEN_LEAK_BLOCKED");
      }

      const request = validateTrustedAnswerProviderRequestV2(rawRequest);
      return options.execute(request);
    },
  });
}

export function publicTrustedAnswerProviderErrorV2(error: unknown): {
  code: string;
  status: number;
} {
  if (error instanceof TrustedAnswerProviderBoundaryErrorV2) {
    return { code: error.code, status: error.status };
  }
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    const status = (error as { status?: unknown }).status;
    if (typeof code === "string" && /^PROVIDER_[A-Z0-9_:-]+$/.test(code)) {
      return {
        code,
        status: Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599
          ? Number(status)
          : 502,
      };
    }
  }
  return { code: "TRUSTED_ANSWER_PROVIDER_EXECUTION_FAILED", status: 502 };
}
