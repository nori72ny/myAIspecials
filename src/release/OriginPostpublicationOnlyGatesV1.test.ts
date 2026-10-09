import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const workflows = [
  ".github/workflows/production-raster-readiness.yml",
  ".github/workflows/production-artifact-integrity.yml",
  ".github/workflows/production-world-class-image-safety.yml",
];
describe("Production-only publication verification boundaries", () => {
  it.each(workflows)("%s runs only after explicit postpublication dispatch on main", (file) => {
    const yml = readFileSync(file, "utf8");
    expect(yml).toMatch(/^on:\n  # Git main acceptance/m);
    expect(yml).toContain("  workflow_dispatch:");
    expect(yml).not.toContain("  workflow_run:");
    expect(yml).toContain("required: true");
    expect(yml).toContain("promoted_sha:");
    expect(yml).toContain("github.event_name == 'workflow_dispatch'");
    expect(yml).toContain("github.ref == 'refs/heads/main'");
    expect(yml).toContain('PROMOTED_SHA: ${{ inputs.promoted_sha }}');
    expect(yml).toContain('[ "$PROMOTED_SHA" = "$GITHUB_SHA" ]');
    expect(yml).toContain("CANDIDATE_SHA: ${{ github.sha }}");
    expect(yml).not.toContain("github.event.workflow_run.head_sha");
    expect(yml).toContain("ORIGIN_PRODUCTION_URL: https://origin-personal.vercel.app");
  });
});
