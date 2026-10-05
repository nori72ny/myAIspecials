import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { readBoundedRunnerTempFile } from "./origin-self-evolution-v2-runner-temp.mjs";
import { materializeArtifactAgainstExactBase } from "./origin-self-evolution-v2-materialize.mjs";

const rawInput=String(process.env.ORIGIN_SELF_EVOLUTION_EXPERIMENT_RESULT_PATH||"");
const rawArtifact=String(process.env.ORIGIN_SELF_EVOLUTION_EXPERIMENT_ARTIFACT_PATH||"");
const rawMetricEvidence=String(process.env.ORIGIN_SELF_EVOLUTION_METRIC_EVIDENCE_PATH||"");
const rawGateEvidence=String(process.env.ORIGIN_SELF_EVOLUTION_GATE_EVIDENCE_PATH||"");
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

function artifactReadReason(code){
  if(code==="NOT_FOUND") return "EXPERIMENT_ARTIFACT_NOT_FOUND";
  if(code==="TOO_LARGE") return "EXPERIMENT_ARTIFACT_FILE_TOO_LARGE";
  if(code==="REALPATH_UNSAFE") return "EXPERIMENT_ARTIFACT_REALPATH_UNSAFE";
  if(code==="CHANGED_DURING_READ") return "EXPERIMENT_ARTIFACT_CHANGED_DURING_READ";
  if(code==="PLATFORM_UNSUPPORTED") return "EXPERIMENT_ARTIFACT_PLATFORM_UNSUPPORTED";
  return "EXPERIMENT_ARTIFACT_PATH_UNSAFE";
}

function finitePairedSamples(samples){
  if(!Array.isArray(samples) || samples.length<1 || samples.length>100) return false;
  const ids=new Set();
  for(const sample of samples){
    const caseId=sample?.caseId;
    if(typeof caseId!=="string" || caseId.length<1 || caseId.length>128 || !/^[A-Za-z0-9._:/-]+$/.test(caseId)) return false;
    if(ids.has(caseId)) return false;
    if(typeof sample?.before!=="number" || !Number.isFinite(sample.before)) return false;
    if(typeof sample?.after!=="number" || !Number.isFinite(sample.after)) return false;
    ids.add(caseId);
  }
  return true;
}

function average(values){
  return values.reduce((sum,value)=>sum+value,0)/values.length;
}

function nearlyEqual(a,b){
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=1e-12;
}

function inspectMetricEvidence(rawPath,manifest,claimedSha256,inputMetric){
  const read=readBoundedRunnerTempFile(rawPath,runnerTemp,65536);
  if(read.ok!==true) return {ok:false,reason:`EXPERIMENT_METRIC_EVIDENCE_${read.code}`};
  const sha256=createHash("sha256").update(read.bytes).digest("hex");
  if(!/^[a-f0-9]{64}$/.test(String(claimedSha256||"").toLowerCase()) || sha256!==String(claimedSha256||"").toLowerCase()){
    return {ok:false,reason:"EXPERIMENT_METRIC_EVIDENCE_DIGEST_INVALID",sha256};
  }
  let evidence;
  try{ evidence=JSON.parse(read.bytes.toString("utf8")); }
  catch{ return {ok:false,reason:"EXPERIMENT_METRIC_EVIDENCE_JSON_INVALID",sha256}; }

  const metric=evidence?.metric||{};
  const samples=metric.samples;
  const direction=metric.direction;
  const minDelta=Number(metric.minDelta);
  if(
    evidence?.schemaVersion!=="origin.self-evolution.metric-evidence.v2" ||
    evidence?.exactBaseSha!==manifest?.exactBaseSha ||
    evidence?.manifestId!==manifest?.manifestId ||
    evidence?.candidateId!==manifest?.candidateId ||
    evidence?.experimentId!==manifest?.experimentId ||
    evidence?.evidenceKind!=="REPRODUCIBLE_NON_HELD_OUT" ||
    evidence?.privateHeldOut!==false ||
    typeof metric.name!=="string" ||
    !metric.name ||
    !["higher_is_better","lower_is_better"].includes(direction) ||
    !Number.isFinite(minDelta) ||
    minDelta<0 ||
    !finitePairedSamples(samples)
  ){
    return {ok:false,reason:"EXPERIMENT_METRIC_EVIDENCE_BINDING_INVALID",sha256};
  }

  const before=average(samples.map(sample=>sample.before));
  const after=average(samples.map(sample=>sample.after));
  const caseIds=samples.map(sample=>sample.caseId).sort();
  const caseSetDigest=createHash("sha256").update(caseIds.join("\n")).digest("hex");
  const measuredDelta=direction==="lower_is_better"?before-after:after-before;
  if(
    inputMetric?.name!==metric.name ||
    inputMetric?.direction!==direction ||
    !nearlyEqual(Number(inputMetric?.minDelta),minDelta) ||
    !nearlyEqual(Number(inputMetric?.before),before) ||
    !nearlyEqual(Number(inputMetric?.after),after)
  ){
    return {ok:false,reason:"EXPERIMENT_METRIC_SUMMARY_MISMATCH",sha256};
  }

  return {
    ok:true,
    reason:"EXPERIMENT_METRIC_EVIDENCE_VERIFIED",
    sha256,
    name:metric.name,
    direction,
    minDelta,
    before,
    after,
    measuredDelta,
    sampleCounts:{paired:samples.length},
    caseSetDigest,
    caseIds
  };
}

