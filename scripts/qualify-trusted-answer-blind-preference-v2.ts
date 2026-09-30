import { promises as fs } from "node:fs";
import path from "node:path";

import type { OriginTrustedAnswerRunAggregateV2 } from "../src/release/OriginTrustedAnswerRunV2.js";
import {
  qualifyOriginTrustedBlindPreferenceV2,
  type OriginTrustedBlindPreferenceBundleV2,
} from "../src/release/OriginTrustedBlindPreferenceV2.js";

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
}

async function main(): Promise<void> {
  const executionPath = process.argv[2];
  const blindBundlePath = process.argv[3];
  const outputPath = process.argv[4]
    ?? path.resolve("test-results", "trusted-answer-blind-preference-v2.json");

  if (!executionPath || !blindBundlePath) {
    throw new Error(
      "AQ_V2_TRUSTED_BLIND_USAGE: expected <trusted-execution.json> <trusted-blind-bundle.json> [output.json]",
    );
  }

  const execution = await readJson(executionPath) as OriginTrustedAnswerRunAggregateV2;
  const bundle = await readJson(blindBundlePath) as OriginTrustedBlindPreferenceBundleV2;
  const report = qualifyOriginTrustedBlindPreferenceV2(execution, bundle);

  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), JSON.stringify(report, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });

  process.stdout.write(JSON.stringify({
    event: "trusted-answer-blind-preference-qualified",
    candidateSha: report.candidateSha,
    identityBound: report.identityBound,
    referenceEvidenceBound: report.referenceEvidenceBound,
    judgeEvidenceBound: report.judgeEvidenceBound,
    answerBindingsBound: report.answerBindingsBound,
    competitiveEvidencePassed: report.competitiveEvidencePassed,
    passed: report.passed,
    blockers: report.blockers,
  }) + "\n");

  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "AQ_V2_TRUSTED_BLIND_QUALIFICATION_FAILED";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
