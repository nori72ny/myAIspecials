// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/aq-v2-private-corpus-ingest.yml"),
  "utf8",
);
const script = readFileSync(
  resolve(process.cwd(), "scripts/ingest-trusted-answer-corpus-v2.ts"),
  "utf8",
);

describe("AQ V2 private corpus ingest contract", () => {
  it("is manual-only on main and serializes private corpus ingestion", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).not.toContain("\n  pull_request:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("group: origin-aq-v2-private-corpus-ingest");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("takes corpus contents only from a GitHub secret and never from dispatch input", () => {
    expect(workflow).toContain("ORIGIN_AQ_V2_FRESH_CORPUS_GZIP_B64: ${{ secrets.ORIGIN_AQ_V2_FRESH_CORPUS_GZIP_B64 }}");
    expect(workflow).toContain("POSTGRES_URL: ${{ secrets.POSTGRES_URL }}");
    expect(workflow).toContain("corpus_id:");
    expect(workflow).not.toContain("corpus_base64:");
    expect(workflow).not.toContain("prompt:");
    expect(workflow).not.toContain("evaluator_notes:");
  });

  it("uploads only the sanitized public identity artifact", () => {
    expect(workflow).toContain("test-results/aq-v2-ingest-public-check.json");
    expect(workflow).not.toContain("aq-v2-sealed-corpus");
    expect(workflow).not.toContain("ORIGIN_AQ_V2_FRESH_CORPUS_GZIP_B64\n");
    expect(script).toContain('schemaVersion: "origin.aq-v2-private-corpus-ingest-public-check.v1"');
    expect(script).toContain("corpusDigest: prepared.corpusDigest");
    expect(script).toContain("sourceFileSha256");
    expect(script).toContain("caseCount: prepared.privateCorpus.cases.length");
  });

  it("rejects duplicate corpus id or digest before insert", () => {
    expect(script).toContain("where corpus_id = $1 or corpus_digest = $2");
    expect(script).toContain("AQ_V2_INGEST_CORPUS_ALREADY_EXISTS");
    expect(script).toContain("AQ_V2_INGEST_INSERT_VERIFICATION_FAILED");
  });

  it("validates the sealed corpus before opening a database transaction", () => {
    const prepare = script.indexOf("prepareOriginAnswerExperienceSealedCorpusV2(corpus)");
    const begin = script.indexOf('await pool.query("begin isolation level serializable")');
    const insert = script.indexOf("insert into origin_eval_private.aq_v2_sealed_corpora");
    expect(prepare).toBeGreaterThan(0);
    expect(begin).toBeGreaterThan(prepare);
    expect(insert).toBeGreaterThan(begin);
  });

  it("does not print or persist prompt bodies from the ingest script", () => {
    expect(script).not.toContain("console.log(corpus");
    expect(script).not.toContain("process.stdout.write(sealedJson");
    expect(script).not.toContain("writeFile(outputPath, sealedJson");
    expect(script).toContain('event: "aq-v2-private-corpus-ingested"');
  });
});
