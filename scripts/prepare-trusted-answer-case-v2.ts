import { writeFileSync } from "node:fs";

import {
  parseOriginAnswerExperienceSealedCorpusGzipBase64V2,
} from "../src/release/OriginAnswerExperienceSealedCorpusV2.js";
import {
  assertOriginAnswerCaseLeaseIsolationV2,
  leaseOriginAnswerExperienceCaseV2,
} from "../src/release/OriginAnswerTrustedCaseLeaseV2.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`AQ_V2_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function parseOrdinal(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("AQ_V2_CASE_ORDINAL_INVALID");
  const ordinal = Number(value);
  if (!Number.isSafeInteger(ordinal)) throw new Error("AQ_V2_CASE_ORDINAL_INVALID");
  return ordinal;
}

function main(): void {
  const encoded = requiredEnv("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64");
  const candidateSha = requiredEnv("ORIGIN_CANDIDATE_SHA");
  const roundId = requiredEnv("ORIGIN_AQ_V2_ROUND_ID");
  const ordinal = parseOrdinal(requiredEnv("ORIGIN_AQ_V2_CASE_ORDINAL"));
  const trustedLeasePath = requiredEnv("ORIGIN_AQ_V2_TRUSTED_LEASE_PATH");

  const prepared = parseOriginAnswerExperienceSealedCorpusGzipBase64V2(encoded);
  const leased = leaseOriginAnswerExperienceCaseV2(prepared, {
    candidateSha,
    roundId,
    ordinal,
  });

  assertOriginAnswerCaseLeaseIsolationV2({
    ...leased,
    fullCorpusSerialized: JSON.stringify(prepared.privateCorpus),
  });

  writeFileSync(
    trustedLeasePath,
    JSON.stringify(leased.trustedLease, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );

  process.stdout.write(JSON.stringify(leased.candidateLease) + "\n");
}

try {
  main();
} catch (error) {
  const code = error instanceof Error ? error.message : "AQ_V2_TRUSTED_CASE_PREPARE_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
