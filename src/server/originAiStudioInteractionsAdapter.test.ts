import { describe, expect, it, vi } from "vitest";

import { ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT } from "../lib/orchestration/OriginAiStudioRuntimePolicy";
import {
  createOriginAiStudioInteractionsTransport,
  ORIGIN_AI_STUDIO_API_KEY_ENV,
} from "./originAiStudioInteractionsAdapter";

function completedResponse(text = "安全な応答"): Response {
  return new Response(JSON.stringify({
    status: "completed",
    steps: [{
      type: "model_output",
      content: [{ type: "text", text }],
    }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function request(signal = new AbortController().signal) {
  return {
    modelId: "gemini-9.9-flash",
    prompt: "テスト入力",
    store: false as const,
    signal,
  };
}

describe("originAiStudioInteractionsAdapter", () => {
  it("sends one stateless request to the fixed endpoint with a server environment credential", async () => {
    const fetchImpl = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => completedResponse());
    const transport = createOriginAiStudioInteractionsTransport({
      env: { [ORIGIN_AI_STUDIO_API_KEY_ENV]: "test-value" },
      fetchImpl,
    });

    await expect(transport(request())).resolves.toEqual({
      kind: "success",
      text: "安全な応答",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("fetch call was not captured");
    const [url, init] = call;
    if (!init) throw new Error("fetch init was not captured");
    expect(url).toBe(ORIGIN_AI_STUDIO_INTERACTIONS_ENDPOINT);
    expect(String(url)).not.toContain("test-value");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-value");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gemini-9.9-flash",
      input: "テスト入力",
      store: false,
    });
  });

  it("does not call fetch without the dedicated server environment credential", async () => {
    const fetchImpl = vi.fn(async () => completedResponse());
    const transport = createOriginAiStudioInteractionsTransport({ env: {}, fetchImpl });

    await expect(transport(request())).resolves.toEqual({ kind: "upstream_rejected" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [429, "rate_limited"],
    [451, "region_unavailable"],
    [400, "upstream_rejected"],
    [401, "upstream_rejected"],
    [403, "upstream_rejected"],
    [500, "upstream_rejected"],
  ] as const)("maps HTTP %s without reading or returning its raw body", async (status, kind) => {
    const text = vi.fn(async () => "raw provider error must stay unread");
    const response = {
      status,
      ok: false,
      headers: new Headers(),
      text,
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => response);
    const transport = createOriginAiStudioInteractionsTransport({
      env: { [ORIGIN_AI_STUDIO_API_KEY_ENV]: "test-value" },
      fetchImpl,
    });

    await expect(transport(request())).resolves.toEqual({ kind });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["SDK-only convenience field", JSON.stringify({ status: "completed", output_text: "not REST evidence" })],
    ["incomplete interaction", JSON.stringify({ status: "incomplete", steps: [] })],
    ["missing model output", JSON.stringify({ status: "completed", steps: [] })],
    ["empty model output", JSON.stringify({
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: "   " }] }],
    })],
  ])("rejects %s as malformed", async (_label, body) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const transport = createOriginAiStudioInteractionsTransport({
      env: { [ORIGIN_AI_STUDIO_API_KEY_ENV]: "test-value" },
      fetchImpl,
    });

    await expect(transport(request())).resolves.toEqual({ kind: "malformed_response" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized success bodies before parsing", async () => {
    const text = vi.fn(async () => "must not be read");
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ "content-length": "1000001" }),
      text,
    } as unknown as Response;
    const transport = createOriginAiStudioInteractionsTransport({
      env: { [ORIGIN_AI_STUDIO_API_KEY_ENV]: "test-value" },
      fetchImpl: vi.fn(async () => response),
    });

    await expect(transport(request())).resolves.toEqual({ kind: "malformed_response" });
    expect(text).not.toHaveBeenCalled();
  });

  it("forwards the abort signal and never retries a rejected fetch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      throw new Error("sanitized by adapter");
    });
    const transport = createOriginAiStudioInteractionsTransport({
      env: { [ORIGIN_AI_STUDIO_API_KEY_ENV]: "test-value" },
      fetchImpl,
    });

    await expect(transport(request(controller.signal))).resolves.toEqual({ kind: "upstream_rejected" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
