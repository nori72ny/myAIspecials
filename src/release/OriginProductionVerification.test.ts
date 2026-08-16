import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_SHA = "1234567890abcdef1234567890abcdef12345678";
const SCRIPT_PATH = resolve(
  process.cwd(),
  "scripts/verify-production-deployment.mjs",
);

async function runVerifier(baseUrl: string, overrides: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [SCRIPT_PATH], {
    env: {
      ...process.env,
      ORIGIN_PRODUCTION_URL: baseUrl,
      ORIGIN_EXPECTED_SHA: EXPECTED_SHA,
      ORIGIN_DEPLOY_TIMEOUT_MS: "200",
      ORIGIN_DEPLOY_POLL_INTERVAL_MS: "10",
      ORIGIN_REQUEST_TIMEOUT_MS: "100",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [exitCode] = await once(child, "exit");
  return { exitCode, stdout, stderr };
}

describe("ORIGIN production verification", () => {
  it("keeps the post-merge workflow tied to successful main validation", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("production-smoke:");
    expect(workflow).toContain("needs: build-and-test");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("ORIGIN_EXPECTED_SHA: ${{ github.sha }}");
    expect(workflow).toContain("node scripts/verify-production-deployment.mjs");
    expect(workflow).not.toContain("VERCEL_TOKEN");
  });

  it("rejects a non-HTTPS production target before making a request", async () => {
    const result = await runVerifier("http://127.0.0.1:9", {
      ORIGIN_PRODUCTION_URL: "http://127.0.0.1:9",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Production smoke tests require HTTPS");
  });
});
