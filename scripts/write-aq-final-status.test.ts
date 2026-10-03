import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const script = resolve(process.cwd(), "scripts/write-aq-final-status.mjs");
const candidateSha = "a".repeat(40);
const baselineSha = "b".repeat(40);

function root(): string {
  const value = mkdtempSync(resolve(tmpdir(), "origin-aq-final-status-"));
  roots.push(value);
  return value;
}

function run(base: string) {
  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      AQ_STATE_DIR: resolve(base, "state"),
      AQ_STATUS_OUTPUT_PATH: resolve(base, "status/status.json"),
      AQ_PROMOTION_PATH: resolve(base, "final/promotion.json"),
      EXPECTED_SHARD_COUNT: "16",
      CANDIDATE_SHA: candidateSha,
      BASELINE_SHA: baselineSha,
    },
  });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("write-aq-final-status", () => {
  it("records NOT_MEASURED when final evidence is incomplete", () => {
    const base = root();
    const result = run(base);

    expect(result.status).toBe(0);
    const status = JSON.parse(readFileSync(resolve(base, "status/status.json"), "utf8"));
    expect(status).toMatchObject({
      schemaVersion: "origin.aq-live-final-status.v1",
      candidateSha,
      baselineSha,
      expectedShardCount: 16,
      completedShardCount: 0,
      qualificationStatus: "NOT_MEASURED",
      measured: false,
      promotionEligible: false,
      blockers: ["AQ_FINAL_EVIDENCE_INCOMPLETE"],
    });
  });

  it("records QUALIFIED only for exact complete promotion evidence", () => {
    const base = root();
    mkdirSync(resolve(base, "state"), { recursive: true });
    mkdirSync(resolve(base, "final"), { recursive: true });
    for (let index = 0; index < 16; index += 1) {
      writeFileSync(resolve(base, `state/aq-official-shard-${index}.json`), "{}\n");
    }
    writeFileSync(
      resolve(base, "final/promotion.json"),
      JSON.stringify({
        schemaVersion: "origin.aq-live-final-promotion.v1",
        candidateSha,
        baselineSha,
        caseCount: 40,
        familyCount: 10,
        shardCount: 16,
        promotionEligible: true,
        blockers: [],
      }),
    );

    const result = run(base);
    expect(result.status).toBe(0);
    const status = JSON.parse(readFileSync(resolve(base, "status/status.json"), "utf8"));
    expect(status.qualificationStatus).toBe("QUALIFIED");
    expect(status.measured).toBe(true);
    expect(status.promotionEligible).toBe(true);
    expect(status.completedShardCount).toBe(16);
  });

  it("fails closed when promotion evidence exists but is malformed", () => {
    const base = root();
    mkdirSync(resolve(base, "final"), { recursive: true });
    writeFileSync(resolve(base, "final/promotion.json"), "{not-json\n");

    const result = run(base);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AQ_FINAL_STATUS_PROMOTION_INVALID_JSON");
  });
});
