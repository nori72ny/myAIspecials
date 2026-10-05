import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  it("uses stable runner-temp file descriptors instead of check-then-open reads",()=>{
    const verifier=read("scripts/origin-self-evolution-v2-experiment-result.mjs");
    const helper=read("scripts/origin-self-evolution-v2-runner-temp.mjs");
    expect(verifier).toContain("readBoundedRunnerTempFile");
    expect(verifier).toContain("EXPERIMENT_RESULT_INPUT_CHANGED_DURING_READ");
    expect(verifier).toContain("EXPERIMENT_ARTIFACT_CHANGED_DURING_READ");
    expect(verifier).not.toContain("existsSync(");
    expect(verifier).not.toContain("lstatSync(");
    expect(verifier).not.toContain("statSync(");
    expect(helper).toContain("openSync(lexical.file");
    expect(helper).toContain("constants.O_NOFOLLOW");
    expect(helper).toContain("fstatSync(fd)");
    expect(helper).toContain("realpathSync(\`/proc/self/fd/\${fd}\`)");
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

  it("requires exact-base materialization and exact changed-path agreement",()=>{
    const verifier=read("scripts/origin-self-evolution-v2-experiment-result.mjs");
    const materializer=read("scripts/origin-self-evolution-v2-materialize.mjs");
    expect(verifier).toContain("materializeArtifactAgainstExactBase");
    expect(verifier).toContain("receipt.materializationDigest===materialization.materializationDigest");
    expect(materializer).toContain('run("git", ["archive"');
    expect(materializer).toContain('run("git", ["apply", "--check"');
    expect(materializer).toContain("MATERIALIZATION_CHANGED_PATH_MISMATCH");
    expect(materializer).toContain("MATERIALIZATION_SYMLINK_PATH_BLOCKED");
    expect(materializer).toContain("MATERIALIZATION_OUTPUT_SYMLINK_BLOCKED");
    expect(verifier).toContain("EXPERIMENT_ARTIFACT_PATCH_DIRECTIVE_BLOCKED");
  });

  it("rehashes the actual runner-temp artifact and validates bounded patch scope",()=>{
    const s=read("scripts/origin-self-evolution-v2-experiment-result.mjs");
    expect(s).toContain("ORIGIN_SELF_EVOLUTION_EXPERIMENT_ARTIFACT_PATH");
    expect(s).toContain('artifact?.schemaVersion!=="origin.self-evolution.experiment-artifact.v2"');
    expect(s).toContain('createHash("sha256").update(bytes).digest("hex")');
    expect(s).toContain("EXPERIMENT_ARTIFACT_PROTECTED_OR_UNSAFE_PATH");
    expect(s).toContain("EXPERIMENT_ARTIFACT_PATCH_HEADER_INVALID");
    expect(s).toContain("EXPERIMENT_ARTIFACT_FILE_HEADER_INVALID");
    expect(s).toContain("EXPERIMENT_ARTIFACT_REALPATH_UNSAFE");
    expect(s).toContain("EXPERIMENT_RESULT_INPUT_REALPATH_UNSAFE");
    expect(s).toContain("EXPERIMENT_ARTIFACT_PATCH_TOO_LARGE");
    expect(s).toContain("receipt.filesChanged===artifactInspection.filesChanged");
    expect(s).toContain("receipt.patchBytes===artifactInspection.patchBytes");
    expect(s).toContain("receipt.cleanWorktreeBefore===true");
    expect(s).toContain("receipt.cleanWorktreeAfter===true");
    expect(s).toContain("receipt.rollbackPlanDefined===true");
    expect(s).toContain("receipt.durationMs");
  });

  it("executes exact-base materialization and fails closed on tampering, protected paths, or non-applying patches",()=>{
    const verifier=resolve(process.cwd(),"scripts/origin-self-evolution-v2-experiment-result.mjs");

    const execute=(pathValue:string,digestOverride?:string,removedLine="old")=>{
      const dir=mkdtempSync(join(tmpdir(),"origin-self-evolution-result-"));
      try{
        mkdirSync(join(dir,"src"),{recursive:true});
        writeFileSync(join(dir,"src/example.ts"),"old\n");
        execFileSync("git",["init","-q"],{cwd:dir,stdio:"pipe"});
        execFileSync("git",["config","user.name","ORIGIN Test"],{cwd:dir,stdio:"pipe"});
        execFileSync("git",["config","user.email","origin-test@invalid.local"],{cwd:dir,stdio:"pipe"});
        execFileSync("git",["add","-A"],{cwd:dir,stdio:"pipe"});
        execFileSync("git",["commit","-q","--no-gpg-sign","-m","base"],{
          cwd:dir,
          env:{...process.env,GIT_AUTHOR_DATE:"2000-01-01T00:00:00Z",GIT_COMMITTER_DATE:"2000-01-01T00:00:00Z"},
          stdio:"pipe"
        });
        const baseSha=execFileSync("git",["rev-parse","HEAD"],{cwd:dir,encoding:"utf8"}).trim();
        const manifest={
          manifestId:"manifest-1",
          experimentId:"experiment-1",
          candidateId:"candidate-1",
          exactBaseSha:baseSha,
          adapterId:"adapter-1",
          implementationBriefId:"brief-1",
          executionAuthority:"EXTERNAL_ORCHESTRATOR_ONLY",
          executionReady:true,
          boundaries:{
            maxPatchBytes:131072,
            maxFilesChanged:20,
            maxDurationMinutes:20,
            protectedPathPrefixes:[".github/",".vercel/","secrets/","credentials/"],
            protectedFileNames:[".env",".env.local",".env.production","vercel.json"]
          }
        };

        writeFileSync(join(dir,"origin-self-evolution-priority-v2.json"),JSON.stringify({
          exactBaseSha:baseSha,
          ranked:[{id:"candidate-1",actionable:true}]
        }));
        writeFileSync(join(dir,"origin-self-evolution-verification-v2.json"),JSON.stringify({
          verification:[{candidateId:"candidate-1",experimentId:"experiment-1",eligibleForSandbox:true}]
        }));
        writeFileSync(join(dir,"origin-self-evolution-experiment-manifests-v2.json"),JSON.stringify({
          exactBaseSha:baseSha,
          manifests:[manifest]
        }));

        const patch=[
          `diff --git a/${pathValue} b/${pathValue}`,
          `--- a/${pathValue}`,
          `+++ b/${pathValue}`,
          "@@ -1 +1 @@",
          `-${removedLine}`,
          "+new",
          ""
        ].join("\n");
        const artifact={
          schemaVersion:"origin.self-evolution.experiment-artifact.v2",
          exactBaseSha:baseSha,
          manifestId:"manifest-1",
          candidateId:"candidate-1",
          experimentId:"experiment-1",
          adapterId:"adapter-1",
          implementationBriefId:"brief-1",
          files:[{path:pathValue,patch}]
        };
        const artifactBytes=JSON.stringify(artifact,null,2)+"\n";
        const actualDigest=createHash("sha256").update(artifactBytes).digest("hex");
        const claimedDigest=digestOverride||actualDigest;
        const materializationDigest=createHash("sha256").update([baseSha,actualDigest,pathValue].join("|")).digest("hex");
        const artifactPath=join(dir,"artifact.json");
        writeFileSync(artifactPath,artifactBytes);

        const input={
          schemaVersion:"origin.self-evolution.experiment-result.v2",
          exactBaseSha:baseSha,
          manifestId:"manifest-1",
          candidateId:"candidate-1",
          experimentId:"experiment-1",
          adapterId:"adapter-1",
          implementationBriefId:"brief-1",
          artifactSha256:claimedDigest,
          costUsd:0,
          paidProvider:false,
          repoMutation:false,
          productionMutation:false,
          networkWrite:false,
          secretAccess:false,
          environmentMutation:false,
          primaryMetric:{name:"score",direction:"higher_is_better",before:1,after:2,minDelta:0.5},
          gates:{
            relevantTests:true,
            securityRegression:true,
            accessibilityRegression:true,
            performanceRegression:true,
            rollbackDefined:true
          },
          executionReceipt:{
            schemaVersion:"origin.self-evolution.execution-receipt.v2",
            manifestId:"manifest-1",
            candidateId:"candidate-1",
            experimentId:"experiment-1",
            adapterId:"adapter-1",
            implementationBriefId:"brief-1",
            artifactSha256:claimedDigest,
            materializationDigest,
            filesChanged:1,
            patchBytes:Buffer.byteLength(patch,"utf8"),
            executionAuthority:"EXTERNAL_ORCHESTRATOR_ONLY",
            ephemeralWorkspace:true,
            cleanWorktreeBefore:true,
            cleanWorktreeAfter:true,
            rollbackPlanDefined:true,
            durationMs:1000,
            networkWrite:false,
            repositoryMutation:false,
            productionMutation:false,
            secretAccess:false,
            environmentMutation:false,
            paidProvider:false,
            costUsd:0
          }
        };
        const inputPath=join(dir,"result-input.json");
        writeFileSync(inputPath,JSON.stringify(input));
        execFileSync(process.execPath,[verifier],{
          cwd:dir,
          env:{
            ...process.env,
            RUNNER_TEMP:dir,
            ORIGIN_SELF_EVOLUTION_REPOSITORY_ROOT:dir,
            ORIGIN_SELF_EVOLUTION_EXPERIMENT_RESULT_PATH:inputPath,
            ORIGIN_SELF_EVOLUTION_EXPERIMENT_ARTIFACT_PATH:artifactPath
          },
          stdio:"pipe"
        });
        return JSON.parse(readFileSync(join(dir,"origin-self-evolution-experiment-result-v2.json"),"utf8"));
      }finally{
        rmSync(dir,{recursive:true,force:true});
      }
    };

    const valid=execute("src/example.ts");
    expect(valid,JSON.stringify(valid)).toMatchObject({status:"MEASURED_IMPROVEMENT",accepted:true});
    expect(valid.provenance.materializedChangedPaths).toEqual(["src/example.ts"]);

    const tampered=execute("src/example.ts","b".repeat(64));
    expect(tampered.status).toBe("REJECTED");
    expect(tampered.reason).toBe("EXPERIMENT_RESULT_PROVENANCE_INVALID");

    const protectedPath=execute(".github/workflows/unsafe.yml");
    expect(protectedPath.status).toBe("REJECTED");
    expect(protectedPath.reason).toBe("EXPERIMENT_ARTIFACT_PROTECTED_OR_UNSAFE_PATH");

    const nonApplying=execute("src/example.ts",undefined,"not-the-base-line");
    expect(nonApplying.status).toBe("REJECTED");
    expect(nonApplying.reason).toBe("MATERIALIZATION_PATCH_DOES_NOT_APPLY");
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
