// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/trusted-answer-quality-v2.yml"), "utf8");

describe("AQ V2 trusted workflow contract", () => {
  it("is manual-only and refuses execution unless dispatched from main", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).not.toContain("\n  pull_request:");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
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

  it("passes the real provider key and sealed corpus only to the trusted controller step", () => {
    expect(workflow).toContain("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64: ${{ secrets.ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64 }}");
    expect(workflow).toContain("OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}");
    expect(workflow).toContain("ORIGIN_AQ_V2_CANDIDATE_CHECKOUT: ${{ github.workspace }}/candidate");
    expect(workflow).toContain("ORIGIN_AQ_V2_EVALUATOR_SHA: ${{ github.sha }}");

    const controller = readFileSync(resolve(process.cwd(), "scripts/run-trusted-answer-case-v2.ts"), "utf8");
    const dockerStart = controller.indexOf("const args = [");
    const dockerEnd = controller.indexOf("const candidate = await execFixed", dockerStart);
    const candidateEnv = controller.slice(dockerStart, dockerEnd);
    expect(candidateEnv).not.toContain("OPENROUTER_API_KEY");
    expect(candidateEnv).not.toContain("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64");
  });

  it("reserves the candidate/corpus pair before provider execution without a round-id reset bypass", () => {
    const reserve = workflow.indexOf("Reserve exact candidate and sealed corpus before provider execution");
    const evaluate = workflow.indexOf("Run 48 leased cases through the trusted boundary");
    expect(reserve).toBeGreaterThan(0);
    expect(evaluate).toBeGreaterThan(reserve);
    expect(workflow).toContain('context="origin/aq-v2-corpus/${CORPUS_DIGEST}"');
    expect(workflow).toContain("LEDGER_ANCHOR_SHA: 01f7db0c0d48ab3ba533148e99e1847203e13f4c");
    expect(workflow).toContain('/commits/${LEDGER_ANCHOR_SHA}/statuses?per_page=100&page=${page}');
    expect(workflow).toContain('/statuses/${LEDGER_ANCHOR_SHA}');
    expect(workflow).not.toContain("round_hash=");
    expect(workflow).toContain("AQ_V2_TRUSTED_ROUND_ALREADY_RESERVED");
    expect(workflow).toContain("Finalize append-only AQ V2 status");
  });
});
