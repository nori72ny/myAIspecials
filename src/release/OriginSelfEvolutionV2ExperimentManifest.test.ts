import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 experiment manifest boundary",()=>{
  it("keeps manifest generator syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-manifest.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("keeps execution external and repository read-only",()=>{
    const policy=JSON.parse(read("config/origin-self-evolution-experiment-policy.json"));
    expect(policy.executionAuthority).toBe("EXTERNAL_ORCHESTRATOR_ONLY");
    expect(policy.defaults.repositoryMutationAllowed).toBe(false);
    expect(policy.defaults.productionAccess).toBe(false);
    expect(policy.defaults.secretAccess).toBe(false);
    expect(policy.defaults.environmentMutation).toBe(false);
    expect(policy.defaults.networkAccess).toBe(false);
    expect(policy.defaults.paidProvider).toBe(false);
    expect(policy.defaults.maxCostUsd).toBe(0);
  });

  it("bounds patch scope and protected paths",()=>{
    const policy=JSON.parse(read("config/origin-self-evolution-experiment-policy.json"));
    expect(policy.defaults.maxPatchBytes).toBeGreaterThan(0);
    expect(policy.defaults.maxFilesChanged).toBeGreaterThan(0);
    expect(policy.protectedPathPrefixes).toContain(".github/");
    expect(policy.protectedPathPrefixes).toContain(".vercel/");
    expect(policy.protectedFileNames).toContain(".env");
    expect(policy.protectedFileNames).toContain("vercel.json");
  });

  it("requires breaker, authorization, allowlisted request and implementation brief",()=>{
    const s=read("scripts/origin-self-evolution-v2-manifest.mjs");
    expect(s).toContain("breaker.tripped!==true");
    expect(s).toContain("auth?.authorized===true");
    expect(s).toContain("candidate?.actionable===true");
    expect(s).toContain('request?.status==="READY_FOR_INTERNAL_DRY_RUN"');
    expect(s).toContain('brief?.briefType==="IMPLEMENTATION_EXPERIMENT_BRIEF"');
    expect(s).toContain("CIRCUIT_BREAKER_TRIPPED");
  });

  it("requires result evidence to bind back to the exact manifest provenance",()=>{
    const s=read("scripts/origin-self-evolution-v2-manifest.mjs");
    expect(s).toContain("resultManifestBindingRequired:true");
    expect(s).toContain("resultAdapterBindingRequired:true");
    expect(s).toContain("resultImplementationBriefBindingRequired:true");
    expect(s).toContain("resultArtifactSha256Required:true");
    expect(s).toContain("resultMetricEvidenceRequired:true");
    expect(s).toContain("resultMetricEvidenceRecomputed:true");
    expect(s).toContain("resultMetricEvidenceDigestRequired:true");
    expect(s).toContain("resultArtifactBytesRehashed:true");
    expect(s).toContain("resultArtifactPatchScopeValidated:true");
    expect(s).toContain("resultProtectedPathValidationRequired:true");
    expect(s).toContain("resultPatchAppliesToExactBaseRequired:true");
    expect(s).toContain("resultChangedPathSetValidated:true");
    expect(s).toContain("resultExecutionReceiptRequired:true");
  });

  it("orders circuit breaker before request brief and manifest packaging",()=>{
    const w=read(".github/workflows/origin-self-evolution-v2.yml");
    const breaker=w.indexOf("Enforce self-evolution circuit breaker");
    const request=w.indexOf("Package allowlisted dry-run requests");
    const brief=w.indexOf("Package bounded implementation briefs");
    const manifest=w.indexOf("Build bounded experiment manifests");
    expect(breaker).toBeGreaterThan(0);
    expect(request).toBeGreaterThan(breaker);
    expect(brief).toBeGreaterThan(request);
    expect(manifest).toBeGreaterThan(brief);
  });

  it("never grants PR merge deploy secret or billing authority",()=>{
    const s=read("scripts/origin-self-evolution-v2-manifest.mjs");
    expect(s).toContain("mayWriteRepository:false");
    expect(s).toContain("mayOpenPr:false");
    expect(s).toContain("mayMerge:false");
    expect(s).toContain("mayDeploy:false");
    expect(s).toContain("mayChangeSecrets:false");
    expect(s).toContain("mayChangeBilling:false");
  });
});
