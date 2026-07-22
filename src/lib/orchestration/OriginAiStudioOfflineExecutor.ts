import {
  isOriginAiStudioRuntimePlanExecutionSafe,
  type OriginAiStudioRuntimePlan,
} from "./OriginAiStudioRuntimePolicy";

export interface OriginAiStudioOfflineRequest {
  modelId: string;
  prompt: string;
  store: false;
  signal: AbortSignal;
}

export type OriginAiStudioOfflineTransportResult =
  | { kind: "success"; text: string }
  | { kind: "rate_limited" }
  | { kind: "region_unavailable" }
  | { kind: "upstream_rejected" }
  | { kind: "malformed_response" };

export type OriginAiStudioOfflineTransport = (
  request: OriginAiStudioOfflineRequest,
) => Promise<OriginAiStudioOfflineTransportResult>;

export type OriginAiStudioExecutionFailureCode =
  | "AI_STUDIO_EXECUTION_POLICY_INVALID"
  | "AI_STUDIO_INPUT_INVALID"
  | "AI_STUDIO_RATE_LIMITED"
  | "AI_STUDIO_REGION_UNAVAILABLE"
  | "AI_STUDIO_TIMEOUT"
  | "AI_STUDIO_UPSTREAM_REJECTED"
  | "AI_STUDIO_UPSTREAM_MALFORMED";

export type OriginAiStudioOfflineExecutionResult =
  | {
      ok: true;
      text: string;
      verificationStatus: "policy-verified";
    }
  | {
      ok: false;
      code: OriginAiStudioExecutionFailureCode;
      message: string;
      retryable: false;
    };

export interface OriginAiStudioSafeLogEvent {
  event: "ai_studio_execution_blocked";
  code: OriginAiStudioExecutionFailureCode;
}

export interface OriginAiStudioOfflineExecutionOptions {
  timeoutMs?: number;
  nowMs?: number;
  log?: (event: OriginAiStudioSafeLogEvent) => void;
}

const FAILURE_MESSAGES: Record<OriginAiStudioExecutionFailureCode, string> = {
  AI_STUDIO_EXECUTION_POLICY_INVALID:
    "無料・安全ポリシーを確認できないため、実行を停止しました。",
  AI_STUDIO_INPUT_INVALID:
    "送信内容を確認できないため、実行を停止しました。",
  AI_STUDIO_RATE_LIMITED:
    "無料利用枠の上限を確認したため、自動再試行せず実行を停止しました。",
  AI_STUDIO_REGION_UNAVAILABLE:
    "現在の地域で無料利用できることを確認できないため、実行を停止しました。",
  AI_STUDIO_TIMEOUT:
    "応答時間を超えたため、自動再試行せず実行を停止しました。",
  AI_STUDIO_UPSTREAM_REJECTED:
    "AIサービスの応答を安全に確認できないため、実行を停止しました。",
  AI_STUDIO_UPSTREAM_MALFORMED:
    "AIサービスの応答形式を確認できないため、回答を表示しません。",
};

function fail(
  code: OriginAiStudioExecutionFailureCode,
  log?: (event: OriginAiStudioSafeLogEvent) => void,
): OriginAiStudioOfflineExecutionResult {
  log?.({ event: "ai_studio_execution_blocked", code });
  return {
    ok: false,
    code,
    message: FAILURE_MESSAGES[code],
    retryable: false,
  };
}

function mapTransportResult(
  result: OriginAiStudioOfflineTransportResult,
  log?: (event: OriginAiStudioSafeLogEvent) => void,
): OriginAiStudioOfflineExecutionResult {
  switch (result.kind) {
    case "success": {
      if (typeof result.text !== "string" || result.text.trim().length === 0) {
        return fail("AI_STUDIO_UPSTREAM_MALFORMED", log);
      }
      return {
        ok: true,
        text: result.text,
        verificationStatus: "policy-verified",
      };
    }
    case "rate_limited":
      return fail("AI_STUDIO_RATE_LIMITED", log);
    case "region_unavailable":
      return fail("AI_STUDIO_REGION_UNAVAILABLE", log);
    case "upstream_rejected":
      return fail("AI_STUDIO_UPSTREAM_REJECTED", log);
    case "malformed_response":
      return fail("AI_STUDIO_UPSTREAM_MALFORMED", log);
  }
}

export async function executeOriginAiStudioOfflineContract(
  plan: OriginAiStudioRuntimePlan,
  prompt: string,
  transport: OriginAiStudioOfflineTransport,
  options: OriginAiStudioOfflineExecutionOptions = {},
): Promise<OriginAiStudioOfflineExecutionResult> {
  if (!isOriginAiStudioRuntimePlanExecutionSafe(plan, options.nowMs ?? Date.now())) {
    return fail("AI_STUDIO_EXECUTION_POLICY_INVALID", options.log);
  }

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return fail("AI_STUDIO_INPUT_INVALID", options.log);
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fail("AI_STUDIO_EXECUTION_POLICY_INVALID", options.log);
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutResult = new Promise<OriginAiStudioOfflineTransportResult>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve({ kind: "upstream_rejected" });
      }, timeoutMs);
    });

    const result = await Promise.race([
      transport({
        modelId: plan.modelId,
        prompt,
        store: false,
        signal: controller.signal,
      }),
      timeoutResult,
    ]);

    if (controller.signal.aborted) {
      return fail("AI_STUDIO_TIMEOUT", options.log);
    }

    return mapTransportResult(result, options.log);
  } catch {
    return fail("AI_STUDIO_UPSTREAM_REJECTED", options.log);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
