// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("AQ V2 trusted exact-candidate execution contract", () => {
  it("runs the candidate without network, write access or git metadata", () => {
    const controller = read("scripts/run-trusted-answer-case-v2.ts");
    expect(controller).toContain('"--network", "none"');
    expect(controller).toContain('"--read-only"');
    expect(controller).toContain("dst=/work,readonly");
    expect(controller).toContain("gitMetadataWithheldFromCandidate: true");
    expect(controller).toContain('"archive", "--format=tar", "HEAD"');
    expect(controller).toContain('path.join(workspace, ".git")');
    expect(controller).toContain("TRUSTED_ANSWER_CANDIDATE_GIT_METADATA_EXPOSED");
  });

  it("withholds the real provider credential and full corpus from candidate env", () => {
    const controller = read("scripts/run-trusted-answer-case-v2.ts");
    const argsStart = controller.indexOf("const args = [");
    const argsEnd = controller.indexOf("const candidate = await execFixed", argsStart);
    const candidateArgs = controller.slice(argsStart, argsEnd);
    expect(candidateArgs).toContain("ORIGIN_AQ_V2_CASE_LEASE_B64");
    expect(candidateArgs).toContain("ORIGIN_TRUSTED_ANSWER_PROVIDER_TOKEN");
    expect(candidateArgs).not.toContain("OPENROUTER_API_KEY");
    expect(candidateArgs).not.toContain("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64");
    expect(candidateArgs).not.toContain("ORIGIN_CANDIDATE_SHA");
    expect(candidateArgs).not.toContain("ORIGIN_AQ_V2_ROUND_ID");

    const runner = read("scripts/trusted-answer-candidate-runner-v2.ts");
    expect(runner).toContain('OPENROUTER_API_KEY: "trusted-proxy-only"');
    expect(runner).not.toContain("ORIGIN_AQ_V2_SEALED_CORPUS_GZIP_B64");
  });

  it("uses the candidate's real /api/chat router while injecting only the trusted provider executor", () => {
    const runner = read("scripts/trusted-answer-candidate-runner-v2.ts");
    expect(runner).toContain('src/legacy/originChatRouter.ts');
    expect(runner).toContain("createOriginChatRouter");
    expect(runner).toContain("execute: proxyExecute");
    expect(runner).toContain('.post("/api/chat")');
  });

  it("uses a separate one-request answer proxy rather than weakening the coding proxy", () => {
    const answerBoundary = read("src/release/OriginTrustedAnswerProviderProxyV2.ts");
    const codingBoundary = read("src/release/OriginTrustedCandidateProviderProxyV15.ts");
    expect(answerBoundary).toContain("TRUSTED_ANSWER_PROVIDER_REQUEST_LIMIT_V2 = 1");
    expect(answerBoundary).toContain("TRUSTED_ANSWER_PROVIDER_TOOL_BLOCKED");
    expect(codingBoundary).toContain("TRUSTED_CANDIDATE_PROVIDER_REQUEST_LIMIT_V15 = 7");
    expect(codingBoundary).toContain("plan.taskType !== 'implementation'");
  });

  it("fails closed if candidate output contains hidden corpus metadata or credentials", () => {
    const controller = read("scripts/run-trusted-answer-case-v2.ts");
    expect(controller).toContain("TRUSTED_ANSWER_CANDIDATE_LEAK_DETECTED");
    expect(controller).toContain("...input.allNotes");
    expect(controller).toContain("...input.allPrompts.filter");
    expect(controller).toContain("input.token");
    expect(controller).toContain("input.apiKey");
    expect(controller).toContain("input.candidateSha");
    expect(controller).toContain("input.roundId");
    expect(controller).toContain("input.corpusDigest");
  });
});