const REQUIRED_GATE_HARNESSES=Object.freeze({
  relevantTests:"origin-gate-tests-v2",
  securityRegression:"origin-gate-security-v2",
  accessibilityRegression:"origin-gate-accessibility-v2",
  performanceRegression:"origin-gate-performance-v2",
  rollbackDefined:"origin-gate-rollback-v2"
});

function hasExecutableField(value){
  if(!value || typeof value!=="object") return false;
  for(const [key,child] of Object.entries(value)){
    if(["command","cmd","shell","script","args","argv","executable"].includes(String(key).toLowerCase())) return true;
    if(hasExecutableField(child)) return true;
  }
  return false;
}

function inspectGateEvidence(rawPath,manifest,claimedSha256,inputGates){
  const read=readBoundedRunnerTempFile(rawPath,runnerTemp,65536);
  if(read.ok!==true) return {ok:false,reason:`EXPERIMENT_GATE_EVIDENCE_${read.code}`};
  const sha256=createHash("sha256").update(read.bytes).digest("hex");
  if(!/^[a-f0-9]{64}$/.test(String(claimedSha256||"").toLowerCase()) || sha256!==String(claimedSha256||"").toLowerCase()){
    return {ok:false,reason:"EXPERIMENT_GATE_EVIDENCE_DIGEST_INVALID",sha256};
  }
  let evidence;
  try{ evidence=JSON.parse(read.bytes.toString("utf8")); }
  catch{ return {ok:false,reason:"EXPERIMENT_GATE_EVIDENCE_JSON_INVALID",sha256}; }

  if(hasExecutableField(evidence)){
    return {ok:false,reason:"EXPERIMENT_GATE_EVIDENCE_EXECUTABLE_CONTENT_BLOCKED",sha256};
  }
  if(
    evidence?.schemaVersion!=="origin.self-evolution.gate-evidence.v2" ||
    evidence?.exactBaseSha!==manifest?.exactBaseSha ||
    evidence?.manifestId!==manifest?.manifestId ||
    evidence?.candidateId!==manifest?.candidateId ||
    evidence?.experimentId!==manifest?.experimentId ||
    evidence?.evidenceKind!=="TRUSTED_ISOLATED_HARNESS" ||
    evidence?.privateHeldOut!==false ||
    !Array.isArray(evidence?.observations) ||
    evidence.observations.length!==Object.keys(REQUIRED_GATE_HARNESSES).length
  ){
    return {ok:false,reason:"EXPERIMENT_GATE_EVIDENCE_BINDING_INVALID",sha256};
  }

  const observations=new Map();
  for(const observation of evidence.observations){
    const gateId=observation?.gateId;
    const expectedHarness=REQUIRED_GATE_HARNESSES[gateId];
    if(
      !expectedHarness ||
      observations.has(gateId) ||
      observation?.harnessId!==expectedHarness ||
      observation?.status!=="PASS" ||
      observation?.exitCode!==0 ||
      !/^[a-f0-9]{64}$/.test(String(observation?.outputSha256||"").toLowerCase())
    ){
      return {ok:false,reason:"EXPERIMENT_GATE_EVIDENCE_OBSERVATION_INVALID",sha256};
    }
    observations.set(gateId,{
      gateId,
      harnessId:expectedHarness,
      outputSha256:String(observation.outputSha256).toLowerCase()
    });
  }

  const derived={};
  for(const gateId of Object.keys(REQUIRED_GATE_HARNESSES)) derived[gateId]=observations.has(gateId);
  const summaryMatches=Object.entries(derived).every(([gateId,passed])=>inputGates?.[gateId]===passed);
  if(!summaryMatches){
    return {ok:false,reason:"EXPERIMENT_GATE_SUMMARY_MISMATCH",sha256};
  }

  const canonical=[...observations.values()]
    .sort((a,b)=>a.gateId.localeCompare(b.gateId))
    .map(x=>[x.gateId,x.harnessId,x.outputSha256].join("|"))
    .join("\n");
  const observationSetDigest=createHash("sha256").update(canonical).digest("hex");
  return {
    ok:true,
    reason:"EXPERIMENT_GATE_EVIDENCE_VERIFIED",
    sha256,
    derived,
    observationSetDigest,
    observationCount:observations.size
  };
}

