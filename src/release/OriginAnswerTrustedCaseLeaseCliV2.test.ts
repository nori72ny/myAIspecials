// @vitest-environment node
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ORIGIN_AQ_V2_FAMILIES } from "./OriginAnswerExperienceV2.js";
import {
  ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
  prepareOriginAnswerExperienceSealedCorpusV2,
} from "./OriginAnswerExperienceSealedCorpusV2.js";

const tempRoots: string[] = [];

function fixtureCorpus() {
  return {
    schemaVersion: ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
    corpusId: "aq-v2-cli-contract",
    cases: ORIGIN_AQ_V2_FAMILIES.flatMap((family, familyIndex) =>
      Array.from({ length: 3 }, (_, index) => ({
        caseId: `aq2-${String(familyIndex + 1).padStart(2, "0")}-${index + 1}`,
        family,
        prompt: `SEALED PROMPT ${familyIndex + 1}-${index + 1}`,
        evaluatorNotes: `SEALED NOTES ${familyIndex + 1}-${index + 1}`,
      })),
    ),
  };
}

afterEach(() => {
  while (tempRoots.length) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("AQ V2 trusted case CLI bridge", () => {
  it("emits only one prompt lease while keeping binding metadata in a 0600 trusted file", () => {
    const corpus = fixtureCorpus();
    const prepared = prepareOriginAnswerExperienceSealedCorpusV2(corpus);
    const encoded = gzipSync(Buffer.from(JSON.stringify(corpus), "utf8")).toString("base64");
    const root = mkdtempSync(join(tmpdir(), "origin-aq-v2-"));
    tempRoots.push(root);
    const trustedLeasePath = join(root, "trusted-lease.json");

    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/prepare-trusted-answer-case-v2.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64: encoded,
          ORIGIN_CANDIDATE_SHA: "a".repeat(40),
          ORIGIN_AQ_V2_ROUND_ID: "round-2026-09-23-a",
          ORIGIN_AQ_V2_CASE_ORDINAL: "7",
          ORIGIN_AQ_V2_TRUSTED_LEASE_PATH: trustedLeasePath,
        },
      },
    );

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");

    const candidate = JSON.parse(run.stdout);
    expect(Object.keys(candidate).sort()).toEqual(["leaseId", "prompt", "schemaVersion"]);
    expect(candidate.prompt).toBe("SEALED PROMPT 3-2");
    expect(run.stdout).not.toContain("SEALED NOTES");
    expect(run.stdout).not.toContain(prepared.corpusDigest);
    expect(run.stdout).not.toContain("round-2026-09-23-a");
    expect(run.stdout).not.toContain("a".repeat(40));
    expect(run.stdout).not.toContain('"family"');
    expect(run.stdout).not.toContain('"ordinal"');

    const trusted = JSON.parse(readFileSync(trustedLeasePath, "utf8"));
    expect(trusted.candidateSha).toBe("a".repeat(40));
    expect(trusted.roundId).toBe("round-2026-09-23-a");
    expect(trusted.caseId).toBe("aq2-03-2");
    expect(trusted.family).toBe(ORIGIN_AQ_V2_FAMILIES[2]);
    expect(trusted.evaluatorNotes).toBe("SEALED NOTES 3-2");
    expect(trusted.ordinal).toBe(7);
    expect(trusted.totalCases).toBe(48);
    expect(statSync(trustedLeasePath).mode & 0o777).toBe(0o600);
  });

  it("fails closed rather than overwriting an existing trusted lease path", () => {
    const corpus = fixtureCorpus();
    const encoded = gzipSync(Buffer.from(JSON.stringify(corpus), "utf8")).toString("base64");
    const root = mkdtempSync(join(tmpdir(), "origin-aq-v2-"));
    tempRoots.push(root);
    const trustedLeasePath = join(root, "trusted-lease.json");

    const env = {
      ...process.env,
      ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64: encoded,
      ORIGIN_CANDIDATE_SHA: "a".repeat(40),
      ORIGIN_AQ_V2_ROUND_ID: "round-2026-09-23-a",
      ORIGIN_AQ_V2_CASE_ORDINAL: "0",
      ORIGIN_AQ_V2_TRUSTED_LEASE_PATH: trustedLeasePath,
    };

    const first = spawnSync(process.execPath, ["--import", "tsx", "scripts/prepare-trusted-answer-case-v2.ts"], {
      cwd: process.cwd(), encoding: "utf8", env,
    });
    const second = spawnSync(process.execPath, ["--import", "tsx", "scripts/prepare-trusted-answer-case-v2.ts"], {
      cwd: process.cwd(), encoding: "utf8", env,
    });

    expect(first.status).toBe(0);
    expect(second.status).not.toBe(0);
    expect(second.stdout).toBe("");
  });
});
