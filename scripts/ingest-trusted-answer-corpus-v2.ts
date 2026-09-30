import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Pool } from "pg";

import {
  ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
  prepareOriginAnswerExperienceSealedCorpusV2,
  type OriginAnswerExperienceSealedCorpusV2,
} from "../src/release/OriginAnswerExperienceSealedCorpusV2.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_V2_INGEST_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function validateDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("AQ_V2_INGEST_DATABASE_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("AQ_V2_INGEST_DATABASE_URL_INVALID");
  }
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/.test(value);
}

async function main(): Promise<void> {
  const connectionString = validateDatabaseUrl(requiredEnv("POSTGRES_URL"));
  const expectedCorpusId = requiredEnv("ORIGIN_AQ_V2_INGEST_CORPUS_ID");
  const encoded = requiredEnv("ORIGIN_AQ_V2_FRESH_CORPUS_GZIP_B64");
  const outputPath = process.env.ORIGIN_AQ_V2_INGEST_PUBLIC_CHECK_PATH
    ?? path.resolve("test-results", "aq-v2-ingest-public-check.json");

  if (!safeId(expectedCorpusId)) throw new Error("AQ_V2_INGEST_CORPUS_ID_INVALID");
  if (encoded.length > 2_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("AQ_V2_INGEST_ENCODING_INVALID");
  }

  let raw: Buffer;
  let corpus: OriginAnswerExperienceSealedCorpusV2;
  try {
    raw = gunzipSync(Buffer.from(encoded, "base64"), { maxOutputLength: 2_000_000 });
    corpus = JSON.parse(raw.toString("utf8")) as OriginAnswerExperienceSealedCorpusV2;
  } catch {
    throw new Error("AQ_V2_INGEST_PARSE_FAILED");
  }

  if (corpus?.corpusId !== expectedCorpusId) {
    throw new Error("AQ_V2_INGEST_CORPUS_ID_MISMATCH");
  }
  const prepared = prepareOriginAnswerExperienceSealedCorpusV2(corpus);
  if (prepared.privateCorpus.cases.length !== 48) {
    throw new Error("AQ_V2_INGEST_CASE_COUNT_INVALID");
  }

  const sourceFileSha256 = sha256(raw);
  const sealedJson = JSON.stringify(prepared.privateCorpus);
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });

  try {
    await pool.query("begin isolation level serializable");
    const duplicate = await pool.query<{
      corpus_id: string;
      corpus_digest: string;
    }>(
      `select corpus_id, corpus_digest
       from origin_eval_private.aq_v2_sealed_corpora
       where corpus_id = $1 or corpus_digest = $2
       for update`,
      [expectedCorpusId, prepared.corpusDigest],
    );
    if (duplicate.rows.length !== 0) {
      throw new Error("AQ_V2_INGEST_CORPUS_ALREADY_EXISTS");
    }

    const inserted = await pool.query<{ corpus_id: string; corpus_digest: string }>(
      `insert into origin_eval_private.aq_v2_sealed_corpora
       (corpus_id, schema_version, corpus_digest, source_file_sha256, sealed_json)
       values ($1, $2, $3, $4, $5)
       returning corpus_id, corpus_digest`,
      [
        expectedCorpusId,
        ORIGIN_AQ_V2_SEALED_CORPUS_VERSION,
        prepared.corpusDigest,
        sourceFileSha256,
        sealedJson,
      ],
    );
    if (
      inserted.rows.length !== 1
      || inserted.rows[0]?.corpus_id !== expectedCorpusId
      || inserted.rows[0]?.corpus_digest !== prepared.corpusDigest
    ) {
      throw new Error("AQ_V2_INGEST_INSERT_VERIFICATION_FAILED");
    }
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }

  const publicCheck = Object.freeze({
    schemaVersion: "origin.aq-v2-private-corpus-ingest-public-check.v1",
    corpusId: expectedCorpusId,
    corpusDigest: prepared.corpusDigest,
    sourceFileSha256,
    caseCount: prepared.privateCorpus.cases.length,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(publicCheck, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(JSON.stringify({
    event: "aq-v2-private-corpus-ingested",
    ...publicCheck,
  }) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const code = /^AQ_V2_[A-Z0-9_:-]+$/.test(message)
    ? message
    : "AQ_V2_INGEST_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
