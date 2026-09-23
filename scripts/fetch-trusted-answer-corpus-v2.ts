import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Pool } from "pg";

import {
  prepareOriginAnswerExperienceSealedCorpusV2,
  type OriginAnswerExperienceSealedCorpusV2,
} from "../src/release/OriginAnswerExperienceSealedCorpusV2.js";

type StoredRow = {
  corpus_id: string;
  schema_version: string;
  corpus_digest: string;
  source_file_sha256: string;
  sealed_json: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_V2_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validateDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("AQ_V2_PRIVATE_CORPUS_DATABASE_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("AQ_V2_PRIVATE_CORPUS_DATABASE_URL_INVALID");
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = validateDatabaseUrl(requiredEnv("POSTGRES_URL"));
  const corpusId = requiredEnv("ORIGIN_AQ_V2_CORPUS_ID");
  const expectedDigest = requiredEnv("ORIGIN_AQ_V2_EXPECTED_CORPUS_DIGEST").toLowerCase();
  const outputPath = requiredEnv("ORIGIN_AQ_V2_SEALED_CORPUS_PATH");
  const publicCheckPath = process.env.ORIGIN_AQ_V2_CORPUS_CHECK_PATH
    ?? path.resolve("test-results", "aq-v2-corpus-public-check.json");

  if (!validSha256(expectedDigest)) throw new Error("AQ_V2_EXPECTED_CORPUS_DIGEST_INVALID");

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });

  let row: StoredRow;
  try {
    const result = await pool.query<StoredRow>(
      `select corpus_id, schema_version, corpus_digest, source_file_sha256, sealed_json
       from origin_eval_private.aq_v2_sealed_corpora
       where corpus_id = $1
       limit 2`,
      [corpusId],
    );
    if (result.rows.length !== 1) throw new Error("AQ_V2_PRIVATE_CORPUS_ROW_INVALID");
    row = result.rows[0];
  } finally {
    await pool.end();
  }

  if (
    row.corpus_id !== corpusId
    || row.schema_version !== "origin.aq-v2.sealed-corpus.v1"
    || !validSha256(row.corpus_digest)
    || !validSha256(row.source_file_sha256)
    || row.corpus_digest !== expectedDigest
    || typeof row.sealed_json !== "string"
    || row.sealed_json.length < 1_000
    || row.sealed_json.length > 2_000_000
  ) {
    throw new Error("AQ_V2_PRIVATE_CORPUS_ROW_INVALID");
  }

  let parsed: OriginAnswerExperienceSealedCorpusV2;
  try {
    parsed = JSON.parse(row.sealed_json) as OriginAnswerExperienceSealedCorpusV2;
  } catch {
    throw new Error("AQ_V2_PRIVATE_CORPUS_JSON_INVALID");
  }

  const prepared = prepareOriginAnswerExperienceSealedCorpusV2(parsed);
  if (prepared.corpusDigest !== expectedDigest || prepared.corpusDigest !== row.corpus_digest) {
    throw new Error("AQ_V2_PRIVATE_CORPUS_DIGEST_MISMATCH");
  }

  const encoded = gzipSync(Buffer.from(JSON.stringify(parsed), "utf8"), { level: 9 }).toString("base64");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, encoded, { encoding: "utf8", mode: 0o600, flag: "wx" });

  const publicCheck = Object.freeze({
    schemaVersion: "origin.aq-v2-private-corpus-public-check.v1",
    corpusId,
    corpusDigest: prepared.corpusDigest,
    sourceFileSha256: row.source_file_sha256,
    caseCount: prepared.privateCorpus.cases.length,
  });
  await fs.mkdir(path.dirname(publicCheckPath), { recursive: true });
  await fs.writeFile(publicCheckPath, JSON.stringify(publicCheck, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  process.stdout.write(JSON.stringify({
    event: "aq-v2-private-corpus-fetched",
    corpusId,
    corpusDigest: prepared.corpusDigest,
    caseCount: prepared.privateCorpus.cases.length,
  }) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const code = /^AQ_V2_[A-Z0-9_:-]+$/.test(message) ? message : "AQ_V2_PRIVATE_CORPUS_FETCH_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