function inspectArtifact(rawPath,manifest){
  const maxPatchBytes=Number(manifest?.boundaries?.maxPatchBytes||0);
  const maxFilesChanged=Number(manifest?.boundaries?.maxFilesChanged||0);
  if(!Number.isFinite(maxPatchBytes) || maxPatchBytes<=0 || !Number.isFinite(maxFilesChanged) || maxFilesChanged<=0){
    return {ok:false,reason:"EXPERIMENT_ARTIFACT_POLICY_INVALID"};
  }

  const artifactRead=readBoundedRunnerTempFile(rawPath,runnerTemp,Math.max(262144,maxPatchBytes*2));
  if(artifactRead.ok!==true) return {ok:false,reason:artifactReadReason(artifactRead.code)};

  const bytes=artifactRead.bytes;
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
    const forbiddenDirectives=[
      "rename from ",
      "rename to ",
      "copy from ",
      "copy to ",
      "GIT binary patch",
      "literal ",
      "delta "
    ];
    if(lines.some(line=>forbiddenDirectives.some(prefix=>line.startsWith(prefix)))){
      return {ok:false,reason:"EXPERIMENT_ARTIFACT_PATCH_DIRECTIVE_BLOCKED",sha256};
    }
    const headers=lines.filter(line=>line.startsWith("diff --git "));
    if(headers.length!==1 || headers[0]!==`diff --git a/${pathValue} b/${pathValue}`){
      return {ok:false,reason:"EXPERIMENT_ARTIFACT_PATCH_HEADER_INVALID",sha256};
    }
    const firstHunk=lines.findIndex(line=>line.startsWith("@@ "));
    if(firstHunk<0){
      return {ok:false,reason:"EXPERIMENT_ARTIFACT_PATCH_HUNK_MISSING",sha256};
    }
    const preamble=lines.slice(0,firstHunk);
    const oldHeaders=preamble.filter(line=>line.startsWith("--- "));
    const newHeaders=preamble.filter(line=>line.startsWith("+++ "));
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
  return {ok:true,sha256,patchBytes,filesChanged:files.length,artifact};
}

