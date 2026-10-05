import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const rawInput=String(process.env.ORIGIN_SELF_EVOLUTION_EXPERIMENT_RESULT_PATH||"");
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

function safeInputPath(){
  if(!rawInput) return null;
  if(!runnerTemp || !isAbsolute(rawInput)) return null;
  const root=resolve(runnerTemp);
  const file=resolve(rawInput);
  const rel=relative(root,file);
  if(rel.startsWith("..") || isAbsolute(rel)) return null;
  return file;
}

let out;
const inputPath=safeInputPath();
if(!rawInput){
  out=notMeasured("EXPERIMENT_RESULT_INPUT_MISSING");
}else if(!inputPath){
  out=reject(null,"EXPERIMENT_RESULT_INPUT_PATH_UNSAFE");
}else if(!existsSync(inputPath)){
  out=notMeasured("EXPERIMENT_RESULT_INPUT_NOT_FOUND");
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
      receipt.schemaVersion==="origin.self-evolution.execution-receipt.v2" &&
      receipt.manifestId===manifest?.manifestId &&
      receipt.experimentId===input.experimentId &&
      receipt.candidateId===input.candidateId &&
      receipt.adapterId===manifest?.adapterId &&
      receipt.implementationBriefId===manifest?.implementationBriefId &&
      receiptArtifactSha256===artifactSha256 &&
      receipt.executionAuthority===manifest?.executionAuthority &&
      receipt.ephemeralWorkspace===true &&
      receipt.networkWrite===false &&
      receipt.repositoryMutation===false &&
      receipt.productionMutation===false &&
      receipt.secretAccess===false &&
      receipt.environmentMutation===false &&
      receipt.paidProvider===false &&
      receipt.costUsd===0;
    const improvementOk=bindingOk && provenanceOk && measuredDelta>=minDelta && measuredDelta>0;

    if(!bindingOk) out=reject(input,"EXPERIMENT_RESULT_BINDING_INVALID");
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
