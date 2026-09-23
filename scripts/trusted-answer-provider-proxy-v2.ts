import { createServer } from "node:http";
import { chmod, unlink } from "node:fs/promises";

import {
  createTrustedAnswerProviderBoundaryV2,
  publicTrustedAnswerProviderErrorV2,
} from "../src/release/OriginTrustedAnswerProviderProxyV2.js";
import {
  assertOriginZeroCostExecutionResult,
  executeOriginProvider,
  type OriginProviderExecutionRequest,
} from "../src/legacy/originProviderClient.js";

const socketPath = process.env.ORIGIN_TRUSTED_ANSWER_PROVIDER_SOCKET ?? "";
const token = process.env.ORIGIN_TRUSTED_ANSWER_PROVIDER_TOKEN ?? "";
const apiKey = process.env.OPENROUTER_API_KEY ?? "";

if (!socketPath.startsWith("/") || !/^[a-f0-9]{64}$/.test(token) || !apiKey) {
  process.stderr.write(JSON.stringify({ code: "TRUSTED_ANSWER_PROVIDER_PROXY_CONFIG_INVALID" }) + "\n");
  process.exit(2);
}

const boundary = createTrustedAnswerProviderBoundaryV2({
  token,
  execute: async (request: OriginProviderExecutionRequest) => {
    const result = await executeOriginProvider(request, {
      OPENROUTER_API_KEY: apiKey,
      FREE_ONLY: "true",
    });
    assertOriginZeroCostExecutionResult(result, request.plan.modelId, request.plan.providerId);
    return result;
  },
});

let stopping = false;
const server = createServer((req, res) => {
  void (async () => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST" || req.url !== "/execute") {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, code: "TRUSTED_ANSWER_PROVIDER_ROUTE_NOT_FOUND" }));
      return;
    }
    if (stopping) {
      res.writeHead(503);
      res.end(JSON.stringify({ ok: false, code: "TRUSTED_ANSWER_PROVIDER_STOPPING" }));
      return;
    }

    const authorization = req.headers.authorization ?? "";
    const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!/^[a-f0-9]{64}$/.test(presented)) {
      res.writeHead(401);
      res.end(JSON.stringify({ ok: false, code: "TRUSTED_ANSWER_PROVIDER_UNAUTHORIZED" }));
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 128 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ ok: false, code: "TRUSTED_ANSWER_PROVIDER_REQUEST_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, code: "TRUSTED_ANSWER_PROVIDER_JSON_INVALID" }));
      return;
    }

    try {
      const result = await boundary.execute(presented, payload);
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        result,
        requestCount: boundary.used(),
      }));
    } catch (error) {
      const safe = publicTrustedAnswerProviderErrorV2(error);
      res.writeHead(safe.status);
      res.end(JSON.stringify({ ok: false, ...safe, requestCount: boundary.used() }));
    }
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: false, code: "TRUSTED_ANSWER_PROVIDER_PROXY_FATAL" }));
  });
});

server.maxConnections = 4;
server.keepAliveTimeout = 1_000;
server.headersTimeout = 5_000;
server.requestTimeout = 55_000;

await unlink(socketPath).catch(() => undefined);
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o600).catch(() => undefined);
  process.stdout.write(JSON.stringify({ event: "trusted-answer-provider-ready" }) + "\n");
});

const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    void unlink(socketPath).catch(() => undefined).finally(() => process.exit(0));
  });
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
