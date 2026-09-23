import { promises as fs } from "node:fs";
import path from "node:path";

import type { OriginTrustedAnswerRunAggregateV2 } from "../src/release/OriginTrustedAnswerRunV2.js";
import {
  qualifyOriginTrustedAnswerQualityV2,
  type OriginTrustedAnswerScoreBundleV2,
} from "../src/release/OriginTrustedAnswerQualityV2.js";

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
}

async function main(): Promise<void> {
  const executionPath = process.argv[2];
  const scoresPath = process.argv[3];
  const outputPath = process.argv[4] ?? path.resolve("test-results", "trusted-answer-quality-v2.json");
  if (!executionPath || !scoresPath) {
    throw new Error("AQ_V2_SCORE_USAGE: expected <trusted-execution.json> <external-score-bundle.json> [output.json]");
  }

  const execution = await readJson(executionPath) as OriginTrustedAnswerRunAggregateV2;
  const scores = await readJson(scoresPath) as OriginTrustedAnswerScoreBundleV2;
  const report = qualifyOriginTrustedAnswerQualityV2(execution, scores);

  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), JSON.stringify(report, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(JSON.stringify({
    event: "trusted-answer-quality-qualified",
    candidateSha: report.candidateSha,
    executionPassed: report.executionPassed,
    scoringIdentityBound: report.scoringIdentityBound,
    absoluteQualityPassed: report.absoluteQualityPassed,
    passed: report.passed,
    blockers: report.blockers,
  }) + "\n");
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "AQ_V2_SCORE_QUALIFICATION_FAILED";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
