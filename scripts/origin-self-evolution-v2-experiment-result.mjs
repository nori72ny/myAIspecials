import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";

const rawInput=String(process.env.ORIGIN_SELF_EVOLUTION_EXPERIMENT_RESULT_PATH||"");
const rawArtifact=String(process.env.ORIGIN_SELF_EVOLUTION_EXPERIMENT_ARTIFACT_PATH||"");
const runnerTemp=String(process.env.RUNNER_TEMP||"");
const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const verified=JSON.parse(readFileSync("origin-self-evolution-verification-v2.json","utf8"));
const manifests=JSON.parse(readFileSync("origin-self-evolution-experiment-manifests-v2.json","utf8"));

function notMeasured(reason){
  return {
    schemaVersion:"origin.self-evolution.experiment-result-evaluation.v2",
    generatedAt:new Date().toISOString(),
    exactBaseSha:priority.exactBaseSha,
    status:"NOT_MEASURED",
    accepted:false,
    reason,
    candidateId:null,
    experimentId:null
  };
}

function reject(input,reason){
  return {
    schemaVersion:"origin.self-evolution.experiment-result-evaluation.v2",
    generatedAt:new Date().toISOString(),
    exactBaseSha:priority.exactBaseSha,
    status:"REJECTED",
    accepted:false,
    reason,
    candidateId:input?.candidateId||null,
    experimentId:input?.experimentId||null
  };
}

function safeRunnerTempPath(raw){
  if(!raw) return null;
  if(!runnerTemp || !isAbsolute(raw)) return null;
  const root=resolve(runnerTemp);
  const file=resolve(raw);
  const rel=relative(root,file);
  if(rel.startsWith("..") || isAbsolute(rel)) return null;
  return file;
}

function realPathSafe(pathValue){
  if(!pathValue || !existsSync(pathValue) || !runnerTemp) return false;
  if(lstatSync(pathValue).isSymbolicLink()) return false;
  const realRoot=realpathSync(resolve(runnerTemp));
  const realFile=realpathSync(pathValue);
  const rel=relative(realRoot,realFile);
  return !(rel.startsWith("..") || isAbsolute(rel));
}

function validArtifactPath(pathValue,boundaries){
  if(typeof pathValue!=="string" || !pathValue || pathValue.includes("\\") || pathValue.includes("\0")) return false;
  if(pathValue.startsWith("/") || pathValue.startsWith("../") || pathValue.includes("/../")) return false;
  if(posix.normalize(pathValue)!==pathValue) return false;
  const prefixes=Array.isArray(boundaries?.protectedPathPrefixes)?boundaries.protectedPathPrefixes:[];
  const names=Array.isArray(boundaries?.protectedFileNames)?boundaries.protectedFileNames:[];
  if(prefixes.some(prefix=>pathValue.startsWith(prefix))) return false;
  if(names.includes(posix.basename(pathValue))) return false;
  return true;
}

