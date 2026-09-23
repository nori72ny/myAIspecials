import { request as httpRequest } from "node:http";
import { writeSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const RESULT_PREFIX = "ORIGIN_TRUSTED_ANSWER_RESULT ";
const MAX_PROXY_RESPONSE_BYTES = 512 * 1024;
const trustedStringify = JSON.stringify.bind(JSON);
const trustedObjectCreate = Object.create;
const trustedRemoveAllListeners = process.removeAllListeners.bind(process);
const trustedWriteSync = writeSync;
const trustedExit = process.exit.bind(process);
const monotonicNow = process.hrtime.bigint;

type CandidateLease = {
  schemaVersion: "origin.answer-case-lease-candidate.v2";
  leaseId: string;
  prompt: string;
};

function parseLease(): CandidateLease {
  const encoded = process.env.ORIGIN_AQ_V2_CASE_LEASE_B64 ?? "";
  if (!encoded || encoded.length > 64 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("TRUSTED_ANSWER_CASE_LEASE_INVALID");
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("TRUSTED_ANSWER_CASE_LEASE_INVALID");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TRUSTED_ANSWER_CASE_LEASE_INVALID");
  }
  const lease = value as CandidateLease;
  if (
    lease.schemaVersion !== "origin.answer-case-lease-candidate.v2"
    || !/^[a-f0-9]{32}$/.test(lease.leaseId)
    || typeof lease.prompt !== "string"
    || lease.prompt.trim().length === 0
    || lease.prompt.length > 24_000
    || Object.keys(lease).sort().join(",") !== "leaseId,prompt,schemaVersion"
  ) {
    throw new Error("TRUSTED_ANSWER_CASE_LEASE_INVALID");
  }
  return lease;
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (Buffer.byteLength(current, "utf8") >= MAX_PROXY_RESPONSE_BYTES) return current;
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, "utf8") <= MAX_PROXY_RESPONSE_BYTES) return next;
  return Buffer.from(next, "utf8").subarray(0, MAX_PROXY_RESPONSE_BYTES).toString("utf8");
}

async function proxyExecute(rawRequest: unknown): Promise<any> {
  const socketPath = process.env.ORIGIN_TRUSTED_ANSWER_PROVIDER_SOCKET ?? "";
  const token = process.env.ORIGIN_TRUSTED_ANSWER_PROVIDER_TOKEN ?? "";
  if (!socketPath.startsWith("/") || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("TRUSTED_ANSWER_PROVIDER_PROXY_UNAVAILABLE");
  }

  const body = trustedStringify(rawRequest);
  if (Buffer.byteLength(body, "utf8") > 128 * 1024) {
    throw new Error("TRUSTED_ANSWER_PROVIDER_REQUEST_TOO_LARGE");
  }

  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({
      socketPath,
      path: "/execute",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 55_000,
    }, res => {
      let output = "";
      res.on("data", chunk => { output = appendBounded(output, chunk); });
      res.on("end", () => resolve({ status: res.statusCode ?? 500, body: output }));
    });
    req.once("timeout", () => req.destroy(new Error("TRUSTED_ANSWER_PROVIDER_PROXY_TIMEOUT")));
    req.once("error", reject);
    req.end(body);
  });

  let parsed: any;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error("TRUSTED_ANSWER_PROVIDER_PROXY_RESPONSE_INVALID");
  }
  if (response.status !== 200 || parsed?.ok !== true || !parsed.result) {
    const code = typeof parsed?.code === "string" && /^(?:PROVIDER|TRUSTED_ANSWER_PROVIDER)_[A-Z0-9_:-]+$/.test(parsed.code)
      ? parsed.code
      : "TRUSTED_ANSWER_PROVIDER_PROXY_EXECUTION_FAILED";
    throw Object.assign(new Error(code), { code, status: response.status });
  }
  return parsed.result;
}

function emit(envelope: Record<string, unknown>, exitCode: number): void {
  trustedRemoveAllListeners("beforeExit");
  trustedRemoveAllListeners("exit");
  trustedWriteSync(1, RESULT_PREFIX + trustedStringify(envelope) + "\n");
  trustedExit(exitCode);
}

