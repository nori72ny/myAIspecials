import { promises as fs } from "node:fs";
import path from "node:path";

import {
  aggregateOriginTrustedAnswerRunV2,
  type OriginTrustedAnswerCaseEvidenceV2,
} from "../src/release/OriginTrustedAnswerRunV2.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`AQ_V2_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

async function main(): Promise<void> {
  const root = requiredEnv("ORIGIN_AQ_V2_CASE_RESULT_ROOT");
  const candidateSha = requiredEnv("ORIGIN_CANDIDATE_SHA").toLowerCase();
  const corpusDigest = requiredEnv("ORIGIN_AQ_V2_CORPUS_DIGEST");
  const roundId = requiredEnv("ORIGIN_AQ_V2_ROUND_ID");
  const executionId = requiredEnv("ORIGIN_AQ_V2_EXECUTION_ID");
  const evaluatorSha = requiredEnv("ORIGIN_AQ_V2_EVALUATOR_SHA").toLowerCase();
  const outputPath = process.env.ORIGIN_AQ_V2_TRUSTED_EXECUTION_PATH
    ?? path.resolve("test-results", "trusted-answer-execution-v2.json");

  const cases: OriginTrustedAnswerCaseEvidenceV2[] = [];
  for (let ordinal = 0; ordinal < 48; ordinal += 1) {
    const file = path.join(root, `trusted-answer-case-${ordinal}.json`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      throw new Error("AQ_V2_TRUSTED_RUN_CASE_FILE_INVALID");
    }
    cases.push(parsed as OriginTrustedAnswerCaseEvidenceV2);
  }

  const aggregate = aggregateOriginTrustedAnswerRunV2(cases, {
    candidateSha,
    corpusDigest,
    roundId,
    executionId,
    evaluatorSha,
    sameRepoOpenPrHead: process.env.ORIGIN_AQ_V2_PR_BINDING_VERIFIED === "true",
    trustedHostControlled: process.env.ORIGIN_AQ_V2_TRUSTED_HOST_CONTROLLED === "true",
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(aggregate, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  process.stdout.write(JSON.stringify({
    event: "trusted-answer-run-complete",
    candidateSha,
    completedCases: aggregate.completedCases,
    providerRequestCount: aggregate.evidence.providerRequestCount,
    evaluatorSha: aggregate.binding.evaluatorSha,
    rubricDigest: aggregate.binding.rubricDigest,
    zeroCostVerified: aggregate.evidence.zeroCostVerified,
    qualificationPassed: aggregate.qualification.passed,
    resultDigest: aggregate.evidence.resultDigest,
  }) + "\n");

  if (!aggregate.qualification.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const code = /^(?:AQ_V2|TRUSTED_ANSWER)_[A-Z0-9_:-]+$/.test(message)
    ? message
    : "AQ_V2_TRUSTED_RUN_SUMMARY_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
