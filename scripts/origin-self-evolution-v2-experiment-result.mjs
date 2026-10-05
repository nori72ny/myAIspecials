import { existsSync, readFileSync, writeFileSync } from "node:fs";

const INPUT="origin-self-evolution-experiment-result-input-v2.json";
const priority=JSON.parse(readFileSync("origin-self-evolution-priority-v2.json","utf8"));
const verified=JSON.parse(readFileSync("origin-self-evolution-verification-v2.json","utf8"));

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

let out;
if(!existsSync(INPUT)){
  out=notMeasured("EXPERIMENT_RESULT_INPUT_MISSING");
}else{
  let input;
  try{ input=JSON.parse(readFileSync(INPUT,"utf8")); }
  catch{ input=null; }

  if(!input){
    out=reject(null,"EXPERIMENT_RESULT_JSON_INVALID");
  }else{
    const candidate=priority.ranked.find(x=>x.id===input.candidateId);
    const check=verified.verification.find(x=>x.candidateId===input.candidateId && x.experimentId===input.experimentId);
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
      input.productionMutation===false;
    const bindingOk=
      input.schemaVersion==="origin.self-evolution.experiment-result.v2" &&
      input.exactBaseSha===priority.exactBaseSha &&
      candidate?.actionable===true &&
      check?.eligibleForSandbox===true &&
      ["higher_is_better","lower_is_better"].includes(direction) &&
      finite &&
      minDelta>=0;
    const improvementOk=bindingOk && measuredDelta>=minDelta && measuredDelta>0;

    if(!bindingOk) out=reject(input,"EXPERIMENT_RESULT_BINDING_INVALID");
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
      boundary:{
        costUsd:0,
        paidProvider:false,
        repoMutation:false,
        productionMutation:false
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