function safeContent(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 400_000) {
    throw new Error("TRUSTED_ANSWER_CANDIDATE_RESPONSE_INVALID");
  }
  return value;
}

async function main(): Promise<void> {
  const lease = parseLease();
  const candidateRoot = process.env.ORIGIN_CANDIDATE_ROOT ?? "/work";
  if (!candidateRoot.startsWith("/")) throw new Error("TRUSTED_ANSWER_CANDIDATE_ROOT_INVALID");

  const requireFromCandidate = createRequire(path.join(candidateRoot, "package.json"));
  const expressModule = requireFromCandidate("express");
  const supertestModule = requireFromCandidate("supertest");
  const express = expressModule.default ?? expressModule;
  const supertest = supertestModule.default ?? supertestModule;

  const routerModule = await import(pathToFileURL(path.join(candidateRoot, "src/legacy/originChatRouter.ts")).href);
  if (typeof routerModule.createOriginChatRouter !== "function") {
    throw new Error("TRUSTED_ANSWER_CHAT_ENTRYPOINT_MISSING");
  }

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(routerModule.createOriginChatRouter({
    env: {
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "trusted-proxy-only",
      FREE_ONLY: "true",
    },
    execute: proxyExecute,
    createRequestId: () => "trusted-answer-case",
  }));

  const startedAt = monotonicNow();
  const response = await supertest(app)
    .post("/api/chat")
    .set("Accept", "application/json")
    .send({ messages: [{ role: "user", content: lease.prompt }] });
  const durationMs = Number(monotonicNow() - startedAt) / 1_000_000;

  const body = response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : null;
  if (!body) throw new Error("TRUSTED_ANSWER_CANDIDATE_RESPONSE_INVALID");

  if (response.status < 200 || response.status >= 300) {
    const rawCode = body.code;
    const safeCode = typeof rawCode === "string"
      && /^(?:PROVIDER|FREE_MODEL|FREE_PROVIDER|INVALID_EXECUTION)_[A-Z0-9_:-]+$/.test(rawCode)
      ? rawCode
      : undefined;
    const envelope = trustedObjectCreate(null) as Record<string, unknown>;
    envelope.schemaVersion = "origin.trusted-answer-candidate-result.v2";
    envelope.leaseId = lease.leaseId;
    envelope.httpStatus = response.status;
    if (safeCode) envelope.error = safeCode;
    emit(envelope, 1);
  }

  const content = safeContent(body.content);

  const routing = body.routing && typeof body.routing === "object"
    ? body.routing as Record<string, unknown>
    : trustedObjectCreate(null);
  const projectedRouting = trustedObjectCreate(null) as Record<string, unknown>;
  for (const key of ["providerId", "modelId", "taskType", "actualCostUsd", "estimatedCostUsd", "freeOnly", "providerAttempts", "verificationStatus", "answerMode", "verificationLevel"]) {
    const value = routing[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      projectedRouting[key] = value;
    }
  }

  const envelope = trustedObjectCreate(null) as Record<string, unknown>;
  envelope.schemaVersion = "origin.trusted-answer-candidate-result.v2";
  envelope.leaseId = lease.leaseId;
  envelope.httpStatus = response.status;
  envelope.durationMs = durationMs;
  envelope.content = content;
  envelope.routing = projectedRouting;
  emit(envelope, response.status >= 200 && response.status < 300 ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const code = /^(?:TRUSTED_ANSWER|PROVIDER|FREE_MODEL|FREE_PROVIDER|INVALID_EXECUTION)_[A-Z0-9_:-]+$/.test(message)
    ? message
    : "TRUSTED_ANSWER_CANDIDATE_FATAL";
  const envelope = trustedObjectCreate(null) as Record<string, unknown>;
  envelope.schemaVersion = "origin.trusted-answer-candidate-result.v2";
  envelope.error = code;
  emit(envelope, 1);
});
