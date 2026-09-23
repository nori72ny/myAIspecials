// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "scripts/fetch-trusted-answer-corpus-v2.ts"), "utf8");

describe("AQ V2 private corpus fetch contract", () => {
  it("reads only the dedicated private table through POSTGRES_URL", () => {
    expect(source).toContain('requiredEnv("POSTGRES_URL")');
    expect(source).toContain("origin_eval_private.aq_v2_sealed_corpora");
    expect(source).toContain("where corpus_id = $1");
    expect(source).not.toContain("SUPABASE_PUBLISHABLE_KEY");
    expect(source).not.toContain("service_role");
  });

  it("fails closed on row identity and exact digest mismatch", () => {
    expect(source).toContain('requiredEnv("ORIGIN_AQ_V2_EXPECTED_CORPUS_DIGEST")');
    expect(source).toContain("row.corpus_digest !== expectedDigest");
    expect(source).toContain("prepared.corpusDigest !== expectedDigest");
    expect(source).toContain("AQ_V2_PRIVATE_CORPUS_DIGEST_MISMATCH");
  });

  it("writes sealed payload only to a mode-0600 file and stdout exposes metadata only", () => {
    expect(source).toContain("mode: 0o600");
    expect(source).toContain('flag: "wx"');
    expect(source).toContain('event: "aq-v2-private-corpus-fetched"');
    const stdout = source.slice(source.indexOf("process.stdout.write"));
    expect(stdout).not.toContain("sealed_json");
    expect(stdout).not.toContain("encoded,");
  });
});
