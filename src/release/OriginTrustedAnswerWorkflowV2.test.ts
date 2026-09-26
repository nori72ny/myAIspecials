// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/trusted-answer-quality-v2.yml"), "utf8");

describe("AQ V2 trusted workflow contract", () => {
  it("keeps manual dispatch and permits only an explicit one-shot main push marker", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("\n  push:\n    branches: [main]");
    expect(workflow).not.toContain("\n  pull_request:");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("contains(github.event.head_commit.message, '[aq-v2-run]')");
  });

  it("freezes the one-shot push candidate, PR, round and corpus digest", () => {
    expect(workflow).toContain("AQ_V2_DEFAULT_CANDIDATE_SHA: ef8825f1b8f9580c37c6a7e286072f3e7caa0abb");
    expect(workflow).toContain("AQ_V2_DEFAULT_PR_NUMBER: '608'");
    expect(workflow).toContain("AQ_V2_DEFAULT_ROUND_ID: round-2026-09-23-independent-claude-1");
    expect(workflow).toContain("AQ_V2_DEFAULT_CORPUS_ID: origin-aq-v2-independent-2026-09");
    expect(workflow).toContain("AQ_V2_DEFAULT_CORPUS_DIGEST: 7b81ab3d76b3ede127378d2a21d6b7844664046b683f9eff7248ca9b87ff9517");
  });

  it("allows a fresh sealed corpus identity only through explicit id and sha256 digest inputs", () => {
    expect(workflow).toContain("corpus_id:");
    expect(workflow).toContain("corpus_digest:");
    expect(workflow).toContain("ORIGIN_AQ_V2_CORPUS_ID: ${{ inputs.corpus_id || env.AQ_V2_DEFAULT_CORPUS_ID }}");
    expect(workflow).toContain("ORIGIN_AQ_V2_EXPECTED_CORPUS_DIGEST: ${{ inputs.corpus_digest || env.AQ_V2_DEFAULT_CORPUS_DIGEST }}");
    expect(workflow).toContain("const corpusId=process.env.CORPUS_ID||'';");
    expect(workflow).toContain("const corpusDigest=process.env.CORPUS_DIGEST||'';");
    expect(workflow).toContain("if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/.test(corpusId)) process.exit(2);");
    expect(workflow).toContain("if(!/^[a-f0-9]{64}$/.test(corpusDigest)) process.exit(2);");
  });

  it("binds execution to an exact open same-repository PR head and rechecks immediately before provider use", () => {
    expect(workflow).toContain("AQ_V2_CANDIDATE_PR_NOT_OPEN");
    expect(workflow).toContain("AQ_V2_CANDIDATE_BASE_INVALID");
    expect(workflow).toContain("AQ_V2_CANDIDATE_FORK_BLOCKED");
    expect(workflow).toContain("AQ_V2_CANDIDATE_SHA_MISMATCH");
    expect(workflow).toContain("Revalidate exact candidate PR binding immediately before execution");
    expect(workflow).toContain("AQ_V2_CANDIDATE_PR_NOT_OPEN_AT_EXECUTION");
    expect(workflow).toContain("AQ_V2_CANDIDATE_SHA_CHANGED_BEFORE_EXECUTION");
    expect(workflow.match(/pr\?\.head\?\.sha!==process\.env\.CANDIDATE_SHA/g)?.length).toBe(2);
  });

  it("installs dependencies only in the trusted evaluator checkout", () => {
    const candidateCheckout = workflow.indexOf("Checkout exact candidate separately");
    const trustedInstall = workflow.indexOf("Install only trusted evaluator dependencies");
    const liveRun = workflow.indexOf("Run 48 leased cases through the trusted boundary");
    expect(candidateCheckout).toBeGreaterThan(0);
    expect(trustedInstall).toBeGreaterThan(candidateCheckout);
    expect(liveRun).toBeGreaterThan(trustedInstall);
    expect(workflow).not.toContain("cd candidate");
    expect(workflow).not.toMatch(/candidate[^\n]*npm ci/);
  });

  it("checks trusted database, provider and runtime prerequisites before consuming the global one-shot reservation", () => {
    const preflightSecretCheck = workflow.indexOf("Verify required trusted-run secrets before reserving the one-shot corpus");
    const preflightFetch = workflow.indexOf("Fetch sealed AQ V2 corpus from private trusted store");
    const runtimeFetch = workflow.indexOf("Fetch sealed corpus into trusted runner temp");
    const dockerPull = workflow.indexOf("Prepare isolated runtime image");
    const rebind = workflow.indexOf("Revalidate exact candidate PR binding immediately before execution");
    const boundaryCheck = workflow.indexOf("Verify secret boundary before execution");
    const reserve = workflow.indexOf("Reserve exact candidate and sealed corpus before provider execution");
    const evaluate = workflow.indexOf("Run 48 leased cases through the trusted boundary");
    expect(preflightSecretCheck).toBeGreaterThan(0);
    expect(preflightFetch).toBeGreaterThan(preflightSecretCheck);
    expect(runtimeFetch).toBeGreaterThan(preflightFetch);
    expect(dockerPull).toBeGreaterThan(runtimeFetch);
    expect(rebind).toBeGreaterThan(dockerPull);
    expect(boundaryCheck).toBeGreaterThan(rebind);
    expect(reserve).toBeGreaterThan(boundaryCheck);
    expect(evaluate).toBeGreaterThan(reserve);
    const preReserve = workflow.slice(preflightSecretCheck, reserve);
    expect(preReserve).toContain("POSTGRES_URL: ${{ secrets.POSTGRES_URL }}");
    expect(preReserve).toContain("OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}");
    expect(preReserve).toContain('test -n "$POSTGRES_URL"');
    expect(preReserve).toContain('test -n "$OPENROUTER_API_KEY"');
    expect(preReserve).toContain("scripts/fetch-trusted-answer-corpus-v2.ts");
    expect(preReserve).not.toContain("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64: ${{ secrets.");
  });

  it("never passes database credentials, real provider credentials or the full corpus into the candidate container", () => {
    expect(workflow).toContain("ORIGIN_AQ_V2_CANDIDATE_CHECKOUT: ${{ github.workspace }}/candidate");
    expect(workflow).toContain("ORIGIN_AQ_V2_EVALUATOR_SHA: ${{ github.sha }}");
    expect(workflow).toContain("ORIGIN_AQ_V2_SEALED_CORPUS_PATH: ${{ runner.temp }}/aq-v2-sealed-corpus.b64");

    const controller = readFileSync(resolve(process.cwd(), "scripts/run-trusted-answer-case-v2.ts"), "utf8");
    const dockerStart = controller.indexOf("const args = [");
    const dockerEnd = controller.indexOf("const candidate = await execFixed", dockerStart);
    const candidateEnv = controller.slice(dockerStart, dockerEnd);
    expect(candidateEnv).not.toContain("OPENROUTER_API_KEY");
    expect(candidateEnv).not.toContain("POSTGRES_URL");
    expect(candidateEnv).not.toContain("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64");
  });

  it("reserves the corpus globally before provider execution without a round-id reset bypass", () => {
    const reserve = workflow.indexOf("Reserve exact candidate and sealed corpus before provider execution");
    const evaluate = workflow.indexOf("Run 48 leased cases through the trusted boundary");
    expect(reserve).toBeGreaterThan(0);
    expect(evaluate).toBeGreaterThan(reserve);
    expect(workflow).toContain('context="origin/aq-v2-corpus/${CORPUS_DIGEST}"');
    expect(workflow).toContain("CORPUS_DIGEST: ${{ needs.preflight.outputs.corpus_digest }}");
    expect(workflow).not.toContain("CORPUS_DIGEST: ${{ steps.corpus.outputs.corpus_digest }}");
    expect(workflow).toContain("LEDGER_ANCHOR_SHA: 01f7db0c0d48ab3ba533148e99e1847203e13f4c");
    expect(workflow).toContain('/commits/${LEDGER_ANCHOR_SHA}/statuses?per_page=100&page=${page}');
    expect(workflow).toContain('/statuses/${LEDGER_ANCHOR_SHA}');
    expect(workflow).not.toContain("round_hash=");
    expect(workflow).toContain("AQ_V2_TRUSTED_ROUND_ALREADY_RESERVED");
    expect(workflow).toContain('echo "reserved=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("Finalize append-only AQ V2 status");
    expect(workflow).toContain("always() && steps.reserve.outputs.reserved == 'true'");
    expect(workflow).toContain("STATUS_CONTEXT: ${{ steps.reserve.outputs.status_context }}");
    expect(workflow).not.toContain("needs.preflight.outputs.status_context");
  });
});
