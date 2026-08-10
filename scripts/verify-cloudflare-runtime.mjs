import assert from "node:assert/strict";

const baseUrl = process.env.ORIGIN_RUNTIME_BASE_URL ?? "http://127.0.0.1:8787";
const sameOriginHeaders = {
  "content-type": "application/json",
  origin: baseUrl,
};

async function readJson(response, label) {
  const contentType = response.headers.get("content-type") ?? "";
  assert.match(contentType, /application\/json/i, `${label} must return JSON, got ${contentType}`);
  const text = await response.text();
  assert.doesNotMatch(text, /<!doctype|<html/i, `${label} returned an HTML fallback`);
  return JSON.parse(text);
}

const healthResponse = await fetch(`${baseUrl}/api/health`);
assert.equal(healthResponse.status, 200);
const health = await readJson(healthResponse, "GET /api/health");
assert.equal(health.status, "ok");
assert.equal(health.service, "acos-2");

const invalidChatResponse = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: sameOriginHeaders,
  body: JSON.stringify({ messages: [] }),
});
assert.equal(invalidChatResponse.status, 400);
const invalidChat = await readJson(invalidChatResponse, "invalid POST /api/chat");
assert.equal(invalidChat.code, "INVALID_CHAT_MESSAGES");

const noSecretResponse = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: sameOriginHeaders,
  body: JSON.stringify({
    messages: [{ role: "user", content: "短いテストです。" }],
  }),
});
assert.equal(noSecretResponse.status, 503);
const noSecret = await readJson(noSecretResponse, "credential-free POST /api/chat");
assert.equal(typeof noSecret.code, "string");

const crossOriginResponse = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://attacker.invalid",
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "送信されないテストです。" }],
  }),
});
assert.equal(crossOriginResponse.status, 403);
await readJson(crossOriginResponse, "cross-origin POST /api/chat");

const oversizedResponse = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: sameOriginHeaders,
  body: JSON.stringify({
    messages: [{ role: "user", content: "a".repeat(70 * 1024) }],
  }),
});
assert.equal(oversizedResponse.status, 413);
const oversized = await readJson(oversizedResponse, "oversized POST /api/chat");
assert.equal(oversized.code, "REQUEST_BODY_TOO_LARGE");

const pageResponse = await fetch(`${baseUrl}/`);
assert.equal(pageResponse.status, 200);
assert.match(pageResponse.headers.get("content-type") ?? "", /text\/html/i);

console.log("Cloudflare workerd runtime gate passed without credentials or external AI calls.");
