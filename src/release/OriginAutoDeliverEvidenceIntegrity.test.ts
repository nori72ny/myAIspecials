// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "scripts/auto-deliver.mjs"), "utf8");

describe("legacy delivery evidence integrity", () => {
  it("never fabricates test counts or substitute PASS result files", () => {
    expect(script).not.toContain("let passCount = 342");
    expect(script).not.toContain("<results><status>PASSED</status></results>");
    expect(script).toContain("no substitute PASS artifact will be created");
    expect(script).toContain("vitestJunitCaptured");
  });

  it("labels local command success as local evidence rather than Production approval", () => {
    expect(script).toContain("LOCAL_GATES_PASSED");
    expect(script).toContain("does not prove GitHub CI");
    expect(script).toContain("independent AQ/Coding qualification");
    expect(script).toContain("Production release readiness");
  });

  it("never embeds GitHub credentials in remote URLs or git metadata", () => {
    expect(script).not.toContain("x-access-token:${githubToken}@");
    expect(script).not.toContain("authed_origin");
    expect(script).toContain("GIT_ASKPASS");
    expect(script).toContain("GIT_TERMINAL_PROMPT");
    expect(script).toContain("os.tmpdir()");
  });

  it("does not instruct users to create broad PAT credentials", () => {
    expect(script).not.toContain("Full control of private repositories");
    expect(script).not.toContain("Personal Access Token (PAT)");
    expect(script).toContain("least-privilege GitHub credential");
    expect(script).toContain("Never paste tokens into chat");
  });

  it("still refuses direct delivery from main", () => {
    expect(script).toContain("if (currentBranch === defaultBranch)");
    expect(script).toContain("Direct delivery on");
  });
});
