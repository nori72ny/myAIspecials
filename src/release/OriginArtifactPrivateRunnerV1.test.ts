// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const runner=readFileSync(resolve(process.cwd(),'scripts/run-artifact-private-heldout-v1.ts'),'utf8');
const inspector=readFileSync(resolve(process.cwd(),'scripts/inspect-artifact-private-corpus-v1.ts'),'utf8');

describe('Artifact private held-out runner V1',()=>{
  it('executes natural-language input through the real chat and artifact runtimes',()=>{
    expect(runner).toContain("createOriginChatRouter");
    expect(runner).toContain("createArtifactV12Router");
    expect(runner).toContain("createWebAppBuilderV13Router");
    expect(runner).toContain("'/api/chat'");
    expect(runner).toContain("'/api/artifacts/v1.2/generate'");
    expect(runner).toContain("'/api/builder/v1.3/generate'");
  });

  it('keeps the provider on the verified zero-cost no-fallback privacy boundary',()=>{
    expect(runner).toContain("routing.freeOnly === true");
    expect(runner).toContain("routing.actualCostUsd === 0");
    expect(runner).toContain("routing.providerAttempts === 1");
    expect(runner).toContain("providerRouting.fallbackUsed === false");
    expect(runner).toContain("policy.dataCollection === 'deny'");
    expect(runner).toContain("policy.requireZeroDataRetention === true");
    expect(runner).toContain("usage.costUsd === 0");
  });

  it('validates actual bytes rather than trusting a success flag',()=>{
    expect(runner).toContain("x-origin-artifact-sha256");
    expect(runner).toContain("x-origin-project-sha256");
    expect(runner).toContain("formatSignaturePassed");
    expect(runner).toContain("formatStructurePassed");
    expect(runner).toContain("headerSha === actualSha");
    expect(runner).toContain("task.technicalRequirements.every");
  });

  it('retains provider, quota and technical failures in candidate evidence',()=>{
    expect(runner).toContain("'quota-limited'");
    expect(runner).toContain("'ARTIFACT_PRIVATE_TECHNICAL_VALIDATION_FAILED'");
    expect(runner).toContain("failures: cases");
    expect(runner).not.toContain("if (item.failureCode) continue");
  });

  it('never persists the sealed prompt or required-content oracle in public metadata',()=>{
    const outputSection=runner.slice(runner.indexOf("const publicTasks"));
    expect(outputSection).not.toContain("prompt: task.prompt");
    expect(outputSection).not.toContain("requiredContent: task.requiredContent");
    expect(outputSection).toContain("promptSha256: task.promptSha256");
    expect(outputSection).toContain("taskDigest: task.taskDigest");
  });

  it('inspector prints only non-secret corpus identity metadata',()=>{
    expect(inspector).toContain("corpusDigest");
    expect(inspector).toContain("candidateSha");
    expect(inspector).toContain("taskCount");
    expect(inspector).not.toContain("tasks: corpus.tasks");
    expect(inspector).not.toContain("prompt");
    expect(inspector).not.toContain("requiredContent");
  });
});
