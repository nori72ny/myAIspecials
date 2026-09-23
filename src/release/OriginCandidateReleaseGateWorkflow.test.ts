// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

describe("candidate release gate workflow", () => {
  it("aggregates build, artifact isolation and dependency review without treating skipped as green", () => {
    expect(workflow).toContain("candidate-release-gate:");
    expect(workflow).toContain("name: Release Gate (CI core)");
    expect(workflow).toContain("always() && github.event_name == 'pull_request'");
    expect(workflow).toContain("- build-and-test");
    expect(workflow).toContain("- artifact-preview-isolation");
    expect(workflow).toContain("- dependency-review");
    expect(workflow).toContain('[ "$BUILD_RESULT" = "success" ]');
    expect(workflow).toContain('[ "$ARTIFACT_RESULT" = "success" ]');
    expect(workflow).toContain('[ "$DEPENDENCY_RESULT" = "success" ]');
  });
});
