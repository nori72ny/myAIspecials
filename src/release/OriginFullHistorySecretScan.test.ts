// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

describe("full-history secret scanning gate", () => {
  it("uses the Node 24 Gitleaks v3 release pinned to an immutable commit", () => {
    expect(workflow).toContain("gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e");
    expect(workflow).not.toContain("gitleaks/gitleaks-action@v2");
  });

  it("scans the complete fetched Git history in addition to event-range scanning", () => {
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("Run Full Git History Secret Scan");
    expect(workflow).toContain('gitleaks detect --redact -v --exit-code=2 --log-opts="--all"');
  });
});
