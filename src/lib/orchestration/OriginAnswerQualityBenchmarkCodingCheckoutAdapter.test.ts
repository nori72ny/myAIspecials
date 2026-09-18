import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createOriginAnswerQualityBenchmarkCodingCheckoutAdapter,
  type OriginAnswerQualityBenchmarkGitExecutor,
} from "./OriginAnswerQualityBenchmarkCodingCheckoutAdapter";
import { readOriginAnswerQualityBenchmarkRuntimeAdapterMetadata } from "./OriginAnswerQualityBenchmarkRuntimeAdapter";

const roots: string[] = [];

async function repo(): Promise<{
  root: string;
  sha: string;
  gitExecutor: OriginAnswerQualityBenchmarkGitExecutor;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "origin-aq-coding-adapter-test-"));
  roots.push(root);
  const sha = "a".repeat(40);
  await fs.writeFile(path.join(root, "tracked.txt"), "baseline\n", "utf8");
  await fs.mkdir(path.join(root, "node_modules"));

  const gitExecutor: OriginAnswerQualityBenchmarkGitExecutor = async (args, cwd) => {
    expect(cwd).toBe(root);
    if (args.join(" ") === "rev-parse --verify HEAD") return { stdout: `${sha}\n` };
    if (args.join(" ") === "diff-index --quiet HEAD --") {
      const tracked = await fs.readFile(path.join(root, "tracked.txt"), "utf8");
      if (tracked !== "baseline\n") throw new Error("dirty");
      return { stdout: "" };
    }
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  };

  return { root, sha, gitExecutor };
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
      gitExecutor: fixture.gitExecutor,
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
      gitExecutor: fixture.gitExecutor,
    })).rejects.toThrow("AQ_BENCHMARK_CODING_SOURCE_SHA_MISMATCH");
  });

  it("rejects tracked workspace drift before any model or verification execution", async () => {
    const fixture = await repo();
    await fs.writeFile(path.join(fixture.root, "tracked.txt"), "changed\n", "utf8");

    await expect(createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: fixture.root,
      expectedGitSha: fixture.sha,
      env: {},
      gitExecutor: fixture.gitExecutor,
    })).rejects.toThrow("AQ_BENCHMARK_CODING_CHECKOUT_DIRTY");
  });

  it("rejects malformed expected revisions before invoking git", async () => {
    const fixture = await repo();
    let gitCalled = false;
    const gitExecutor: OriginAnswerQualityBenchmarkGitExecutor = async () => {
      gitCalled = true;
      return { stdout: fixture.sha };
    };

    await expect(createOriginAnswerQualityBenchmarkCodingCheckoutAdapter({
      sourceRoot: fixture.root,
      expectedGitSha: "not-a-sha",
      env: {},
      gitExecutor,
    })).rejects.toThrow("AQ_BENCHMARK_CODING_SHA_INVALID");
    expect(gitCalled).toBe(false);
  });
});
