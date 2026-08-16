import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/assert-origin-production-env.mjs");
const releaseSha = "0123456789abcdef0123456789abcdef01234567";
let directory: string;
let imageShaFile: string;

function validate(overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      NODE_ENV: "production",
      FREE_ONLY: "true",
      ORIGIN_RELEASE_SHA: releaseSha,
      ORIGIN_IMAGE_RELEASE_SHA_FILE: imageShaFile,
      OPENROUTER_API_KEY: "synthetic-test-secret",
      ...overrides,
    },
  });
}

describe("Cloud Run production environment guard", () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "origin-production-env-"));
    imageShaFile = join(directory, "ORIGIN_RELEASE_SHA");
    writeFileSync(imageShaFile, releaseSha);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("accepts only the fixed free production boundary", () => {
    const result = validate();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([
    [{ ORIGIN_RELEASE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, "Runtime release SHA does not match"],
    [{ NODE_ENV: "development" }, "NODE_ENV must be production"],
    [{ FREE_ONLY: "false" }, "FREE_ONLY must be true"],
    [{ OPENROUTER_API_KEY: "" }, "OPENROUTER_API_KEY must be provided"],
    [{ GEMINI_API_KEY: "synthetic-forbidden" }, "GEMINI_API_KEY is forbidden"],
    [{ GOOGLE_API_KEY: "synthetic-forbidden" }, "GOOGLE_API_KEY is forbidden"],
    [{ GOOGLE_GENERATIVE_AI_API_KEY: "synthetic-forbidden" }, "GOOGLE_GENERATIVE_AI_API_KEY is forbidden"],
    [{ OPENAI_API_KEY: "synthetic-forbidden" }, "OPENAI_API_KEY is forbidden"],
    [{ ANTHROPIC_API_KEY: "synthetic-forbidden" }, "ANTHROPIC_API_KEY is forbidden"],
    [{ ORIGIN_AI_STUDIO_API_KEY: "synthetic-forbidden" }, "ORIGIN_AI_STUDIO_API_KEY is forbidden"],
    [{ ORIGIN_AI_STUDIO_RUNTIME_ENABLED: "true" }, "ORIGIN_AI_STUDIO_RUNTIME_ENABLED is forbidden"],
    [{ ORIGIN_AI_STUDIO_OWNER_APPROVED: "true" }, "ORIGIN_AI_STUDIO_OWNER_APPROVED is forbidden"],
    [{ VERCEL_GIT_COMMIT_SHA: releaseSha }, "VERCEL_GIT_COMMIT_SHA is forbidden"],
  ])("rejects unsafe production environment %o", (overrides, message) => {
    const result = validate(overrides);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain("synthetic-test-secret");
    expect(result.stderr).not.toContain("synthetic-forbidden");
  });
});
