import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 measurement evidence contract",()=>{
  it("keeps result verifier syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-experiment-result.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("defaults missing experiment evidence to NOT_MEASURED",()=>{
    const s=read("scripts/origin-self-evolution-v2-experiment-result.mjs");
    expect(s).toContain("EXPERIMENT_RESULT_INPUT_MISSING");
    expect(s).toContain('status:"NOT_MEASURED"');
    expect(s).toContain("accepted:false");
  });

  it("only accepts runner-temp bounded evidence",()=>{
    const s=read("scripts/origin-self-evolution-v2-experiment-result.mjs");
    expect(s).toContain("RUNNER_TEMP");
    expect(s).toContain("EXPERIMENT_RESULT_INPUT_PATH_UNSAFE");
    expect(s).toContain("EXPERIMENT_RESULT_INPUT_TOO_LARGE");
    expect(s).toContain("65536");
  });

  it("requires exact binding, zero cost, no mutation, full gates and positive measured delta",()=>{
    const s=read("scripts/origin-self-evolution-v2-experiment-result.mjs");
    expect(s).toContain('input.exactBaseSha===priority.exactBaseSha');
    expect(s).toContain('candidate?.actionable===true');
    expect(s).toContain('check?.eligibleForSandbox===true');
    expect(s).toContain('input.costUsd===0');
    expect(s).toContain('input.repoMutation===false');
    expect(s).toContain('input.productionMutation===false');
    expect(s).toContain('input.networkWrite===false');
    expect(s).toContain('input.secretAccess===false');
    expect(s).toContain('input.environmentMutation===false');
    expect(s).toContain('gates.securityRegression===true');
    expect(s).toContain('gates.accessibilityRegression===true');
    expect(s).toContain('gates.performanceRegression===true');
    expect(s).toContain('measuredDelta>0');
  });

  it("binds measured results to an execution-ready manifest, adapter, brief, artifact digest and receipt",()=>{
    const s=read("scripts/origin-self-evolution-v2-experiment-result.mjs");
    expect(s).toContain('manifest?.executionReady===true');
    expect(s).toContain('input.manifestId===manifest?.manifestId');
    expect(s).toContain('input.adapterId===manifest?.adapterId');
    expect(s).toContain('input.implementationBriefId===manifest?.implementationBriefId');
    expect(s).toContain('/^[a-f0-9]{64}$/.test(artifactSha256)');
    expect(s).toContain('receipt.schemaVersion==="origin.self-evolution.execution-receipt.v2"');
    expect(s).toContain('receipt.executionAuthority===manifest?.executionAuthority');
    expect(s).toContain("EXPERIMENT_RESULT_PROVENANCE_INVALID");
  });

  it("does not promote sandbox eligibility by itself",()=>{
    const s=read("scripts/origin-self-evolution-v2-promotion.mjs");
    expect(s).toContain('result.status==="MEASURED_IMPROVEMENT"');
    expect(s).toContain("DRAFT_PR_PROPOSAL_ONLY");
    expect(s).toContain("HOLD_PENDING_EXPERIMENT_RESULT");
    expect(s).toContain("codeWriteAuthorized:false");
    expect(s).toContain("automaticMerge:false");
    expect(s).toContain("automaticDeploy:false");
  });

  it("verifies experiment evidence before promotion in workflow order",()=>{
    const workflow=read(".github/workflows/origin-self-evolution-v2.yml");
    const verify=workflow.indexOf("Verify externally supplied isolated experiment evidence");
    const promote=workflow.indexOf("Build promotion packages");
    expect(verify).toBeGreaterThan(0);
    expect(promote).toBeGreaterThan(verify);
  });
});