function inspectArtifact(artifactPath,manifest){
  if(!artifactPath) return {ok:false,reason:"EXPERIMENT_ARTIFACT_PATH_UNSAFE"};
  if(!existsSync(artifactPath)) return {ok:false,reason:"EXPERIMENT_ARTIFACT_NOT_FOUND"};
  if(!realPathSafe(artifactPath)) return {ok:false,reason:"EXPERIMENT_ARTIFACT_REALPATH_UNSAFE"};
  const maxPatchBytes=Number(manifest?.boundaries?.maxPatchBytes||0);
  const maxFilesChanged=Number(manifest?.boundaries?.maxFilesChanged||0);
  if(!Number.isFinite(maxPatchBytes) || maxPatchBytes<=0 || !Number.isFinite(maxFilesChanged) || maxFilesChanged<=0){
    return {ok:false,reason:"EXPERIMENT_ARTIFACT_POLICY_INVALID"};
  }
  if(statSync(artifactPath).size>Math.max(262144,maxPatchBytes*2)){
    return {ok:false,reason:"EXPERIMENT_ARTIFACT_FILE_TOO_LARGE"};
  }
  const bytes=readFileSync(artifactPath);
  const sha256=createHash("sha256").update(bytes).digest("hex");
  let artifact;
  try{ artifact=JSON.parse(bytes.toString("utf8")); }
  catch{ return {ok:false,reason:"EXPERIMENT_ARTIFACT_JSON_INVALID",sha256}; }
  const files=Array.isArray(artifact?.files)?artifact.files:[];
  if(
    artifact?.schemaVersion!=="origin.self-evolution.experiment-artifact.v2" ||
    artifact?.exactBaseSha!==manifest?.exactBaseSha ||
    artifact?.manifestId!==manifest?.manifestId ||
    artifact?.candidateId!==manifest?.candidateId ||
    artifact?.experimentId!==manifest?.experimentId ||
    artifact?.adapterId!==manifest?.adapterId ||
    artifact?.implementationBriefId!==manifest?.implementationBriefId
  ) return {ok:false,reason:"EXPERIMENT_ARTIFACT_BINDING_INVALID",sha256};
  if(files.length<1 || files.length>maxFilesChanged){
    return {ok:false,reason:"EXPERIMENT_ARTIFACT_FILE_COUNT_INVALID",sha256};
  }
  let patchBytes=0;
  const paths=[];
  for(const file of files){
    const pathValue=file?.path;
    const patch=typeof file?.patch==="string"?file.patch:"";
    if(!validArtifactPath(pathValue,manifest?.boundaries)){
      return {ok:false,reason:"EXPERIMENT_ARTIFACT_PROTECTED_OR_UNSAFE_PATH",sha256};
    }
    if(!patch){
      return {ok:false,reason:"EXPERIMENT_ARTIFACT_PATCH_MISSING",sha256};
    }
    const lines=patch.split(/\r?\n/);
    const headers=lines.filter(line=>line.startsWith("diff --git "));
    if(headers.length!==1 || headers[0]!==`diff --git a/${pathValue} b/${pathValue}`){
      return {ok:false,reason:"EXPERIMENT_ARTIFACT_PATCH_HEADER_INVALID",sha256};
    }
    const oldHeaders=lines.filter(line=>line.startsWith("--- "));
    const newHeaders=lines.filter(line=>line.startsWith("+++ "));
    const allowedOld=new Set([`--- a/${pathValue}`,"--- /dev/null"]);
    const allowedNew=new Set([`+++ b/${pathValue}`,"+++ /dev/null"]);
    if(oldHeaders.length!==1 || newHeaders.length!==1 || !allowedOld.has(oldHeaders[0]) || !allowedNew.has(newHeaders[0])){
      return {ok:false,reason:"EXPERIMENT_ARTIFACT_FILE_HEADER_INVALID",sha256};
    }
    patchBytes+=Buffer.byteLength(patch,"utf8");
    paths.push(pathValue);
  }
  if(new Set(paths).size!==paths.length){
    return {ok:false,reason:"EXPERIMENT_ARTIFACT_DUPLICATE_PATH",sha256};
  }
  if(patchBytes>maxPatchBytes){
    return {ok:false,reason:"EXPERIMENT_ARTIFACT_PATCH_TOO_LARGE",sha256};
  }
  return {ok:true,sha256,patchBytes,filesChanged:files.length};
}