let out;
const inputRead=readBoundedRunnerTempFile(rawInput,runnerTemp,65536);
if(!rawInput){
  out=notMeasured("EXPERIMENT_RESULT_INPUT_MISSING");
}else if(inputRead.code==="NOT_FOUND"){
  out=notMeasured("EXPERIMENT_RESULT_INPUT_NOT_FOUND");
}else if(inputRead.code==="TOO_LARGE"){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_TOO_LARGE");
}else if(inputRead.code==="REALPATH_UNSAFE"){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_REALPATH_UNSAFE");
}else if(inputRead.code==="CHANGED_DURING_READ"){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_CHANGED_DURING_READ");
}else if(inputRead.ok!==true){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_PATH_UNSAFE");
}else{
  let input;
  try{ input=JSON.parse(inputRead.bytes.toString("utf8")); }
  catch{ input=null; }

  if(!input){
    out=reject(null,"EXPERIMENT_RESULT_JSON_INVALID");
  }else{
    const candidate=priority.ranked.find(x=>x.id===input.candidateId);
    const check=verified.verification.find(x=>x.candidateId===input.candidateId && x.experimentId===input.experimentId);
    const manifest=manifests.manifests.find(x=>x.candidateId===input.candidateId && x.experimentId===input.experimentId);
    const artifactSha256=String(input.artifactSha256||"").toLowerCase();
    const artifactInspection=inspectArtifact(rawArtifact,manifest);
    const repositoryRoot=String(process.env.ORIGIN_SELF_EVOLUTION_REPOSITORY_ROOT||process.cwd());
    const materialization=artifactInspection.ok===true
      ? materializeArtifactAgainstExactBase({
          artifact:artifactInspection.artifact,
          artifactSha256:artifactInspection.sha256,
          exactBaseSha:priority.exactBaseSha,
          runnerTemp,
          repositoryRoot
        })
      : {ok:false,reason:"MATERIALIZATION_SKIPPED_ARTIFACT_INVALID"};
    const receipt=input.executionReceipt||{};
    const receiptArtifactSha256=String(receipt.artifactSha256||"").toLowerCase();
    const metric=input.primaryMetric||{};
    const metricEvidenceSha256=String(input.metricEvidenceSha256||"").toLowerCase();
    const metricEvidence=inspectMetricEvidence(rawMetricEvidence,manifest,metricEvidenceSha256,metric);
    const gateEvidenceSha256=String(input.gateEvidenceSha256||"").toLowerCase();
    const gateEvidence=inspectGateEvidence(rawGateEvidence,manifest,gateEvidenceSha256,input.gates||{});
    const before=metricEvidence.ok===true?metricEvidence.before:Number.NaN;
    const after=metricEvidence.ok===true?metricEvidence.after:Number.NaN;
    const minDelta=metricEvidence.ok===true?metricEvidence.minDelta:Number.NaN;
    const finite=[before,after,minDelta].every(Number.isFinite);
    const direction=metricEvidence.ok===true?metricEvidence.direction:null;
    const measuredDelta=metricEvidence.ok===true?metricEvidence.measuredDelta:Number.NaN;
    const gates=gateEvidence.ok===true?gateEvidence.derived:{};
    const gatesOk=
      gateEvidence.ok===true &&
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
      materialization.ok===true &&
      receipt.schemaVersion==="origin.self-evolution.execution-receipt.v2" &&
      receipt.manifestId===manifest?.manifestId &&
      receipt.experimentId===input.experimentId &&
      receipt.candidateId===input.candidateId &&
      receipt.adapterId===manifest?.adapterId &&
      receipt.implementationBriefId===manifest?.implementationBriefId &&
      receiptArtifactSha256===artifactSha256 &&
      metricEvidence.ok===true &&
      receipt.metricEvidenceSha256===metricEvidenceSha256 &&
      receipt.metricCaseSetDigest===metricEvidence.caseSetDigest &&
      gateEvidence.ok===true &&
      receipt.gateEvidenceSha256===gateEvidenceSha256 &&
      receipt.gateObservationSetDigest===gateEvidence.observationSetDigest &&
      receipt.materializationDigest===materialization.materializationDigest &&
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

    if(metricEvidence.ok!==true) out=reject(input,metricEvidence.reason||"EXPERIMENT_METRIC_EVIDENCE_INVALID");
    else if(gateEvidence.ok!==true) out=reject(input,gateEvidence.reason||"EXPERIMENT_GATE_EVIDENCE_INVALID");
    else if(!bindingOk) out=reject(input,"EXPERIMENT_RESULT_BINDING_INVALID");
    else if(artifactInspection.ok!==true) out=reject(input,artifactInspection.reason||"EXPERIMENT_ARTIFACT_INVALID");
    else if(materialization.ok!==true) out=reject(input,materialization.reason||"MATERIALIZATION_VERIFICATION_FAILED");
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
        metricEvidenceSha256,
        metricEvidenceSampleCounts:metricEvidence.sampleCounts,
        metricCaseSetDigest:metricEvidence.caseSetDigest,
        metricCaseIds:metricEvidence.caseIds,
        gateEvidenceSha256,
        gateObservationSetDigest:gateEvidence.observationSetDigest,
        gateObservationCount:gateEvidence.observationCount,
        artifactFilesChanged:artifactInspection.filesChanged,
        artifactPatchBytes:artifactInspection.patchBytes,
        materializationDigest:materialization.materializationDigest,
        materializedChangedPaths:materialization.changedPaths,
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
