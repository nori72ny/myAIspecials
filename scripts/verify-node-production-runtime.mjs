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

  console.log("Node production runtime smoke test passed.");
} finally {
  server.kill("SIGTERM");
}
