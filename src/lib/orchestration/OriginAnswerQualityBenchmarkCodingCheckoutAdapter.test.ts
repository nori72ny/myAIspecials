import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createOriginAnswerQualityBenchmarkCodingCheckoutAdapter } from "./OriginAnswerQualityBenchmarkCodingCheckoutAdapter";
import { readOriginAnswerQualityBenchmarkRuntimeAdapterMetadata } from "./OriginAnswerQualityBenchmarkRuntimeAdapter";

const executeFile = promisify(execFile);
const roots: string[] = [];

async function repo(): Promise<{ root: string; sha: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "origin-aq-coding-adapter-test-"));
  roots.push(root);
  await executeFile("git", ["init"], { cwd: root });
  await executeFile("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await executeFile("git", ["config", "user.name", "ORIGIN Test"], { cwd: root });
  await fs.writeFile(path.join(root, "tracked.txt"), "baseline\n", "utf8");
  await fs.mkdir(path.join(root, "node_modules"));
  await executeFile("git", ["add", "tracked.txt"], { cwd: root });
  await executeFile("git", ["commit", "-m", "baseline"], { cwd: root });
  const { stdout } = await executeFile("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return { root, sha: stdout.trim() };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("OriginAnswerQualityBenchmarkCodingCheckoutAdapter", () => {
  it("brands only the exact clean checkout as the coding v1.4 runtime", async () => {
    const fixture = await repo();
    const adapter = await createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: fixture.root,
      expectedGitSha: fixture.sha,
      env: {},
    });

    expect(readOriginAnswerQualityBenchmarkRuntimeAdapterMetadata(adapter)).toEqual({
      lane: "coding",
      runtimeId: "coding-v1.4",
      freeOnly: true,
      productionPath: true,
    });
  });

  it("rejects an expected SHA that differs from the checkout", async () => {
    const fixture = await repo();
    await expect(createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: fixture.root,
      expectedGitSha: "b".repeat(40),
      env: {},
    })).rejects.toThrow("AQ_BENCHMARK_CODING_SOURCE_SHA_MISMATCH");
  });

  it("rejects tracked workspace drift before any model or verification execution", async () => {
    const fixture = await repo();
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "changed\n", "utf8");

    await expect(createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: fixture.root,
      expectedGitSha: fixture.sha,
      env: {},
    })).rejects.toThrow("AQ_BENCHMARK_CODING_CHECKOUT_DIRTY");
  });

  it("rejects malformed expected revisions", async () => {
    const fixture = await repo();
    await expect(createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: fixture.root,
      expectedGitSha: "not-a-sha",
      env: {},
    })).rejects.toThrow("AQ_BENCHMARK_CODING_SHA_INVALID");
  });
});
