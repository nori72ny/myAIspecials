import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = "8790";
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/server.cjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    TEST_PORT: port,
    FREE_ONLY: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

try {
  let healthResponse;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited before becoming ready.\n${output}`);
    }
    try {
      healthResponse = await fetch(`${baseUrl}/api/health`);
      if (healthResponse.ok) break;
    } catch {
      // Server startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  assert.ok(healthResponse, `Production server did not become ready.\n${output}`);
  assert.equal(healthResponse.status, 200);
  assert.match(healthResponse.headers.get("content-type") ?? "", /application\/json/i);

  const health = await healthResponse.json();
  assert.equal(health.status, "ok");

  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type") ?? "", /text\/html/i);
  assert.match(await pageResponse.text(), /<!doctype|<html/i);

  const unicodePdfResponse = await fetch(`${baseUrl}/api/artifacts/v1.2/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "pdf",
      title: "日本語PDF検証",
      content: "営業資料：前年比を確認します。 ABC 123",
    }),
  });
  assert.equal(unicodePdfResponse.status, 200);
  assert.match(unicodePdfResponse.headers.get("content-type") ?? "", /application\/pdf/i);
  assert.equal(unicodePdfResponse.headers.get("x-origin-artifact-verified"), "true");
  assert.equal(unicodePdfResponse.headers.get("x-origin-free-only"), "true");
  assert.equal(unicodePdfResponse.headers.get("x-origin-cost-usd"), "0");
  const unicodePdfBytes = Buffer.from(await unicodePdfResponse.arrayBuffer());
  assert.equal(unicodePdfBytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(unicodePdfBytes.length > 1000);

  console.log("Node production runtime smoke test passed.");
} finally {
  server.kill("SIGTERM");
}
