import {
  type OriginAiStudioOfflineTransport,
  type OriginAiStudioOfflineTransportResult,
} from "../lib/orchestration/OriginAiStudioOfflineExecutor";
import { ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT } from "../lib/orchestration/OriginAiStudioRuntimePolicy";

export const ORIGIN_AI_STUDIO_API_KEY_ENV = "ORIGIN_AI_STUDIO_API_KEY" as const;
const MAX_INTERACTIONS_RESPONSE_BYTES = 1_000_000;

type OriginFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OriginAiStudioInteractionsAdapterOptions {
  env: Readonly<Record<string, string | undefined>>;
  fetchImpl?: OriginFetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractCompletedModelText(value: unknown): string | null {
  if (!isRecord(value) || value.status !== "completed" || !Array.isArray(value.steps)) {
    return null;
  }

  const parts: string[] = [];
  for (const step of value.steps) {
    if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) {
      continue;
    }
    for (const content of step.content) {
      if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  const text = parts.join("");
  return text.trim().length > 0 ? text : null;
}

async function parseSuccessResponse(response: Response): Promise<OriginAiStudioOfflineTransportResult> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INTERACTIONS_RESPONSE_BYTES) {
    return { kind: "malformed_response" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { kind: "malformed_response" };
  }

  if (body.length === 0 || body.length > MAX_INTERACTIONS_RESPONSE_BYTES) {
    return { kind: "malformed_response" };
  }

  try {
    const text = extractCompletedModelText(JSON.parse(body));
    return text === null
      ? { kind: "malformed_response" }
      : { kind: "success", text };
  } catch {
    return { kind: "malformed_response" };
  }
}

export function createOriginAiStudioInteractionsTransport(
  options: OriginAiStudioInteractionsAdapterOptions,
): OriginAiStudioOfflineTransport {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (request) => {
    const apiKey = options.env[ORIGIN_AI_STUDIO_API_KEY_ENV]?.trim();
    if (!apiKey) return { kind: "upstream_rejected" };

    let response: Response;
    try {
      response = await fetchImpl(ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: request.modelId,
          input: request.prompt,
          store: false,
        }),
        redirect: "error",
        signal: request.signal,
      });
    } catch {
      return { kind: "upstream_rejected" };
    }

    if (response.status === 429) return { kind: "rate_limited" };
    if (response.status === 451) return { kind: "region_unavailable" };
    if (!response.ok) return { kind: "upstream_rejected" };

    return parseSuccessResponse(response);
  };
}