let out;
const inputPath=safeRunnerTempPath(rawInput);
if(!rawInput){
  out=notMeasured("EXPERIMENT_RESULT_INPUT_MISSING");
}else if(!inputPath){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_PATH_UNSAFE");
}else if(!existsSync(inputPath)){
  out=notMeasured("EXPERIMENT_RESULT_INPUT_NOT_FOUND");
}else if(!realPathSafe(inputPath)){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_REALPATH_UNSAFE");
}else if(statSync(inputPath).size>65536){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_TOO_LARGE");
}else{
  let input;
  try{ input=JSON.parse(readFileSync(inputPath,"utf8")); }
  catch{ input=null; }

  if(!input){
    out=reject(null,"EXPERIMENT_RESULT_JSON_INVALID");
  }else{
    const candidate=priority.ranked.find(x=>x.id===input.candidateId);
    const check=verified.verification.find(x=>x.candidateId===input.candidateId && x.experimentId===input.experimentId);
    const manifest=manifests.manifests.find(x=>x.candidateId===input.candidateId && x.experimentId===input.experimentId);
    const artifactSha256=String(input.artifactSha256||"").toLowerCase();
    const artifactPath=safeRunnerTempPath(rawArtifact);
    const artifactInspection=inspectArtifact(artifactPath,manifest);
    const receipt=input.executionReceipt||{};
    const receiptArtifactSha256=String(receipt.artifactSha256||"").toLowerCase();
    const metric=input.primaryMetric||{};
    const before=Number(metric.before);
    const after=Number(metric.after);
    const minDelta=Number(metric.minDelta);
    const finite=[before,after,minDelta].every(Number.isFinite);
    const direction=metric.direction;
    const measuredDelta=finite
      ? direction==="lower_is_better" ? before-after : after-before
      : Number.NaN;
    const gates=input.gates||{};
    const gatesOk=
      gates.relevantTests===true &&
      gates.securityRegression===true &&
      gates.accessibilityRegression===true &&
      gates.performanceRegression===true &&
      gates.rollbackDefined===true;
    const boundaryOk=
      input.costUsd===0 &&
      input.paidProvider===false &&
      input.repoMutation===false &&
      input.productionMutation===false &&
      input.networkWrite===false &&
      input.secretAccess===false &&
      input.environmentMutation===false;
    const bindingOk=
      input.schemaVersion==="origin.self-evolution.experiment-result.v2" &&
      input.exactBaseSha===priority.exactBaseSha &&
      candidate?.actionable===true &&
      check?.eligibleForSandbox===true &&
      ["higher_is_better","lower_is_better"].includes(direction) &&
      finite &&
      minDelta>=0;
    const provenanceOk=
      manifests.exactBaseSha===priority.exactBaseSha &&
      manifest?.executionReady===true &&
      manifest?.exactBaseSha===priority.exactBaseSha &&
      input.manifestId===manifest?.manifestId &&
      input.adapterId===manifest?.adapterId &&
      input.implementationBriefId===manifest?.implementationBriefId &&
      /^[a-f0-9]{64}$/.test(artifactSha256) &&
      artifactInspection.ok===true &&
      artifactInspection.sha256===artifactSha256 &&
      receipt.schemaVersion==="origin.self-evolution.execution-receipt.v2" &&
      receipt.manifestId===manifest?.manifestId &&
      receipt.experimentId===input.experimentId &&
      receipt.candidateId===input.candidateId &&
      receipt.adapterId===manifest?.adapterId &&
      receipt.implementationBriefId===manifest?.implementationBriefId &&
      receiptArtifactSha256===artifactSha256 &&
      receipt.filesChanged===artifactInspection.filesChanged &&
      receipt.patchBytes===artifactInspection.patchBytes &&
      receipt.executionAuthority===manifest?.executionAuthority &&
      receipt.ephemeralWorkspace===true &&
      receipt.cleanWorktreeBefore===true &&
      receipt.cleanWorktreeAfter===true &&
      receipt.rollbackPlanDefined===true &&
      Number.isFinite(Number(receipt.durationMs)) &&
      Number(receipt.durationMs)>=0 &&
      Number(receipt.durationMs)<=Number(manifest?.boundaries?.maxDurationMinutes)*60000 &&
      receipt.networkWrite===false &&
      receipt.repositoryMutation===false &&
      receipt.productionMutation===false &&
      receipt.secretAccess===false &&
      receipt.environmentMutation===false &&
      receipt.paidProvider===false &&
      receipt.costUsd===0;
    const improvementOk=bindingOk && provenanceOk && measuredDelta>=minDelta && measuredDelta>0;

    if(!bindingOk) out=reject(input,"EXPERIMENT_RESULT_BINDING_INVALID");
    else if(artifactInspection.ok!==true) out=reject(input,artifactInspection.reason||"EXPERIMENT_ARTIFACT_INVALID");
    else if(!provenanceOk) out=reject(input,"EXPERIMENT_RESULT_PROVENANCE_INVALID");
    else if(!boundaryOk) out=reject(input,"EXPERIMENT_RESULT_BOUNDARY_INVALID");
    else if(!gatesOk) out=reject(input,"EXPERIMENT_RESULT_GATES_INCOMPLETE");
    else if(!improvementOk) out=reject(input,"MEASURED_IMPROVEMENT_NOT_PROVEN");
    else out={
      schemaVersion:"origin.self-evolution.experiment-result-evaluation.v2",
      generatedAt:new Date().toISOString(),
      exactBaseSha:priority.exactBaseSha,
      status:"MEASURED_IMPROVEMENT",
      accepted:true,
      reason:"MEASURED_IMPROVEMENT_VERIFIED",
      candidateId:input.candidateId,
      experimentId:input.experimentId,
      primaryMetric:{
        name:String(metric.name||"unnamed"),
        direction,
        before,
        after,
        minDelta,
        measuredDelta
      },
      gates,
      provenance:{
        manifestId:manifest.manifestId,
        adapterId:manifest.adapterId,
        implementationBriefId:manifest.implementationBriefId,
        artifactSha256,
        artifactFilesChanged:artifactInspection.filesChanged,
        artifactPatchBytes:artifactInspection.patchBytes,
        executionReceiptSchema:receipt.schemaVersion
      },
      boundary:{
        costUsd:0,
        paidProvider:false,
        repoMutation:false,
        productionMutation:false,
        networkWrite:false,
        secretAccess:false,
        environmentMutation:false
      }
    };
  }
}

writeFileSync("origin-self-evolution-experiment-result-v2.json",JSON.stringify(out,null,2)+"\n");
writeFileSync("origin-self-evolution-experiment-result-v2.md",[
  "# ORIGIN Self-Evolution V2 Experiment Result",
  "",
  `Status: ${out.status}`,
  `Accepted: ${out.accepted}`,
  `Reason: ${out.reason}`,
  `Exact base SHA: ${out.exactBaseSha}`,
  "",
  "Missing evidence remains NOT_MEASURED. Sandbox eligibility alone is never promotion evidence."
].join("\n")+"\n");

console.log(JSON.stringify({ok:true,status:out.status,accepted:out.accepted,reason:out.reason}));
